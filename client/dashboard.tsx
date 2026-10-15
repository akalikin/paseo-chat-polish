import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { useEffect, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { contrast, isHex, PRESETS, THEME_CATALOG_ID, themeSchema, themeSettings, TOKEN_ROLES, TOKENS, type ThemeDraft, type Token } from "../shared/theme";
import { HIDEABLE, prefsSettings, RICH_TEXT, type Hideable, type Prefs, type RichText } from "../shared/timeline";
import { hideableKind, toolData } from "./model";
import { PrefsOverride, setPrefs, usePrefs } from "./prefs";
import { registerTheme, useCurrentTheme } from "./theme-registry";
import { highlightShell, PLAIN_SYNTAX, SYNTAX_THEMES } from "./highlight";
import { alpha, ImagesItem, sunken, SyntaxOverride, ThoughtItem, ToolItem, useStyles } from "./views";
import { canSetAppTheme, readHostAppearance, readSyntaxTheme, setAppTheme, updateAppSettings } from "./web";

type ToolCall = Extract<AgentTimelineItem, { type: "tool_call" }>;
const call = (detail: ToolCall["detail"], extra?: Partial<ToolCall>) =>
  ({ type: "tool_call", callId: "preview", name: "preview", status: "completed", error: null, detail, ...extra }) as ToolCall;

const PREVIEW_CALLS = [
  call({ type: "search", query: "verifyToken", numMatches: 11, numFiles: 7, filePaths: ["src/routes/billing.ts", "src/routes/users.ts"] }),
  call({ type: "read", filePath: "src/routes/billing.ts" }),
  call({ type: "write", filePath: "src/middleware/requireAuth.ts", content: "\n".repeat(27) }),
  call({ type: "shell", command: "npm run lint", output: "src/routes/users.ts\n  12:10  error  'verifyToken' is defined but never used", exitCode: 1 }, { status: "failed" }),
  call({ type: "shell", command: "npm test -- auth", output: "PASS  test/auth.middleware.test.ts\nTests:  24 passed, 24 total", exitCode: 0 }),
  call({ type: "plain_text", label: "Dev server exited", text: "<task-notification/>" }, { name: "task_notification" }),
];

// 2×2 pixels in the Mariana accents; scaled up it reads as a soft gradient screenshot.
const PREVIEW_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVR4nGNIm3nm6JSjDPGbN//angwANX4Hw07OqLUAAAAASUVORK5CYII=";

type Page = "theme" | "messages" | "rich" | "reasoning" | "tools";
const PAGES: Array<{ id: Page; icon: string; label: string }> = [
  { id: "theme", icon: "Palette", label: "Theme" },
  { id: "messages", icon: "MessageSquareText", label: "Messages" },
  { id: "rich", icon: "Type", label: "Rich text" },
  { id: "reasoning", icon: "Brain", label: "Reasoning" },
  { id: "tools", icon: "Wrench", label: "Tool call" },
];

const sameColors = (a: ThemeDraft["colors"], b: ThemeDraft["colors"]) => TOKENS.every((t) => a[t].toLowerCase() === b[t].toLowerCase());

/** Plugin theme tokens for a draft, so the preview renders exactly what Apply would ship. */
function previewTheme(d: ThemeDraft, host: PluginTheme): PluginTheme {
  const c = d.colors;
  const onAccent = contrast(c.accent, "#ffffff") >= contrast(c.accent, c.background) ? "#ffffff" : c.background;
  return {
    colors: {
      ...host.colors,
      surface0: c.background,
      surface1: c.raised,
      surface2: c.control,
      border: c.border,
      foreground: c.foreground,
      foregroundMuted: c.mutedForeground,
      accent: c.accent,
      accentForeground: onAccent,
    },
  };
}

function Button({ theme, label, icon, primary, disabled, onPress }: { theme: PluginTheme; label: string; icon: string; primary?: boolean; disabled?: boolean; onPress(): void }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const fg = primary ? c.accentForeground : c.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        opacity: disabled ? 0.45 : 1,
        ...(primary ? { backgroundColor: c.accent } : { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }),
      }}
    >
      <Icon name={icon} size={14} color={primary ? fg : c.foregroundMuted} />
      <Text style={[s.verb, { color: fg, fontWeight: primary ? "600" : "400" }]}>{label}</Text>
    </Pressable>
  );
}

function Segmented<T extends string>({ theme, value, options, onChange }: { theme: PluginTheme; value: T; options: Array<[T, string, string?]>; onChange(v: T): void }) {
  const s = useStyles(theme);
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", padding: 2, gap: 2, borderRadius: 8, backgroundColor: c.surface2 }}>
      {options.map(([v, icon, label]) => {
        const on = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label ?? icon}
            onPress={() => onChange(v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: on ? c.surface1 : undefined }}
          >
            <Icon name={icon} size={13} color={on ? c.foreground : c.foregroundMuted} />
            {label ? <Text style={[s.small, { fontSize: 12, color: on ? c.foreground : c.foregroundMuted }]}>{label}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionHead({ theme, title, hint }: { theme: PluginTheme; title: string; hint?: string }) {
  const s = useStyles(theme);
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={[s.title, { fontSize: 13 }]}>{title}</Text>
      {hint ? <Text style={[s.small, { fontSize: 11 }]}>{hint}</Text> : null}
    </View>
  );
}

/** A small full-radius tag: "Desktop", "Paseo default", "Live". */
function Badge({ theme, label, icon, tone }: { theme: PluginTheme; label: string; icon?: string; tone?: string }) {
  const s = useStyles(theme);
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: tone ? 0 : 1, borderColor: alpha(c.border, 0.9), backgroundColor: tone ? alpha(tone, 0.14) : undefined }}>
      {icon ? <Icon name={icon} size={10} color={tone ?? c.foregroundMuted} /> : tone ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: tone }} /> : null}
      <Text style={[s.small, { fontSize: 11, lineHeight: 14, color: tone ?? c.foregroundMuted }]}>{label}</Text>
    </View>
  );
}

