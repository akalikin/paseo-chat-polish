import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useRevealedText } from "@getpaseo/plugin/client/react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Image, LayoutAnimation, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { z } from "zod";
import { readImage } from "../shared/image";
import type { Recap } from "../shared/recap";
import type { imagesSchema, noticeSchema, planSchema, thoughtSchema, todoSchema, ToolData, Tone } from "./model";
import { contrast, isHex } from "../shared/theme";
import { highlight, highlightShell, highlightShellBlock, SYNTAX_THEMES, type Span, type SyntaxColors } from "./highlight";
import { usePrefs } from "./prefs";
import { useCurrentTheme } from "./theme-registry";
import { readHostAppearance, type HostAppearance } from "./web";

type Colors = PluginTheme["colors"];

// Paseo's own fallback stack when Settings → Appearance → Code font is empty.
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" });
const ICON_SLOT = 20;
const INDENT = 28;
// Paseo puts 16pt between timeline items; rows are 26pt tall, so -3 on each side gives the design's 36pt pitch.
const TIGHT = { marginVertical: -3 };

function toneColor(c: Colors, tone: Tone | undefined) {
  if (tone === "success") return c.statusSuccess;
  if (tone === "danger") return c.statusDanger;
  if (tone === "warning") return c.statusWarning;
  if (tone === "accent") return c.accent;
  return c.foregroundMuted;
}

/** Hex color with alpha; non-hex colors (rgb(), names) are returned unchanged. */
export function alpha(color: string, a: number) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((ch) => ch + ch).join("") : m[1]!;
  return `#${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}

/** The sunken surface behind code blocks: a step darker than the canvas (#23272e → #1e2227 in Mariana). */
export function sunken(color: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `#${[16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) * 0.86).toString(16).padStart(2, "0")).join("")}`;
}

/** Sizes follow Settings → Appearance: content size for prose and rows, code size (line height 1.5×) for code. */
function makeStyles(c: Colors, a: HostAppearance) {
  const ui = a.uiFont ? { fontFamily: a.uiFont } : {};
  const mono = { fontFamily: a.monoFont ? `${a.monoFont}, ${MONO}` : MONO };
  const body = a.contentSize - 1;
  const code = { ...mono, fontSize: a.codeSize, lineHeight: Math.round(a.codeSize * 1.5) };
  const rule = alpha(c.border, 0.6);
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26, paddingVertical: 3 },
    slot: { width: ICON_SLOT, height: 18, alignItems: "center", justifyContent: "center" },
    verb: { ...ui, color: c.foreground, fontSize: body, fontWeight: "500" },
    target: { ...ui, color: c.foregroundMuted, fontSize: body, flexShrink: 1 },
    mono: { ...mono, fontSize: a.codeSize + 1 },
    meta: { ...ui, color: c.foregroundMuted, fontSize: body - 2, fontVariant: ["tabular-nums"], marginLeft: "auto", flexShrink: 0 },
    detail: { paddingLeft: INDENT, paddingTop: 2, marginTop: 6 },
    ruled: { paddingLeft: 18, borderLeftWidth: 1, borderLeftColor: c.border, gap: 4, paddingVertical: 2 },
    block: { borderRadius: 8, backgroundColor: sunken(c.surface0), borderWidth: 1, borderColor: rule, overflow: "hidden" },
    blockHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: rule },
    blockBody: { paddingHorizontal: 12, paddingVertical: 9 },
    code: { ...code, color: c.foreground },
    gutter: { ...code, color: c.foregroundMuted, opacity: 0.6, textAlign: "right", minWidth: a.codeSize * 2.4 },
    small: { ...ui, color: c.foregroundMuted, fontSize: body - 1, lineHeight: Math.round((body - 1) * 1.45) },
    label: { ...ui, color: c.foregroundMuted, fontSize: 10, fontWeight: "600", letterSpacing: 0.8, marginBottom: 4 },
    prose: { ...ui, color: c.foregroundMuted, fontSize: body, lineHeight: Math.round(body * 1.6) },
    card: { borderRadius: 12, backgroundColor: c.surface1, borderWidth: 1, borderColor: rule, overflow: "hidden" },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: rule },
    title: { ...ui, color: c.foreground, fontSize: body, fontWeight: "600" },
    more: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 4 },
    moreText: { ...ui, color: c.foregroundMuted, fontSize: body - 2, fontWeight: "500" },
    hairline: { flex: 1, height: 1, backgroundColor: rule },
  });
}

