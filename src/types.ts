/** A claim the agent made about the work it did. */
export type ClaimType =
  | "tests" // "all tests pass", "added tests"
  | "implementation" // "implemented X", "fixed the bug"
  | "dependency" // "uses package Y"
  | "build" // "it compiles", "no type errors"
  | "no-placeholders" // "no TODOs / placeholders left"
  | "done"; // generic "done", "complete", "ready to merge"

export interface Claim {
  type: ClaimType;
  /** The exact phrase the agent used. */
  text: string;
  /** Extracted entity, e.g. a symbol name or package name, when applicable. */
  subject?: string;
}

export type Status = "verified" | "failed" | "warning" | "unchecked";

/** A single line of evidence about a claim or about the diff. */
export interface Receipt {
  status: Status;
  /** Short headline, e.g. `tests pass`. */
  title: string;
  /** Human explanation of what we found. */
  detail: string;
  /** Which verifier produced this. */
  verifier: string;
  /** Raw proof: test output tail, the offending source line, etc. */
  evidence?: string;
  /** file or file:line the receipt points at. */
  location?: string;
  /** The agent claim this receipt is adjudicating, if any. */
  claim?: Claim;
}

export interface Verdict {
  receipts: Receipt[];
  verified: number;
  failed: number;
  warnings: number;
  unchecked: number;
  total: number;
  /** false when there is at least one failed receipt. */
  ok: boolean;
}

/** One changed file, normalised from a git diff. */
export interface FileDiff {
  path: string;
  /** true for files that did not previously exist (untracked or added). */
  isNew: boolean;
  /** Added lines with their line number in the new file. */
  added: Array<{ line: number; text: string }>;
  /** Removed lines (text only). */
  removed: string[];
}

export interface VerifyOptions {
  cwd: string;
  claims: Claim[];
  diff: FileDiff[];
  /** Skip running the test suite. */
  noTests?: boolean;
  /** Run the suite even without a completion claim (manual CLI audits). */
  forceTests?: boolean;
  /** Skip the npm-registry dependency check. */
  offline?: boolean;
  /** Run `tsc --noEmit` even without an explicit build claim. */
  build?: boolean;
  /** Override the detected test command. */
  testCommand?: string;
}

export interface Verifier {
  name: string;
  run(opts: VerifyOptions): Promise<Receipt[]>;
}
