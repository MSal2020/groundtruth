#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Claim } from "./types.js";
import { getDiff, isGitRepo } from "./git.js";
import { extractClaims } from "./claims/extract.js";
import {
  findLatestTranscript,
  parseTranscript,
} from "./claims/transcript.js";
import { verify } from "./verify.js";
import { renderPretty } from "./report/pretty.js";
import { renderMarkdown } from "./report/markdown.js";
import { runHook } from "./integrations/hook.js";
import { installClaudeHook } from "./integrations/install.js";
import { color } from "./util/color.js";

function version(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP = `
${color.bold("groundtruth")} — catch your AI coding agent when it lies.

Independently re-derives reality (runs your tests, reads the diff) and checks
it against what the agent claimed.

${color.bold("Usage")}
  groundtruth [options]          Verify the current working tree
  groundtruth hook               Run as a Claude Code Stop hook (reads stdin)
  groundtruth init               Install the Claude Code Stop hook for this repo

${color.bold("Claims")}
  --claim <text>                 A claim to check (repeatable)
  --transcript <path>            Read claims from a Claude Code transcript (.jsonl)
  --auto-transcript              Auto-find the latest Claude Code transcript
  (or pipe the agent's message:  echo "all tests pass" | groundtruth)

${color.bold("Scope")}
  --base <ref>                   Diff against a base ref (e.g. main) instead of HEAD
  --staged                       Only inspect staged changes

${color.bold("Verifiers")}
  --no-tests                     Don't run the test suite
  --offline                      Skip the npm-registry dependency check
  --build                        Also run tsc --noEmit

${color.bold("Output")}
  --json                         Machine-readable verdict
  --markdown                     Markdown summary (for PR comments)
  -q, --quiet                    Only print the verdict line
  -v, --version                  Print version
  -h, --help                     Show this help

Exit code is non-zero when the agent overclaimed.
`;

interface Args {
  command: string;
  claims: string[];
  transcript?: string;
  autoTranscript: boolean;
  base?: string;
  staged: boolean;
  noTests: boolean;
  offline: boolean;
  build: boolean;
  json: boolean;
  markdown: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    command: "check",
    claims: [],
    autoTranscript: false,
    staged: false,
    noTests: false,
    offline: false,
    build: false,
    json: false,
    markdown: false,
    quiet: false,
  };
  let i = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    a.command = argv[0];
    i = 1;
  }
  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--claim": a.claims.push(argv[++i] ?? ""); break;
      case "--transcript": a.transcript = argv[++i]; break;
      case "--auto-transcript": a.autoTranscript = true; break;
      case "--base": a.base = argv[++i]; break;
      case "--staged": a.staged = true; break;
      case "--no-tests": a.noTests = true; break;
      case "--offline": a.offline = true; break;
      case "--build": a.build = true; break;
      case "--json": a.json = true; break;
      case "--markdown": a.markdown = true; break;
      case "-q": case "--quiet": a.quiet = true; break;
      default: break;
    }
  }
  return a;
}

function readPipedStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function gatherClaims(args: Args): Promise<Claim[]> {
  const texts: string[] = [...args.claims];

  if (args.transcript) {
    try {
      texts.push(parseTranscript(args.transcript).finalText);
    } catch (e) {
      process.stderr.write(color.yellow(`Could not read transcript: ${String(e)}\n`));
    }
  }
  if (args.autoTranscript) {
    const latest = findLatestTranscript(process.cwd());
    if (latest) {
      try {
        texts.push(parseTranscript(latest).finalText);
      } catch {/* ignore */}
    }
  }
  const piped = await readPipedStdin();
  if (piped.trim()) texts.push(piped);

  return texts.flatMap((t) => extractClaims(t));
}

async function runCheck(args: Args): Promise<number> {
  const cwd = process.cwd();
  if (!isGitRepo(cwd)) {
    process.stderr.write(color.red("Not a git repository. groundtruth inspects the git diff.\n"));
    return 2;
  }

  const claims = await gatherClaims(args);
  const diff = getDiff(cwd, { base: args.base, staged: args.staged });
  const verdict = await verify({
    cwd,
    claims,
    diff,
    noTests: args.noTests,
    offline: args.offline,
    build: args.build,
  });

  if (args.json) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  } else if (args.markdown) {
    process.stdout.write(renderMarkdown(verdict) + "\n");
  } else if (args.quiet) {
    process.stdout.write(
      (verdict.ok
        ? color.green("✓ claims hold up")
        : color.red(`✗ ${verdict.failed} overclaim(s) — DO NOT MERGE`)) + "\n"
    );
  } else {
    process.stdout.write(renderPretty(verdict));
  }

  return verdict.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    process.stdout.write(version() + "\n");
    return;
  }

  const args = parseArgs(argv);

  switch (args.command) {
    case "hook":
      process.exit(await runHook());
      break;
    case "init": {
      const r = installClaudeHook(process.cwd());
      const tag =
        r.status === "installed" ? color.green("✓") :
        r.status === "already" ? color.yellow("•") : color.red("✗");
      process.stdout.write(`${tag} ${r.message}\n  ${color.dim(r.file)}\n`);
      process.exit(r.status === "error" ? 1 : 0);
      break;
    }
    case "check":
      process.exit(await runCheck(args));
      break;
    default:
      process.stderr.write(color.red(`Unknown command: ${args.command}\n`));
      process.stdout.write(HELP + "\n");
      process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(color.red(`groundtruth crashed: ${String(err)}\n`));
  process.exit(2);
});