export function useStyles(theme: PluginTheme) {
  return useMemo(() => makeStyles(theme.colors, readHostAppearance()), [theme]);
}

const NATIVE_DRIVER = Platform.OS !== "web";

// One shared reduce-motion subscription for every row, attached while any row is mounted.
let reducedMotion = false;
const motionListeners = new Set<() => void>();
let motionSub: { remove(): void } | undefined;
function subscribeReducedMotion(listener: () => void) {
  motionListeners.add(listener);
  if (!motionSub) {
    const set = (v: boolean) => {
      reducedMotion = v;
      motionListeners.forEach((l) => l());
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(set);
    motionSub = AccessibilityInfo.addEventListener("reduceMotionChanged", set);
  }
  return () => {
    motionListeners.delete(listener);
    if (!motionListeners.size) {
      motionSub?.remove();
      motionSub = undefined;
    }
  };
}
function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => reducedMotion);
}

/** Animated value that eases to `to` whenever it changes; snaps when the OS asks for reduced motion. */
function useTween(to: number, duration: number, from = to, native = NATIVE_DRIVER) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(from)).current;
  useEffect(() => {
    if (reduced) return void value.setValue(to);
    const anim = Animated.timing(value, { toValue: to, duration, easing: Easing.out(Easing.cubic), useNativeDriver: native });
    anim.start();
    return () => anim.stop();
  }, [to, reduced, duration, native, value]);
  return value;
}

/** Opacity pulse for live labels: 1 → 0.45 → 1 over 2.2s. */
function usePulse(active: boolean) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    value.setValue(1);
    if (!active || reduced) return;
    const step = (toValue: number) =>
      Animated.timing(value, { toValue, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER });
    const loop = Animated.loop(Animated.sequence([step(0.45), step(1)]));
    loop.start();
    return () => {
      loop.stop();
      value.setValue(1);
    };
  }, [active, reduced, value]);
  return value;
}

/** Fade + 4px rise for rows born while the agent is live; history renders still. */
function useEnter(live: boolean) {
  const [born] = useState(live);
  const t = useTween(1, 160, born ? 0 : 1);
  return born ? { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] } : null;
}

/** Open state whose toggle animates the surrounding layout change. */
function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  const reduced = useReducedMotion();
  const toggle = useCallback(() => {
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeOut", "opacity"));
    setOpen((v) => !v);
  }, [reduced]);
  return [open, toggle, setOpen] as const;
}

function FadeIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const opacity = useTween(1, 200, 0);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

interface RowProps {
  theme: PluginTheme;
  icon: string;
  iconColor?: string;
  verb: string;
  target?: string;
  mono?: boolean;
  meta?: string;
  metaColor?: string;
  pulsing?: boolean;
  struck?: boolean;
  /** Color the target as a shell command line while the row is expanded; collapsed rows stay quiet. */
  shell?: boolean;
  open?: boolean;
  onToggle?: () => void;
  compact: boolean;
}

