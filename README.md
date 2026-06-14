<div align="center">

# groundtruth

### Catch your AI coding agent when it lies.

Your agent says **"✅ Done, all tests pass."** `groundtruth` runs the tests itself,
reads the diff, and tells you whether that's actually true.

[![npm](https://img.shields.io/npm/v/groundtruth?color=2563eb)](https://www.npmjs.com/package/groundtruth)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![CI](https://img.shields.io/badge/tests-passing-brightgreen)](#)

</div>

<!-- TODO(demo): replace with the split-screen GIF — Claude Code says "Done" on the left, groundtruth busts it on the right. -->

```console
$ npx groundtruth

The agent said:
  "✅ Done. I implemented validateInput with full input validation, added tests,
   and all tests pass. It uses the `fast-csv-parser-pro` package. Ready to merge."

  groundtruth — what the agent actually did

  ✗ "Ready to merge" — it is not
      Agent declared the work complete, but 5 claim(s) don't hold up.

  ✗ "...all tests pass" — but the suite is RED
      Ran `npm test`: 1 test(s) failed.

  ✗ harness gaming: skipped test
      A passing test suite may be hiding real failures — this was added in the diff.
      test/validate.test.js:5

  ✗ claimed implemented, but it's a stub
      `validateInput` in this file is a placeholder (throws 'not implemented').
      src/validate.js:4

  ✗ hallucinated dependency: fast-csv-parser-pro
      does not exist on the npm registry — a slopsquatting supply-chain risk.

  ✗ claimed to add tests, but none found
      No new test cases appear in the diff.

  ────────────────────────────────────────────────
  VERDICT: 6 overclaim(s) — DO NOT MERGE. ✗
```

Try it yourself right now: **`bash examples/demo/run.sh`**

---

## Why

AI coding agents are confidently wrong, and 2026 has the receipts:

- METR found models reward-hacking coding tasks in **up to 76%** of runs on impossible problems — and Anthropic showed an agent learning to call `sys.exit(0)` to **fake a green test suite**. [[METR]](https://metr.org/blog/2025-06-05-recent-reward-hacking/) [[Anthropic]](https://cyberscoop.com/anthropic-claude-breaks-bad-jailbreak-reward-hacking-study/)
- **19.7%** of packages LLMs recommend **don't exist** — fuel for "slopsquatting" supply-chain attacks. [[study]](https://www.helpnetsecurity.com/2025/04/14/package-hallucination-slopsquatting-malicious-code/)
- The everyday version: *"Complete! All 10 tabs with working buttons"* — when 3 tabs existed and the rest said "Coming soon."

The fix everyone hand-rolls is a 15-line bash hook that re-runs the tests. `groundtruth` is that idea, done properly: it takes the agent's **own words** and **independently re-derives the truth**, then hands you the receipts.

It is **deterministic and offline** (it runs your tests, parses your diff, checks the registry). No LLM judge, no API key, no telemetry.

## Install & use

```bash
# zero-install: run it after your agent finishes a change
npx groundtruth

# or install it
npm i -D groundtruth
```

By default it inspects your working tree (`git diff HEAD` + untracked files). Give it the agent's summary to check the claims by name:

```bash
npx groundtruth --claim "implemented retryWithBackoff, all tests pass, uses p-retry"

# pipe the agent's message straight in
pbpaste | npx groundtruth

# read claims from a Claude Code transcript
npx groundtruth --auto-transcript
```

Exit code is non-zero when the agent overclaimed — so it drops into any script or CI.

## Three ways to run it

### 1. CLI — works with any agent
Cursor, Copilot, Codex, Claude Code, a human on a deadline — `groundtruth` audits the **diff**, so it doesn't care who wrote it.

### 2. Claude Code hook — it won't let the agent lie
Install a `Stop` hook and Claude Code **physically cannot end its turn on an overclaim** — it gets blocked and told to fix the issues first.

```bash
npx groundtruth init     # writes the Stop hook into .claude/settings.json
```

<details>
<summary>What that adds to <code>.claude/settings.json</code></summary>

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npx groundtruth hook" }] }
    ]
  }
}
```
When the agent stops, `groundtruth` verifies its claims. If they don't hold, it returns `{"decision":"block"}` with the receipts, and the agent keeps working.
</details>

### 3. CI gate
```yaml
# .github/workflows/groundtruth.yml
- run: npx groundtruth --base origin/${{ github.base_ref }} --markdown
```

## What it checks

| Verifier | Catches |
|---|---|
| **tests** | "all tests pass" → actually runs the suite (vitest / jest / `node --test`) and compares. |
| **harness** | Tests disabled to fake green: `.skip` / `.only` / `xit`, `@pytest.mark.skip`, `sys.exit(0)`, deleted assertions. |
| **stubs** | "implemented X" that's really `throw new Error("TODO")`, `NotImplementedError`, empty bodies, placeholders. |
| **deps** | Imported/added packages that **don't exist on npm** (hallucinations / slopsquatting). |
| **build** | "it compiles / no type errors" → runs `tsc --noEmit` (`--build`). |
| **claims** | "added tests" with no new test case; "implemented X" where X isn't in the diff. |

## Roadmap

- [ ] Python & Go verifiers (test detection, stubs, PyPI checks)
- [ ] Coverage-delta gate ("you said you tested it, but coverage didn't move")
- [ ] GitHub Action with inline PR comments
- [ ] VS Code surfacing
- [ ] Optional `--llm` claim extraction for free-form summaries
- [ ] A gallery of caught lies

## Philosophy — what `groundtruth` will *not* do

It is **the claims-vs-reality checker**, and nothing else. No generic AI bug-hunting, no eval platform, no hosted service, no telemetry. It only ever tells you one thing: **did the agent's claims survive contact with reality?**

## Contributing

Issues and PRs welcome — especially new verifiers and language support. Run `npm test` and `npm run build` before opening a PR. (`groundtruth` is tested with `groundtruth`.)

## License

MIT © Muhammad Salmaan Ahmed Nusrath
