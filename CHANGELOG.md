# Changelog

All notable changes to `modelfusion-hermes-skill` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- SSE streaming delivery mode (currently the skill uses JSON delivery for
  deterministic schema validation).
- Optional caching of `sessionId` → response for replay during development.
- Tighter typing of `provenance` keys once the API exposes a structured form.

## [0.1.0] — 2026-05-27

### Added
- Initial SKILL.md for Hermes Agent and other agentskills.io-compatible hosts.
- `callModelFusion` tool with Zod schemas for request and response validation.
- `ModelFusionToolError` with stable `code` field across nine error classes.
- Automatic exponential-backoff retries on 408 / 429 / 5xx with `Retry-After`
  honored when present.
- CLI wrapper (`scripts/modelfusion-cli.js`) with stable exit codes.
- Jest unit test suite (no network, mocked transport).
- Playwright live-API contract tests (gated on `MODELFUSION_DEMO_KEY`).
- GitHub Actions CI: typecheck + lint + unit tests on PR; contract tests on
  push to main when secrets are configured.
- References: `api-reference.md`, `examples.md`, `errors.md`.
- Example request payloads for general and `medfusion` presets.
- Apache-2.0 license.