function Row(p: RowProps) {
  const s = useStyles(p.theme);
  const [hovered, setHovered] = useState(false);
  const pulse = usePulse(!!p.pulsing);
  const syntax = useSyntax(p.theme);
  const { commandColors, steps } = usePrefs();
  const c = p.theme.colors;
  const rotation = useTween(p.open ? 1 : 0, 200);
  const chevronOpacity = useTween(hovered || p.open || p.compact ? 0.7 : 0, 120);
  // Rows step back so the reply reads first; hover, open, running and failed rows come back to full strength.
  const quiet = steps !== "full" && !(hovered || p.open || p.pulsing || p.iconColor);
  return (
    <Pressable
      disabled={!p.onToggle}
      onPress={p.onToggle}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole={p.onToggle ? "button" : undefined}
      accessibilityState={p.onToggle ? { expanded: !!p.open } : undefined}
      // Bleeds into the gutter so the hover surface (full-strength rows only; faded rows brighten instead) covers the same area as Paseo's own tool rows.
      style={[s.row, { marginHorizontal: -13, paddingHorizontal: 13, borderRadius: 6 }, hovered && p.onToggle && steps === "full" ? { backgroundColor: c.surface1 } : null, quiet && { opacity: 0.55 }]}
    >
      <View style={s.slot}>
        <Icon name={p.icon} size={15} color={p.iconColor ?? c.foregroundMuted} />
      </View>
      <Animated.Text style={[s.verb, { opacity: pulse }]}>{p.verb}</Animated.Text>
      {p.target ? (
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          style={[s.target, p.mono && s.mono, hovered && { color: c.foreground }, p.struck && { textDecorationLine: "line-through" }]}
        >
          {p.shell && (p.open || commandColors === "always") && syntax ? colored(highlightShell(p.target), syntax) : p.target}
        </Text>
      ) : null}
      {p.meta ? <Text numberOfLines={1} style={[s.meta, p.metaColor ? { color: p.metaColor } : null]}>{p.meta}</Text> : <View style={{ flex: 1 }} />}
      {p.onToggle ? (
        <Animated.View
          style={{ opacity: chevronOpacity, transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) }] }}
        >
          <Icon name="ChevronRight" size={12} color={c.foregroundMuted} />
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

function isDark(theme: PluginTheme) {
  const bg = theme.colors.surface0;
  return isHex(bg) && contrast(bg, "#ffffff") > contrast(bg, "#000000");
}

/** Lets the dashboard preview a highlight theme before it is applied. */
export const SyntaxOverride = createContext<string | undefined>(undefined);

/** Colors of the chosen highlight theme, or undefined for plain code (off, or a dark palette on a light theme). */
function useSyntax(theme: PluginTheme): SyntaxColors | undefined {
  const override = useContext(SyntaxOverride);
  const applied = useCurrentTheme()?.syntax;
  const id = override ?? applied ?? SYNTAX_THEMES[0]!.id;
  const palette = SYNTAX_THEMES.find((t) => t.id === id);
  return palette && (palette.appearance === "dark") === isDark(theme) ? palette.colors : undefined;
}

function colored(spans: Span[], colors: SyntaxColors) {
  return spans.map((t, i) => (t.kind ? <Text key={i} style={{ color: colors[t.kind] }}>{t.text}</Text> : t.text));
}

/** One line of code (or a shell command) in the chosen highlight theme. */
function CodeLine({ text, theme, style, shell }: { text: string; theme: PluginTheme; style: StyleProp<TextStyle>; shell?: boolean }) {
  const colors = useSyntax(theme);
  return (
    <Text selectable style={style}>
      {colors ? colored(shell ? highlightShellBlock(text) : highlight(text), colors) : text}
    </Text>
  );
}

function Scroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
      {children}
    </ScrollView>
  );
}

