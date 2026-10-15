import assert from "node:assert/strict";
import { test } from "node:test";
import { errorText, hideableKind, imageData, noticeData, todoData, toolData, toolSchema } from "../client/model.ts";

const tool = (detail, extra = {}) => ({ type: "tool_call", callId: "1", name: "Bash", status: "completed", error: null, detail, ...extra });

test("shell: tense follows status, nonzero exit is flagged", () => {
  const running = toolData(tool({ type: "shell", command: "npm test\n--watch" }, { status: "running" }));
  assert.equal(running.verb, "Running");
  assert.equal(running.target, "npm test");
  const failed = toolData(tool({ type: "shell", command: "npm test", exitCode: 1, output: "FAIL" }, { status: "failed", error: { message: "x" } }));
  assert.equal(failed.verb, "Ran");
  assert.equal(failed.meta, "exit 1");
  assert.equal(failed.metaTone, "danger");
  assert.equal(failed.detail.kind, "output");
});

test("edit: counts come from old/new strings when no unified diff", () => {
  const d = toolData(tool({ type: "edit", filePath: "/a/b/c/d/e.ts", oldString: "x\ny", newString: "z" }));
  assert.equal(d.meta, "+1 −2");
  assert.equal(d.target, "…/c/d/e.ts");
  assert.deepEqual(d.detail.lines.map((l) => l.sign), ["-", "-", "+"]);
});

test("edit: unified diff headers are dropped, hunk headers give line numbers", () => {
  const d = toolData(tool({ type: "edit", filePath: "a.ts", unifiedDiff: "--- a\n+++ b\n@@ -12,2 +12 @@\n-old\n+new\n same" }));
  assert.deepEqual(d.detail.lines, [{ sign: "-", text: "old", n: 12 }, { sign: "+", text: "new", n: 12 }, { sign: " ", text: "same", n: 13 }]);
});

test("canceled overrides verb and icon; every output passes the renderer schema", () => {
  const d = toolData(tool({ type: "read", filePath: "a.ts" }, { status: "canceled" }));
  assert.equal(d.verb, "Canceled");
  assert.equal(d.icon, "CircleSlash");
  for (const detail of [
    { type: "search", query: "q", numMatches: 1, numFiles: 2, filePaths: ["a"] },
    { type: "search", query: "q", toolName: "web_search", webResults: [{ title: "T", url: "https://x.dev" }] },
    { type: "fetch", url: "https://x.dev", code: 200, bytes: 2048 },
    { type: "worktree_setup", worktreePath: "/w", branchName: "b", log: "", commands: [{ index: 0, command: "npm ci", cwd: "/w", log: "", status: "completed", exitCode: 0 }] },
    { type: "sub_agent", subAgentType: "explore", log: "", actions: [{ index: 0, toolName: "Read" }] },
    { type: "plain_text", label: "Spoke", icon: "mic_vocal" },
    { type: "unknown", input: { id: 1 }, output: null },
  ]) {
    toolSchema.parse(JSON.parse(JSON.stringify(toolData(tool(detail)))));
  }
  assert.equal(toolData(tool({ type: "search", query: "q", numMatches: 1, numFiles: 2 })).meta, "1 match · 2 files");
  assert.equal(toolData(tool({ type: "plain_text", icon: "mic_vocal" })).icon, "MicVocal");
});

test("task notifications drop raw XML and keep the summary", () => {
  const d = toolData(tool({ type: "plain_text", label: "Fix ids", icon: "wrench", text: "<task-notification>…" }, { name: "task_notification" }));
  assert.equal(d.verb, "Background task");
  assert.equal(d.target, "Fix ids");
  assert.equal(d.detail, undefined);
});

test("todo uses activeForm while in progress; legacy completed flag maps to status", () => {
  const d = todoData({ type: "todo", items: [{ text: "Write tests", completed: false, status: "in_progress", activeForm: "Writing tests" }, { text: "Ship", completed: true }] });
  assert.deepEqual(d.items, [{ status: "in_progress", text: "Writing tests" }, { status: "completed", text: "Ship" }]);
});

test("notices", () => {
  assert.equal(noticeData({ type: "compaction", status: "completed", trigger: "manual", preTokens: 182400 }).text, "Context manually compacted · 182K tokens");
  assert.equal(noticeData({ type: "compaction", status: "loading" }).pulsing, true);
  assert.equal(noticeData({ type: "error", message: "boom" }).variant, "inline");
});

test("image-only assistant messages become thumbnails; mixed text stays native", () => {
  assert.deepEqual(imageData("![Image](file:///a.png)![](file:///b.png)\n"), {
    images: [{ alt: "Image", url: "file:///a.png" }, { alt: "Image", url: "file:///b.png" }],
  });
  assert.equal(imageData("Here it is: ![Image](file:///a.png)"), undefined);
  assert.equal(imageData("no images"), undefined);
});

test("errors read as one line: message first, never a lone brace", () => {
  assert.equal(errorText({ message: "Command failed\nstack…" }), "Command failed");
  assert.equal(errorText({ code: 1 }), '{"code":1}');
  assert.equal(errorText("\n  boom  \n"), "boom");
  assert.equal(errorText(null), undefined);
});

