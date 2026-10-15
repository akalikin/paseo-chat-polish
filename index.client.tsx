import type { PluginTimelineData } from "@getpaseo/plugin";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Dashboard } from "./client/dashboard";
import { hideableKind, imageData, imagesSchema, noticeData, noticeSchema, planSchema, thoughtSchema, todoData, todoSchema, toolData, toolSchema } from "./client/model";
import { currentPrefs, setPrefs, subscribePrefs } from "./client/prefs";
import { bindThemeRegistry, currentTheme, registerTheme } from "./client/theme-registry";
import { clampUserMessages, paintSidebar, readHostAppearance, restyleNative, setNativeColors, setRailProviders, setRichText, watchDom } from "./client/web";
import { getTheme, THEME_CATALOG_ID, themeSchema } from "./shared/theme";
import { getPrefs } from "./shared/timeline";
import { ImagesItem, NoticeItem, PlanItem, ThoughtItem, TodoItem, ToolItem } from "./client/views";

const KIND = "chat-polish";

function DashboardItem({ currentScreen, openScreen, theme }: PluginSidebarItemProps) {
  // Always mounted on desktop, so it is where the restyle learns the app theme's colors.
  useEffect(() => setNativeColors(theme.colors), [theme]);
  return <SidebarRow icon="Sparkles" active={currentScreen?.screenId === "dashboard"} onPress={() => openScreen({ screenId: "dashboard" })} />;
}

export default function contribute(client: PluginClientContext) {
  const unbindTheme = bindThemeRegistry(client);
  // Register the default right away, then swap in the theme saved from the dashboard.
  registerTheme(themeSchema.parse({}));
  client
    .rpc(getTheme, {})
    .then(registerTheme)
    .catch((error: unknown) => console.warn("[chat-polish] Saved theme unavailable, using the default", error));
  const unpaintSidebar = paintSidebar(() => {
    const theme = currentTheme();
    const active = readHostAppearance().pluginThemeId === THEME_CATALOG_ID;
    return active && theme?.sidebar ? { sidebar: theme.sidebar, background: theme.colors.background } : undefined;
  });

  const unrestyle = restyleNative(() => currentPrefs().nativeStyle === "design");
  const unclamp = clampUserMessages(() => currentPrefs().userMessages === "clamp");

  // The composer's model selector rail lists every provider, which Paseo only renders for new chats.
  const loadProviders = () =>
    client.paseo.providers
      .snapshot()
      .then(({ entries }) =>
        setRailProviders(
          entries
            .filter((e) => e.enabled !== false)
            .map((e) => ({
              id: e.provider,
              label: e.label ?? e.provider,
              status: e.status,
              iconSvg: e.iconSvg,
              models: (e.models ?? []).map((m) => ({
                label: m.label,
                thinking: (m.thinkingOptions ?? []).map((t) => ({ label: t.label, description: t.description, isDefault: t.id === m.defaultThinkingOptionId })),
              })),
            })),
        ),
      )
      .catch((error: unknown) => console.warn("[chat-polish] Provider list unavailable for the model selector", error));
  void loadProviders();
  const unsubscribeProviders = client.paseo.providers.subscribe(() => void loadProviders());

  // Round-trip through JSON so optional fields left undefined never reach the host as non-JSON.
  const one = (kind: string, data: object) => ({
    items: [{ type: "plugin" as const, kind: `${KIND}-${kind}`, version: 1, data: JSON.parse(JSON.stringify(data)) as PluginTimelineData }],
  });

  // Transformers read prefs when they run; re-register when hiding or images change so Paseo re-transforms.
  const addTransformers = () => {
    const removers = [
      client.addTimelineTransformer({
        id: `${KIND}-tool`,
        query: { itemType: "tool_call" },
        transform: ({ item, phase }) => {
          const kind = hideableKind(item);
          if (kind && currentPrefs().hidden.includes(kind)) return { items: [] };
          if (item.detail.type === "plan") return one("plan", { text: item.detail.text, phase });
          // Summary mode: leave calls native so Paseo can group them ("Ran 4 commands"); a plugin row would split the group.
          return readHostAppearance().toolCallDetail === "overview" ? undefined : one("tool", toolData(item));
        },
      }),
      client.addTimelineTransformer({
        id: `${KIND}-reasoning`,
        query: { itemType: "reasoning" },
        transform: ({ item, phase }) => one("thought", { text: item.text, phase }),
      }),
      client.addTimelineTransformer({
        id: `${KIND}-images`,
        query: { itemType: "assistant_message" },
        transform: ({ item }) => {
          const data = currentPrefs().images === "native" ? undefined : imageData(item.text);
          return data ? one("images", data) : undefined;
        },
      }),
      client.addTimelineTransformer({ id: `${KIND}-todo`, query: { itemType: "todo" }, transform: ({ item }) => one("todo", todoData(item)) }),
      client.addTimelineTransformer({ id: `${KIND}-error`, query: { itemType: "error" }, transform: ({ item }) => one("notice", noticeData(item)) }),
      client.addTimelineTransformer({ id: `${KIND}-compaction`, query: { itemType: "compaction" }, transform: ({ item }) => one("notice", noticeData(item)) }),
    ];
    return () => removers.forEach((r) => void r());
  };
  let removeTransformers = addTransformers();
  const inputs = () => [currentPrefs().images, currentPrefs().hidden.join(), readHostAppearance().toolCallDetail].join("|");
  let transformedWith = inputs();
  const retransform = () => {
    if (inputs() === transformedWith) return;
    transformedWith = inputs();
    removeTransformers();
    removeTransformers = addTransformers();
  };
  setRichText({ ...currentPrefs().richText, images: currentPrefs().images, steps: currentPrefs().steps });
  const unsubscribePrefs = subscribePrefs(() => {
    setRichText({ ...currentPrefs().richText, images: currentPrefs().images, steps: currentPrefs().steps });
    retransform();
  });
  // Paseo doesn't tell plugins when Tool call display changes; its settings screen re-renders, so check on DOM changes.
  const unwatchHost = watchDom({ settled: retransform }, () => {});
  client
    .rpc(getPrefs, {})
    .then(setPrefs)
    .catch((error: unknown) => console.warn("[chat-polish] Saved timeline prefs unavailable, using defaults", error));

  client.addTimelineRenderer({ kind: `${KIND}-tool`, version: 1, schema: toolSchema, Component: ToolItem });
  client.addTimelineRenderer({ kind: `${KIND}-plan`, version: 1, schema: planSchema, Component: PlanItem });
  client.addTimelineRenderer({ kind: `${KIND}-thought`, version: 1, schema: thoughtSchema, Component: ThoughtItem });
  client.addTimelineRenderer({ kind: `${KIND}-todo`, version: 1, schema: todoSchema, Component: TodoItem });
  client.addTimelineRenderer({ kind: `${KIND}-notice`, version: 1, schema: noticeSchema, Component: NoticeItem });
  client.addTimelineRenderer({ kind: `${KIND}-images`, version: 1, schema: imagesSchema, Component: ImagesItem });

  client.addScreen({ id: "dashboard", title: "Chat Polish", Component: Dashboard });
  client.addSidebarHeaderItem({ id: "dashboard", title: "Chat Polish", Component: DashboardItem });
  return () => {
    unsubscribePrefs();
    unwatchHost();
    removeTransformers();
    unpaintSidebar();
    unclamp();
    unsubscribeProviders();
    unrestyle();
    unbindTheme();
  };
}
