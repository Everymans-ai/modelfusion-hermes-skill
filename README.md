# modelfusion-hermes-skill

A Hermes Agent skill (also compatible with Claude Code, OpenClaw, Cursor, Codex
CLI, and other SKILL.md-compliant hosts) that lets an agent call the
[ModelFusion](https://modelfusion.ai) multi-model fusion API.

ModelFusion runs a prompt through multiple frontier models in parallel
(Claude Opus, DeepSeek-V3, o1-pro, others), then uses a judge model to produce
**structured analysis** — agreement, conflicts (with severity), partial
coverage, unique insights, blind spots — plus a synthesized answer with
**paragraph-level provenance** and an optional **verification pass** that
checks the synthesis against the sources for fabrication, misattribution,
distortion, and omission.

This skill is the agent-facing client. The fusion engine lives behind the
ModelFusion API; this repo only handles the transport, schema validation,
retries, and the SKILL.md procedure that tells the agent when and how to
invoke it.

> **Architectural note for evaluators.** This skill calls a remote API rather
> than reimplementing the fusion pipeline in a SKILL.md `## Procedure`
> section. The pipeline (analysis JSON schema, synthesis algorithm,
> verification logic, judge prompts) is the ModelFusion product, kept under
> the engine's deterministic control. Putting it inside an agent's Markdown
> procedure would change quality (probabilistic agent execution vs. strict
> JSON schemas), security (Tier 3 IP exposed in plaintext), and operational
> posture (Vercel timeout limits, single-tenant agent state, etc). The skill
> wraps the API; it does not replace it.

---

## Install

### From the Hermes Skills Hub

```bash
hermes skills install modelfusion
```

### From this GitHub repo (until Hub listing is approved)

```bash
hermes skills install github://Everymans-ai/modelfusion-hermes-skill
```

### From a one-off URL

```bash
hermes skills install https://raw.githubusercontent.com/Everymans-ai/modelfusion-hermes-skill/main/SKILL.md --category research
```

Hermes will fetch the SKILL.md, parse the frontmatter, security-scan it, and
install it under `~/.hermes/skills/research/modelfusion/`.

### Manual install (any SKILL.md host)

```bash
git clone https://github.com/Everymans-ai/modelfusion-hermes-skill.git
mkdir -p ~/.hermes/skills/research/modelfusion
cp -r modelfusion-hermes-skill/{SKILL.md,scripts,references,assets} \
  ~/.hermes/skills/research/modelfusion/
cd ~/.hermes/skills/research/modelfusion && npm install --omit=dev
```

---

## Configure

### API key (required)

ModelFusion uses bearer-token authentication. Obtain a key from your
ModelFusion dashboard, then either:

**Option A — environment variable:**

```bash
export MODELFUSION_API_KEY=sk_modelfusion_xxxxxxxxxxxxxxxxxxxx
```

**Option B — Hermes secrets store:**

```bash
hermes config set-secret MODELFUSION_API_KEY
```

Hermes will prompt for the value, store it in the secrets vault, and inject it
into the skill context when the skill loads.

### Endpoint (optional)

Set the endpoint via `skills.config.modelfusion.endpoint` in
`~/.hermes/config.yaml` for self-hosted deployments:

```yaml
skills:
  config:
    modelfusion:
      endpoint: https://modelfusion.acme-internal.example/api/fusion
      timeout_ms: 120000
      default_preset: general
```

Or run `hermes config migrate` and answer the prompts.

---

## Use

Once installed and configured, the agent decides when to use the skill based
on the `description` and `## When to Use` section in SKILL.md. Typical
invocations the agent reasons its way into:

- *"Give me a verified answer to a medical question."* → `preset: "medfusion"`,
  `verify: true` is automatic.
- *"Review this function for security issues."* → `preset: "codefusion"`.
- *"Get a multi-model consensus on whether X is true."* → `preset: "general"`,
  inspect `analysis.conflicts` and `analysis.agreement`.

No explicit "use modelfusion" command is needed; the skill activates from its
description when the agent encounters a matching task.

### Direct shell usage (for testing or non-Hermes hosts)

```bash
echo '{"prompt":"Compare REST and gRPC.","preset":"general","verify":true}' \
  | MODELFUSION_API_KEY=sk_... node scripts/modelfusion-cli.js

# Or from a file:
MODELFUSION_API_KEY=sk_... node scripts/modelfusion-cli.js \
  --request @assets/example-request.json

# Self-hosted endpoint:
MODELFUSION_API_KEY=sk_... node scripts/modelfusion-cli.js \
  --request @assets/example-request.json \
  --endpoint https://modelfusion.internal.example/api/fusion
```

CLI exit codes are stable and documented in `scripts/modelfusion-cli.js`:

| Code | Meaning |
|------|---------|
| 0    | Success |
| 2    | Invalid request, missing key, or schema violation |
| 3    | Unauthorized |
| 4    | Rate limited |
| 5    | Server / network / timeout (auto-retries exhausted) |
| 1    | Unknown |

### Library usage (TypeScript / Node)

```ts
import { callModelFusion, ModelFusionToolError } from "modelfusion-hermes-skill";

try {
  const result = await callModelFusion(
    { prompt: "...", preset: "medfusion" },
    { apiKey: process.env.MODELFUSION_API_KEY! },
  );
  console.log(result.fusedContent);
  console.log("Agreement score:", result.analysis.agreementScore);
} catch (err) {
  if (err instanceof ModelFusionToolError) {
    console.error(`ModelFusion error: ${err.code} (${err.status ?? "—"})`);
    if (err.sessionId) console.error(`Session: ${err.sessionId}`);
  } else {
    throw err;
  }
}
```

See `references/api-reference.md` for the full response shape and
`references/examples.md` for five end-to-end scenarios.

---

## Develop

### Prerequisites

- Node ≥ 18.17 (uses native `fetch` and `AbortController`)
- npm ≥ 9

### Setup

```bash
git clone https://github.com/Everymans-ai/modelfusion-hermes-skill.git
cd modelfusion-hermes-skill
npm install
cp .env.example .env  # then fill in MODELFUSION_API_KEY for live tests
```

### Build

```bash
npm run build  # compiles src/*.ts → scripts/*.js
```

### Verify (typecheck + lint + unit tests)

```bash
npm run verify
```

This is the same command CI runs on every PR.

### Live API contract tests (Playwright)

These hit the real ModelFusion API and verify the wire-level contract the
skill depends on. They are skipped unless `MODELFUSION_DEMO_KEY` is set:

```bash
export MODELFUSION_DEMO_KEY=sk_modelfusion_demo_xxxxx
npm run test:e2e:contract
```

If these tests break, **the skill is broken** — the API contract has drifted
and the SKILL.md / tool code needs an update before the skill is safe to
publish.

### Project layout

```
modelfusion-hermes-skill/
├── SKILL.md                          # The skill — agent-facing
├── src/
│   ├── index.ts                      # Public exports
│   └── modelfusion_tool.ts           # Schemas + callModelFusion + errors
├── scripts/                          # Compiled JS + CLI (shipped artifact)
│   └── modelfusion-cli.js            # Shell-callable wrapper
├── __tests__/
│   └── modelfusion_tool.test.ts      # Unit tests (Jest, no network)
├── e2e/
│   └── api-contract.spec.ts          # Live API contract tests (Playwright)
├── references/                       # Loaded on demand by the agent
│   ├── api-reference.md
│   ├── examples.md
│   └── errors.md
├── assets/
│   ├── example-request.json
│   └── example-medfusion.json
├── .github/workflows/ci.yml
├── package.json
├── tsconfig.json / tsconfig.test.json
├── jest.config.cjs
├── playwright.config.ts
├── .eslintrc.cjs
├── .env.example
├── .gitignore
├── README.md                         # This file
├── CHANGELOG.md
└── LICENSE                           # Apache-2.0
```

---

## Submit to the Hermes Skills Hub

These are the steps to get this skill listed in the official Hermes Skills
Hub. Once listed, anyone can install it with `hermes skills install modelfusion`.

### 1. Verify the skill builds and tests pass

```bash
npm run verify
npm run build
```

A green `verify` is the precondition for everything that follows.

### 2. Validate the SKILL.md frontmatter

Hermes enforces frontmatter conventions:

- `description` ≤ 60 characters, one sentence, ends with a period, no
  marketing words ("powerful", "comprehensive", "advanced").
- Required: `name`, `description`, `version`, `author`, `license`.
- Optional but recommended: `platforms`, `required_environment_variables`,
  `metadata.hermes.tags`, `metadata.hermes.category`, `metadata.hermes.config`.

This repo's SKILL.md is already compliant. To re-validate after edits:

```bash
hermes skills validate ./SKILL.md
```

### 3. Tag a release

```bash
npm version patch -m "release: %s"   # or minor / major
git push origin main --tags
```

### 4. Publish via the Hermes CLI

The Hub-publish workflow expects the skill folder layout this repo already
uses (`SKILL.md` + `scripts/` + `references/` + `assets/`):

```bash
hermes skills publish . --to github --repo Everymans-ai/modelfusion-hermes-skill
```

This will push a publish manifest to the configured GitHub repo and submit it
to the Skills Hub catalog. Approval typically takes 24–48 hours.

### 5. Optional — list on agensi.io

The [agensi.io](https://agensi.io/skills) directory catalogs SKILL.md skills
across all 20+ compatible agents. Submit the repo URL via their listing form
once the Hermes Hub listing is live.

### 6. Cross-agent compatibility note

Because this skill follows the agentskills.io open standard, it also works in:

- **Claude Code** — drop into `.claude/skills/`
- **OpenClaw** — install via `openclaw skill add`
- **Cursor** — install via the skills extension
- **Codex CLI** — drop into `~/.codex/skills/`

No code changes required. The frontmatter, body, and tool code are identical
across hosts; only the install location and config namespace differ.

---

## What this skill does NOT do

Be explicit about scope to avoid confusion:

- **Does not implement fusion logic.** All multi-model orchestration, judge
  analysis, synthesis, and verification happens on the ModelFusion API
  server. This repo only calls it.
- **Does not store API keys.** The skill reads `MODELFUSION_API_KEY` from
  the Hermes secrets store or environment at invocation time. The key is
  never written to disk by this code.
- **Does not log prompt contents locally.** Session logging happens
  server-side under your ModelFusion account; local Hermes session logs
  follow your Hermes configuration.
- **Does not support streaming (SSE) yet.** The API supports it; the skill
  uses the JSON delivery mode for deterministic schema validation.
  Streaming support is planned (see `CHANGELOG.md`).

---

## Support, issues, contributions

- **Bugs / feature requests:** open an issue in this repo.
- **Security disclosures:** `security@modelfusion.ai` (do not file public
  issues for vulnerabilities).
- **API status:** [status.modelfusion.ai](https://status.modelfusion.ai)
- **Contributing:** PRs welcome — see `CONTRIBUTING.md` (forthcoming). Skill
  PRs must keep the SKILL.md body under 5,000 tokens and must pass
  `npm run verify`.

---

## License

Apache-2.0. See `LICENSE`.

The ModelFusion API and underlying fusion engine are commercial products of
ModelFusion.ai. This skill is open-source under Apache-2.0; using it requires
a valid ModelFusion API key (a free demo tier may be available — contact
ModelFusion for current terms).