/** A settings section: title (with a Desktop tag for desktop-only settings), one line on what it covers, then the control. */
function Section({ theme, title, description, desktop, first, children }: { theme: PluginTheme; title: string; description: string; desktop?: boolean; first?: boolean; children: ReactNode }) {
  const s = useStyles(theme);
  return (
    <View style={{ gap: 14, paddingTop: first ? 0 : 20, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[s.title, { fontSize: 14 }]}>{title}</Text>
          {desktop ? <Badge theme={theme} label="Desktop" icon="Monitor" /> : null}
        </View>
        <Text style={[s.small, { fontSize: 12 }]}>{description}</Text>
      </View>
      {children}
    </View>
  );
}

/** An informational box: accent icon, text, and an optional action on the right. */
function Notice({ theme, children, action }: { theme: PluginTheme; children: ReactNode; action?: ReactNode }) {
  const s = useStyles(theme);
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 8, backgroundColor: c.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
      <Icon name="Info" size={14} color={c.accent} />
      <Text style={[s.small, { flex: 1, fontSize: 12, lineHeight: 17, color: c.foreground }]}>{children}</Text>
      {action}
    </View>
  );
}

function InnerNav({ theme, host, page, onSelect }: { theme: PluginTheme; host: string; page: Page; onSelect(p: Page): void }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const item = ({ id, icon, label }: (typeof PAGES)[number]) => {
    const active = id === page;
    return (
      <Pressable
        key={id}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onSelect(id)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 8,
          paddingVertical: 8,
          borderRadius: 6,
          backgroundColor: active ? c.surface2 : pressed ? c.surface1 : undefined,
        })}
      >
        <Icon name={icon} size={16} color={active ? c.foreground : c.foregroundMuted} />
        <Text style={[s.target, { color: active ? c.foreground : c.foregroundMuted, flex: 1 }]}>{label}</Text>
      </Pressable>
    );
  };
  const group = (label: string) => <Text style={[s.label, { paddingHorizontal: 8, marginBottom: 2 }]}>{label}</Text>;
  return (
    <View style={{ width: 232, paddingHorizontal: 12, paddingVertical: 20, gap: 24, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8 }}>
        <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
          <Icon name="Sparkles" size={14} color={c.accentForeground} />
        </View>
        <View>
          <Text style={[s.title, { fontSize: 14 }]}>Chat Polish</Text>
          <Text style={[s.small, { fontSize: 11 }]}>Paseo plugin</Text>
        </View>
      </View>
      <View style={{ gap: 2 }}>
        {group("APPEARANCE")}
        {item(PAGES[0]!)}
      </View>
      <View style={{ gap: 2 }}>
        {group("TIMELINE ITEMS")}
        {PAGES.slice(1).map(item)}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.statusSuccess }} />
        <Text style={[s.small, { fontSize: 11 }]} numberOfLines={1}>
          Plugin active · {host}
        </Text>
      </View>
    </View>
  );
}

function Editor({ theme, draft, setDraft }: { theme: PluginTheme; draft: ThemeDraft; setDraft(d: ThemeDraft): void }) {
  const s = useStyles(theme);
  const c = theme.colors;
  // Hex text being typed; only valid values reach the draft.
  const [typing, setTyping] = useState<Partial<Record<Token | "sidebar", string>>>({});
  useEffect(() => setTyping({}), [draft.colors, draft.sidebar]);
  const selected = PRESETS.find((p) => sameColors(p.colors, draft.colors) && (p.sidebar ?? "") === draft.sidebar && p.syntax === draft.syntax)?.id;
  const ratios = [
    ["foreground", contrast(draft.colors.foreground, draft.colors.background)],
    ["muted", contrast(draft.colors.mutedForeground, draft.colors.background)],
    ["accent", contrast(draft.colors.accent, draft.colors.background)],
  ] as const;
  const passes = ratios.every(([, r]) => r >= 4.5);
  const input = { ...s.target, color: c.foreground, backgroundColor: c.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 };

  return (
    <View style={{ gap: 28 }}>
      <View style={{ gap: 12 }}>
        <SectionHead theme={theme} title="Presets" hint={`${PRESETS.length} themes`} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {PRESETS.map((p) => {
            const on = p.id === selected;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setDraft({ name: p.name, appearance: p.appearance, colors: { ...p.colors }, sidebar: p.sidebar ?? "", syntax: p.syntax })}
                style={{ flex: 1, padding: 8, gap: 8, borderRadius: 8, backgroundColor: c.surface1, borderWidth: on ? 1.5 : StyleSheet.hairlineWidth, borderColor: on ? c.accent : c.border }}
              >
                <View style={{ flexDirection: "row", height: 40, borderRadius: 4, overflow: "hidden" }}>
                  {(["background", "raised", "accent", "foreground"] as const).map((k) => (
                    <View key={k} style={{ flex: 1, backgroundColor: p.colors[k] }} />
                  ))}
                </View>
                <Text style={[s.small, { fontSize: 12, color: on ? c.foreground : c.foregroundMuted }]} numberOfLines={2}>
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New theme from current colors"
            onPress={() => setDraft({ ...draft, name: "Custom theme" })}
            style={{ width: 64, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Icon name="Plus" size={16} color={c.foregroundMuted} />
            <Text style={[s.small, { fontSize: 11 }]}>New</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <SectionHead theme={theme} title="Identity" />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput
            accessibilityLabel="Theme name"
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name: name || " " })}
            style={[input, { flex: 1 }]}
          />
          <Segmented
            theme={theme}
            value={draft.appearance}
            onChange={(appearance) => setDraft({ ...draft, appearance })}
            options={[
              ["light", "Sun", "Light"],
              ["dark", "Moon", "Dark"],
            ]}
          />
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <SectionHead theme={theme} title="Colors" hint="PluginThemeColors" />
        <View style={{ borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: "hidden" }}>
          {TOKENS.map((t, i) => {
            const text = typing[t] ?? draft.colors[t];
            const bad = !isHex(text);
            return (
              <View key={t} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }}>
                <View style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: draft.colors[t], borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[s.code, { color: c.foreground }]}>{t}</Text>
                  <Text style={[s.small, { fontSize: 11 }]}>{TOKEN_ROLES[t]}</Text>
                </View>
                <TextInput
                  accessibilityLabel={`${t} hex color`}
                  value={text}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(v) => {
                    const next = v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`;
                    setTyping({ ...typing, [t]: v });
                    if (isHex(next)) setDraft({ ...draft, colors: { ...draft.colors, [t]: next.toLowerCase() } });
                  }}
                  style={[input, s.code, { width: 96, paddingVertical: 4, color: c.foreground, borderColor: bad ? c.statusDanger : c.border }]}
                />
              </View>
            );
          })}
          {canSetAppTheme ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
              <View style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: draft.sidebar || draft.colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.code, { color: c.foreground }]}>sidebar</Text>
                <Text style={[s.small, { fontSize: 11 }]}>Desktop sidebar, painted by the plugin · empty uses background</Text>
              </View>
              <TextInput
                accessibilityLabel="sidebar hex color"
                value={typing.sidebar ?? draft.sidebar}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="#rrggbb"
                onChangeText={(v) => {
                  const t = v.trim();
                  const next = !t ? "" : t.startsWith("#") ? t : `#${t}`;
                  setTyping({ ...typing, sidebar: v });
                  if (next === "" || isHex(next)) setDraft({ ...draft, sidebar: next.toLowerCase() });
                }}
                style={[input, s.code, { width: 96, paddingVertical: 4, color: c.foreground, borderColor: typing.sidebar && !isHex(typing.sidebar.startsWith("#") ? typing.sidebar : `#${typing.sidebar}`) ? c.statusDanger : c.border }]}
              />
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Icon name={passes ? "CircleCheck" : "TriangleAlert"} size={14} color={passes ? c.statusSuccess : c.statusWarning} />
          <Text style={[s.small, { flex: 1, fontSize: 11 }]}>
            {ratios.map(([k, r]) => `${k} ${r.toFixed(1)}:1`).join(" · ")} on background — {passes ? "passes AA" : "below AA (4.5:1)"}
          </Text>
        </View>
      </View>
      <HighlightTheme theme={theme} draft={draft} setDraft={setDraft} />
    </View>
  );
}

const SAMPLE_COMMAND = 'rg -n "verifyToken" src | head -20 && npm test -- --watch';

/** Highlight theme for code the plugin draws; Paseo's own code blocks are on the Assistant message page. */
function HighlightTheme({ theme, draft, setDraft }: { theme: PluginTheme; draft: ThemeDraft; setDraft(d: ThemeDraft): void }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const options = [...SYNTAX_THEMES, { id: PLAIN_SYNTAX, name: "Plain", appearance: draft.appearance, colors: undefined }];
  return (
    <View style={{ gap: 12 }}>
      <SectionHead theme={theme} title="Highlight theme" hint="commands, diffs, JSON" />
      <View style={{ borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: "hidden" }}>
        {options.map((t, i) => {
          const on = t.id === draft.syntax;
          const fits = t.appearance === draft.appearance;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setDraft({ ...draft, syntax: t.id })}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: on ? c.surface2 : undefined, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border, opacity: fits ? 1 : 0.5 }}
            >
              <Icon name={on ? "CircleDot" : "Circle"} size={14} color={on ? c.accent : c.foregroundMuted} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[s.target, { color: c.foreground, fontSize: 13 }]}>
                  {t.name}
                  {fits ? "" : ` · ${t.appearance} themes only`}
                </Text>
                <Text numberOfLines={1} style={[s.code, { fontSize: 11, lineHeight: 15, color: draft.colors.foreground, backgroundColor: draft.colors.background, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 }]}>
                  {t.colors
                    ? highlightShell(SAMPLE_COMMAND).map((sp, j) => (sp.kind ? <Text key={j} style={{ color: t.colors![sp.kind] }}>{sp.text}</Text> : sp.text))
                    : SAMPLE_COMMAND}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** One option row of a bordered group: radio or checkbox, label, one-line hint, and a "Paseo default" tag where it applies. */
function OptionRow({ theme, kind, on, label, hint, paseo, first, onPress }: { theme: PluginTheme; kind: "radio" | "checkbox"; on: boolean; label: string; hint: string; paseo?: boolean; first: boolean; onPress(): void }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const icon = kind === "radio" ? (on ? "CircleDot" : "Circle") : on ? "SquareCheck" : "Square";
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: kind === "radio" && on ? c.surface1 : pressed ? alpha(c.surface1, 0.6) : undefined, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.border })}
    >
      <Icon name={icon} size={15} color={on ? c.accent : c.foregroundMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.target, { color: c.foreground, fontSize: 14 }]}>{label}</Text>
        <Text style={[s.small, { fontSize: 12 }]}>{hint}</Text>
      </View>
      {paseo ? <Badge theme={theme} label="Paseo default" /> : null}
    </Pressable>
  );
}

