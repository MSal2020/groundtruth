// `groundtruth init` — wire the Stop hook into the project's Claude Code config.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const HOOK_COMMAND = "npx groundtruth hook";

interface HookCmd {
  type?: string;
  command?: string;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookCmd[];
}

export function installClaudeHook(cwd: string): {
  status: "installed" | "already" | "error";
  file: string;
  message: string;
} {
  const dir = path.join(cwd, ".claude");
  const file = path.join(dir, "settings.json");

  let settings: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return { status: "error", file, message: "existing .claude/settings.json is not valid JSON — not touching it." };
    }
  }

  const hooks = (settings.hooks ??= {}) as Record<string, HookGroup[]>;
  const stop = (hooks.Stop ??= []) as HookGroup[];

  const already = stop.some((g) =>
    (g.hooks ?? []).some((h) => h.command === HOOK_COMMAND)
  );
  if (already) {
    return { status: "already", file, message: "groundtruth Stop hook is already installed." };
  }

  stop.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  } catch (err) {
    return { status: "error", file, message: err instanceof Error ? err.message : String(err) };
  }

  return {
    status: "installed",
    file,
    message: "Installed the groundtruth Stop hook. Claude Code can no longer end a turn on an overclaim.",
  };
}
