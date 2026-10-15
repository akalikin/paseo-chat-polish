import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

export type DiffLine = { sign: " " | "+" | "-"; text: string; n?: number };

/** Diff rows with the new-file line number (old-file number for deletions) taken from `@@` hunk headers. */
export function diffLines(d: Extract<ToolCallDetail, { type: "edit" }>): DiffLine[] {
  if (!d.unifiedDiff) {
    const lines = (s: string | undefined, sign: "+" | "-") => (s ? s.split("\n").map((text) => ({ sign, text })) : []);
    return [...lines(d.oldString, "-"), ...lines(d.newString, "+")];
  }
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const l of d.unifiedDiff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      continue;
    }
    if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("\\")) continue;
    const sign = l[0] === "+" || l[0] === "-" ? l[0] : " ";
    const n = sign === "-" ? oldNo++ : sign === "+" ? newNo++ : (oldNo++, newNo++);
    out.push({ sign, text: l.slice(1), n: n || undefined });
  }
  return out;
}