const group = (c: PluginTheme["colors"]) => ({ borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: "hidden" as const });

/** A radio list; the fourth entry marks the option that leaves things as Paseo has them. */
function Choice<T extends string>({ theme, value, options, onChange }: { theme: PluginTheme; value: T; options: Array<[T, string, string, boolean?]>; onChange(v: T): void }) {
  return (
    <View style={group(theme.colors)}>
      {options.map(([id, label, hint, paseo], i) => (
        <OptionRow key={id} theme={theme} kind="radio" on={id === value} label={label} hint={hint} paseo={paseo} first={!i} onPress={() => onChange(id)} />
      ))}
    </View>
  );
}

const HIDEABLE_LABELS: Record<Hideable, [string, string]> = {
  read: ["Reads", "Read file rows"],
  search: ["Searches", "Code and web searches"],
  fetch: ["Fetches", "Fetched web pages"],
  task: ["Background tasks", "Finished background task notices"],
};

/** Labels and hints for each rich text variant, from the "Rich Text — Style Variants" design. */
const RICH_TEXT_OPTIONS: Record<RichText, { title: string; description: string; options: Array<[string, string]> }> = {
  quote: { title: "Blockquote", description: "Quoted text (> …).", options: [["Accent bar", "2px accent rule, muted italic text"], ["Tinted card", "Raised fill with a quote mark; reads as an aside"], ["Italic indent", "No rule, just indented italic text"]] },
  table: { title: "Table", description: "Markdown tables.", options: [["Bordered", "Outer hairline and a raised header row"], ["Striped", "No borders; alternating raised rows"], ["Minimal", "Header rule only; lightest for small tables"], ["Grid", "Bordered plus a hairline between columns"]] },
  code: { title: "Code block", description: "Fenced code. The language shows when the fence names one (```ts).", options: [["Header bar", "Language and copy in a strip over the code"], ["Bare", "Sunken fill, no frame; language and copy float top-right"], ["Gutter", "Line numbers and a hairline frame, no fill"]] },
  inline: { title: "Inline code", description: "`code` inside prose.", options: [["Filled chip", "Control fill, radius 4"], ["Tinted text", "No box; mono in the warning color"], ["Outlined", "Hairline border, no fill"]] },
  heading: { title: "Headings", description: "# to ### in replies.", options: [["Size scale", "24 / 20 / 16, all semibold"], ["Compact + rule", "18 / 15 / 12 caps; H1 gets a hairline"], ["Accent marker", "Accent bar on H1 and H2, a muted ### on H3"]] },
  list: { title: "Lists and task lists", description: "Bullets, numbers and [x] tasks.", options: [["Bullets + squares", "Dots, mono numbers, filled square checks"], ["Dashes + circles", "En dashes, 1) numbers, round green checks"], ["Timeline rows", "Small dots, tight rows, done tasks muted"]] },
  callout: { title: "Callouts", description: "> [!NOTE], [!WARNING] and [!TIP] quotes.", options: [["Tinted card", "Tinted fill with an icon and title; most visible"], ["Side bar", "Colored rule and a small-caps label"], ["Inline row", "Icon and label inline with the text"]] },
  rule: { title: "Horizontal rule", description: "--- between sections.", options: [["Hairline", "Full-width 1px line"], ["Spaced dots", "Three muted dots, centered"], ["Short inset", "A 48px line, left-aligned"]] },
};

