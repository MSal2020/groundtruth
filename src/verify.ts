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
