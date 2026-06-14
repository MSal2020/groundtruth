import type { Receipt, Status, Verdict } from "../types.js";
import { color } from "../util/color.js";

const ICON: Record<Status, string> = {
  verified: color.green("✓"),
  failed: color.red("✗"),
  warning: color.yellow("⚠"),
  unchecked: color.gray("•"),
};

function indentEvidence(evidence: string): string {
  return evidence
    .split("\n")
    .map((l) => "      " + color.dim(l))
    .join("\n");
}

function line(r: Receipt): string {
  let s = `  ${ICON[r.status]} ${color.bold(r.title)}`;
  s += `\n      ${r.detail}`;
  if (r.location) s += `\n      ${color.cyan(r.location)}`;
  if (r.evidence) s += `\n${indentEvidence(r.evidence)}`;
  return s;
}

export function renderPretty(verdict: Verdict): string {
  const { receipts } = verdict;
  const out: string[] = [];

  out.push("");
  out.push(`  ${color.bold("groundtruth")} ${color.dim("— what the agent actually did")}`);
  out.push("");

  if (receipts.length === 0) {
    out.push(color.dim("  No claims or changes to verify."));
    out.push("");
    return out.join("\n");
  }

  // failed first, then warnings, then verified, then unchecked
  const order: Status[] = ["failed", "warning", "verified", "unchecked"];
  const sorted = [...receipts].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status)
  );
  for (const r of sorted) out.push(line(r), "");

  const parts: string[] = [];
  if (verdict.verified) parts.push(color.green(`${verdict.verified} verified`));
  if (verdict.failed) parts.push(color.red(`${verdict.failed} busted`));
  if (verdict.warnings) parts.push(color.yellow(`${verdict.warnings} suspicious`));
  if (verdict.unchecked) parts.push(color.gray(`${verdict.unchecked} unchecked`));

  const banner = verdict.ok
    ? color.green("  VERDICT: claims hold up. ✓")
    : color.red(`  VERDICT: ${verdict.failed} overclaim(s) — DO NOT MERGE. ✗`);

  out.push(color.dim("  " + "─".repeat(48)));
  out.push("  " + parts.join(color.dim("  ·  ")));
  out.push(banner);
  out.push("");
  return out.join("\n");
}
