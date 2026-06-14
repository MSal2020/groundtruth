# Demo

`run.sh` spins up a throwaway git repo, commits a clean, honest baseline, then
applies the kind of change a coding agent leaves behind when it overclaims:

- `validateInput` "implemented" — actually a `throw new Error("not implemented")` stub
- "all tests pass" — the real test was `.skip`-ped and the suite is red
- "added tests" — no new test cases exist
- "uses `fast-csv-parser-pro`" — a package that doesn't exist on npm

Then it runs `groundtruth` against the agent's summary and watches it call the bluff.

```bash
# from the repo root
npm run build
bash examples/demo/run.sh
```

The repo is created in a temp dir and cleaned up automatically.
