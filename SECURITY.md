# Security Policy

## Reporting a vulnerability

If you believe you've found a security issue in `modelfusion-hermes-skill`,
**do not open a public GitHub issue**. Email:

> security@modelfusion.ai

Please include:

- A clear description of the issue
- Steps to reproduce
- Affected versions (`git rev-parse HEAD` or release tag)
- Your assessment of severity and impact

You'll get an acknowledgement within 3 business days. A fix and disclosure
timeline will follow based on the severity assessment.

## In-scope

- Code in this repository (`src/`, `scripts/`, `__tests__/`, `e2e/`)
- SKILL.md frontmatter and its handling of secrets
- The CLI wrapper's handling of API keys and request payloads

## Out of scope

- The ModelFusion API itself (report at the same address, but it's a separate
  surface)
- Bugs in Hermes Agent, Claude Code, Cursor, OpenClaw, or other host runtimes
- Theoretical issues without practical impact (e.g. "an attacker who already
  has shell on your machine can read `.env`")

## API key handling

- This skill never writes `MODELFUSION_API_KEY` to disk.
- The CLI accepts the key only via env var, never via flag (to prevent
  shell history leakage).
- The library exposes the key only through the `opts.apiKey` argument; the
  caller is responsible for not logging it.
- Outbound requests use `Authorization: Bearer <key>` over HTTPS only.

## Dependency policy

- Production dependencies are kept to a minimum (currently only `zod`).
- Dev dependencies are pinned to caret-major ranges and reviewed quarterly.
- `npm audit` is run on every PR; high-severity advisories block merge.

## Supply-chain

- The published npm artifact ships `scripts/`, `references/`, `assets/`,
  `SKILL.md`, `README.md`, `CHANGELOG.md`, and `LICENSE` — see
  `package.json#files`. No `.env`, no `node_modules`, no test fixtures.
- Releases are tagged in git before publish, and the npm package version
  must match the git tag.
