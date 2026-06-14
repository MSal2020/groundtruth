// Reads a Claude Code session transcript (JSONL) and extracts the agent's
// final natural-language message — the "claims" — plus the tools it called.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TranscriptSummary {
  /** Concatenated text of the last assistant message(s). */
  finalText: string;
  /** Names of tools the agent invoked anywhere in the session. */
  toolsUsed: string[];
}

interface JsonlEntry {
  type?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string; name?: string }>;
  };
}

export function parseTranscript(filePath: string): TranscriptSummary {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const toolsUsed = new Set<string>();
  let lastAssistantText = "";

  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const isAssistant =
      entry.type === "assistant" || entry.message?.role === "assistant";
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    if (isAssistant) {
      const texts = content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string);
      if (texts.length) lastAssistantText = texts.join("\n");
      for (const c of content) {
        if (c.type === "tool_use" && c.name) toolsUsed.add(c.name);
      }
    }
  }

  return { finalText: lastAssistantText, toolsUsed: [...toolsUsed] };
}

/**
 * Best-effort discovery of the most recent Claude Code transcript for a given
 * working directory. Claude stores transcripts under
 * `~/.claude/projects/<encoded-cwd>/<session>.jsonl`.
 */
export function findLatestTranscript(cwd: string): string | null {
  const base = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "projects"
  );
  if (!existsSync(base)) return null;

  // Claude encodes the path by replacing non-alphanumerics with dashes.
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  const candidates = [path.join(base, encoded)];

  // Fall back to scanning all project dirs for the freshest jsonl.
  let dirs = candidates.filter(existsSync);
  if (!dirs.length) {
    try {
      dirs = readdirSync(base)
        .map((d) => path.join(base, d))
        .filter((d) => {
          try {
            return statSync(d).isDirectory();
          } catch {
            return false;
          }
        });
    } catch {
      return null;
    }
  }

  let newest: { file: string; mtime: number } | null = null;
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const mtime = statSync(full).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { file: full, mtime };
      } catch {
        /* skip */
      }
    }
  }
  return newest?.file ?? null;
}