function PrefsEditor({ theme, page, prefs, onChange }: { theme: PluginTheme; page: Exclude<Page, "theme">; prefs: Prefs; onChange(p: Prefs): void }) {
  const set = <K extends keyof Prefs>(key: K) => (value: Prefs[K]) => onChange({ ...prefs, [key]: value });
  if (page === "messages") {
    const paseoSyntax = readSyntaxTheme();
    return (
      <View style={{ gap: 20 }}>
        <Section theme={theme} first title="User messages" description="Messages longer than 8 lines." desktop={canSetAppTheme}>
          <Choice
            theme={theme}
            value={prefs.userMessages}
            onChange={set("userMessages")}
            options={[
              ["clamp", "Clamp long messages", "Six lines with a fade; click the bubble to open"],
              ["full", "Show in full", "Every line, always", true],
            ]}
          />
        </Section>
        <Section theme={theme} title="Thoughts and tool calls" description="How loud the rows between replies are.">
          <Choice
            theme={theme}
            value={prefs.steps}
            onChange={set("steps")}
            options={[
              ["faded", "Faded", "Rows sit back until you hover or open them"],
              ["full", "Full strength", "As loud as the reply", true],
            ]}
          />
        </Section>
        {canSetAppTheme ? (
          <Section theme={theme} title="Paseo's own items" description="Tool call groups, bubbles, headings, lists, quotes, tables and code blocks." desktop>
            <Choice
              theme={theme}
              value={prefs.nativeStyle}
              onChange={set("nativeStyle")}
              options={[
                ["design", "Match the design", "Restyle them to the Chat Polish design"],
                ["paseo", "Leave untouched", "Draw them the way Paseo does", true],
              ]}
            />
          </Section>
        ) : null}
        <Section theme={theme} title="Images" description="Replies that only contain images.">
          <Choice
            theme={theme}
            value={prefs.images}
            onChange={set("images")}
            options={[
              ["small", "Small thumbnails", "200 × 128 · click to open full size"],
              ["large", "Large thumbnails", "320 × 200 · click to open full size"],
              ["native", "Full size inline", "Images at their own size", true],
            ]}
          />
        </Section>
        <Section theme={theme} title="Text and code" description="Drawn by Paseo. Fonts and sizes follow Settings → Appearance.">
          {paseoSyntax ? (
            <Notice theme={theme} action={paseoSyntax === "one" ? null : <Button theme={theme} label="Use One" icon="Code" onPress={() => updateAppSettings({ syntaxTheme: "one" })} />}>
              {paseoSyntax === "one"
                ? "Code blocks use Paseo's One syntax theme, the closest match to Mariana."
                : `Code blocks use Paseo's ${paseoSyntax} syntax theme. One Dark is the closest match to Mariana.`}
            </Notice>
          ) : (
            <Notice theme={theme}>Text, tables, code blocks and mermaid diagrams render natively.</Notice>
          )}
        </Section>
      </View>
    );
  }
  if (page === "rich") {
    return (
      <View style={{ gap: 20 }}>
        {prefs.nativeStyle === "paseo" ? <Notice theme={theme}>Paseo's own items are left untouched (Messages page), so these styles don't apply until you switch that back.</Notice> : null}
        {RICH_TEXT.map((k, i) => (
          <Section key={k} theme={theme} first={!i && prefs.nativeStyle !== "paseo"} title={RICH_TEXT_OPTIONS[k].title} description={RICH_TEXT_OPTIONS[k].description} desktop>
            <Choice
              theme={theme}
              value={prefs.richText[k]}
              onChange={(v) => onChange({ ...prefs, richText: { ...prefs.richText, [k]: v } })}
              options={RICH_TEXT_OPTIONS[k].options.map(([label, hint], j) => [(["a", "b", "c", "d"] as const)[j]!, label, hint])}
            />
          </Section>
        ))}
      </View>
    );
  }
  if (page === "reasoning") {
    const paseo = readHostAppearance().autoExpandReasoning;
    return (
      <Section theme={theme} first title="Default state" description="How reasoning rows start when they appear.">
        <Choice
          theme={theme}
          value={prefs.reasoning}
          onChange={set("reasoning")}
          options={[
            ["paseo", "Follow Paseo", `Settings → Appearance → Always expand reasoning (${paseo ? "on" : "off"})`, true],
            ["collapsed", "Collapsed", "A quiet Thought row, click to read"],
            ["expanded", "Expanded", "Show the full reasoning"],
          ]}
        />
      </Section>
    );
  }
  return (
    <View style={{ gap: 20 }}>
      <Section theme={theme} first title="Details" description="Which rows start with their output or diff open.">
        {readHostAppearance().toolCallDetail === "overview" ? (
          <Notice theme={theme}>Paseo's tool call display is Summary, so calls stay grouped ("Ran 4 commands"). Switch it to Detailed in Settings → Appearance to get these rows.</Notice>
        ) : null}
        <Choice
          theme={theme}
          value={prefs.toolDetails}
          onChange={set("toolDetails")}
          options={[
            ["collapsed", "Collapsed", "Open a row to see its output or diff"],
            ["failed", "Open failures", "Failed calls start open"],
            ["expanded", "Expanded", "Every row with details starts open"],
          ]}
        />
      </Section>
      <Section theme={theme} title="Command colors" description="Highlight theme is chosen on the Theme page.">
        <Choice
          theme={theme}
          value={prefs.commandColors}
          onChange={set("commandColors")}
          options={[
            ["expanded", "Only when expanded", "Collapsed rows stay quiet"],
            ["always", "Always", "Color every command row"],
          ]}
        />
      </Section>
      <Section theme={theme} title="Show in timeline" description="Running and failed calls always show.">
        <View style={group(theme.colors)}>
          {HIDEABLE.map((k, i) => {
            const shown = !prefs.hidden.includes(k);
            return (
              <OptionRow
                key={k}
                theme={theme}
                kind="checkbox"
                on={shown}
                label={HIDEABLE_LABELS[k][0]}
                hint={HIDEABLE_LABELS[k][1]}
                first={!i}
                onPress={() => onChange({ ...prefs, hidden: shown ? [...prefs.hidden, k] : prefs.hidden.filter((h) => h !== k) })}
              />
            );
          })}
        </View>
      </Section>
    </View>
  );
}

