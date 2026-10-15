import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Completed tool calls the dashboard can leave out of the timeline. */
export const HIDEABLE = ["read", "search", "fetch", "task"] as const;
export type Hideable = (typeof HIDEABLE)[number];

/** Markdown elements with a choice of style. */
export const RICH_TEXT = ["quote", "table", "code", "inline", "heading", "list", "callout", "rule"] as const;
export type RichText = (typeof RICH_TEXT)[number];

const variant = z.enum(["a", "b", "c"]).default("a");
// Tables have a fourth style, "d" (grid).
const tableVariant = z.enum(["a", "b", "c", "d"]).default("a");

export const prefsSchema = z.object({
  /** Initial state of reasoning rows; "paseo" follows Settings → Appearance → Always expand reasoning. */
  reasoning: z.enum(["paseo", "collapsed", "expanded"]).default("paseo"),
  /** Which tool rows start with their details open. */
  toolDetails: z.enum(["collapsed", "failed", "expanded"]).default("collapsed"),
  /** When the shell command in a row title is colored. */
  commandColors: z.enum(["expanded", "always"]).default("expanded"),
  /** Completed tool calls left out of the timeline; running and failed calls always show. */
  hidden: z.array(z.enum(HIDEABLE)).default([]),
  /** Long user messages: clamped to six lines with a fade (desktop), or shown in full. */
  userMessages: z.enum(["clamp", "full"]).default("clamp"),
  /** Thought and tool rows: faded until hovered or opened, or full strength. "merged" (folding steps between replies) was
   * removed because hiding items inside Paseo's virtualized list crashed it; saved values fall back to faded. */
  steps: z.enum(["faded", "full"]).catch("faded"),
  /** Paseo's own items (tool call groups, bubbles, markdown) restyled to the design on desktop, or left as Paseo draws them. */
  nativeStyle: z.enum(["design", "paseo"]).default("design"),
  /** Image-only replies as thumbnails; "native" leaves them to Paseo. */
  images: z.enum(["small", "large", "native"]).default("small"),
  /** One style variant per markdown element in Paseo's own replies (desktop, with nativeStyle "design"); "a" is the base design. */
  richText: z.object({ quote: variant, table: tableVariant, code: variant, inline: variant, heading: variant, list: variant, callout: variant, rule: variant }).prefault({}),
});
export type Prefs = z.output<typeof prefsSchema>;

/** How timeline items render, edited from the dashboard. */
export const prefsSettings = defineSettings({ id: "timeline", scope: "host", version: 1, schema: prefsSchema });

/** Lets the client entry fetch saved prefs before the first timeline row renders. */
export const getPrefs = defineRpc({ name: "prefs.get", input: z.object({}), output: prefsSchema });
