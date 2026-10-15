import { Platform } from "react-native";
import { BOT_ICON, PROVIDER_ICONS } from "./provider-icons";

declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
declare const location: { reload(): void };
interface DomElement {
  parentElement: DomElement | null;
  firstElementChild: DomElement | null;
  lastElementChild: DomElement | null;
  previousElementSibling: DomElement | null;
  scrollHeight: number;
  textContent: string | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  style: { setProperty(name: string, value: string, priority?: string): void; removeProperty(name: string): void };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  matches(selector: string): boolean;
  closest(selector: string): DomElement | null;
  tagName: string;
  removeAttribute(name: string): void;
  addEventListener(type: "click" | "mouseover" | "mouseleave", listener: (event: { target: unknown }) => void, capture?: boolean): void;
  removeEventListener(type: "click" | "mouseover" | "mouseleave", listener: (event: { target: unknown }) => void, capture?: boolean): void;
  remove(): void;
  // Used by the model selector.
  children: ArrayLike<DomElement>;
  firstChild: { nodeValue: string | null } | null;
  innerHTML: string;
  outerHTML: string;
  scrollTop: number;
  appendChild(el: DomElement): void;
  click(): void;
  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number };
}
declare const document: {
  documentElement: DomElement;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  createElement(tag: "style" | "div" | "span"): DomElement;
  addEventListener(type: "click", listener: (event: { target: unknown }) => void, capture?: boolean): void;
  removeEventListener(type: "click", listener: (event: { target: unknown }) => void, capture?: boolean): void;
  body: unknown;
  head: { appendChild(el: DomElement): void };
};
declare const HTMLIFrameElement: { prototype: { setAttribute(name: string, value: string): void } };
type MessageListener = (event: { source: unknown; data: unknown }) => void;
declare const window: { addEventListener(type: "message", listener: MessageListener): void; removeEventListener(type: "message", listener: MessageListener): void };
declare function requestAnimationFrame(cb: () => void): number;
declare function getComputedStyle(el: DomElement): {
  borderRightWidth: string;
  borderRightStyle: string;
  borderLeftWidth: string;
  borderTopWidth: string;
  borderBottomWidth: string;
  borderRadius: string;
  backgroundColor: string;
  lineHeight: string;
  fontSize: string;
  fontWeight: string;
  fontFamily: string;
  marginLeft: string;
  height: string;
  color: string;
};
declare function getSelection(): { toString(): string } | null;
declare class MutationObserver {
  constructor(cb: (records: Array<{ addedNodes: ArrayLike<unknown> }>) => void);
  observe(target: unknown, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
}

const SETTINGS_KEY = "@paseo:app-settings";

export interface HostAppearance {
  uiFont?: string;
  monoFont?: string;
  contentSize: number;
  codeSize: number;
  pluginThemeId?: string;
  /** Settings → Appearance → Always expand reasoning. */
  autoExpandReasoning: boolean;
  /** Settings → Tool call display: "overview" (Summary) groups consecutive calls, "detailed" lists each one. */
  toolCallDetail: "overview" | "detailed";
}

const DEFAULTS: HostAppearance = { contentSize: 15, codeSize: 12, autoExpandReasoning: false, toolCallDetail: "detailed" };
let cache: { at: number; value: HostAppearance } | undefined;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const size = (v: unknown, fallback: number) => (typeof v === "number" && v >= 8 && v <= 32 ? v : fallback);

/**
 * Settings → Appearance fonts, sizes and reasoning expansion, which the plugin API doesn't pass to plugins.
 * ponytail: reads the desktop/web app's own `@paseo:app-settings` storage (undocumented, may move);
 * iOS/Android get defaults. Switch to a host settings API once Paseo exposes one.
 */
export function readHostAppearance(): HostAppearance {
  if (Platform.OS !== "web") return DEFAULTS;
  if (cache && Date.now() - cache.at < 2000) return cache.value;
  let value = DEFAULTS;
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Record<string, unknown> | null;
    if (s && typeof s === "object") {
      value = {
        uiFont: text(s.uiFontFamily),
        monoFont: text(s.monoFontFamily),
        contentSize: size(s.contentFontSize, DEFAULTS.contentSize),
        codeSize: size(s.codeFontSize, DEFAULTS.codeSize),
        pluginThemeId: s.theme === "plugin" ? text(s.pluginThemeId) : undefined,
        autoExpandReasoning: s.autoExpandReasoning === true,
        // Same fallback as Paseo: the legacy compactToolCalls flag, then "detailed"; "concise" is the old "overview".
        toolCallDetail: ["overview", "concise"].includes(String(s.toolCallDetailLevel)) || (s.toolCallDetailLevel === undefined && s.compactToolCalls === true) ? "overview" : "detailed",
      };
    }
  } catch {
    // Unreadable or missing settings: keep Paseo's defaults.
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Whether this client can switch Paseo's app theme itself (desktop and web). */
export const canSetAppTheme = Platform.OS === "web";

/**
 * Selects a plugin theme as Paseo's app theme the way Settings → Appearance does, then reloads the
 * app so it is applied. `catalogId` is `<plugin id>/theme/<theme id>`.
 * ponytail: writes Paseo's private settings document (undocumented); replace with a host
 * "select theme" API once Paseo offers one.
 */
export function setAppTheme(catalogId: string) {
  updateAppSettings({ theme: "plugin", pluginThemeId: catalogId });
}

/** Changes Paseo's own app settings (desktop/web) and reloads so Paseo picks them up. Same caveat as setAppTheme. */
export function updateAppSettings(patch: Record<string, unknown>) {
  if (!canSetAppTheme) return;
  let current: Record<string, unknown> = {};
  try {
    current = (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, unknown> | null) ?? {};
  } catch {
    // Start from Paseo's defaults rather than refusing to switch.
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
  cache = undefined;
  location.reload();
}

/** Paseo's current code-block syntax theme (Settings → Appearance), desktop/web only. */
export function readSyntaxTheme(): string | undefined {
  if (!canSetAppTheme) return undefined;
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as { syntaxTheme?: unknown } | null;
    return typeof s?.syntaxTheme === "string" ? s.syntaxTheme : "one";
  } catch {
    return undefined;
  }
}

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

/** Elements matching `selector` within the added roots, the roots themselves included. */
const within = (roots: DomElement[], selector: string) => roots.flatMap((root) => [...(root.matches(selector) ? [root] : []), ...Array.from(root.querySelectorAll(selector))]);

interface DomWatcher {
  /** Runs before the browser paints, with the elements just added (initially the whole body), so restyled parts never flash. */
  added?: (roots: DomElement[]) => void;
  /** Runs at most every 250ms once mutations settle (they stream in while agents run). */
  settled?: () => void;
}

// One observer for every watcher: Paseo mutates the DOM on each streamed token.
const watchers = new Set<DomWatcher>();
let observer: MutationObserver | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function settle() {
  settleTimer = undefined;
  for (const w of watchers) w.settled?.();
}

/**
 * Watches the DOM for the restyles below; also how the plugin notices host settings that change without
 * telling plugins. Returns cleanup, which runs `cleanup` after the watcher is removed.
 */
export function watchDom(watcher: DomWatcher, cleanup: () => void) {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  watchers.add(watcher);
  if (!observer) {
    observer = new MutationObserver((records) => {
      const roots: DomElement[] = [];
      for (const record of records) for (const node of Array.from(record.addedNodes)) if ((node as { nodeType?: number }).nodeType === 1) roots.push(node as DomElement);
      if (roots.length) for (const w of watchers) w.added?.(roots);
      settleTimer ??= setTimeout(settle, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  watcher.added?.([document.body as DomElement]);
  watcher.settled?.();
  return () => {
    watchers.delete(watcher);
    if (!watchers.size) {
      observer?.disconnect();
      observer = undefined;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = undefined;
    }
    cleanup();
  };
}

/**
 * Paints Paseo's desktop sidebars (left nav, right explorer) while `colors()` returns colors; dark plugin
 * themes can't set them because Paseo reuses the background. Inside the explorer only surfaces that show the
 * plain background are repainted, so hover and selection keep their colors. Returns cleanup.
 * ponytail: finds the left sidebar as the bordered ancestor of its Search row and the explorer by testID;
 * breaks if Paseo renames those. Replace with a sidebar theme token once Paseo has one.
 */
export function paintSidebar(colors: () => { sidebar: string; background: string } | undefined) {
  let painted: DomElement[] = [];
  const unpaint = () => {
    for (const el of painted) el.style.removeProperty("background-color");
    painted = [];
  };
  return watchDom({ settled: () => {
    unpaint();
    const want = colors();
    if (!want) return;
    let left = document.querySelector('[data-testid="sidebar-search"]');
    while (left && !(getComputedStyle(left).borderRightStyle !== "none" && getComputedStyle(left).borderRightWidth !== "0px")) left = left.parentElement;
    const explorer = document.querySelector('[data-testid="workspace-explorer-sidebar"]');
    const plain = rgb(want.background);
    const inner = explorer ? Array.from(explorer.querySelectorAll("*")).filter((el) => getComputedStyle(el).backgroundColor === plain) : [];
    painted = [left, explorer, ...inner].filter((el): el is DomElement => !!el);
    for (const el of painted) el.style.setProperty("background-color", want.sidebar, "important");
  } }, unpaint);
}

const CLAMP = "data-chat-polish-clamp";
const SHOWN_LINES = 6;
// Clamp only when it hides a real chunk; a 7-line message isn't worth a click.
const CLAMP_FROM_LINES = 9;
const CLAMP_CSS = `
[${CLAMP}] { cursor: pointer; }
[${CLAMP}] > :last-child { overflow: hidden; }
[${CLAMP}="closed"] > :last-child { max-height: var(--chat-polish-max); -webkit-mask-image: linear-gradient(#000 55%, transparent); mask-image: linear-gradient(#000 55%, transparent); }
[${CLAMP}]::after { content: "Show full message"; margin-top: 8px; font-size: 12px; font-weight: 500; color: var(--chat-polish-muted); opacity: 0.75; }
[${CLAMP}="open"]::after { content: "Show less"; }
`;

/**
 * Clamps long user messages to six lines with a fade while `enabled()`; clicking the bubble toggles it.
 * Paseo keeps its own bubble, so rewind, copy, timestamps and attachments still work. Returns cleanup.
 * ponytail: the bubble is the first grandchild of [data-testid="user-message"] and its text the bubble's last
 * child; breaks if Paseo restructures the message. Replace with a native clamp if Paseo adds one.
 */
export function clampUserMessages(enabled: () => boolean) {
  const bound = new Map<DomElement, () => void>();
  let style: DomElement | undefined;
  const release = () => {
    for (const [bubble, onClick] of bound) {
      bubble.removeEventListener("click", onClick);
      bubble.removeAttribute(CLAMP);
    }
    bound.clear();
  };
  return watchDom({ added: (roots) => {
      if (!enabled()) return release();
      if (!style) {
        style = document.createElement("style");
        style.textContent = CLAMP_CSS;
        document.head.appendChild(style);
      }
      for (const [bubble] of bound) if (!bubble.parentElement) bound.delete(bubble);
      for (const message of within(roots, '[data-testid="user-message"]')) {
        const bubble = message.firstElementChild?.firstElementChild;
        const text = bubble?.lastElementChild;
        if (!bubble || !text || bound.has(bubble)) continue;
        const css = getComputedStyle(text);
        const line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.4;
        if (!line || text.scrollHeight < line * CLAMP_FROM_LINES) continue;
        bubble.style.setProperty("--chat-polish-max", `${Math.round(line * SHOWN_LINES)}px`);
        bubble.style.setProperty("--chat-polish-muted", css.color);
        bubble.setAttribute(CLAMP, "closed");
        // Selecting text inside the bubble shouldn't toggle it.
        const onClick = () => {
          if (getSelection()?.toString()) return;
          bubble.setAttribute(CLAMP, bubble.getAttribute(CLAMP) === "open" ? "closed" : "open");
        };
        bubble.addEventListener("click", onClick);
        bound.set(bubble, onClick);
      }
    } },
    () => {
      release();
      style?.remove();
      style = undefined;
    },
  );
}

const TAG = "data-chat-polish";
// Assistant replies, plus the plan body Paseo renders with the same markdown.
const MSG = ':is([data-testid="assistant-message"], [data-testid="permission-plan-card"] > div:nth-child(2))';
const ROW = ':is([data-testid="tool-call-group"], [data-testid="tool-call-badge"])';
const ROW_ICON = `${ROW} > button > div > div:first-child`;
const mask = (paths: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`)}")`;
// Shown when a row was first drawn open, so its own icon was never seen.
const WRENCH_MASK = mask('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>');
const THUMBS = `:root:not([data-cp-rt-images="native"]) ${MSG} [data-paseo-markdown-tag="img"]`;
// Parts Paseo marks only through a child, and containers whose every descendant is restyled, are tagged by tagParts.
// :has(), and "X *" where X is only known by data-testid (on nearly every ancestor), re-match the whole timeline
// on every node a scroll mounts, which made fast scrolling stutter.
// Paseo marks each markdown part for its copy-as-markdown feature; the restyle keys on those marks.
const md = (tag: string) => `[data-paseo-markdown-tag="${tag}"]`;
const INLINE_CODE = `span${md("code")}`;
const HEADING = (n: number) => `${md(`h${n}`)} > [dir] > span`;
const MARK = "[data-paseo-markdown-list-marker]";
const MARK_UL = `${md("ul")} > ${md("li")} > ${MARK}`;
const MARK_OL = `${md("ol")} > ${md("li")} > ${MARK}`;
const CODE_BLOCK = `${MSG} ${md("pre")}`;
// Fences that name a language (```ts); Paseo leaves the attribute off otherwise.
const LANG = '[data-paseo-markdown-language]:not([data-paseo-markdown-language=""])';

const FOOTER = '[data-cp-part="footer"]';
const FOOTER_ICON = ':is(button[aria-label="Copy turn"], [data-testid="assistant-fork-menu-trigger"])';
const COMPOSER_BUTTON =
  ':is([data-testid="message-input-attach-button"], [data-testid="agent-feature-fast_mode"], [data-testid="context-window-meter"], button:is([aria-label="Start dictation"], [aria-label="Send message"], [aria-label="Queue message"], [aria-label="Stop agent"], [aria-label$="Voice mode"]))';
const CHIP = ':is([data-testid="combined-model-selector"], [data-testid="agent-thinking-selector"], [data-testid="mode-control"])';
const PERMISSION = '[data-cp-part="permission"]';
const PLAN = '[data-testid="permission-plan-card"]';
const CTX = '[data-cp-part="context"]';
const CTX_HEAD = `${CTX} > div:first-child`;
const USAGE = `${CTX} > [data-testid^="usage-report-"]`;
const LIMIT = `${USAGE} > div:nth-child(2) > div`;
const QUESTION = '[data-testid="question-form-card"]';
const PRIMARY = ':is([data-testid="permission-request-accept"], [data-testid="question-form-primary-action"])';
const SECONDARY = ':is([data-testid="permission-request-deny"], [data-testid="question-form-dismiss"])';

// Paseo steps the working dots' opacity from JS every ~160ms, which reads as slow and choppy. The same
// clockwise chase (dots 4, 6, 5, 3, 1, 2) as a CSS animation runs smoothly on the compositor.
const DOT = '[data-testid="turn-working-indicator"] > div > div:first-child > div > div > div > div';
const WORKING_DOTS = `${DOT} { animation: cp-dots 0.8s linear infinite !important; }
${[4, 5, 3, 0, 2, 1].map((step, i) => `${DOT}:nth-child(${i + 1}) { animation-delay: ${((step - 6) * 0.8) / 6}s !important; }`).join("\n")}
@keyframes cp-dots { 0% { opacity: 1; } 70%, 90% { opacity: 0.15; } 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { ${DOT} { animation: none !important; } }`;

// The chat's own chrome from the "Chat Surfaces" design: turn footer, composer, prompts, outline rail.
const CHAT_CHROME_CSS = `
${FOOTER} { gap: 8px !important; min-height: 26px !important; align-items: center !important; }
${FOOTER} > [data-cp-part="fork"] { width: 20px !important; height: 20px !important; }
${FOOTER} ${FOOTER_ICON} { width: 20px !important; height: 20px !important; padding: 3px !important; margin: 0 !important; }
${FOOTER} > :last-child, ${FOOTER} > :last-child * { font-size: 12px !important; }
[data-testid="turn-working-indicator"] > div > div:first-child { width: 20px !important; margin-left: 0 !important; align-items: center !important; }
${WORKING_DOTS}

[data-testid="message-input-root"] > div:first-child { border-radius: 12px !important; padding: 14px 10px 10px 16px !important; gap: 20px !important; }
/* Paseo keeps the box two lines tall even when empty; let it size to its text instead (one line, up to 400px). */
/* Paseo pulls the toolbar 6px past both sides; keep it on the left (the + lines up with the text) but not the right, so Send sits as far from the edge as from the bottom. */
[data-testid="message-input-root"] > div:first-child > div:last-child { margin-right: 0 !important; }
[data-testid="message-input-root"] textarea { field-sizing: content !important; height: auto !important; min-height: 21px !important; }
[data-cp-part="input-row"] > div + div { display: none !important; }
${CHIP} { height: 24px !important; padding: 0 7px !important; border-radius: 7px !important; }
[data-cp-part="chip"] * { font-size: 13px !important; font-weight: 500 !important; }
[data-cp-part="chip"] > div > div:last-child:nth-child(3) { display: none !important; }
${CHIP}:hover { background-color: var(--cp-control) !important; }
[data-testid="message-input-root"] ${COMPOSER_BUTTON} { width: 26px !important; min-width: 26px !important; height: 26px !important; border-radius: 7px !important; }
[data-testid="message-input-root"] [data-testid="context-window-meter"] { border-radius: 999px !important; }
button[aria-label="Stop agent"] { background-color: var(--cp-control) !important; border: 1px solid var(--cp-rule) !important; }
button[aria-label="Stop agent"] svg { width: 11px !important; height: 11px !important; stroke: var(--cp-fg) !important; fill: var(--cp-fg) !important; }
:is([data-testid="subagents-track-header"], [data-testid="composer-diff-stat-pill"]) { height: 24px !important; padding: 0 10px !important; border-radius: 999px !important; border-color: var(--cp-rule) !important; }

${PERMISSION}, ${QUESTION} { padding: 12px 14px !important; border-color: var(--cp-rule) !important; }
${PERMISSION} > div:first-child, [data-testid="question-form-current-question"] { font-weight: 500 !important; color: var(--cp-fg) !important; }
${PERMISSION} > div:nth-child(2) > div > div:first-child { background-color: var(--cp-sunken) !important; border: 1px solid var(--cp-rule) !important; border-radius: 8px !important; overflow: hidden !important; }
[data-testid="permission-request-question"] { font-size: 12px !important; margin: 0 !important; }
${PERMISSION} > div:last-child, ${QUESTION} > div:last-child, ${PLAN} > div:last-child > div:last-child { justify-content: flex-end !important; }
:is(${PRIMARY}, ${SECONDARY}) { height: 28px !important; padding: 0 12px !important; border-radius: 8px !important; justify-content: center !important; }
[data-cp-part="primary"] *, [data-cp-part="secondary"] * { font-size: 13px !important; font-weight: 500 !important; }
${SECONDARY} { background-color: transparent !important; border-color: var(--cp-rule) !important; }
${PRIMARY} { background-color: var(--cp-accent) !important; border-color: var(--cp-accent) !important; }
[data-cp-part="primary"] * { color: var(--cp-accent-fg) !important; font-weight: 600 !important; }
${PRIMARY} svg { stroke: var(--cp-accent-fg) !important; }
${PRIMARY}[aria-disabled="true"] { opacity: 0.45 !important; }
${QUESTION} [role="radio"] { padding: 7px 10px !important; }
${QUESTION} [role="radio"][aria-checked="true"] { background-color: var(--cp-control) !important; }
${QUESTION} [role="radio"] > div > div:first-child { width: 14px !important; height: 14px !important; margin-top: 4px !important; }
${QUESTION} [role="radio"][aria-checked="true"] > div > div:first-child { border-color: var(--cp-accent) !important; background-color: var(--cp-accent) !important; box-shadow: inset 0 0 0 3px var(--cp-control) !important; }
${QUESTION} [role="radio"] > div > div:nth-child(2) > :first-child { color: var(--cp-fg) !important; }
${QUESTION} [role="radio"] > div > div:nth-child(2) > :nth-child(2) { font-size: 12px !important; line-height: 18px !important; }
${PLAN} { border-radius: 12px !important; padding: 0 !important; gap: 0 !important; border-color: var(--cp-rule) !important; overflow: hidden !important; }
${PLAN} > button:first-child { padding: 12px 16px !important; border-bottom: 1px solid var(--cp-rule) !important; }
[data-cp-part="plan-head"] * { font-weight: 600 !important; }
${PLAN} > div:nth-child(2) { padding: 14px 16px !important; }
${PLAN} > div:last-child { padding: 10px 16px 12px !important; border-top: 1px solid var(--cp-rule) !important; }

[data-testid^="chat-outline-tick-"][aria-selected="true"] > div { background-color: var(--cp-accent) !important; }
[data-testid="chat-outline-preview"] { background-color: var(--cp-raised) !important; border-radius: 12px !important; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45) !important; }
[data-cp-part="outline-preview"] * { font-size: 13px !important; }

/* Context window hover card: caps label, big percent with a bar (from data-cp-pct), plan pill, rounded limit bars, footer under a hairline. */
${CTX} { padding: 14px !important; gap: 14px !important; border-radius: 12px !important; border: 1px solid var(--cp-rule) !important; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45) !important; }
${CTX_HEAD} { display: grid !important; grid-template-columns: auto 1fr; column-gap: 6px; row-gap: 6px; align-items: baseline; }
${CTX_HEAD} > :nth-child(1) { grid-column: 1 / -1; font-size: 11px !important; font-weight: 600 !important; letter-spacing: 0.06em; text-transform: uppercase; color: var(--cp-muted) !important; }
${CTX_HEAD} > :nth-child(2) { grid-column: 1; grid-row: 2; }
${CTX_HEAD} > [data-cp-pct] { font-size: 0 !important; }
${CTX_HEAD} > [data-cp-pct]::before { content: attr(data-cp-pct) "%"; margin-right: 6px; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--cp-fg); }
${CTX_HEAD} > [data-cp-pct]::after { content: "used"; font-size: 12px; color: var(--cp-muted); }
${CTX_HEAD} > :nth-child(3) { grid-column: 2; grid-row: 2; justify-self: end; font-family: var(--cp-mono) !important; font-size: 12px !important; }
${CTX_HEAD}[data-cp-level]::after { content: ""; grid-column: 1 / -1; grid-row: 3; height: 4px; margin-top: 2px; border-radius: 999px; background: linear-gradient(to right, var(--cp-accent) var(--cp-pct), var(--cp-control) 0); }
${CTX_HEAD}[data-cp-level="high"]::after { background: linear-gradient(to right, var(--cp-warn) var(--cp-pct), var(--cp-control) 0); }
${CTX_HEAD} > :nth-child(4) { grid-column: 1 / -1; grid-row: 4; font-size: 12px !important; color: var(--cp-muted) !important; }
${CTX} > div:nth-child(2) { background-color: var(--cp-rule) !important; }
${USAGE} > div:first-child > div:nth-child(2) { font-size: 13px !important; font-weight: 500 !important; color: var(--cp-fg) !important; }
${USAGE} > div:first-child > div:nth-child(3) { background-color: transparent !important; border: 1px solid var(--cp-rule) !important; padding: 0 7px !important; }
${USAGE} > div:first-child > div:nth-child(3) > div { font-size: 11px !important; }
${USAGE} > div:nth-child(2) { gap: 10px !important; }
${LIMIT} { margin: 0 !important; padding: 0 !important; }
${LIMIT} > div:nth-child(2) > div { gap: 6px !important; }
${LIMIT} > div:nth-child(2) > div > div:first-child > div:nth-child(2) { font-variant-numeric: tabular-nums; }
${LIMIT} > div:nth-child(2) > div > div:last-child { height: 4px !important; border-radius: 999px !important; background-color: var(--cp-control) !important; }
${LIMIT} > div:nth-child(2) > div > div:last-child > div { border-radius: 999px !important; }
${USAGE} > div:nth-child(3) { padding-top: 12px !important; border-top: 1px solid var(--cp-rule) !important; }
${USAGE} > div:nth-child(4) { margin-top: -6px !important; }
`;

// Values come from CSS variables set by setNativeColors, so a theme switch restyles without re-tagging.
const NATIVE_CSS = `
${ROW} > button { padding: 2px 8px 2px 12px !important; }
${ROW} > button > div > div:first-child { width: 20px !important; height: 20px !important; margin-right: 8px !important; }
${ROW} > button > div > div:first-child svg { width: 15px !important; height: 15px !important; }
/* Paseo swaps a row's icon for a chevron on hover and while open. Like the plugin's rows, keep the icon (cached by tagParts) and show the chevron at the row's end. */
${ROW_ICON}[data-cp-chev] { position: static !important; justify-content: flex-start !important; }
${ROW_ICON}[data-cp-chev]::before { content: ""; align-self: flex-start; flex-shrink: 0; width: 15px; height: 15px; margin: 2.5px 0 0 2px; background-color: var(--cp-muted); -webkit-mask: var(--cp-row-icon, ${WRENCH_MASK}) center / 15px no-repeat; mask: var(--cp-row-icon, ${WRENCH_MASK}) center / 15px no-repeat; }
${ROW_ICON}[data-cp-chev] > div { position: absolute !important; right: 4px; top: 50%; width: 12px !important; height: 12px !important; margin-top: -6px; opacity: 0.7; display: flex !important; align-items: center !important; justify-content: center !important; }
${ROW_ICON}[data-cp-chev] svg { width: 9px !important; height: 9px !important; }
${ROW_ICON}[data-cp-chev] + div { padding-right: 18px !important; }
${ROW} > button > div > div:nth-child(2) > [dir]:first-child { color: var(--cp-fg) !important; }
/* Running rows draw a shimmer from a transparent copy of the labels laid over them: type changes go to both so they stay aligned. */
${ROW} > button > div > div:nth-child(2) [dir]:first-child { font-weight: 500 !important; }
[data-testid="tool-call-badge"] > button > div > div:nth-child(2) [dir]:nth-child(2) { font-family: var(--cp-mono) !important; font-size: calc(var(--cp-code) + 1px) !important; }
[data-testid="tool-call-group"] { margin-top: -3px !important; margin-bottom: -3px !important; }
/* The open-file button Paseo adds on hover is taller than the label; keep it from growing the row. */
[data-testid="tool-call-open-file"] { margin-top: -4px !important; margin-bottom: -4px !important; }
/* Expanded rows read like the plugin's: no filled header, children behind a 1px rule, details in a sunken block. */
${ROW} > button { background-color: transparent !important; border-color: transparent !important; border-radius: 6px !important; }
:root[data-cp-rt-steps="full"] ${ROW} > button:hover { background-color: var(--cp-raised) !important; }
/* Rows step back so the reply reads first: faded until hovered or opened (an open row's details follow its button), with no hover fill. Plugin rows do the same in views.tsx. */
:root:not([data-cp-rt-steps="full"]) ${ROW} > button:last-child:not(:hover) { opacity: 0.55; }
[data-testid="tool-call-badge"] > button > div > div:nth-child(2) > [dir]:nth-child(2) { color: var(--cp-muted) !important; }
[data-testid="tool-call-group"] > div:nth-child(2) > div { max-height: none !important; }
[data-testid="tool-call-group"] > div:nth-child(2) > div > div { padding: 4px 13px 0 41px !important; position: relative !important; }
[data-testid="tool-call-group"] > div:nth-child(2) > div > div::before { content: ""; position: absolute; left: 22px; top: 6px; bottom: 12px; width: 1px; background: var(--cp-rule); }
[data-testid="tool-call-badge"] > div:nth-child(2) { margin: 6px 13px 4px 41px !important; border: 1px solid var(--cp-rule) !important; border-radius: 8px !important; background-color: var(--cp-sunken) !important; }
[data-testid="tool-call-badge"] > div:nth-child(2) > div > div > div { background-color: transparent !important; }
/* Paseo nests a horizontal scroller inside the vertical one, so long lines showed their scrollbar only below the last line. One box scrolls both ways instead. */
[data-cp-part="detail-scroll"] { max-height: 320px !important; overflow: auto !important; }
[data-cp-part="detail-scroll"] div { overflow: visible !important; }
[data-testid="tool-call-badge"] { margin-bottom: 10px !important; }

[data-testid="user-message"] > div > div:first-child { padding: 10px 14px !important; border-radius: 16px !important; }
[data-testid="user-message"] > div > div:first-child > :last-child { line-height: 1.55 !important; }

${MSG} span { line-height: 1.6 !important; }
${MSG} ${INLINE_CODE} { border-radius: 4px !important; padding: 2px 5px !important; }
${MSG} ${md("strong")}, ${MSG} ${md("strong")} span { font-weight: 600 !important; }
${MSG} ${HEADING(1)} { font-size: 24px !important; line-height: 1.3 !important; }
${MSG} ${HEADING(2)} { font-size: 20px !important; line-height: 1.3 !important; }
${MSG} ${HEADING(3)} { font-size: 16px !important; line-height: 1.3 !important; }
${MSG} ${md("h1")}, ${MSG} ${md("h2")} { border-bottom-width: 0 !important; padding-bottom: 0 !important; }
${MSG} ${md("li")} { margin-bottom: 6px !important; }
${MSG} ${MARK} { margin: 0 10px 0 4px !important; line-height: calc(var(--cp-content) * 1.6) !important; }
${MSG} ${MARK_OL} { font-family: var(--cp-mono) !important; font-size: calc(var(--cp-code) + 1px) !important; }
${MSG} ${md("blockquote")} { background: transparent !important; border-left: 2px solid var(--cp-accent) !important; border-radius: 0 !important; padding: 2px 0 2px 14px !important; margin: 4px 0 !important; }
${MSG} ${md("blockquote")} > :last-child { margin-bottom: 0 !important; }
${MSG} ${md("blockquote")} span { font-style: italic !important; color: var(--cp-muted) !important; }
${MSG} ${md("table")} { border-radius: 8px !important; border-color: var(--cp-rule) !important; overflow: hidden !important; }
${MSG} ${md("table")} > div > div { border-color: var(--cp-rule) !important; }
${MSG} ${md("table")} > div:last-child > div:last-child { border-bottom-width: 0 !important; }
${MSG} ${md("table")} > div > div > div { padding: 9px 14px !important; border-right-width: 0 !important; border-bottom-width: 0 !important; background: transparent !important; }
${MSG} ${md("table")} > div:first-child { background: var(--cp-raised) !important; }
${MSG} ${md("table")} span:not(${INLINE_CODE}) { font-size: calc(var(--cp-content) - 1px) !important; }
${MSG} ${md("table")} span { line-height: 1.45 !important; }
${MSG} ${md("table")} > div:first-child span:not(${INLINE_CODE}) { font-size: 12px !important; font-weight: 600 !important; color: var(--cp-muted) !important; }
${CODE_BLOCK} { background: var(--cp-sunken) !important; border-color: var(--cp-rule) !important; border-radius: 8px !important; padding: 12px 14px !important; }
${CODE_BLOCK} :is(div, span) { line-height: 1.5 !important; }
/* Code block A: the language in a header strip, with Paseo's copy button in it. B floats the language instead; C has none. */
:root:not([data-cp-rt-code="b"]):not([data-cp-rt-code="c"]) ${CODE_BLOCK}${LANG} { padding-top: 0 !important; }
:root:not([data-cp-rt-code="b"]):not([data-cp-rt-code="c"]) ${CODE_BLOCK}${LANG}::before { content: attr(data-paseo-markdown-language); margin: 0 -14px 10px; padding: 7px 14px; border-bottom: 1px solid var(--cp-rule); font-family: var(--cp-mono); font-size: 12px; line-height: 18px; color: var(--cp-muted); }
:root:not([data-cp-rt-code="b"]):not([data-cp-rt-code="c"]) ${CODE_BLOCK}${LANG} > button[aria-label="Copy code"] { top: 5px !important; opacity: 0.6 !important; }
:root:not([data-cp-rt-code="b"]):not([data-cp-rt-code="c"]) ${CODE_BLOCK}${LANG} > button[aria-label="Copy code"]:hover { opacity: 1 !important; }
/* Mermaid: the diagram itself is themed inside its frame (themeMermaid); the card matches code blocks, its zoom controls faint until hover. */
[data-testid="mermaid-viewport"] { background-color: var(--cp-sunken) !important; border-color: var(--cp-rule) !important; border-radius: 8px !important; }
[data-testid="mermaid-viewport"] [data-testid="zoomable-viewport-toolbar"] { opacity: 0.6; transition: opacity 0.15s; }
[data-testid="mermaid-viewport"]:hover [data-testid="zoomable-viewport-toolbar"] { opacity: 1; }
/* Images in a reply that also has text (tool screenshots land at the end of the text before them) get the plugin's thumbnail size; Paseo's own button still opens the full image. */
${THUMBS} { width: auto !important; min-height: 0 !important; margin: 6px 8px 2px 0 !important; }
:root:not([data-cp-rt-images="native"]) ${MSG} [data-cp-part="image-text"] > [dir] { flex-basis: 100% !important; }
${THUMBS} > button { width: var(--cp-thumb-w) !important; height: var(--cp-thumb-h) !important; aspect-ratio: auto !important; border: 1px solid var(--cp-rule) !important; border-radius: 8px !important; background-color: var(--cp-raised) !important; }
${THUMBS} > button div { width: 100% !important; height: 100% !important; background-size: cover !important; }
:root { --cp-thumb-w: 200px; --cp-thumb-h: 128px; }
:root[data-cp-rt-images="large"] { --cp-thumb-w: 320px; --cp-thumb-h: 200px; }
${CHAT_CHROME_CSS}`;

const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const hexAlpha = (hex: string, a: number) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex);
const darker = (hex: string) =>
  /^#[0-9a-f]{6}$/i.test(hex) ? `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.86).toString(16).padStart(2, "0")).join("")}` : hex;

/** Publishes the app theme's colors and the code font as CSS variables for restyleNative. */
export function setNativeColors(c: { surface0: string; surface1: string; surface2: string; border: string; foreground: string; foregroundMuted: string; accent: string; accentForeground: string; statusSuccess: string; statusWarning: string }) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const a = readHostAppearance();
  const vars: Record<string, string> = {
    "--cp-fg": c.foreground,
    "--cp-muted": c.foregroundMuted,
    "--cp-accent": c.accent,
    "--cp-raised": c.surface1,
    "--cp-control": c.surface2,
    "--cp-accent-fg": c.accentForeground,
    "--cp-sunken": darker(c.surface0),
    "--cp-rule": hexAlpha(c.border, 0.6),
    "--cp-mono": a.monoFont ? `${a.monoFont}, ${MONO_FALLBACK}` : MONO_FALLBACK,
    "--cp-code": `${a.codeSize}px`,
    "--cp-content": `${a.contentSize}px`,
    "--cp-ok": c.statusSuccess,
    "--cp-warn": c.statusWarning,
  };
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  const theme = mermaidThemeFrom(c);
  if (theme === mermaidTheme) return;
  mermaidTheme = theme;
  rethemeMermaid?.();
}

// ---- Mermaid ----

// Paseo draws each diagram in a sandboxed iframe from a srcdoc that bundles mermaid, so page CSS can't reach it.
// The theme goes into that srcdoc instead, as React sets it and before the frame loads (changing it later doesn't take).
// Paseo's own theme expression, or one this plugin put there earlier.
const MERMAID_THEME = /theme:(\w+)==="dark"\?"dark":"default"|theme:"base",themeVariables:\{[^}]*\},themeCSS:"(?:[^"\\]|\\.)*"/;
const MERMAID_FRAME = '[data-testid="mermaid-viewport-canvas"] iframe';
const MERMAID_CSS = [
  ".node rect, .actor, rect.note, .labelBox, .statediagram-state rect, .classGroup rect { rx: 6px; ry: 6px; }",
  ".cluster rect { rx: 8px; ry: 8px; stroke-dasharray: 3 3; }",
  ".flowchart-link, .edgePath .path, .transition, .relation, .messageLine0, .messageLine1 { stroke-width: 1.25px; }",
  ".edgeLabel, .edgeLabel p, .edgeLabel rect { border-radius: 4px; }",
].join(" ");
let mermaidTheme = "";
let rethemeMermaid: (() => void) | undefined;

const mix = (a: string, b: string, t: number) =>
  /^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b)
    ? `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("")}`
    : a;
const isDark = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) && [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0) < 384;