const LONG_MESSAGE = [
  "Move auth into one middleware and keep the tests green.",
  "Right now the token check runs twice on /api/billing: once in the router guard and once inside the handler.",
  "The second check reads a stale header after the refresh middleware rotated it, so users get logged out at random.",
  "Delete the per-route calls, mount requireAuth before the router, and let public routes opt out with skipAuth.",
  "Don't touch the session store; that migration lands next week.",
].join(" ");

/** The user bubble as Paseo draws it; the clamp is shortened to three lines to fit the mock. */
function PreviewBubble({ theme, clamp }: { theme: PluginTheme; clamp: boolean }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const [open, setOpen] = useState(false);
  const clamped = clamp && !open;
  return (
    <View style={{ alignItems: "flex-end", paddingBottom: 8 }}>
      <Pressable
        disabled={!clamp}
        onPress={() => setOpen(!open)}
        accessibilityRole={clamp ? "button" : undefined}
        accessibilityState={clamp ? { expanded: open } : undefined}
        style={{ maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 10, gap: 6, borderRadius: 16, backgroundColor: c.border }}
      >
        <Text style={[s.prose, { color: c.foreground }]} numberOfLines={clamped ? 3 : undefined}>
          {LONG_MESSAGE}
        </Text>
        {clamp ? <Text style={[s.small, { fontSize: 12 }]}>{open ? "Show less" : "Show full message"}</Text> : null}
      </Pressable>
    </View>
  );
}

type Viewport = "desktop" | "phone";

function PreviewHead({ theme, layout, viewport, setViewport }: { theme: PluginTheme; layout: PluginScreenProps["layout"]; viewport: Viewport; setViewport(v: Viewport): void }) {
  const s = useStyles(theme);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={[s.title, { fontSize: 13 }]}>Preview</Text>
      <Badge theme={theme} label="Live" tone={theme.colors.statusSuccess} />
      <Text style={[s.small, { flex: 1, fontSize: 12 }]} numberOfLines={1}>
        Updates as you change settings
      </Text>
      {layout.compact ? null : (
        <Segmented<Viewport>
          theme={theme}
          value={viewport}
          onChange={setViewport}
          options={[
            ["desktop", "Monitor", "Desktop"],
            ["phone", "Smartphone", "Phone"],
          ]}
        />
      )}
    </View>
  );
}

/** A chat as Paseo shows it: title bar, the timeline, and the composer. `theme` is the previewed theme. */
function MockChat({ theme, layout, viewport, children }: { theme: PluginTheme; layout: PluginScreenProps["layout"]; viewport: Viewport; children: ReactNode }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const chip = (icon: string, label?: string) => (
    <View key={icon} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: label ? 6 : 0, height: 26 }}>
      <Icon name={icon} size={14} color={c.foregroundMuted} />
      {label ? <Text style={[s.small, { fontSize: 13, color: c.foregroundMuted }]}>{label}</Text> : null}
      {label ? <Icon name="ChevronDown" size={12} color={c.foregroundMuted} /> : null}
    </View>
  );
  const narrow = layout.compact || viewport === "phone";
  return (
    <View style={{ width: viewport === "phone" ? 390 : "100%", alignSelf: "center", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.surface0, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: alpha(c.border, 0.6) }}>
        <Text style={[s.target, { color: c.foreground, fontSize: 13, fontWeight: "500" }]}>Refactor auth middleware</Text>
        <Text style={[s.target, { fontSize: 12 }]} numberOfLines={1}>
          paseo-api
        </Text>
      </View>
      <View style={{ paddingHorizontal: narrow ? 16 : 40, paddingVertical: 24, gap: 16 }}>{children}</View>
      <View style={{ margin: 20, marginTop: 4, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.surface1 }}>
        <Text style={[s.prose, { fontSize: 14 }]} numberOfLines={1}>
          Message the agent, tag @files, or use /commands
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {chip("Plus")}
          {chip("Bot", "Opus 5.5")}
          {narrow ? null : chip("Brain", "High")}
          {narrow ? null : chip("ShieldOff", "Bypass")}
          <View style={{ flex: 1 }} />
          <Icon name="Mic" size={15} color={c.foregroundMuted} />
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
            <Icon name="ArrowUp" size={15} color={c.accentForeground} />
          </View>
        </View>
      </View>
    </View>
  );
}

function Preview({ theme, draft, prefs, layout }: { theme: PluginTheme; draft: ThemeDraft; prefs: Prefs; layout: PluginScreenProps["layout"] }) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const pt = previewTheme(draft, theme);
  const ps = useStyles(pt);
  const pc = pt.colors;
  const host = { id: "preview", label: "Preview" };
  const props = { agentId: "preview", timestamp: new Date(0), theme: pt, host, layout };
  const item = <T,>(data: T) => ({ type: "plugin" as const, kind: "preview", version: 1, data });
  // Rows read their open state once; remount them when a pref that sets it changes.
  const remount = `${prefs.reasoning}-${prefs.toolDetails}`;
  const tools = PREVIEW_CALLS.filter((t) => !prefs.hidden.includes(hideableKind(t)!)).map(toolData);

  return (
    <PrefsOverride.Provider value={prefs}>
      <SyntaxOverride.Provider value={draft.syntax}>
        <View style={{ gap: 14 }}>
          <PreviewHead theme={theme} layout={layout} viewport={viewport} setViewport={setViewport} />
          <MockChat theme={pt} layout={layout} viewport={viewport}>
            <PreviewBubble theme={pt} clamp={prefs.userMessages === "clamp"} />
            <ThoughtItem key={`thought-${remount}`} {...props} item={item({ text: "Handlers in routes/ each call verifyToken(); one middleware removes the duplicates.", phase: "complete" as const })} />
            {tools.map((d) => (
              <ToolItem key={`${d.verb}-${d.target}-${remount}`} {...props} item={item(d)} />
            ))}
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5, paddingTop: 8 }}>
              <Text style={[ps.prose, { color: pc.foreground }]}>Done. Auth now lives in</Text>
              <InlineCode theme={pt} variant={prefs.richText.inline}>
                requireAuth
              </InlineCode>
              <Text style={[ps.prose, { color: pc.foreground }]}>and all 24 tests pass.</Text>
            </View>
            {prefs.images === "native" ? (
              <Image source={{ uri: PREVIEW_IMAGE }} style={{ width: "100%", aspectRatio: 16 / 10, borderRadius: 8 }} resizeMode="cover" />
            ) : (
              <ImagesItem {...props} item={item({ images: [{ alt: "Login screen", url: PREVIEW_IMAGE }, { alt: "Settings screen", url: PREVIEW_IMAGE }] })} />
            )}
          </MockChat>
        </View>
      </SyntaxOverride.Provider>
    </PrefsOverride.Provider>
  );
}

