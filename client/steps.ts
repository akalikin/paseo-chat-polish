import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

// Merged steps: each run of consecutive thoughts and tool calls between replies folds into one row.
// A transformer sees one item at a time, so the runs come from each open agent's own timeline (fetched
// and followed live); the transformer looks its item up here: the run's first step becomes the merged
// row, the others are removed from the list (never hidden in place: that crashed Paseo's virtual list).

type Item = AgentTimelineItem;
export type Phase = "streaming" | "complete";
/** A timeline item and when it last changed (ms). */
export interface Entry {
  item: Item;
  at: number;
}
export interface Run {
  steps: Item[];
  /** From the end of what came before the run to the last step's latest update. */
  ms: number;
  /** Nothing has come after the run yet: while the agent works, its next step may still join. */
  open: boolean;
}

/** The id a step has both in the app and in the daemon's timeline: tool calls by callId, thoughts (which carry none) by their opening words. */
export function stepKey(item: Item): string | undefined {
  if (item.type === "tool_call") return item.detail.type === "plan" ? undefined : `t:${item.callId}`;
  if (item.type !== "reasoning") return undefined;
  const words = item.text.replace(/\s+/g, " ").trim().slice(0, 80);
  return words ? `r:${words}` : undefined;
}

/** Folds a live timeline event into an agent's list the way the daemon's projection does: tool updates replace their call, thought chunks
 * extend the thought before. Returns false when the runs can't have changed (a reply chunk after a reply), so streaming text costs nothing. */
export function applyItem(list: Entry[], item: Item, at: number): boolean {
  const last = list.at(-1);
  if (item.type === "tool_call") {
    const i = list.findLastIndex((e) => e.item.type === "tool_call" && e.item.callId === item.callId);
    if (i < 0) return (list.push({ item, at }), true);
    const old = list[i]!.item as typeof item;
    list[i] = { item: { ...old, ...item, detail: item.detail.type === "unknown" ? old.detail : item.detail }, at };
  } else if (item.type === "reasoning" && last?.item.type === "reasoning") {
    list[list.length - 1] = { item: { type: "reasoning", text: last.item.text + item.text }, at };
  } else if (item.type === "assistant_message" && last?.item.type === "assistant_message") {
    // Reply chunks only matter as the end of a run, so one per reply is kept (with the time of the latest).
    last.at = at;
    return false;
  } else list.push({ item, at });
  return true;
}

/** Runs of consecutive steps; anything else ends a run, and steps `skip` names (hidden by prefs) are passed over. */
export function stepRuns(list: readonly Entry[], skip: (item: Item) => boolean): Run[] {
  const runs: Run[] = [];
  let run: Item[] = [];
  let start = 0;
  let end = 0;
  const close = (open = false) => {
    if (run.length) runs.push({ steps: run, ms: Math.max(0, end - start), open });
    run = [];
  };
  for (const [i, { item, at }] of list.entries()) {
    if (!stepKey(item)) {
      close();
      continue;
    }
    if (skip(item)) continue;
    if (!run.length) start = list[i - 1]?.at ?? at;
    run.push(item);
    end = Math.max(end, at);
  }
  close(true);
  return runs;
}

const PASEO_TOOL = /^(mcp__paseo(_[a-z0-9_]*)?__.|paseo(_[a-z0-9_]*)?\.|paseo_)/;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace("#", String(n));

