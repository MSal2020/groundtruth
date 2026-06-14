# Contributing to groundtruth

Thanks for helping make AI coding agents honest.

## Ground rules

groundtruth has one job: **check the agent's claims against reality.** Before
proposing a feature, ask whether it serves that. We intentionally say no to
generic bug-hunting, eval platforms, hosted services, and LLM-judging in the
core. Keeping the scope sharp is what makes the tool trustworthy.

## Dev setup

```bash
git clone https://github.com/MSal2020/groundtruth
cd groundtruth
npm install
npm run build
npm test        # 18+ tests, all deterministic
```

groundtruth is tested with groundtruth — run `node dist/cli.js --claim "tests pass and it compiles" --build` before opening a PR.

## The best contributions

- **New verifiers** — a new class of overclaim we can catch deterministically.
- **Language support** — Python (`pytest`/`unittest`, PyPI checks) and Go (`go test`) are the top asks. See `src/verifiers/` and `src/verifiers/shared.ts`.
- **A lie we missed** — open a "missed lie" issue with a minimal diff + claim; ideally add a failing test in `test/`.
- **A false positive** — open a "false positive" issue with the diff/claim that was wrongly flagged.

## Adding a verifier

1. Implement the `Verifier` interface (`src/types.ts`) in `src/verifiers/`.
2. Register it in `src/verify.ts`.
3. Add tests in `test/verifiers.test.ts` with synthetic `FileDiff`s (no network/IO).
4. Prefer **deterministic** checks. If something needs an LLM, it belongs behind an opt-in flag, not in the core.

## PRs

Small, focused PRs. Run `npm run build && npm test`. Describe what overclaim your change catches (or stops mis-catching).