type Variant = "a" | "b" | "c";

function InlineCode({ theme, variant, children }: { theme: PluginTheme; variant: Variant; children: string }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const box = { a: { backgroundColor: c.surface2 }, b: {}, c: { borderWidth: 1, borderColor: alpha(c.border, 0.6) } }[variant];
  return (
    <View style={[{ paddingHorizontal: variant === "b" ? 0 : 5, paddingVertical: 1, borderRadius: 4 }, box]}>
      <Text style={[s.code, { color: variant === "b" ? c.statusWarning : c.foreground }]}>{children}</Text>
    </View>
  );
}

const SAMPLE_TABLE = [
  ["src/middleware/requireAuth.ts", "new file", "28", "0"],
  ["src/routes/billing.ts", "check removed", "2", "5"],
  ["src/server.ts", "mount", "1", "0"],
];
const SAMPLE_CODE = ["export function requireAuth(req, next) {", "  const token = verifyToken(req);", "  if (!token) return deny(401);", "  next();", "}"];

/** A reply using every markdown element, drawn with the chosen variants, as the Rich text page's preview. */
function RichSample({ theme, rt }: { theme: PluginTheme; rt: Prefs["richText"] }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const rule = alpha(c.border, 0.6);
  const prose = [s.prose, { color: c.foreground }];
  const muted = [s.prose, { color: c.foregroundMuted }];

  const heading = (level: 1 | 2 | 3, text: string) => {
    if (rt.heading === "b") {
      const size = [18, 15, 12][level - 1]!;
      return <Text style={[s.title, { fontSize: size, color: level === 3 ? c.foregroundMuted : c.foreground, ...(level === 3 ? { textTransform: "uppercase", letterSpacing: 0.7 } : {}), ...(level === 1 ? { paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: rule } : {}) }]}>{text}</Text>;
    }
    const title = <Text style={[s.title, { fontSize: [24, 20, 16][level - 1]! }]}>{text}</Text>;
    if (rt.heading === "a") return title;
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {level < 3 ? <View style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: c.accent }} /> : <Text style={[s.code, { color: c.foregroundMuted }]}>###</Text>}
        {title}
      </View>
    );
  };

  const quote = (() => {
    const text = "Never read the token before refresh() runs — it may already be rotated.";
    if (rt.quote === "b")
      return (
        <View style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: 8, backgroundColor: c.surface1 }}>
          <Text style={[s.title, { fontSize: 20, lineHeight: 22, color: c.accent }]}>“</Text>
          <Text style={[prose, { flex: 1 }]}>{text}</Text>
        </View>
      );
    return (
      <View style={rt.quote === "a" ? { borderLeftWidth: 2, borderLeftColor: c.accent, paddingLeft: 14 } : { paddingLeft: 20 }}>
        <Text style={[muted, { fontStyle: "italic" }]}>{text}</Text>
      </View>
    );
  })();

  const callout = (tone: string, icon: string, label: string, text: string) => {
    if (rt.callout === "b")
      return (
        <View key={label} style={{ borderLeftWidth: 2, borderLeftColor: tone, paddingLeft: 14, gap: 2 }}>
          <Text style={[s.small, { fontSize: 11, fontWeight: "600", letterSpacing: 0.7, color: tone }]}>{label.toUpperCase()}</Text>
          <Text style={prose}>{text}</Text>
        </View>
      );
    if (rt.callout === "c")
      return (
        <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={icon} size={14} color={tone} />
          <Text style={[prose, { flex: 1 }]}>
            <Text style={{ color: tone, fontWeight: "600" }}>{label} — </Text>
            {text}
          </Text>
        </View>
      );
    return (
      <View key={label} style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: 8, backgroundColor: alpha(tone, 0.12) }}>
        <Icon name={icon} size={14} color={tone} />
        <View style={{ flex: 1, gap: 2, marginTop: -3 }}>
          <Text style={[s.title, { fontSize: 13, color: tone }]}>{label}</Text>
          <Text style={prose}>{text}</Text>
        </View>
      </View>
    );
  };

  const marker = (ordered: number | undefined) => {
    const text = rt.list === "c" ? "·" : ordered ? (rt.list === "b" ? `${ordered})` : `${ordered}.`) : rt.list === "b" ? "–" : "•";
    return <Text style={[ordered && rt.list !== "c" ? s.code : s.prose, { width: 20, color: c.foregroundMuted, fontWeight: rt.list === "c" ? "700" : "400" }]}>{text}</Text>;
  };
  const listItem = (text: string, ordered?: number, nested?: boolean) => (
    <View key={text} style={{ flexDirection: "row", alignItems: "baseline", paddingLeft: nested ? 22 : 0 }}>
      {marker(ordered)}
      <Text style={prose}>{text}</Text>
    </View>
  );
  const task = (text: string, done: boolean) => {
    const icon = rt.list === "b" ? (done ? "CircleCheck" : "Circle") : done ? "SquareCheck" : "Square";
    const tone = !done ? c.foregroundMuted : rt.list === "b" ? c.statusSuccess : rt.list === "c" ? c.foregroundMuted : c.accent;
    return (
      <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: rt.list === "c" ? 26 : undefined }}>
        <Icon name={icon} size={15} color={tone} />
        <Text style={[prose, done && rt.list === "c" ? { color: c.foregroundMuted } : null]}>{text}</Text>
      </View>
    );
  };

  const divider =
    rt.rule === "b" ? (
      <Text style={[s.small, { textAlign: "center", letterSpacing: 3 }]}>• • •</Text>
    ) : (
      <View style={{ height: 1, width: rt.rule === "c" ? 48 : "100%", backgroundColor: rt.rule === "c" ? c.border : rule }} />
    );

  const widths = [3, 2, 0.6, 0.6];
  const bordered = rt.table === "a" || rt.table === "d";
  const grid = rt.table === "d";
  const cell = (text: string, i: number, head: boolean) => (
    <Text
      key={i}
      numberOfLines={1}
      style={[
        head ? s.small : s.code,
        { flex: widths[i], fontSize: head ? 11 : undefined, fontWeight: head ? "600" : undefined, color: head ? c.foregroundMuted : i === 3 && text !== "0" ? c.statusDanger : c.foreground },
        grid ? { paddingHorizontal: 12, paddingVertical: 8, borderRightWidth: i < 3 ? 1 : 0, borderRightColor: rule } : null,
      ]}
    >
      {head ? text.toUpperCase() : text}
    </Text>
  );
  // Grid cells carry their own padding so the column rules run the full row height.
  const rowPad = grid ? { gap: 0 } : { gap: 12, paddingHorizontal: rt.table === "c" ? 0 : 12, paddingVertical: 8 };
  const table = (
    <View style={bordered ? { borderRadius: 8, borderWidth: 1, borderColor: rule, overflow: "hidden" } : { gap: rt.table === "b" ? 2 : 0 }}>
      <View style={{ flexDirection: "row", ...rowPad, backgroundColor: bordered ? c.surface1 : undefined, borderBottomWidth: rt.table === "b" ? 0 : 1, borderBottomColor: rule }}>
        {["File", "Change", "+", "-"].map((t, i) => cell(t, i, true))}
      </View>
      {SAMPLE_TABLE.map((row, r) => (
        <View
          key={row[0]}
          style={{ flexDirection: "row", ...rowPad, borderRadius: rt.table === "b" ? 6 : 0, backgroundColor: rt.table === "b" && r % 2 === 0 ? c.surface1 : undefined, borderTopWidth: bordered && r ? 1 : 0, borderTopColor: rule }}
        >
          {row.map((t, i) => cell(t, i, false))}
        </View>
      ))}
    </View>
  );

  const codeBody = (
    <View style={{ flexDirection: "row", gap: 12, padding: 12 }}>
      {rt.code === "c" ? (
        <View>
          {SAMPLE_CODE.map((_, i) => (
            <Text key={i} style={[s.code, { color: c.foregroundMuted, opacity: 0.6, textAlign: "right" }]}>
              {i + 1}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        {SAMPLE_CODE.map((line) => (
          <Text key={line} style={s.code}>
            {line}
          </Text>
        ))}
      </View>
      {rt.code === "b" ? <Text style={[s.code, { fontSize: 11, color: alpha(c.foregroundMuted, 0.6) }]}>ts</Text> : null}
      {rt.code === "a" ? null : <Icon name="Copy" size={13} color={rt.code === "b" ? alpha(c.foregroundMuted, 0.4) : c.foregroundMuted} />}
    </View>
  );
  const codeBlock = (
    <View style={{ borderRadius: 8, backgroundColor: rt.code === "c" ? undefined : sunken(c.surface0), borderWidth: rt.code === "b" ? 0 : 1, borderColor: rule }}>
      {rt.code === "a" ? (
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: rule }}>
          <Text style={[s.code, { flex: 1, fontSize: 12, color: c.foregroundMuted }]}>typescript</Text>
          <Icon name="Copy" size={13} color={c.foregroundMuted} />
        </View>
      ) : null}
      {codeBody}
    </View>
  );

  return (
    <View style={{ gap: 14 }}>
      {heading(1, "Auth middleware")}
      {heading(2, "What changed")}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
        <Text style={prose}>Auth now lives in</Text>
        <InlineCode theme={theme} variant={rt.inline}>
          requireAuth
        </InlineCode>
        <Text style={prose}>and runs once.</Text>
      </View>
      {quote}
      {callout(c.accent, "Info", "Note", "Public routes opt out with skipAuth.")}
      {callout(c.statusWarning, "TriangleAlert", "Warning", "Tokens rotate on refresh; never cache them.")}
      {heading(3, "Routes")}
      <View style={{ gap: 6 }}>
        {listItem("Add requireAuth before the router", 1)}
        {listItem("Reads the rotated header", undefined, true)}
        {listItem("Delete the inline checks", 2)}
      </View>
      <View style={{ gap: 4 }}>
        {task("Middleware", true)}
        {task("Route cleanup", true)}
        {task("Docs", false)}
      </View>
      {divider}
      {table}
      {codeBlock}
    </View>
  );
}

function RichPreview({ theme, draft, prefs, layout }: { theme: PluginTheme; draft: ThemeDraft; prefs: Prefs; layout: PluginScreenProps["layout"] }) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const pt = previewTheme(draft, theme);
  return (
    <View style={{ gap: 14 }}>
      <PreviewHead theme={theme} layout={layout} viewport={viewport} setViewport={setViewport} />
      <MockChat theme={pt} layout={layout} viewport={viewport}>
        <RichSample theme={pt} rt={prefs.richText} />
      </MockChat>
    </View>
  );
}

function TopBar({ theme, layout, title, subtitle, children }: { theme: PluginTheme; layout: PluginScreenProps["layout"]; title: string; subtitle: string; children?: ReactNode }) {
  const s = useStyles(theme);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: layout.compact ? 16 : 32, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[s.title, { fontSize: 20 }]}>{title}</Text>
        <Text style={[s.small, { fontSize: 13 }]}>{subtitle}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * Settings beside the preview, which sits on a sunken pane. Stacked in one scroll on compact screens and when the
 * dashboard is too narrow for both (desktop window beside the sidebar).
 */
function Columns({ theme, layout, editor, preview }: { theme: PluginTheme; layout: PluginScreenProps["layout"]; editor: ReactNode; preview: ReactNode }) {
  const [width, setWidth] = useState(0);
  const pane = sunken(theme.colors.surface0);
  const measure = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  if (layout.compact || (width > 0 && width < 940)) {
    return (
      <ScrollView onLayout={measure} contentContainerStyle={{ gap: 28, paddingVertical: layout.compact ? 16 : 28 }}>
        <View style={{ paddingHorizontal: layout.compact ? 16 : 32 }}>{editor}</View>
        <View style={{ paddingHorizontal: layout.compact ? 16 : 32, paddingVertical: 24, backgroundColor: pane }}>{preview}</View>
      </ScrollView>
    );
  }
  return (
    <View onLayout={measure} style={{ flex: 1, flexDirection: "row" }}>
      <ScrollView style={{ width: 472, flexGrow: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: theme.colors.border }} contentContainerStyle={{ paddingHorizontal: 32, paddingVertical: 28 }}>
        {editor}
      </ScrollView>
      <ScrollView style={{ flex: 1, backgroundColor: pane }} contentContainerStyle={{ paddingHorizontal: 32, paddingVertical: 28 }}>
        {preview}
      </ScrollView>
    </View>
  );
}

function ThemePage({ theme, layout }: Pick<PluginScreenProps, "theme" | "layout">) {
  const s = useStyles(theme);
  const c = theme.colors;
  const prefs = usePrefs();
  const settings = useSettings(themeSettings);
  const saved = settings.status === "ready" ? settings.values : undefined;
  const [draft, setDraft] = useState<ThemeDraft | undefined>();
  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);

  const dirty = !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft);
  const active = readHostAppearance().pluginThemeId === THEME_CATALOG_ID;
  const apply = async () => {
    if (!draft || settings.status !== "ready") return false;
    if (!(await settings.save(draft, settings.revision))) return false;
    registerTheme(draft);
    return true;
  };
  const useAsAppTheme = async () => {
    if (dirty && !(await apply())) return;
    setAppTheme(THEME_CATALOG_ID);
  };

  let body: ReactNode;
  if (settings.status === "invalid" || settings.status === "error") {
    body = (
      <View style={{ padding: 28, gap: 12 }}>
        <Text style={[s.verb, { color: c.statusDanger }]}>Couldn't load the saved theme.</Text>
        <Button theme={theme} label="Restore default theme" icon="RotateCcw" onPress={() => void settings.reset()} />
      </View>
    );
  } else if (!draft) {
    body = <Text style={[s.small, { padding: 28 }]}>Loading theme…</Text>;
  } else {
    body = (
      <Columns
        theme={theme}
        layout={layout}
        editor={<Editor theme={theme} draft={draft} setDraft={setDraft} />}
        preview={<Preview theme={theme} draft={draft} prefs={prefs} layout={layout} />}
      />
    );
  }

  const subtitle = active
    ? "This is your Paseo theme. Apply pushes edits to the app."
    : canSetAppTheme
      ? "Use as app theme saves your edits and reloads Paseo with this theme."
      : "Apply, then choose it under Settings → Appearance to use it app-wide.";
  return (
    <>
      <TopBar theme={theme} layout={layout} title="Theme" subtitle={subtitle + (settings.saveError ? ` Save failed: ${String(settings.saveError)}` : "")}>
        <Button theme={theme} label="Reset" icon="RotateCcw" disabled={!dirty} onPress={() => saved && setDraft(saved)} />
        {active || !canSetAppTheme ? (
          <Button theme={theme} label={settings.saving ? "Applying…" : "Apply theme"} icon="Check" primary disabled={!dirty || settings.saving} onPress={() => void apply()} />
        ) : (
          <Button theme={theme} label="Use as app theme" icon="Paintbrush" primary disabled={settings.saving || !draft} onPress={() => void useAsAppTheme()} />
        )}
      </TopBar>
      {body}
    </>
  );
}

