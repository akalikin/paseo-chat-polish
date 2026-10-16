import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** What `paseo plugin update --check` found for this plugin's install, in the dashboard's terms. */
export const updateStatusSchema = z.object({
  /** "local": installed from a folder, which only reloads; "error": the check failed (offline, CLI missing). */
  state: z.enum(["update", "current", "local", "error"]),
  /** Short commit (Git) or version (npm) installed and offered. */
  current: z.string().optional(),
  target: z.string().optional(),
  /** Where to review the change (a compare link for Git). */
  links: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type UpdateStatus = z.output<typeof updateStatusSchema>;

export const checkUpdate = defineRpc({ name: "update.check", input: z.object({}), output: updateStatusSchema });

/** Applies the update the user reviewed; Paseo then installs it and restarts the plugin. */
export const applyUpdate = defineRpc({ name: "update.apply", input: z.object({}), output: z.object({ error: z.string().optional() }) });
