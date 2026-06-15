// Read piped stdin without ever hanging.
//
// CLIs that opportunistically read stdin (to support `cmd | groundtruth`) can
// deadlock when launched with stdin attached to a pipe that is held open but
// never sends EOF — common in CI, hooks, and subprocess invocations. We resolve
// empty if no data arrives within a short window, and only wait for EOF once
// data has actually started flowing.

export function readStdin(timeoutMs = 200): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }

    let data = "";
    let sawData = false;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", finish);
      process.stdin.removeListener("error", finish);
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      resolve(data);
    };

    const onData = (chunk: string) => {
      sawData = true;
      data += chunk;
    };

    const timer = setTimeout(() => {
      // Nothing piped in — don't block waiting for an EOF that isn't coming.
      if (!sawData) finish();
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}
