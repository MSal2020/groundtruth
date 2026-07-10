# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] — 2026-06-15

### Added
- **Multi-language test runners** — the `tests` verifier now detects and runs
  **pytest** (`python -m pytest`) and **`go test ./...`** in addition to npm
  (vitest / jest / `node --test`). Missing toolchains are reported as
  `unchecked`, never as a failing suite.
- **PyPI dependency checks** (`pydeps`) — deps declared in `requirements.txt`
  or `pyproject.toml` dependency arrays that don't exist on PyPI are hard
  failures; bare Python imports are warnings (stdlib/local/alias-aware, since
  import names ≠ distribution names). Keywords/classifiers are never scanned.
- **Go module checks** (`godeps`) — `go.mod` requires that don't exist on the
  Go module proxy are hard failures; imports from known hosts are warnings.
  `replace` directives and the module's own path are skipped.
- **GitHub Action** (`action.yml`) — diffs against the PR base, fails the check
  on an overclaim, and posts a sticky PR comment with the receipts.
- Skip-guarded pytest/go E2E tests; CI installs pytest and runs both.

### Changed
- Eval corpus expanded to 47 cases (21 lying + 26 honest), still 100%
  precision/recall, gated in CI.

### Fixed
- CLI/hook no longer hang when stdin is an open, empty pipe (CI runners, hooks).
- ANSI-colored runner output now parses correctly (vitest/jest/pytest).

[0.2.0]: https://github.com/MSal2020/groundtruth/releases/tag/v0.2.0

## [0.1.0] — 2026-06-14

First release. Catch your AI coding agent when it lies.

### Added
- **CLI** (`groundtruth`, `gt`) — verifies the working-tree diff against the agent's claims; `--json` / `--markdown` / `--quiet` output; non-zero exit on an overclaim.
- **Claude Code `Stop` hook** (`groundtruth hook`, `groundtruth init`) — returns `decision:"block"` so the agent can't end its turn on an overclaim; respects `stop_hook_active` to avoid loops.
- **Verifiers**:
  - `tests` — runs the suite (vitest / jest / `node --test`) and compares to "tests pass"; flags green-but-zero-tests.
  - `harness` — `.skip` / `.only` / `xit` (incl. aliased), `@pytest.mark.skip`, `sys.exit(0)`, deleted assertions.
  - `stubs` — `throw "TODO"`, `NotImplementedError`, empty bodies, placeholders; escalated to a failure when tied to a claimed symbol.
  - `deps` — imports/dependencies that don't exist on the npm registry (hallucination / slopsquatting).
  - `build` — `tsc --noEmit` for "it compiles" claims.
  - `claims` — "added tests" with no new test case; "implemented X" missing from the diff.
- Claim extraction from `--claim`, piped stdin, or a Claude Code transcript (`--transcript` / `--auto-transcript`).
- Demo (`examples/demo/run.sh`) and a reproducible README GIF (VHS).

[0.1.0]: https://github.com/MSal2020/groundtruth/releases/tag/v0.1.0