/** Mermaid's "base" theme in the app's colors: raised nodes with a 1px border, thin muted edges, accent-tinted notes. */
function mermaidThemeFrom(c: Parameters<typeof setNativeColors>[0]) {
  const sunken = darker(c.surface0);
  // Mermaid derives shades from these, so they stay opaque hex.
  const vars = {
    darkMode: isDark(c.surface0),
    background: sunken,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
    fontSize: "13px",
    primaryColor: c.surface1,
    primaryBorderColor: c.border,
    primaryTextColor: c.foreground,
    secondaryColor: c.surface2,
    tertiaryColor: sunken,
    mainBkg: c.surface1,
    nodeBorder: c.border,
    textColor: c.foreground,
    titleColor: c.foreground,
    lineColor: c.foregroundMuted,
    edgeLabelBackground: sunken,
    clusterBkg: mix(sunken, c.surface1, 0.4),
    clusterBorder: c.border,
    actorBkg: c.surface1,
    actorBorder: c.border,
    actorTextColor: c.foreground,
    actorLineColor: c.border,
    signalColor: c.foregroundMuted,
    signalTextColor: c.foreground,
    labelBoxBkgColor: c.surface1,
    labelBoxBorderColor: c.border,
    labelTextColor: c.foreground,
    loopTextColor: c.foreground,
    activationBkgColor: c.surface2,
    activationBorderColor: c.border,
    noteBkgColor: mix(sunken, c.accent, 0.12),
    noteBorderColor: mix(sunken, c.accent, 0.3),
    noteTextColor: c.accent,
    rowOdd: c.surface1,
    rowEven: mix(sunken, c.surface1, 0.5),
  };
  // ER's "zero" markers are hard-coded white.
  const css = `${MERMAID_CSS} marker[id*="zeroOr"] circle { fill: ${sunken}; }`;
  return `theme:"base",themeVariables:${JSON.stringify(vars)},themeCSS:${JSON.stringify(css)}`;
}

