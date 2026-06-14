import type { Status, Verdict } from "../types.js";

const ICON: Record<Status, string> = {
  verified: "✅",
  failed: "❌",
  warning: "⚠️",
  unchecked: "➖",
};

/** Markdown summary — used for PR comments and the Claude Code hook reason. */
export function renderMarkdown(verdict: Verdict): string {
  const lines: string[] = [];
  const header = verdict.ok
    ? "### 🟢 groundtruth: claims hold up"
    : `### 🔴 groundtruth: ${verdict.failed} overclaim(s) detected`;
  lines.push(header, "");

  const order: Status[] = ["failed", "warning", "verified", "unchecked"];
  const sorted = [...verdict.receipts].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status)
  );

  for (const r of sorted) {
    let item = `- ${ICON[r.status]} **${r.title}** — ${r.detail}`;
    if (r.location) item += ` (\`${r.location}\`)`;
    lines.push(item);
    if (r.evidence) {
      lines.push("", "  ```", ...r.evidence.split("\n").map((l) => "  " + l), "  ```");
    }
  }

  lines.push("");
  lines.push(
    `_${verdict.verified} verified · ${verdict.failed} busted · ${verdict.warnings} suspicious · ${verdict.unchecked} unchecked_`
  );
  return lines.join("\n");
}