/** "Thought 2 times, edited 1 file and ran 3 commands": what a run did, in the words and order of Paseo's own groups. */
export function stepSummary(items: readonly Item[]): string {
  const edited = new Set<string>();
  const read = new Set<string>();
  let thoughts = 0;
  let commands = 0;
  let searches = 0;
  let other = 0;
  let paseo = 0;
  for (const item of items) {
    if (item.type === "reasoning") thoughts++;
    if (item.type !== "tool_call") continue;
    const d = item.detail;
    if (PASEO_TOOL.test(item.name.trim().toLowerCase())) paseo++;
    else if (d.type === "edit" || d.type === "write") edited.add(d.filePath);
    else if (d.type === "shell") commands++;
    else if (d.type === "read") read.add(d.filePath);
    else if (d.type === "search") searches++;
    else other++;
  }
  const parts = [
    thoughts && plural(thoughts, "thought # time", "thought # times"),
    edited.size && plural(edited.size, "edited # file", "edited # files"),
    commands && plural(commands, "ran # command", "ran # commands"),
    read.size && plural(read.size, "read # file", "read # files"),
    searches && plural(searches, "searched # time", "searched # times"),
    other && plural(other, "used # other tool", "used # other tools"),
    paseo && plural(paseo, "called Paseo # time", "called Paseo # times"),
  ].filter((p): p is string => !!p);
  const text = parts.length > 2 ? `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}` : parts.join(" and ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The live state: every open agent's list, and where each step sits.
const lists = new Map<string, Entry[]>();
const keysByAgent = new Map<string, string[]>();
const runs = new Map<string, Run>();
const places = new Map<string, { head: string; index: number }>();
/** The app's own copy of each step (with its phase), newer than the daemon's while it streams. */
const seen = new Map<string, { item: Item; phase: Phase }>();
/** What the transformer last made of each step, to tell when Paseo must transform again. */
const made = new Map<string, "plain" | "head" | "none">();
// ponytail: seen keeps the latest few thousand steps across agents; key it per agent if long sessions show stale rows.
const SEEN_MAX = 4000;

const headListeners = new Map<string, Set<() => void>>();
const versions = new Map<string, number>();
const dirty = new Set<string>();
let flushQueued = false;
let onStale: () => void = () => {};
let skip: (item: Item) => boolean = () => false;

/** Steps the transformer hides (prefs) are left out of runs; re-splits every agent when that changes. */
export function setStepSkip(fn: (item: Item) => boolean) {
  skip = fn;
  for (const agentId of lists.keys()) rebuild(agentId);
}

function touch(head: string) {
  dirty.add(head);
  if (flushQueued) return;
  flushQueued = true;
  // Transformers run during Paseo's render; listeners are told afterwards so no component updates mid-render.
  queueMicrotask(() => {
    flushQueued = false;
    for (const h of dirty) {
      versions.set(h, (versions.get(h) ?? 0) + 1);
      headListeners.get(h)?.forEach((l) => l());
    }
    dirty.clear();
  });
}

function unplace(agentId: string) {
  for (const key of keysByAgent.get(agentId) ?? []) {
    places.delete(key);
    runs.delete(key);
  }
}

/** Re-splits one agent's runs after its list changed (about 3ms for 1000 items), and asks for a fresh transform if a step now belongs elsewhere. */
function rebuild(agentId: string) {
  unplace(agentId);
  const keys: string[] = [];
  for (const run of stepRuns(lists.get(agentId) ?? [], skip)) {
    const head = stepKey(run.steps[0]!)!;
    const before = runs.get(head);
    runs.set(head, run);
    if (before?.ms !== run.ms || before.open !== run.open || before.steps.length !== run.steps.length || before.steps.some((x, i) => x !== run.steps[i])) touch(head);
    run.steps.forEach((item, index) => {
      const key = stepKey(item)!;
      places.set(key, { head, index });
      keys.push(key);
    });
  }
  keysByAgent.set(agentId, keys);
  if (keys.some(stale)) onStale();
}

/** A step the transformer made differently than it would now; a lone step made plain is fine until its run grows. */
function stale(key: string) {
  const was = made.get(key);
  const now = expected(key);
  if (!was || was === now) return false;
  return !(was === "plain" && now === "head" && (runs.get(key)?.steps.length ?? 1) === 1);
}

function expected(key: string) {
  const place = places.get(key);
  if (!place) return "plain";
  return place.index > 0 ? "none" : "head";
}

/** Called by the transformer for every step: "head" (render the merged row), "none" (leave it out) or "plain" (unknown, render alone). */
export function placeStep(item: Item, phase: Phase): { key: string; as: "plain" | "head" | "none" } | undefined {
  const key = stepKey(item);
  if (!key) return undefined;
  seen.delete(key);
  seen.set(key, { item, phase });
  if (seen.size > SEEN_MAX) for (const old of [...seen.keys()].slice(0, SEEN_MAX / 4)) seen.delete(old);
  const as = expected(key);
  made.set(key, as);
  const place = places.get(key);
  if (place) touch(place.head);
  return { key, as };
}

/** Keeps an agent's list current: the latest 1000 entries, then live events (those that raced the fetch are replayed past its end). */
export function followAgent(paseo: PluginClientContext["paseo"], agentId: string) {
  const timeline = paseo.agents.ref(agentId).timeline;
  let pending: Array<{ seq?: number; item: Item; at: number }> | undefined;
  let closed = false;
  const load = async () => {
    pending = [];
    try {
      const page = await timeline.refetch({ direction: "tail", limit: 1000, projection: "projected" });
      if (closed) return;
      const list = page.entries.map((e) => ({ item: e.item as Item, at: Date.parse(e.timestamp) || 0 }));
      const end = page.endCursor?.seq ?? -1;
      for (const e of pending) if (e.seq === undefined || e.seq > end) applyItem(list, e.item, e.at);
      lists.set(agentId, list);
      rebuild(agentId);
    } catch (error) {
      console.warn("[chat-polish] Couldn't load the timeline to merge steps", error);
    } finally {
      pending = undefined;
    }
  };
  const subscription = timeline.subscribe((payload) => {
    const { event } = payload;
    if (event.type === "timeline") {
      const item = event.item as Item;
      const at = ("timestamp" in payload && Date.parse(payload.timestamp)) || Date.now();
      if (pending) return void pending.push({ seq: "seq" in payload ? payload.seq : undefined, item, at });
      const list = lists.get(agentId);
      if (list && applyItem(list, item, at)) rebuild(agentId);
    } else if (event.type === "replacement" || event.type === "subscription_restored") void load();
  });
  subscription.ready.then(load, (error: unknown) => console.warn("[chat-polish] Couldn't follow the timeline to merge steps", error));
  return () => {
    closed = true;
    subscription();
    unplace(agentId);
    keysByAgent.delete(agentId);
    lists.delete(agentId);
  };
}

/** After a fresh transform everything is made again. */
export const resetMade = () => made.clear();
export const onStaleSteps = (fn: () => void) => void (onStale = fn);

/** A run's steps as the app last saw them and its duration; a single step when the head isn't known (yet). */
export function runOf(head: string): { steps: Array<{ item: Item; phase: Phase }>; ms?: number; open?: boolean } {
  const run = runs.get(head);
  if (!run) {
    const own = seen.get(head);
    return { steps: own ? [own] : [] };
  }
  return { steps: run.steps.map((item) => seen.get(stepKey(item)!) ?? { item, phase: "complete" as const }), ms: run.ms, open: run.open };
}

export function subscribeRun(head: string, listener: () => void) {
  let set = headListeners.get(head);
  if (!set) headListeners.set(head, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) headListeners.delete(head);
  };
}

export const runVersion = (head: string) => versions.get(head) ?? 0;
