// Checks whether a package name actually exists on the npm registry.
// Used to catch hallucinated / slopsquatted dependencies an agent invented.

import https from "node:https";

export type RegistryResult = "exists" | "missing" | "unknown";

const cache = new Map<string, RegistryResult>();

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline",
  "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

export function isBuiltin(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  const root = spec.split("/")[0] ?? spec;
  return NODE_BUILTINS.has(root);
}

/** Normalise an import specifier to its installable package name. */
export function packageNameFromSpecifier(spec: string): string | null {
  if (!spec) return null;
  if (spec.startsWith(".") || spec.startsWith("/")) return null; // relative / absolute
  if (spec.startsWith("node:")) return null;
  if (spec.startsWith("~")) return null; // common path alias (~/, ~)
  if (spec.startsWith("#")) return null; // Node subpath imports ("imports" field)
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    // A real scoped package is "@scope/name"; "@/foo" is a path alias.
    if (parts.length < 2 || parts[0] === "@" || !parts[0] || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  const root = spec.split("/")[0] ?? spec;
  return root || null;
}

function fetchStatus(name: string, timeoutMs: number): Promise<RegistryResult> {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`;
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      // Drain so the socket can be reused/closed.
      res.resume();
      const code = res.statusCode ?? 0;
      if (code === 200) resolve("exists");
      else if (code === 404) resolve("missing");
      else resolve("unknown");
    });
    req.on("timeout", () => {
      req.destroy();
      resolve("unknown");
    });
    req.on("error", () => resolve("unknown"));
  });
}

export async function packageExists(
  name: string,
  timeoutMs = 4000
): Promise<RegistryResult> {
  const cached = cache.get(name);
  if (cached) return cached;
  const result = await fetchStatus(name, timeoutMs);
  cache.set(name, result);
  return result;
}
