import type { FileDiff } from "./types.js";

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified diff (e.g. from `git diff --no-color`) into per-file added
 * and removed lines. New-file line numbers are tracked from hunk headers so
 * receipts can point at `file:line`.
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let newLineNo = 0;

  const lines = diffText.split("\n");
  for (const raw of lines) {
    if (raw.startsWith("diff --git")) {
      // `diff --git a/path b/path`
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      const path = m ? m[2]! : raw.slice("diff --git ".length);
      current = { path, isNew: false, added: [], removed: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (raw.startsWith("new file mode")) {
      current.isNew = true;
      continue;
    }
    if (raw.startsWith("rename to ")) {
      current.path = raw.slice("rename to ".length);
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") current.path = p.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ")) continue;

    const hunk = HUNK_RE.exec(raw);
    if (hunk) {
      newLineNo = parseInt(hunk[1]!, 10);
      continue;
    }

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      current.added.push({ line: newLineNo, text: raw.slice(1) });
      newLineNo++;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      current.removed.push(raw.slice(1));
      // removed lines do not advance the new-file counter
    } else if (raw.startsWith(" ")) {
      newLineNo++;
    }
  }

  return files;
}

/** Build a FileDiff for an untracked file from its full contents. */
export function fileDiffFromContents(path: string, contents: string): FileDiff {
  const added = contents
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }));
  // Drop a trailing empty line caused by a final newline.
  if (added.length && added[added.length - 1]!.text === "") added.pop();
  return { path, isNew: true, added, removed: [] };
}
