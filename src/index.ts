// Public programmatic API.
export type {
  Claim,
  ClaimType,
  Receipt,
  Status,
  Verdict,
  FileDiff,
  Verifier,
  VerifyOptions,
} from "./types.js";

export { verify, buildVerdict, VERIFIERS } from "./verify.js";
export { getDiff, isGitRepo } from "./git.js";
export { parseUnifiedDiff } from "./diff.js";
export { extractClaims } from "./claims/extract.js";
export { parseTranscript, findLatestTranscript } from "./claims/transcript.js";
export { renderPretty } from "./report/pretty.js";
export { renderMarkdown } from "./report/markdown.js";