const PAGE_SUBTITLES: Record<Exclude<Page, "theme">, string> = {
  messages: "Long user messages, images in replies, and how Paseo draws text and code.",
  rich: "One style per markdown element in Paseo's replies. A is the base design.",
  reasoning: "Whether thinking starts open or as a quiet row.",
  tools: "What tool rows show, and which ones appear at all.",
};

/** Timeline prefs save as you pick; open chats pick them up for new rows. */
function PrefsPage({ theme, layout, page }: Pick<PluginScreenProps, "theme" | "layout"> & { page: Exclude<Page, "theme"> }) {
  const settings = useSettings(prefsSettings);
  const prefs = usePrefs();
  const draft = useCurrentTheme() ?? themeSchema.parse({});
  const saved = settings.status === "ready" ? settings.values : undefined;
  // Settings may load after the entry's own fetch failed: trust the stored document.
  useEffect(() => {
    if (saved) setPrefs(saved);
  }, [saved]);
  const change = (next: Prefs) => {
    setPrefs(next);
    if (settings.status === "ready") void settings.save(next, settings.revision);
  };
  const defaults = prefsSettings.schema.parse({});
  const isDefault = JSON.stringify(prefs) === JSON.stringify(defaults);
  const c = theme.colors;
  const s = useStyles(theme);
  const failed = !!settings.saveError;
  const status = failed ? `Save failed: ${String(settings.saveError)}` : settings.saving ? "Saving…" : "Saved automatically";
  const PagePreview = page === "rich" ? RichPreview : Preview;
  return (
    <>
      <TopBar theme={theme} layout={layout} title={PAGES.find((p) => p.id === page)!.label} subtitle={PAGE_SUBTITLES[page]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          <Icon name={failed ? "TriangleAlert" : "Check"} size={13} color={failed ? c.statusDanger : c.statusSuccess} />
          <Text style={[s.small, { fontSize: 12, color: failed ? c.statusDanger : c.foregroundMuted }]} numberOfLines={1}>
            {status}
          </Text>
        </View>
        <Button theme={theme} label="Defaults" icon="RotateCcw" disabled={isDefault} onPress={() => change(defaults)} />
      </TopBar>
      <Columns
        theme={theme}
        layout={layout}
        editor={<PrefsEditor theme={theme} page={page} prefs={prefs} onChange={change} />}
        preview={<PagePreview theme={theme} draft={draft} prefs={prefs} layout={layout} />}
      />
    </>
  );
}

export function Dashboard({ theme, layout, host }: PluginScreenProps) {
  const [page, setPage] = useState<Page>("theme");
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: theme.colors.surface0 }}>
      {layout.compact ? null : <InnerNav theme={theme} host={host.label} page={page} onSelect={setPage} />}
      <View style={{ flex: 1 }}>
        {layout.compact ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12, alignItems: "flex-start" }}>
            <Segmented<Page> theme={theme} value={page} onChange={setPage} options={PAGES.map((p) => [p.id, p.icon] as [Page, string])} />
          </View>
        ) : null}
        {page === "theme" ? <ThemePage theme={theme} layout={layout} /> : <PrefsPage key={page} theme={theme} layout={layout} page={page} />}
      </View>
    </View>
  );
}