/**
 * Themes mermaid diagrams from now on, and redraws those on screen when the colors change; returns cleanup.
 * Diagrams already on screen when it starts keep Paseo's theme until they remount.
 * ponytail: matches the theme expression in Paseo's minified mermaid bridge and replays its render message;
 * if Paseo rewrites either, diagrams silently fall back to Paseo's own theme.
 */
function themeMermaid() {
  type Frame = { postMessage(message: unknown, targetOrigin: string): void };
  const proto = HTMLIFrameElement.prototype;
  const inherited = proto.setAttribute;
  proto.setAttribute = function (this: unknown, name: string, value: string) {
    if (mermaidTheme && name.toLowerCase() === "srcdoc" && typeof value === "string") value = value.replace(MERMAID_THEME, () => mermaidTheme);
    inherited.call(this, name, value);
  };
  // A reloaded frame waits for a render request that only Paseo sends, so replay the last one it answered.
  const rendered = new WeakMap<object, unknown>();
  const reloading = new WeakSet<object>();
  const onMessage: MessageListener = ({ source, data }) => {
    const d = data as { type?: unknown; revision?: unknown; source?: unknown; colorScheme?: unknown } | null;
    if (!source || typeof source !== "object" || !d) return;
    if (d.type === "rendered") {
      rendered.set(source, { type: "render", revision: d.revision, source: d.source, colorScheme: d.colorScheme, interactive: false });
      // The colors may have changed while this frame was still loading.
      refresh(source);
    } else if (d.type === "bridgeReady" && reloading.delete(source)) (source as Frame).postMessage(rendered.get(source), "*");
  };
  window.addEventListener("message", onMessage);
  const refresh = (only?: object) => {
    for (const frame of Array.from(document.querySelectorAll(MERMAID_FRAME))) {
      const win = (frame as unknown as { contentWindow: object | null }).contentWindow;
      if (!win || (only && win !== only) || !rendered.has(win)) continue;
      const srcdoc = frame.getAttribute("srcdoc");
      if (!srcdoc || srcdoc.includes(mermaidTheme)) continue;
      reloading.add(win);
      frame.setAttribute("srcdoc", srcdoc);
    }
  };
  rethemeMermaid = () => refresh();
  return () => {
    delete (proto as { setAttribute?: unknown }).setAttribute;
    window.removeEventListener("message", onMessage);
    rethemeMermaid = undefined;
  };
}

