const SYNTAX_KINDS = ["comment", "string", "number", "keyword", "constant", "function", "punctuation", "operator", "parameter", "variable"] as const;
export type SyntaxKind = (typeof SYNTAX_KINDS)[number];
export type SyntaxColors = Record<SyntaxKind, string>;

export interface SyntaxTheme {
  id: string;
  name: string;
  /** Light palettes on dark backgrounds (and the reverse) wash out, so mismatches render plain. */
  appearance: "dark" | "light";
  colors: SyntaxColors;
}

const palette = (c: string[]) => Object.fromEntries(SYNTAX_KINDS.map((k, i) => [k, c[i]!])) as SyntaxColors;

/** Order: comment, string, number, keyword, constant, function, punctuation, operator, parameter, variable. */
export const SYNTAX_THEMES: SyntaxTheme[] = [
  // Token colors from OneDark-Pro-darker-Mariana.json; comment is #ffffff70 blended on #23272e.
  { id: "one-dark-darker-mariana", name: "One Dark Darker Mariana", appearance: "dark", colors: palette(["#84868a", "#a3ce9e", "#fab763", "#c594c5", "#ee6a6f", "#6699cc", "#5fb3b3", "#fa8763", "#fab763", "#ee6a6f"]) },
  { id: "one-dark", name: "One Dark", appearance: "dark", colors: palette(["#7f848e", "#98c379", "#d19a66", "#c678dd", "#d19a66", "#61afef", "#abb2bf", "#56b6c2", "#d19a66", "#e06c75"]) },
  { id: "github-dark", name: "GitHub Dark", appearance: "dark", colors: palette(["#8b949e", "#a5d6ff", "#79c0ff", "#ff7b72", "#79c0ff", "#d2a8ff", "#c9d1d9", "#ff7b72", "#ffa657", "#ffa657"]) },
  { id: "dracula", name: "Dracula", appearance: "dark", colors: palette(["#6272a4", "#f1fa8c", "#bd93f9", "#ff79c6", "#bd93f9", "#50fa7b", "#f8f8f2", "#ff79c6", "#ffb86c", "#8be9fd"]) },
  { id: "tokyo-night", name: "Tokyo Night", appearance: "dark", colors: palette(["#565f89", "#9ece6a", "#ff9e64", "#bb9af7", "#ff9e64", "#7aa2f7", "#89ddff", "#89ddff", "#e0af68", "#f7768e"]) },
  { id: "github-light", name: "GitHub Light", appearance: "light", colors: palette(["#6e7781", "#0a3069", "#0550ae", "#cf222e", "#0550ae", "#8250df", "#24292f", "#cf222e", "#953800", "#953800"]) },
];
export const PLAIN_SYNTAX = "plain";

export interface Span {
  text: string;
  kind?: SyntaxKind;
}

const KEYWORDS =
  "abstract|as|async|await|break|case|catch|class|const|continue|def|default|delete|do|elif|else|enum|export|extends|finally|fn|for|from|func|function|if|implements|import|in|instanceof|interface|let|match|new|of|package|private|protected|pub|public|readonly|return|static|struct|switch|throw|try|type|typeof|use|var|void|while|with|yield";

// ponytail: one regex for C-family, JSON, Python and shell-ish code, not a real grammar; good enough for diff lines.
const TOKEN = new RegExp(
  [
    String.raw`(\/\/.*$|\/\*.*?\*\/)`,
    String.raw`("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|\`(?:[^\`\\]|\\.)*\`?)`,
    String.raw`\b(\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?|0x[\da-f]+)\b`,
    String.raw`\b(${KEYWORDS})\b`,
    String.raw`\b(true|false|null|undefined|None|True|False|nil|this|self)\b`,
    String.raw`([A-Za-z_$][\w$]*)(?=\s*\()`,
    String.raw`([{}()[\];,.])`,
    String.raw`([=+\-*/<>!&|?:%^~]+)`,
  ].join("|"),
  "gi",
);
const KINDS: SyntaxKind[] = ["comment", "string", "number", "keyword", "constant", "function", "punctuation", "operator"];

/** Splits one line of code into colored spans. */
export function highlight(line: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ text: line.slice(last, at) });
    const group = m.slice(1).findIndex((g) => g !== undefined);
    spans.push({ text: m[0], kind: KINDS[group] });
    last = at + m[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last) });
  return spans;
}

const SHELL_KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "function", "export", "local", "return", "sudo", "time", "exec", "env", "xargs", "command"]);
// Words after which the next word is a command again.
const LEADS = new Set(["then", "else", "do", "sudo", "time", "exec", "env", "xargs", "command"]);
const SHELL_TOKEN = /("(?:[^"\\]|\\.)*"?|'[^']*'?|\s+|\|\||&&|[0-9]*>>?&?[0-9]*|[|;&<()]|[^\s|;&<>()"']+)/g;

/** Splits one shell command line into colored spans: commands, flags, variables, strings, operators. */
export function highlightShell(line: string): Span[] {
  const spans: Span[] = [];
  let atCommand = true; // the next word names a command
  let consumed = 0;
  const push = (text: string, kind?: SyntaxKind) => {
    spans.push({ text, kind });
    consumed += text.length;
  };
  for (const [token] of line.matchAll(SHELL_TOKEN)) {
    if (/^\s/.test(token)) {
      push(token);
    } else if (token.startsWith("#") && (consumed === 0 || /\s$/.test(line.slice(0, consumed)))) {
      push(line.slice(consumed), "comment");
      break;
    } else if (token[0] === '"' || token[0] === "'") {
      push(token, "string");
      atCommand = false;
    } else if (/^(\|\||&&|[|;&(])$/.test(token)) {
      push(token, "operator");
      atCommand = true;
    } else if (/^[0-9]*>>?&?[0-9]*$|^[<)]$/.test(token)) {
      push(token, "operator");
    } else if (atCommand && SHELL_KEYWORDS.has(token)) {
      push(token, "keyword");
      atCommand = LEADS.has(token) || token === "if" || token === "while";
    } else if (atCommand && /^[A-Za-z_]\w*=/.test(token)) {
      const eq = token.indexOf("=");
      push(token.slice(0, eq), "variable");
      push("=", "operator");
      if (eq + 1 < token.length) push(token.slice(eq + 1));
    } else if (atCommand) {
      push(token, "function");
      atCommand = false;
    } else if (/^--?[A-Za-z]/.test(token)) {
      push(token, "parameter");
    } else if (token.includes("$")) {
      push(token, "variable");
    } else {
      push(token, /^\d+(\.\d+)?$/.test(token) ? "number" : undefined);
    }
  }
  return spans;
}

/** A whole shell command: each line is its own command, and heredoc bodies (`<<'EOF'` … `EOF`) are colored as code. */
export function highlightShellBlock(text: string): Span[] {
  const spans: Span[] = [];
  let heredocEnd: string | undefined;
  text.split("\n").forEach((line, i) => {
    if (i) spans.push({ text: "\n" });
    if (heredocEnd === undefined) {
      spans.push(...highlightShell(line));
      heredocEnd = /<<-?\s*['"]?(\w+)['"]?/.exec(line)?.[1];
    } else if (line.trim() === heredocEnd) {
      spans.push({ text: line, kind: "keyword" });
      heredocEnd = undefined;
    } else {
      spans.push(...highlight(line));
    }
  });
  return spans;
}
