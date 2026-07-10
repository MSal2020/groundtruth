// Checks whether a package name actually exists on a public registry.
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

function fetchStatus(url: string, timeoutMs: number): Promise<RegistryResult> {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      res.resume(); // drain so the socket can close
      const code = res.statusCode ?? 0;
      if (code === 200) resolve("exists");
      // proxy.golang.org answers 404/410 for modules that don't exist.
      else if (code === 404 || code === 410) resolve("missing");
      else resolve("unknown");
    });
    req.on("timeout", () => {
      req.destroy();
      resolve("unknown");
    });
    req.on("error", () => resolve("unknown"));
  });
}

async function checkWithRetry(
  cacheKey: string,
  url: string,
  timeoutMs: number
): Promise<RegistryResult> {
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  // Retry only on inconclusive (network) results so a transient blip doesn't
  // flip a real hallucination into "unknown".
  let result: RegistryResult = "unknown";
  for (let attempt = 0; attempt < 3; attempt++) {
    result = await fetchStatus(url, timeoutMs);
    if (result !== "unknown") break;
  }
  cache.set(cacheKey, result);
  return result;
}

/** Does this package exist on the npm registry? */
export function packageExists(name: string, timeoutMs = 4000): Promise<RegistryResult> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`;
  return checkWithRetry(`npm:${name}`, url, timeoutMs);
}

/** Does this distribution exist on PyPI? */
export function pypiExists(name: string, timeoutMs = 4000): Promise<RegistryResult> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  return checkWithRetry(`pypi:${name}`, url, timeoutMs);
}

/** Case-encode a module path per the Go module proxy protocol (M -> !m). */
export function encodeGoModule(path: string): string {
  return path.replace(/[A-Z]/g, (c) => "!" + c.toLowerCase());
}

/** Does this module exist on the Go module proxy? */
export function goModuleExists(module: string, timeoutMs = 4000): Promise<RegistryResult> {
  const url = `https://proxy.golang.org/${encodeGoModule(module)}/@latest`;
  return checkWithRetry(`go:${module}`, url, timeoutMs);
}