// [child, parent it marks, part]
const PARTS: Array<[string, (el: DomElement) => DomElement | null | undefined, string]> = [
  ['[data-testid="assistant-fork-menu-trigger"]', (el) => el.parentElement, "fork"],
  ['[data-testid="assistant-fork-menu-trigger"]', (el) => el.parentElement?.parentElement, "footer"],
  // The plan card shows the same question; it has its own styles.
  ['[data-testid="permission-request-question"]', (el) => (el.parentElement?.parentElement?.getAttribute("data-testid") === "permission-plan-card" ? null : el.parentElement), "permission"],
  ['[data-paseo-markdown-tag="img"]', (el) => el.parentElement, "image-text"],
  [CHIP, (el) => el, "chip"],
  // The row holding the textarea and, while it's empty and unfocused, the "⌘L to focus" hint.
  ['[data-testid="message-input-root"] textarea', (el) => el.parentElement?.parentElement, "input-row"],
  [PRIMARY, (el) => el, "primary"],
  [SECONDARY, (el) => el, "secondary"],
  [`${PLAN} > button:first-child`, (el) => el, "plan-head"],
  ['[data-testid="chat-outline-preview"]', (el) => el, "outline-preview"],
  ['[data-testid="context-window-details"]', (el) => el, "context"],
  // The vertical scroller of a tool call's details; its depth varies by tool.
  ['[data-testid="tool-call-badge"] > div:nth-child(2) [style*="max-height"]', (el) => el, "detail-scroll"],
];

