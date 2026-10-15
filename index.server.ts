import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readImageFile } from "./server/image";
import { readImage } from "./shared/image";
import { getTheme, themeSchema, themeSettings } from "./shared/theme";
import { getPrefs, prefsSchema, prefsSettings } from "./shared/timeline";

export default function contribute(server: PluginServerContext) {
  const theme = server.registerSettings(themeSettings);
  server.handle(readImage, readImageFile);
  server.handle(getTheme, async () => {
    const current = await theme.read();
    return current.status === "ready" ? current.values : themeSchema.parse({});
  });
  const prefs = server.registerSettings(prefsSettings);
  server.handle(getPrefs, async () => {
    const current = await prefs.read();
    return current.status === "ready" ? current.values : prefsSchema.parse({});
  });
  return () => {};
}
