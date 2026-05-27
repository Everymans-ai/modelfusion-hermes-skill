# Contributing

Thanks for your interest in improving `modelfusion-hermes-skill`. Two
constraints make this skill a little stricter than a typical npm package; read
these before opening a PR.

## Constraint 1 — SKILL.md size discipline

The Hermes Skills Hub recommends SKILL.md bodies under **5,000 tokens**. The
full body is loaded into the agent's context every time the skill activates,
so larger bodies dilute attention and inflate per-invocation cost.

When proposing additions to `SKILL.md`:

- If the content is invocation-critical (the agent needs it to *decide* what
  to do), it belongs in the body.
- If the content is reference material (the agent needs it to *do* something
  it already decided to do), it belongs in `references/` and is loaded on
  demand.

When in doubt, put it in `references/` and link from the body.

## Constraint 2 — IP boundary

This skill calls a remote API. It does **not** reimplement the fusion engine.
PRs that try to move the analysis, synthesis, or verification logic into the
SKILL.md procedure or into local code will be declined.

Specifically, do not contribute:

- Exact judge prompts or fragments of them.
- The synthesis algorithm's procedural steps.
- Confidence-scoring calibration details.
- Domain-preset `judgeGuidance` strings.
- Verification-pass prompt text.

These are ModelFusion product internals, kept under deterministic engine
control on the API side. The skill is the transport; the API is the engine.

## PR checklist

- [ ] `npm run verify` passes locally (typecheck + lint + unit tests)
- [ ] If the API contract is involved: `npm run test:e2e:contract` passes
      against a live ModelFusion endpoint
- [ ] `SKILL.md` frontmatter still validates (`hermes skills validate ./SKILL.md`)
- [ ] `description` in SKILL.md is ≤ 60 chars, one sentence, ends with a period,
      no marketing words
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`
- [ ] No new dependencies unless absolutely necessary
- [ ] No proprietary API internals introduced (see "IP boundary" above)

## Local development

```bash
git clone https://github.com/Everymans-ai/modelfusion-hermes-skill.git
cd modelfusion-hermes-skill
npm install
npm run verify
```

For live testing, copy `.env.example` to `.env`, set `MODELFUSION_API_KEY`
(and optionally `MODELFUSION_DEMO_KEY` for the contract tests), then:

```bash
npm run build
echo '{"prompt":"Hello","preset":"general"}' \
  | node scripts/modelfusion-cli.js
```

## Releasing

Maintainers only:

```bash
git checkout main && git pull
npm run verify
npm version patch  # or minor / major
git push origin main --tags
# CI builds and the release workflow publishes to npm + Hub
```
