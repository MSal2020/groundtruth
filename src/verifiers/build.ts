import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Receipt, Verifier, VerifyOptions } from "../types.js";

// Verifies "it compiles / no type errors" claims by actually running tsc.
// Only runs when there is a build claim or `--build` is passed, since type
// checking can be slow.

export const buildVerifier: Verifier = {
  name: "build",
  async run(opts: VerifyOptions): Promise<Receipt[]> {
    const claim = opts.claims.find((c) => c.type === "build");
    if (!claim && !opts.build) return [];

    const hasTsconfig = existsSync(path.join(opts.cwd, "tsconfig.json"));
    if (!hasTsconfig) {
      return claim
        ? [
            {
              status: "unchecked",
              verifier: "build",
              title: "no tsconfig.json to type-check",
              detail: `Agent claimed "${claim.text}" but no tsconfig.json was found.`,
              claim,
            },
          ]
        : [];
    }

    const res = spawnSync("npx", ["--no-install", "tsc", "--noEmit"], {
      cwd: opts.cwd,
      encoding: "utf8",
      timeout: 5 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    if (res.error || res.status === null) {
      return [
        {
          status: "unchecked",
          verifier: "build",
          title: "could not run tsc",
          detail: "tsc is not available (try installing typescript).",
          ...(claim ? { claim } : {}),
        },
      ];
    }

    const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    if (res.status === 0) {
      return [
        {
          status: "verified",
          verifier: "build",
          title: claim ? "compiles — confirmed" : "type-check passes",
          detail: "`tsc --noEmit` exited 0.",
          ...(claim ? { claim } : {}),
        },
      ];
    }

    const errorLines = output
      .split("\n")
      .filter((l) => /error TS\d+/.test(l));
    return [
      {
        status: "failed",
        verifier: "build",
        title: claim ? `"${claim.text}" — but tsc reports errors` : "type-check fails",
        detail: `\`tsc --noEmit\` found ${errorLines.length || "some"} type error(s).`,
        evidence: errorLines.slice(0, 8).join("\n") || output.trim().slice(-400),
        ...(claim ? { claim } : {}),
      },
    ];
  },
};