function ToolDetail({ data, theme }: { data: NonNullable<ToolData["detail"]>; theme: PluginTheme }) {
  const s = useStyles(theme);
  const c = theme.colors;
  switch (data.kind) {
    case "output":
      return (
        <View style={s.block}>
          {data.command ? (
            <View style={s.blockHead}>
              <Text style={[s.code, { color: c.foregroundMuted, fontSize: s.code.fontSize + 0.5 }]}>$</Text>
              <CodeLine text={data.command} theme={theme} shell style={[s.code, { flex: 1, fontSize: s.code.fontSize + 0.5 }]} />
              {data.cwd ? <Text style={[s.code, { color: c.foregroundMuted, fontSize: s.code.fontSize - 0.5 }]}>{data.cwd.split("/").pop()}</Text> : null}
            </View>
          ) : null}
          {data.text ? (
            <Scroll>
              <Text style={[s.code, s.blockBody, { color: c.foregroundMuted }]} selectable>
                {data.text}
              </Text>
            </Scroll>
          ) : null}
        </View>
      );
    case "diff":
      return (
        <View style={s.block}>
          <Scroll>
            <View style={{ paddingVertical: 6 }}>
              {data.lines.map((l, i) => {
                const color = l.sign === "+" ? c.statusSuccess : l.sign === "-" ? c.statusDanger : undefined;
                return (
                  <View key={i} style={{ flexDirection: "row", gap: 12, paddingHorizontal: 12, paddingVertical: 1, backgroundColor: color ? alpha(color, 0.12) : undefined }}>
                    <Text style={s.gutter}>{l.n ?? ""}</Text>
                    <Text style={[s.code, { color: color ?? c.foregroundMuted, width: 10, marginRight: -6 }]}>{l.sign}</Text>
                    <CodeLine text={l.text} theme={theme} style={[s.code, { flex: 1 }]} />
                  </View>
                );
              })}
            </View>
          </Scroll>
        </View>
      );
    case "io":
      return (
        <View style={s.block}>
          {(["input", "output"] as const).map((k, i) => (
            <View key={k} style={[s.blockBody, i === 0 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
              <Text style={s.label}>{k.toUpperCase()}</Text>
              <Scroll>
                {data[k].split("\n").map((line, i) => (
                  <CodeLine key={i} text={line} theme={theme} style={s.code} />
                ))}
              </Scroll>
            </View>
          ))}
        </View>
      );
    case "list":
      return (
        <View style={s.ruled}>
          {data.items.map((it, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {it.icon ? <Icon name={it.icon} size={13} color={toneColor(c, it.tone)} /> : null}
              {it.shell ? (
                <CodeLine text={it.text} theme={theme} shell style={[s.code, { flexShrink: 1 }]} />
              ) : (
                <Text numberOfLines={1} style={[s.code, { flexShrink: 1 }]}>
                  {it.text}
                </Text>
              )}
            </View>
          ))}
        </View>
      );
    case "text":
      return (
        <View style={s.ruled}>
          <Scroll>
            <Text style={s.small} selectable>
              {data.text}
            </Text>
          </Scroll>
        </View>
      );
  }
}

export function ToolItem({ item, theme, layout }: PluginTimelineItemProps<ToolData>) {
  const d = item.data;
  const s = useStyles(theme);
  const { toolDetails } = usePrefs();
  const auto = !!d.detail && (toolDetails === "expanded" || (toolDetails === "failed" && d.status === "failed"));
  const [open, toggle, setOpen] = useDisclosure(auto);
  // A running call that fails opens once it fails.
  useEffect(() => {
    if (auto) setOpen(true);
  }, [auto, setOpen]);
  const enter = useEnter(d.status === "running");
  const c = theme.colors;
  return (
    <Animated.View style={[TIGHT, enter, d.status === "canceled" ? { opacity: 0.55 } : null]}>
      <Row
        theme={theme}
        compact={layout.compact}
        icon={d.icon}
        iconColor={d.status === "failed" ? c.statusDanger : undefined}
        verb={d.verb}
        target={d.target}
        mono={d.mono}
        shell={d.shell}
        meta={d.meta}
        metaColor={d.metaTone ? toneColor(c, d.metaTone) : undefined}
        pulsing={d.status === "running"}
        struck={d.status === "canceled"}
        open={open}
        onToggle={d.detail ? toggle : undefined}
      />
      {d.error ? (
        <Text style={[s.small, { color: c.statusDanger, paddingLeft: INDENT }]} numberOfLines={open ? undefined : 2}>
          {d.error}
        </Text>
      ) : null}
      {open && d.detail ? (
        <FadeIn style={s.detail}>
          <ToolDetail data={d.detail} theme={theme} />
        </FadeIn>
      ) : null}
    </Animated.View>
  );
}

export function ThoughtItem({ item, theme, layout }: PluginTimelineItemProps<z.output<typeof thoughtSchema>>) {
  const s = useStyles(theme);
  // "paseo" follows Settings → Appearance → Always expand reasoning, which is off (collapsed) by default.
  const { reasoning } = usePrefs();
  const [open, toggle] = useDisclosure(reasoning === "paseo" ? readHostAppearance().autoExpandReasoning : reasoning === "expanded");
  const streaming = item.data.phase === "streaming";
  const enter = useEnter(streaming);
  const text = useRevealedText(item.data.text, item.data.phase);
  return (
    <Animated.View style={[TIGHT, enter]}>
      <Row
        theme={theme}
        compact={layout.compact}
        icon="Brain"
        verb={streaming ? "Thinking" : "Thought"}
        pulsing={streaming}
        open={open}
        onToggle={text.trim() ? toggle : undefined}
      />
      {open ? (
        <FadeIn style={[s.detail, { paddingLeft: 9, paddingTop: 0 }]}>
          <View style={[s.ruled, { gap: 10 }]}>
            {text
              .trim()
              .split(/\n\s*\n/)
              .map((para, i) => (
                <Text key={i} style={s.prose} selectable>
                  {para}
                </Text>
              ))}
          </View>
        </FadeIn>
      ) : null}
    </Animated.View>
  );
}

export function PlanItem({ item, theme }: PluginTimelineItemProps<z.output<typeof planSchema>>) {
  const s = useStyles(theme);
  const [open, toggle] = useDisclosure();
  const text = useRevealedText(item.data.text, item.data.phase).trim();
  const long = text.split("\n").length > 14 || text.length > 1200;
  const steps = text.match(/^\s*\d+[.)]\s/gm)?.length ?? 0;
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Icon name="Map" size={15} color={theme.colors.accent} />
        <Text style={s.title}>Plan</Text>
        {steps ? <Text style={[s.meta, { marginLeft: 0 }]}>{steps} steps</Text> : null}
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: long ? 6 : 14, maxHeight: long && !open ? 320 : undefined, overflow: "hidden" }}>
        <Text style={[s.prose, { color: theme.colors.foreground, lineHeight: Math.round(s.prose.fontSize * 1.5) }]} selectable>
          {text}
        </Text>
      </View>
      {long ? (
        <Pressable accessibilityRole="button" onPress={toggle} style={s.more}>
          <Text style={s.moreText}>{open ? "Show less" : "Show full plan"}</Text>
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function TodoLine({ theme, status, text }: { theme: PluginTheme; status: "pending" | "in_progress" | "completed"; text: string }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const pulse = usePulse(status === "in_progress");
  const [icon, color] =
    status === "completed" ? ["CircleCheck", c.statusSuccess] : status === "in_progress" ? ["CircleDot", c.accent] : ["Circle", c.foregroundMuted];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Icon name={icon} size={14} color={color} />
      <Animated.Text
        style={[
          s.target,
          { opacity: pulse, color: status === "completed" ? c.foregroundMuted : c.foreground },
          status === "completed" && { textDecorationLine: "line-through" },
        ]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

export function TodoItem({ item, theme }: PluginTimelineItemProps<z.output<typeof todoSchema>>) {
  const s = useStyles(theme);
  const c = theme.colors;
  const items = item.data.items;
  const done = items.filter((t) => t.status === "completed").length;
  const width = useTween(items.length ? (120 * done) / items.length : 0, 300, undefined, false);
  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { gap: 10, paddingVertical: 0, minHeight: 20 }]}>
        <View style={s.slot}>
          <Icon name="ListChecks" size={15} color={c.foregroundMuted} />
        </View>
        <Text style={s.verb}>Tasks</Text>
        <Text style={[s.code, { color: c.foregroundMuted }]}>
          {done} / {items.length}
        </Text>
        <View style={{ width: 120, height: 3, borderRadius: 2, backgroundColor: c.surface2 }}>
          <Animated.View style={{ width, height: 3, borderRadius: 2, backgroundColor: c.accent }} />
        </View>
      </View>
      <View style={{ paddingLeft: INDENT, gap: 6 }}>
        {items.map((t, i) => (
          <TodoLine key={i} theme={theme} status={t.status} text={t.text} />
        ))}
      </View>
    </View>
  );
}

export function NoticeItem({ item, theme }: PluginTimelineItemProps<z.output<typeof noticeSchema>>) {
  const s = useStyles(theme);
  const d = item.data;
  const color = toneColor(theme.colors, d.tone);
  const pulse = usePulse(d.pulsing);
  if (d.variant === "inline") {
    return (
      <View style={[s.row, { alignItems: "flex-start" }]}>
        <View style={s.slot}>
          <Icon name={d.icon} size={15} color={color} />
        </View>
        <Text style={[s.verb, { color, flex: 1, lineHeight: 20 }]} selectable>
          {d.text}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }} accessibilityRole="text">
      <View style={s.hairline} />
      <Icon name={d.icon} size={12} color={color} />
      <Animated.Text style={[s.meta, { marginLeft: 0, color: d.tone === "danger" ? color : theme.colors.foregroundMuted, opacity: pulse, flexShrink: 1 }]} numberOfLines={2}>
        {d.text}
      </Animated.Text>
      <View style={s.hairline} />
    </View>
  );
}