/** Tags the parts above, for selectors that would otherwise need :has() or a slow "X *". */
function tagParts(roots: DomElement[]) {
  for (const [child, parentOf, part] of PARTS) for (const el of within(roots, child)) parentOf(el)?.setAttribute("data-cp-part", part);
  for (const svg of within(roots, `${ROW_ICON} svg`)) {
    const slot = svg.closest(ROW_ICON);
    if (!slot) continue;
    if (svg.querySelector('path[d="m9 18 6-6-6-6"]')) slot.setAttribute("data-cp-chev", "");
    else {
      slot.removeAttribute("data-cp-chev");
      // Some of Paseo's icons (its own logo) omit xmlns, without which an SVG image doesn't render.
      const markup = svg.outerHTML.replace(/^<svg(?![^>]*\sxmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg"');
      slot.style.setProperty("--cp-row-icon", `url("data:image/svg+xml,${encodeURIComponent(markup)}")`);
    }
  }
  // The context card's percent is plain text ("35% used"); the redesign draws it large, with a bar.
  // Also when only its text re-renders, so the card is an ancestor of the root.
  for (const card of new Set([...within(roots, CTX), ...roots.map((root) => root.closest(CTX))])) {
    if (!card) continue;
    const head = card.firstElementChild;
    const used = head?.children[1];
    const pct = /^(\d+(?:\.\d+)?)% /.exec(used?.textContent ?? "")?.[1];
    if (!head || !used || !pct) continue;
    used.setAttribute("data-cp-pct", pct);
    head.style.setProperty("--cp-pct", `${pct}%`);
    head.setAttribute("data-cp-level", Number(pct) >= 80 ? "high" : "normal");
  }
}

// ---- Rich text variants ----

const CALLOUT_MARK = /^\[!(note|tip|important|warning|caution)\]$/i;
const CALLOUT_KIND: Record<string, [string, string]> = { note: ["note", "Note"], important: ["note", "Important"], tip: ["tip", "Tip"], warning: ["warning", "Warning"], caution: ["warning", "Caution"] };
const TASK_MARK = /^\[([ xX])\]\s+/;

/**
 * Marks what markdown leaves as plain text: "> [!NOTE]" quotes become callouts, "[x] item" bullets become tasks,
 * ordered list marks keep their number, and code blocks get their line numbers. Runs on added nodes and again once streaming settles.
 */
function markBlocks(roots: DomElement[]) {
  const find = (selector: string) => roots.flatMap((root) => (root === document.documentElement ? Array.from(root.querySelectorAll(selector)) : [root.closest(selector) ?? null, ...within([root], selector)].filter((el): el is DomElement => !!el)));
  for (const quote of find(`${MSG} ${md("blockquote")}:not([data-cp-callout])`)) {
    const mark = quote.querySelector("span");
    const kind = CALLOUT_KIND[CALLOUT_MARK.exec(mark?.textContent?.trim() ?? "")?.[1]?.toLowerCase() ?? ""];
    if (!mark || !kind) continue;
    quote.setAttribute("data-cp-callout", kind[0]);
    mark.setAttribute("data-cp-callout-mark", kind[1]);
  }
  for (const li of find(`${MSG} ${md("li")}`)) {
    // Paseo may rewrite the text node as the reply streams, so the "[x] " prefix is checked every time.
    const text = li.querySelector(":scope > div:last-child span")?.firstChild;
    const box = TASK_MARK.exec(text?.nodeValue ?? "");
    if (!text || !box) continue;
    li.setAttribute("data-cp-task", box[1] === " " ? "todo" : "done");
    text.nodeValue = text.nodeValue!.slice(box[0].length);
  }
  // Kept for list styles that redraw the number ("1)").
  for (const mark of find(`${MSG} ${MARK_OL}`)) {
    const n = mark.textContent?.trim().replace(".", "") ?? "";
    if (mark.getAttribute("data-cp-n") !== n) mark.setAttribute("data-cp-n", n);
  }
  for (const code of find(`${CODE_BLOCK} > div:first-child`)) {
    const count = (code.textContent ?? "").replace(/\n$/, "").split("\n").length;
    if (code.getAttribute("data-cp-lines")?.split("\n").length !== count) code.setAttribute("data-cp-lines", Array.from({ length: count }, (_, i) => i + 1).join("\n"));
  }
}

/** Shows the chosen variant of each markdown element, and the image size; "a" needs no attribute. */
export function setRichText(choices: Record<string, string>) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  for (const [element, variant] of Object.entries(choices)) {
    if (variant === "a") document.documentElement.removeAttribute(`data-cp-rt-${element}`);
    else document.documentElement.setAttribute(`data-cp-rt-${element}`, variant);
  }
}

const INFO_MASK = mask('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>');
const ALERT_MASK = mask('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>');
const TIP_MASK = mask('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>');
const CHECK_MASK = mask('<path d="M20 6 9 17l-5-5"/>');

const RT = (element: string, variant: string) => `:root[data-cp-rt-${element}="${variant}"] ${MSG}`;
const QUOTE = `${md("blockquote")}:not([data-cp-callout])`;
const CALLOUT = `${md("blockquote")}[data-cp-callout]`;
const TASK_ITEM = `${MSG} ${md("li")}[data-cp-task]`;
const TASK = `:root ${TASK_ITEM}`;

const RICH_TEXT_CSS = `
${RT("quote", "b")} ${QUOTE} { border-left-width: 0 !important; border-radius: 8px !important; background: var(--cp-raised) !important; padding: 10px 14px 10px 36px !important; position: relative !important; }
${RT("quote", "b")} ${QUOTE}::before { content: "\\201C"; position: absolute; left: 13px; top: 6px; font-size: 24px; line-height: 1; font-weight: 600; color: var(--cp-accent); }
${RT("quote", "b")} ${QUOTE} span { font-style: normal !important; color: var(--cp-fg) !important; }
${RT("quote", "c")} ${QUOTE} { border-left-width: 0 !important; padding: 0 0 0 20px !important; }

${RT("table", "b")} ${md("table")} { border-width: 0 !important; border-radius: 6px !important; }
${RT("table", "b")} ${md("table")} > div:first-child { background: transparent !important; }
${RT("table", "b")} ${md("table")} > div > div { border-bottom-width: 0 !important; border-radius: 6px !important; }
${RT("table", "b")} ${md("table")} > div:last-child > div:nth-child(odd) { background: var(--cp-raised) !important; }
${RT("table", "c")} ${md("table")} { border-width: 0 !important; border-radius: 0 !important; }
${RT("table", "c")} ${md("table")} > div:first-child { background: transparent !important; }
${RT("table", "c")} ${md("table")} > div:last-child > div { border-bottom-width: 0 !important; }
${RT("table", "c")} ${md("table")} > div > div > div { padding: 7px 12px 7px 0 !important; }
${RT("table", "d")} ${md("table")} > div > div > div:not(:last-child) { border-right: 1px solid var(--cp-rule) !important; }

${RT("code", "b")} ${md("pre")} { border-width: 0 !important; }
${RT("code", "b")} button[aria-label="Copy code"] { opacity: 0.35; transition: opacity 120ms; }
${RT("code", "b")} ${md("pre")}:hover button[aria-label="Copy code"] { opacity: 1; }
${RT("code", "b")} ${md("pre")}${LANG}::before { content: attr(data-paseo-markdown-language); position: absolute; top: 11px; right: 38px; font-family: var(--cp-mono); font-size: 11px; line-height: 16px; color: var(--cp-muted); opacity: 0.6; transition: opacity 120ms; }
${RT("code", "b")} ${md("pre")}${LANG}:hover::before { opacity: 1; }
${RT("code", "c")} ${md("pre")} { background: transparent !important; }
${RT("code", "c")} ${md("pre")} > div:first-child { position: relative !important; padding-left: 32px !important; }
${RT("code", "c")} ${md("pre")} > div:first-child::before { content: attr(data-cp-lines); position: absolute; left: 0; top: 0; width: 18px; text-align: right; white-space: pre; font-family: var(--cp-mono); font-size: var(--cp-code); line-height: 1.5; color: var(--cp-muted); opacity: 0.6; }

${RT("inline", "b")} ${INLINE_CODE} { background: transparent !important; padding: 0 1px !important; color: var(--cp-warn) !important; }
${RT("inline", "c")} ${INLINE_CODE} { background: transparent !important; box-shadow: inset 0 0 0 1px var(--cp-rule) !important; }

${RT("heading", "b")} ${HEADING(1)} { font-size: 18px !important; display: inline-block !important; width: 100% !important; padding-bottom: 6px !important; border-bottom: 1px solid var(--cp-rule) !important; }
${RT("heading", "b")} ${HEADING(2)} { font-size: 15px !important; }
${RT("heading", "b")} ${HEADING(3)} { font-size: 12px !important; text-transform: uppercase !important; letter-spacing: 0.06em !important; color: var(--cp-muted) !important; }
${RT("heading", "c")} ${HEADING(1)}, ${RT("heading", "c")} ${HEADING(2)} { border-left: 3px solid var(--cp-accent) !important; padding-left: 10px !important; }
${RT("heading", "c")} ${HEADING(3)}::before { content: "### "; font-family: var(--cp-mono); font-size: var(--cp-code); font-weight: 400; color: var(--cp-muted); }

${RT("list", "b")} ${MARK} { font-size: 0 !important; }
${RT("list", "b")} ${MARK_UL}::before { content: "\\2013"; font-size: var(--cp-content); color: var(--cp-muted); }
${RT("list", "b")} ${MARK_OL}::before { content: attr(data-cp-n) ")"; font-family: var(--cp-mono); font-size: calc(var(--cp-code) + 1px); color: var(--cp-muted); }
${RT("list", "c")} ${MARK} { font-size: 0 !important; }
${RT("list", "c")} ${MARK}::before { content: "\\00B7"; font-size: var(--cp-content); font-weight: 700; color: var(--cp-muted); }
${RT("list", "c")} ${md("li")} { margin-bottom: 2px !important; }

${TASK} > ${MARK} { position: relative !important; font-size: 0 !important; width: 14px !important; }
${TASK} > ${MARK}::before { content: ""; position: absolute; left: 0; top: calc(var(--cp-content) * 0.8 - 7px); width: 14px; height: 14px; box-sizing: border-box; border: 1.5px solid var(--cp-muted); border-radius: 3px; }
${TASK}[data-cp-task="done"] > ${MARK}::before { background: var(--cp-accent); border-color: var(--cp-accent); }
${TASK}[data-cp-task="done"] > ${MARK}::after { content: ""; position: absolute; left: 2px; top: calc(var(--cp-content) * 0.8 - 5px); width: 10px; height: 10px; background: var(--cp-accent-fg); -webkit-mask: ${CHECK_MASK} center / contain no-repeat; mask: ${CHECK_MASK} center / contain no-repeat; }
:root[data-cp-rt-list="b"] ${TASK_ITEM} > ${MARK}::before { border-radius: 999px; }
:root[data-cp-rt-list="b"] ${TASK_ITEM}[data-cp-task="done"] > ${MARK}::before { background: transparent; border-color: var(--cp-ok); }
:root[data-cp-rt-list="b"] ${TASK_ITEM}[data-cp-task="done"] > ${MARK}::after { background: var(--cp-ok); }
:root[data-cp-rt-list="c"] ${TASK_ITEM} { min-height: 26px !important; align-items: center !important; }
:root[data-cp-rt-list="c"] ${TASK_ITEM}[data-cp-task="done"] span { color: var(--cp-muted) !important; }

${MSG} ${CALLOUT} { --cp-tone: var(--cp-accent); --cp-icon: ${INFO_MASK}; position: relative !important; border-left-width: 0 !important; border-radius: 8px !important; padding: 10px 14px 10px 36px !important; margin: 6px 0 !important; background: color-mix(in srgb, var(--cp-tone) 12%, transparent) !important; }
${MSG} ${CALLOUT}[data-cp-callout="warning"] { --cp-tone: var(--cp-warn); --cp-icon: ${ALERT_MASK}; }
${MSG} ${CALLOUT}[data-cp-callout="tip"] { --cp-tone: var(--cp-ok); --cp-icon: ${TIP_MASK}; }
${MSG} ${CALLOUT}::before { content: ""; position: absolute; left: 13px; top: 13px; width: 14px; height: 14px; background: var(--cp-tone); -webkit-mask: var(--cp-icon) center / contain no-repeat; mask: var(--cp-icon) center / contain no-repeat; }
${MSG} ${CALLOUT} span { font-style: normal !important; color: var(--cp-fg) !important; }
${MSG} ${CALLOUT} [data-cp-callout-mark] { font-size: 0 !important; }
${MSG} ${CALLOUT} [data-cp-callout-mark]::after { content: attr(data-cp-callout-mark); font-size: 13px; font-weight: 600; color: var(--cp-tone); }
${RT("callout", "b")} ${CALLOUT} { background: transparent !important; border-radius: 0 !important; border-left: 2px solid var(--cp-tone) !important; padding: 2px 0 2px 14px !important; }
${RT("callout", "b")} ${CALLOUT}::before { display: none; }
${RT("callout", "b")} ${CALLOUT} [data-cp-callout-mark]::after { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
${RT("callout", "c")} ${CALLOUT} { background: transparent !important; border-radius: 0 !important; padding: 0 0 0 24px !important; }
${RT("callout", "c")} ${CALLOUT}::before { left: 0; top: calc(var(--cp-content) * 0.8 - 7px); }
${RT("callout", "c")} ${CALLOUT} [data-cp-callout-mark] + span { display: none !important; }
${RT("callout", "c")} ${CALLOUT} [data-cp-callout-mark]::after { content: attr(data-cp-callout-mark) " \\2014  "; }

${MSG} ${md("hr")} { margin: 8px 0 !important; background: var(--cp-rule) !important; }
${RT("rule", "b")} ${md("hr")} { height: auto !important; background: transparent !important; text-align: center; }
${RT("rule", "b")} ${md("hr")}::before { content: "\\2022  \\2022  \\2022"; font-size: 12px; letter-spacing: 0.2em; color: var(--cp-muted); }
${RT("rule", "c")} ${md("hr")} { width: 48px !important; background: var(--cp-border, var(--cp-rule)) !important; }
`;

/**
 * Restyles what Paseo still draws itself (tool call groups, user bubbles, markdown) to the Chat Polish design
 * while `enabled()`; desktop/web only. Returns cleanup.
 * ponytail: CSS keyed on Paseo's testIDs, its DOM nesting and the data-paseo-markdown-* marks on its markdown;
 * a Paseo layout change can silently stop parts of it applying. Turn it off from the dashboard if it misfires.
 */
export function restyleNative(enabled: () => boolean) {
  let style: DomElement | undefined;
  let unthemeMermaid: (() => void) | undefined;
  const off = () => {
    if (!style) return;
    style.remove();
    style = undefined;
    unthemeMermaid?.();
    unthemeMermaid = undefined;
    document.removeEventListener("click", noteClick, true);
    for (const el of Array.from(document.querySelectorAll("[data-cp-rail], [data-cp-tip], [data-cp-hint]"))) el.remove();
  };
  return watchDom({
    added: (roots) => {
      if (!enabled()) return off();
      if (!style) {
        style = document.createElement("style");
        style.textContent = NATIVE_CSS + RICH_TEXT_CSS + MODEL_SELECTOR_CSS;
        document.head.appendChild(style);
        document.addEventListener("click", noteClick, true);
        unthemeMermaid = themeMermaid();
      }
      tagParts(roots);
      markBlocks(roots);
      decoratePopovers(roots);
    },
    settled: () => {
      if (!style) return;
      noteThinkingFallback();
      // Streamed text lands in nodes tagged earlier; catch callout markers, task boxes and code lines that arrived since.
      markBlocks([document.documentElement]);
    },
  }, off);
}

// ---- Composer model and thinking selectors ----

/** A provider as the model selector's rail shows it, from Paseo's provider snapshot. */
export interface RailProvider {
  id: string;
  label: string;
  status: "ready" | "loading" | "error" | "unavailable";
  iconSvg?: string;
  models: Array<{ label: string; thinking: Array<{ label: string; description?: string; isDefault: boolean }> }>;
}

const POP = '[data-testid="combobox-desktop-container"]';
const MODEL_POP = `${POP}[${TAG}="models"]`;
const THINKING_POP = `${POP}[${TAG}="thinking"]`;
const BACK = '[data-testid="sheet-header-back"]';
const SETTINGS = '[data-testid^="selector-header-settings-"]';
const MODEL_ROW = '[data-testid^="model-row-"]';
const HEADER = `${MODEL_POP} [data-cp-part="header"]`;

const MODEL_SELECTOR_CSS = `
${MODEL_POP} { width: 440px !important; min-width: 440px !important; max-width: 440px !important; display: grid !important; grid-template-columns: 172px minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr); border-radius: 12px !important; border-color: var(--cp-rule) !important; overflow: hidden !important; }
${MODEL_POP} > div:first-child { display: contents !important; }
${MODEL_POP} [data-cp-part="search"] { grid-column: 1 / -1; grid-row: 1; padding: 4px 12px !important; border-bottom: 1px solid var(--cp-rule) !important; }
${HEADER} { grid-column: 2; grid-row: 2; padding: 10px 12px 6px 14px !important; }
${HEADER} > :is(button, [data-cp-part="icon"]) { display: none !important; }
${HEADER} > [data-cp-part="title"] { font-size: 13px !important; font-weight: 600 !important; color: var(--cp-fg) !important; }
${HEADER} > [data-cp-part="title"]::after { content: attr(data-cp-count); margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--cp-muted); }
${MODEL_POP} > div:nth-child(2) { grid-column: 2; grid-row: 3; min-height: 0 !important; }
${MODEL_POP} [data-cp-part="providers"] { display: none !important; }
${MODEL_POP} :is([data-cp-part="rows"], [data-testid="model-profiles-empty"]) { margin: 0 6px 2px !important; border-radius: 6px !important; overflow: hidden !important; }
${MODEL_POP} :is(${MODEL_ROW}, [data-testid="model-profiles-empty"]) { padding: 6px 0 !important; }
${MODEL_POP} :is(${MODEL_ROW}, [data-testid="model-profiles-empty"]) > div { padding: 0 8px !important; gap: 8px !important; }
${MODEL_POP} ${MODEL_ROW} > div > div:first-child { display: none !important; }
${MODEL_POP} ${MODEL_ROW} > div > div:nth-child(2) { flex: 1 1 auto !important; min-width: 0 !important; align-items: baseline !important; }
${MODEL_POP} ${MODEL_ROW} > div > div:nth-child(2) > div:last-child { min-width: 0 !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }
${MODEL_POP} ${MODEL_ROW} > div > div:last-child { display: contents !important; }
${MODEL_POP} ${MODEL_ROW} > div > div:last-child > div:first-child { order: -1; width: 14px !important; }
${MODEL_POP} ${MODEL_ROW} svg { stroke: var(--cp-accent) !important; }

[data-cp-rail] { grid-column: 1; grid-row: 2 / 4; display: flex; flex-direction: column; gap: 2px; padding: 6px; overflow-y: auto; background: rgba(0, 0, 0, 0.14); border-right: 1px solid var(--cp-rule); }
[data-cp-rail] button { all: unset; box-sizing: border-box; position: relative; display: flex; align-items: center; gap: 8px; flex-shrink: 0; height: 30px; padding: 0 8px; border-radius: 6px; font-size: 13px; color: var(--cp-fg); cursor: pointer; }
[data-cp-rail] button:hover { background: var(--cp-control); }
[data-cp-rail] button[aria-current="true"] { background: var(--cp-control); font-weight: 500; }
[data-cp-rail] button[aria-current="true"]::before { content: ""; position: absolute; left: -6px; top: 8px; bottom: 8px; width: 2px; border-radius: 999px; background: var(--cp-accent); }
[data-cp-rail] button[aria-disabled="true"] { opacity: 0.45; cursor: default; }
[data-cp-rail] button[aria-disabled="true"]:hover { background: transparent; }
[data-cp-rail] hr { border: 0; height: 1px; margin: 4px 2px; background: var(--cp-rule); flex-shrink: 0; }
[data-cp-rail] [data-cp-icon] { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex-shrink: 0; color: var(--cp-muted); font-size: 11px; font-weight: 600; }
[data-cp-rail] svg { width: 14px; height: 14px; }
[data-cp-rail] [data-cp-label] { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-cp-rail] [data-cp-status="loading"] svg { color: var(--cp-muted); animation: cp-spin 1s linear infinite; }
[data-cp-rail] [data-cp-status="error"] svg { color: #e06c75; }
@keyframes cp-spin { to { transform: rotate(360deg); } }
[data-cp-tip] { position: absolute; z-index: 1; display: none; max-width: 220px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--cp-rule); background: var(--cp-sunken); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); font-size: 12px; line-height: 1.45; color: var(--cp-muted); pointer-events: none; }
[data-cp-tip] b { display: block; margin-bottom: 2px; font-weight: 600; color: var(--cp-fg); }

${THINKING_POP} { border-radius: 12px !important; border-color: var(--cp-rule) !important; }
${THINKING_POP}[data-cp-described] { width: 420px !important; }
${THINKING_POP} button { margin: 0 4px !important; padding: 6px 8px !important; border-radius: 6px !important; gap: 8px !important; }
${THINKING_POP} button > div:first-child { visibility: hidden !important; }
${THINKING_POP} button[data-cp-part="checked"] > div:first-child { display: none !important; }
${THINKING_POP} button > div:nth-child(3) { order: -1; }
${THINKING_POP} button > div:nth-child(3) svg { stroke: var(--cp-accent) !important; }
${THINKING_POP} button > div:nth-child(2) { flex: 1 1 auto !important; min-width: 0 !important; flex-direction: row !important; align-items: center !important; gap: 8px !important; }
[data-cp-default] { flex-shrink: 0; padding: 0 6px; border: 1px solid var(--cp-rule); border-radius: 999px; font-size: 11px; line-height: 16px; color: var(--cp-muted); }
[data-cp-desc] { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--cp-muted); }
[data-cp-hint] { position: absolute; right: 12px; bottom: calc(100% + 8px); padding: 3px 10px; border: 1px solid var(--cp-rule); border-radius: 999px; background: var(--cp-raised); font-size: 12px; line-height: 16px; white-space: nowrap; color: var(--cp-muted); pointer-events: none; }
`;

let railProviders: RailProvider[] = [];

/** Feeds the model selector the host's providers; call again whenever Paseo's provider snapshot changes. */
export function setRailProviders(list: RailProvider[]) {
  railProviders = list;
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  for (const pop of Array.from(document.querySelectorAll(MODEL_POP))) decorateModels(pop);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const lucide = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const BOOKMARK = lucide('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>');
const LOADER = lucide('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>');
const ALERT = lucide('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>');

const safeSvg = (svg?: string) => (svg && /^<svg[\s>]/.test(svg) && !/<script|\son\w+=/i.test(svg) ? svg : undefined);
const iconFor = (p: RailProvider) => PROVIDER_ICONS[p.id] ?? safeSvg(p.iconSvg) ?? BOT_ICON;

const railHtml = new WeakMap<DomElement, string>();
let clickedThinking: { chip: DomElement; at: number } | undefined;
let pickedModelAt = 0;

function noteClick(event: { target: unknown }) {
  const target = event.target as DomElement | null;
  const chip = target?.closest?.('[data-testid="agent-thinking-selector"]');
  if (chip) clickedThinking = { chip, at: Date.now() };
  if (target?.closest?.(`${MODEL_POP} ${MODEL_ROW}`)) pickedModelAt = Date.now();
}

/** Marks and decorates Paseo's model and thinking popovers as they open or change view. */
function decoratePopovers(roots: DomElement[]) {
  const pops = new Set<DomElement>();
  for (const root of roots) {
    const inside = root.closest(POP);
    if (inside) pops.add(inside);
    else for (const pop of within([root], POP)) pops.add(pop);
  }
  for (const pop of pops) {
    if (pop.querySelector('[data-testid="compact-model-list"], [data-testid="compact-provider-list"]')) {
      pop.setAttribute(TAG, "models");
      decorateModels(pop);
    } else if (clickedThinking && Date.now() - clickedThinking.at < 2000) {
      decorateThinking(pop, clickedThinking.chip);
    }
  }
}

/** The left provider rail, the model count and shorter descriptions. Paseo's own list still does the selecting. */
function decorateModels(pop: DomElement) {
  const current = pop.querySelector(SETTINGS)?.getAttribute("data-testid")?.slice("selector-header-settings-".length);
  // Only a new chat can change provider: its selector has a provider list or a back button to one.
  const canSwitch = !!pop.querySelector(`${BACK}, [data-testid="compact-provider-list"]`);

  for (const el of Array.from(pop.firstElementChild?.children ?? [])) el.setAttribute("data-cp-part", el.querySelector("input") ? "search" : "header");
  for (const el of Array.from(pop.querySelectorAll('[data-cp-part="header"] > div'))) if (el.querySelector(":scope > svg")) el.setAttribute("data-cp-part", "icon");
  for (const el of Array.from(pop.querySelectorAll('[data-testid^="model-provider-"]'))) el.parentElement?.parentElement?.parentElement?.setAttribute("data-cp-part", "providers");
  for (const el of Array.from(pop.querySelectorAll(MODEL_ROW))) el.parentElement?.setAttribute("data-cp-part", "rows");
  // Counted while the search is empty, so a filtered list doesn't change the provider's total.
  let title = pop.querySelector(SETTINGS);
  while (title && title.parentElement?.getAttribute("data-cp-part") !== "header") title = title.parentElement;
  title = title?.previousElementSibling ?? null;
  title?.setAttribute("data-cp-part", "title");
  const count = pop.querySelectorAll(MODEL_ROW).length;
  if (title && count && !(pop.querySelector("input") as { value?: string } | null)?.value) title.setAttribute("data-cp-count", `${count} model${count === 1 ? "" : "s"}`);
  // "Opus 5.5 · Latest release" under "Opus 5.5": the name is already on the row.
  for (const text of Array.from(pop.querySelectorAll(`${MODEL_ROW} > div > div:nth-child(2)`))) {
    const [name, description] = Array.from(text.children);
    const node = description?.firstChild;
    const prefix = `${name?.textContent ?? ""} · `;
    if (node?.nodeValue?.startsWith(prefix)) node.nodeValue = node.nodeValue.slice(prefix.length);
  }

  let rail = Array.from(pop.children).find((el) => el.hasAttribute("data-cp-rail"));
  const opening = !rail;
  if (!rail) {
    rail = document.createElement("div");
    rail.setAttribute("data-cp-rail", "");
    const font = pop.querySelector("input");
    if (font) rail.style.setProperty("font-family", getComputedStyle(font).fontFamily);
    wireRail(pop, rail);
    pop.appendChild(rail);
  }
  const item = (id: string, label: string, icon: string, extra = "") =>
    `<button type="button" data-cp-provider="${esc(id)}" aria-current="${id === (current ?? "profiles")}"${!canSwitch && id !== current ? ' aria-disabled="true"' : ""}><span data-cp-icon>${icon}</span><span data-cp-label title="${esc(label)}">${esc(label)}</span>${extra}</button>`;
  const status = (p: RailProvider) =>
    p.status === "loading" ? `<span data-cp-icon data-cp-status="loading">${LOADER}</span>` : p.status === "error" || p.status === "unavailable" ? `<span data-cp-icon data-cp-status="error">${ALERT}</span>` : "";
  const html = [canSwitch ? `${item("profiles", "Profiles", BOOKMARK)}<hr>` : "", ...railProviders.map((p) => item(p.id, p.label, iconFor(p), status(p)))].join("");
  if (railHtml.get(rail) !== html) {
    rail.innerHTML = html;
    railHtml.set(rail, html);
  }
  const active = rail.querySelector('[aria-current="true"]');
  const offset = active ? active.getBoundingClientRect().top - rail.getBoundingClientRect().top : 0;
  if (opening && offset > rail.getBoundingClientRect().height - 36) rail.scrollTop += offset - 120;
}

function wireRail(pop: DomElement, rail: DomElement) {
  const tip = document.createElement("div");
  tip.setAttribute("data-cp-tip", "");
  pop.appendChild(tip);
  const itemOf = (target: unknown) => (target as DomElement | null)?.closest?.("[data-cp-provider]") ?? null;
  rail.addEventListener("click", (event) => {
    const item = itemOf(event.target);
    if (!item || item.getAttribute("aria-disabled") === "true" || item.getAttribute("aria-current") === "true") return;
    const id = item.getAttribute("data-cp-provider")!;
    // Drive Paseo's own drill-down: back to its provider list, then into the provider.
    pop.querySelector(BACK)?.click();
    let tries = 0;
    const open = () => {
      if (id === "profiles") return;
      const row = pop.querySelector(`[data-testid="model-provider-${id}"]`);
      if (row) row.click();
      else if (++tries < 30) requestAnimationFrame(open);
    };
    open();
  });
  rail.addEventListener("mouseover", (event) => {
    const item = itemOf(event.target);
    if (!item || item.getAttribute("aria-disabled") !== "true") return tip.style.setProperty("display", "none");
    const here = railProviders.find((p) => p.id === pop.querySelector('[data-cp-provider][aria-current="true"]')?.getAttribute("data-cp-provider"));
    const there = item.textContent ?? "";
    tip.innerHTML = `<b>New chats only</b>This agent stays on ${esc(here?.label ?? "its provider")}. Start a new chat to use ${esc(there)}.`;
    const box = pop.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    tip.style.setProperty("left", `${at.right - box.left - 24}px`);
    tip.style.setProperty("top", `${at.bottom - box.top + 4}px`);
    tip.style.setProperty("display", "block");
  });
  rail.addEventListener("mouseleave", () => tip.style.setProperty("display", "none"));
}

/** The model a composer's chips show, matched by its label and, when labels repeat across providers, its thinking option count. */
function findModel(label: string | undefined, thinkingCount?: number) {
  const named = railProviders.flatMap((p) => p.models).filter((m) => m.label === label);
  return named.find((m) => thinkingCount === undefined || m.thinking.length === thinkingCount) ?? named[0];
}

// Paseo shows its own wording for thinking levels ("Extra high" for xhigh), so compare loosely.
const level = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^extra/, "x");

const chipText = (scope: DomElement, testId: string) => scope.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? "";
// Some providers' thinking chip is an icon only; its accessibility label still names the level.
const thinkingText = (scope: DomElement) => /\((.+)\)$/.exec(scope.querySelector('[data-testid="agent-thinking-selector"]')?.getAttribute("aria-label") ?? "")?.[1] ?? chipText(scope, "agent-thinking-selector");

/** Adds what Paseo's thinking list leaves out: the model's default level and, when the provider has them, descriptions. */
function decorateThinking(pop: DomElement, chip: DomElement) {
  const composer = chip.closest('[data-testid="message-input-root"]') ?? document.documentElement;
  const labels = Array.from(pop.querySelectorAll("button > div:nth-child(2)"));
  const model = findModel(chipText(composer, "combined-model-selector"), labels.length);
  if (!model) return;
  pop.setAttribute(TAG, "thinking");
  for (const button of Array.from(pop.querySelectorAll("button"))) if (button.children.length > 2) button.setAttribute("data-cp-part", "checked");
  if (model.thinking.some((t) => t.description)) pop.setAttribute("data-cp-described", "");
  // Paseo lists the model's options in order; a search filter (over six options) breaks that, so match by name then.
  const inOrder = labels.length === model.thinking.length;
  labels.forEach((el, i) => {
    const option = inOrder ? model.thinking[i] : model.thinking.find((t) => level(t.label) === level(el.firstElementChild?.textContent ?? ""));
    if (!option || el.querySelector("[data-cp-default], [data-cp-desc]")) return;
    for (const [attr, value] of [["data-cp-default", option.isDefault ? "Default" : ""], ["data-cp-desc", option.description ?? ""]] as const) {
      if (!value) continue;
      const span = document.createElement("span");
      span.setAttribute(attr, "");
      span.textContent = value;
      el.appendChild(span);
    }
  });
}

const seenChips = new WeakMap<DomElement, { model: string; thinking: string }>();

/** Paseo silently moves thinking to the new model's default when the old level doesn't exist there; say so. */
function noteThinkingFallback() {
  for (const composer of Array.from(document.querySelectorAll('[data-testid="message-input-root"]'))) {
    const now = { model: chipText(composer, "combined-model-selector"), thinking: composer.querySelector('[data-testid="agent-thinking-selector"]') ? thinkingText(composer) : "" };
    const before = seenChips.get(composer);
    seenChips.set(composer, now);
    if (!before || before.model === now.model || !before.thinking || !now.thinking || before.thinking === now.thinking) continue;
    if (Date.now() - pickedModelAt > 3000) continue;
    const model = findModel(now.model);
    if (!model || model.thinking.some((t) => level(t.label) === level(before.thinking))) continue;
    composer.querySelector("[data-cp-hint]")?.remove();
    const hint = document.createElement("div");
    hint.setAttribute("data-cp-hint", "");
    hint.textContent = `${before.thinking} isn't on ${now.model} · using its default, ${now.thinking}`;
    composer.appendChild(hint);
    setTimeout(() => hint.remove(), 6000);
  }
}
