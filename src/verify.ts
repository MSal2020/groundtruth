import type { Receipt, Verdict, Verifier, VerifyOptions } from "./types.js";
import { testsVerifier } from "./verifiers/tests.js";
import { harnessVerifier } from "./verifiers/harness.js";
import { stubsVerifier } from "./verifiers/stubs.js";
import { depsVerifier } from "./verifiers/deps.js";
import { buildVerifier } from "./verifiers/build.js";
import { claimsVerifier } from "./verifiers/claims.js";

export const VERIFIERS: Verifier[] = [
  testsVerifier,
  harnessVerifier,
  stubsVerifier,
  depsVerifier,
  buildVerifier,
  claimsVerifier,
];

export function buildVerdict(receipts: Receipt[]): Verdict {
  const verified = receipts.filter((r) => r.status === "verified").length;
  const failed = receipts.filter((r) => r.status === "failed").length;
  const warnings = receipts.filter((r) => r.status === "warning").length;
  const unchecked = receipts.filter((r) => r.status === "unchecked").length;
  return {
    receipts,
    verified,
    failed,
    warnings,
    unchecked,
    total: receipts.length,
    ok: failed === 0,
  };
}

/** Run every verifier and fold the results into a verdict. */
export async function verify(opts: VerifyOptions): Promise<Verdict> {
  const results = await Promise.all(
    VERIFIERS.map(async (v) => {
      try {
        return await v.run(opts);
      } catch (err) {
        const receipt: Receipt = {
          status: "unchecked",
          verifier: v.name,
          title: `${v.name} verifier errored`,
          detail: err instanceof Error ? err.message : String(err),
        };
        return [receipt];
      }
    })
  );

  const receipts = results.flat();

  // The agent claimed substantive work but the working tree has no changes —
  // the "declared victory on an empty branch" failure mode. A warning (not a
  // failure) because the work may simply have been committed already.
  const substantive = opts.claims.some(
    (c) => c.type === "implementation" || c.type === "tests" || c.type === "done"
  );
  if (opts.diff.length === 0 && substantive) {
    receipts.push({
      status: "warning",
      verifier: "claims",
      title: "agent claimed work, but the diff is empty",
      detail:
        "No changes in the working tree. If the agent committed its work, re-run with --base <ref>; otherwise it claimed work it didn't do.",
    });
  }

  // Capstone: if the agent declared "done" but something failed, call it out.
  const doneClaim = opts.claims.find((c) => c.type === "done");
  const failed = receipts.filter((r) => r.status === "failed");
  if (doneClaim && failed.length > 0) {
    receipts.unshift({
      status: "failed",
      verifier: "claims",
      title: `"${doneClaim.text}" — it is not`,
      detail: `Agent declared the work complete, but ${failed.length} claim(s) don't hold up.`,
      claim: doneClaim,
    });
  }

  return buildVerdict(receipts);
}
