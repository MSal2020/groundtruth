# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Swift runner** — SwiftPM (`swift test`) and Xcode projects/workspaces
  (`xcodebuild test`), including iOS apps, which are run on an already-booted
  simulator when one is available. Scheme and destination are resolved lazily,
  so detection stays cheap on every Stop hook. Both Swift Testing and legacy
  XCTest summaries are parsed.
- **Follows committed work.** The Stop hook usually fires on a clean working
  tree because the agent committed — `git diff HEAD` is then empty and nothing
  was checked. The hook now falls back to the commits made during the session.
- **Says when it could not check.** Warnings and unchecked results are surfaced
  in the hook's `systemMessage` instead of being swallowed by `suppressOutput`,
  which made "verified nothing" look identical to "verified clean".
- Xcode trouble that says nothing about honesty — no simulator, no signing
  identity, a test target that never built, a suite that timed out — is
  reported as *unchecked*, never as a failing suite.
- Eval cases can declare a required toolchain (`requires: "swift"`) and are
  reported as **skipped** where it is absent. A macOS CI job runs the Swift
  corpus, so the language cannot silently lose coverage again.
- **Monorepo reach** — the `tests` verifier now walks from each changed file to
  the sub-project that owns it and runs *that* suite (e.g. `backend/`), instead
  of only looking at the repo root. This was the #1 reason the tool stayed
  silent on real projects run from the root.
- `groundtruth catches` now records diff size, claim count, and which test
  runners were in scope, so "clean" is never ambiguous (it distinguishes
  "verified honest" from "nothing was actually run").

### Changed
- The Stop hook runs test suites only when the agent claims completion
  (tests/done), keeping every intermediate stop fast. A manual `groundtruth`
  run still audits tests (use `--no-tests` to skip).

### Fixed
- **Swift test files were invisible, which turned honest work into an
  accusation.** `TEST_FILE_RE` matched only lowercase `tests/` directories and
  JS/Python/Go filenames, so PascalCase Swift layouts (`EmberTests/`,
  `Tests/DemoTests/`, `ShelfReadTests.swift`) never counted as tests — and
  `TEST_CASE_RE` knew nothing of `@Test` or XCTest's lowercase `func testX`.
  Every "added tests" claim in a Swift project was therefore unsatisfiable and
  reported as *"claimed to add tests, but none found"*, no matter how many
  tests were really added. Both patterns now cover Swift (and `@Test` picks up
  JUnit/Kotlin as a side effect).
- A missing test *runner* (un-installed sub-project) reports `unchecked`, but a
  missing *application* module (a hallucinated import) correctly reads as a
  failing suite instead of being masked.
- Scrub `NODE_TEST_CONTEXT` / `PYTEST_CURRENT_TEST` when spawning a suite so a
  nested runner executes standalone.

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