// Data URLs of recently shown images, keyed by source; bounded so a long session can't pile up megabytes.
const imageCache = new Map<string, Promise<string>>();
const IMAGE_CACHE_SIZE = 24;

function useImage(url: string) {
  const read = useRpc(readImage);
  const [state, setState] = useState<{ uri?: string; failed?: boolean }>({});
  useEffect(() => {
    if (/^(https?:|data:)/.test(url)) return void setState({ uri: url });
    let pending = imageCache.get(url);
    if (!pending) {
      pending = read({ path: url }).then((r) => r.dataUrl);
      pending.catch(() => imageCache.delete(url));
      imageCache.set(url, pending);
      if (imageCache.size > IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value!);
    }
    let alive = true;
    pending.then(
      (uri) => alive && setState({ uri }),
      () => alive && setState({ failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [url, read]);
  return state;
}

const THUMB = { small: { width: 200, height: 128 }, large: { width: 320, height: 200 } };

function Thumbnail({ alt, url, theme }: { alt: string; url: string; theme: PluginTheme }) {
  const s = useStyles(theme);
  const c = theme.colors;
  const { uri, failed } = useImage(url);
  const size = THUMB[usePrefs().images === "large" ? "large" : "small"];
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(16 / 10);
  useEffect(() => {
    if (uri) Image.getSize(uri, (w, h) => h && setRatio(w / h), () => {});
  }, [uri]);
  const frame = [size, { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.surface1, overflow: "hidden" as const }];
  if (!uri) {
    return (
      <View style={[frame, { alignItems: "center", justifyContent: "center", gap: 6 }]}>
        <Icon name={failed ? "ImageOff" : "Image"} size={16} color={c.foregroundMuted} />
        <Text style={s.small}>{failed ? "Image unavailable" : "Loading…"}</Text>
      </View>
    );
  }
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open ${alt}`} onPress={() => setOpen(true)} style={frame}>
        <Image source={{ uri }} style={size} resizeMode="cover" />
      </Pressable>
      <Modal title={alt} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <Image source={{ uri }} style={{ width: "100%", aspectRatio: ratio, borderRadius: 8 }} resizeMode="contain" />
        </Modal.Content>
      </Modal>
    </>
  );
}

export function ImagesItem({ item, theme }: PluginTimelineItemProps<z.output<typeof imagesSchema>>) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 }}>
      {item.data.images.map((img, i) => (
        <Thumbnail key={i} alt={img.alt} url={img.url} theme={theme} />
      ))}
    </View>
  );
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** GitHub-style diffstat: five squares split between added and removed, at least one for any removal. */
export function Diffstat({ added, removed, theme }: { added: number; removed: number; theme: PluginTheme }) {
  const c = theme.colors;
  const total = added + removed;
  const plus = total ? Math.round((5 * added) / total) : 0;
  const minus = total ? Math.min(5 - plus, Math.max(removed ? 1 : 0, Math.round((5 * removed) / total))) : 0;
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ width: 7, height: 7, borderRadius: 1.5, backgroundColor: i < plus ? c.statusSuccess : i < plus + minus ? c.statusDanger : c.surface2, opacity: i < plus + minus ? 0.85 : 1 }} />
      ))}
    </View>
  );
}

/** The daemon's recap after a turn, set like the turn footer under it: files with +/− and a diffstat, commands, failures. Opens to the file list. */
export function RecapItem({ item, theme }: PluginTimelineItemProps<Recap>) {
  const s = useStyles(theme);
  const c = theme.colors;
  const { files, commands, failed } = item.data;
  const [open, toggle] = useDisclosure(false);
  const [hovered, setHovered] = useState(false);
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const text = [s.meta, { marginLeft: 0, fontSize: 12 }];
  const mono = [s.code, { fontSize: 12, lineHeight: 18 }];
  const dot = <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.statusDanger }} />;
  const parts: ReactNode[] = [];
  if (files.length)
    parts.push(
      <View key="files" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={[text, { color: c.foreground }]}>{count(files.length, "file")}</Text>
        {added ? <Text style={[mono, { color: c.statusSuccess }]}>+{added}</Text> : null}
        {removed ? <Text style={[mono, { color: c.statusDanger }]}>−{removed}</Text> : null}
        <Diffstat added={added} removed={removed} theme={theme} />
      </View>,
    );
  if (commands) parts.push(<Text key="commands" style={text}>{count(commands, "command")}</Text>);
  if (failed.length)
    parts.push(
      <View key="failed" style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {dot}
        <Text style={[text, { color: c.statusDanger }]}>{failed.length} failed</Text>
      </View>,
    );
  return (
    <View style={TIGHT}>
      <Pressable
        onPress={toggle}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26, alignSelf: "flex-start", opacity: hovered || open ? 1 : 0.85 }}
      >
        <View style={s.slot}>
          <Icon name="FileDiff" size={14} color={c.foregroundMuted} />
        </View>
        {parts.flatMap((part, i) => (i ? [<Text key={`dot${i}`} style={text}>·</Text>, part] : [part]))}
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={c.foregroundMuted} />
      </Pressable>
      {open ? (
        <FadeIn style={{ paddingLeft: 9, marginTop: 4 }}>
          <View style={{ borderLeftWidth: 1, borderLeftColor: alpha(c.border, 0.6), paddingLeft: 14, paddingVertical: 2 }}>
            {files.map((f) => {
              const cut = f.path.lastIndexOf("/") + 1;
              return (
                <View key={f.path} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 26 }}>
                  <Text numberOfLines={1} ellipsizeMode="head" style={[mono, { flexShrink: 1 }]} selectable>
                    <Text style={{ color: c.foregroundMuted }}>{f.path.slice(0, cut)}</Text>
                    {f.path.slice(cut)}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6, minWidth: 76 }}>
                    {f.added ? <Text style={[mono, { color: c.statusSuccess }]}>+{f.added}</Text> : null}
                    {f.removed ? <Text style={[mono, { color: c.statusDanger }]}>−{f.removed}</Text> : null}
                  </View>
                  <Diffstat added={f.added} removed={f.removed} theme={theme} />
                </View>
              );
            })}
            {failed.map((f, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26 }}>
                {dot}
                <Text numberOfLines={1} style={[mono, { flexShrink: 1 }]} selectable>
                  {f.command}
                </Text>
                {f.exit ? <Text style={[mono, { color: c.statusDanger }]}>exit {f.exit}</Text> : null}
              </View>
            ))}
          </View>
        </FadeIn>
      ) : null}
    </View>
  );
}