test("claude shell failures: exit code goes to meta, tool_result content becomes output", () => {
  const d = toolData(tool({ type: "shell", command: "rg x" }, { status: "failed", error: { type: "tool_result", content: "Exit code 2\nline one\nline two" } }));
  assert.equal(d.meta, "exit 2");
  assert.equal(d.error, undefined);
  assert.equal(d.detail.text, "line one\nline two");
  assert.equal(errorText({ type: "tool_result", content: [{ type: "text", text: "\nPermission denied" }] }), "Permission denied");
});

test("highlight colors code tokens and keeps every character", async () => {
  const { highlight } = await import("../client/highlight.ts");
  const line = 'const user = await verifyToken(req.headers.auth) // 401 if "missing"';
  const spans = highlight(line);
  assert.equal(spans.map((s) => s.text).join(""), line);
  const kind = (t) => spans.find((s) => s.text === t)?.kind;
  assert.equal(kind("const"), "keyword");
  assert.equal(kind("await"), "keyword");
  assert.equal(kind("verifyToken"), "function");
  assert.equal(kind("="), "operator");
  assert.equal(kind("// 401 if \"missing\""), "comment");
  assert.equal(highlight('{ "id": 12, "ok": true }').filter((s) => s.kind).map((s) => s.kind).join(" "), "punctuation string operator number punctuation string operator constant punctuation");
});

test("shell highlighting: commands after pipes and &&, flags, variables, strings, comments", async () => {
  const { highlightShell } = await import("../client/highlight.ts");
  const line = `F=$(rg -l "export" src) && cat $F | head -20 2>&1; sudo npm test # run`;
  const spans = highlightShell(line);
  assert.equal(spans.map((s) => s.text).join(""), line);
  const kinds = Object.fromEntries(spans.filter((s) => s.kind).map((s) => [s.text, s.kind]));
  assert.equal(kinds.F, "variable");
  assert.equal(kinds.rg, "function");
  assert.equal(kinds["-l"], "parameter");
  assert.equal(kinds['"export"'], "string");
  assert.equal(kinds.cat, "function");
  assert.equal(kinds.$F, "variable");
  assert.equal(kinds.head, "function");
  assert.equal(kinds["2>&1"], "operator");
  assert.equal(kinds.sudo, "keyword");
  assert.equal(kinds.npm, "function");
  assert.equal(kinds["# run"], "comment");
  assert.equal(kinds.test, undefined);
});

test("shell blocks: heredoc bodies are code, the terminator closes them, each line starts a command", async () => {
  const { highlightShellBlock } = await import("../client/highlight.ts");
  const text = "python3 - <<'EOF'\nimport json\nEOF\necho done";
  const spans = highlightShellBlock(text);
  assert.equal(spans.map((s) => s.text).join(""), text);
  const kinds = spans.filter((s) => s.kind).map((s) => `${s.text}:${s.kind}`);
  assert.ok(kinds.includes("python3:function"));
  assert.ok(kinds.includes("import:keyword"));
  assert.ok(kinds.includes("EOF:keyword"));
  assert.ok(kinds.includes("echo:function"));
});

test("every highlight theme colors every token kind; presets point at real highlight themes", async () => {
  const { SYNTAX_THEMES } = await import("../client/highlight.ts");
  const { PRESETS, themeSchema } = await import("../shared/theme.ts");
  for (const t of SYNTAX_THEMES) {
    assert.equal(Object.keys(t.colors).length, 10, t.id);
    for (const c of Object.values(t.colors)) assert.match(c, /^#[0-9a-f]{6}$/, t.id);
  }
  for (const p of PRESETS) assert.ok(SYNTAX_THEMES.some((t) => t.id === p.syntax && t.appearance === p.appearance), p.id);
  assert.equal(themeSchema.parse({}).syntax, "one-dark-darker-mariana");
});

test("hideable kinds: only completed reads, searches, fetches and background tasks", async () => {
  const { prefsSchema } = await import("../shared/timeline.ts");
  assert.equal(hideableKind(tool({ type: "read", filePath: "a.ts" })), "read");
  assert.equal(hideableKind(tool({ type: "search", query: "x" })), "search");
  assert.equal(hideableKind(tool({ type: "plain_text", label: "Done" }, { name: "task_notification" })), "task");
  assert.equal(hideableKind(tool({ type: "read", filePath: "a.ts" }, { status: "failed" })), undefined);
  assert.equal(hideableKind(tool({ type: "read", filePath: "a.ts" }, { status: "running" })), undefined);
  assert.equal(hideableKind(tool({ type: "shell", command: "ls" })), undefined);
  assert.deepEqual(prefsSchema.parse({}), { reasoning: "paseo", toolDetails: "collapsed", commandColors: "expanded", hidden: [], userMessages: "clamp", steps: "faded", nativeStyle: "design", images: "small", richText: { quote: "a", table: "a", code: "a", inline: "a", heading: "a", list: "a", callout: "a", rule: "a" } });
  // Saved prefs from before rich text variants still load, with each element on its base style.
  assert.equal(prefsSchema.parse({ images: "large" }).richText.callout, "a");
  assert.equal(prefsSchema.parse({ richText: { table: "c" } }).richText.table, "c");
  // Only tables have a fourth style.
  assert.equal(prefsSchema.parse({ richText: { table: "d" } }).richText.table, "d");
  assert.equal(prefsSchema.parse({ steps: "merged" }).steps, "faded");
  assert.equal(prefsSchema.safeParse({ richText: { quote: "d" } }).success, false);
});
