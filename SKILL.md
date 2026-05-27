---
name: modelfusion
description: Run a prompt through the ModelFusion multi-model fusion API.
version: 0.1.0
author: ModelFusion (https://modelfusion.ai)
license: Apache-2.0
platforms: [linux, macos, windows]
required_environment_variables:
  - MODELFUSION_API_KEY
metadata:
  hermes:
    tags: [llm, reliability, multi-model, verification, fusion, api]
    category: research
    related_skills: []
    config:
      endpoint:
        description: ModelFusion API endpoint. Override for self-hosted deployments.
        default: https://modelfusion-api.vercel.app/api/fusion
      timeout_ms:
        description: Per-request timeout in milliseconds.
        default: 90000
      default_preset:
        description: Domain preset applied when none is specified per call.
        default: general
---

## When to Use

Use this skill when the agent needs a verified, multi-model answer instead of a single-model completion. Specifically:

- The prompt is high-stakes (medical, legal, code review, regulated decisions) and a single-model answer is insufficient.
- The agent needs **structured analysis** — explicit agreement, conflicts, partial coverage, unique insights, and blind spots — not just synthesized prose.
- The downstream consumer requires **paragraph-level provenance** (which source model contributed which claim).
- A domain preset (`medfusion`, `legalfusion`, `codefusion`) matches the task.
- The agent must surface a **verification pass** that checks the synthesized answer against the source responses for fabrication, misattribution, distortion, or omission.

Do **not** use this skill for:

- Quick chat-style answers where a single model is adequate.
- Streaming token-by-token output (the API supports SSE separately; this skill targets the JSON delivery mode).
- Agent scratchpad / chain-of-thought routing. Pass the user-facing question, not internal reasoning.

## Quick Reference

```ts
import { callModelFusion } from "./scripts/modelfusion_tool.js";

const result = await callModelFusion(
  {
    prompt: "Summarize the evidence for SGLT2 inhibitors in HFrEF.",
    preset: "medfusion",
    verify: true,
  },
  { apiKey: process.env.MODELFUSION_API_KEY },
);

console.log(result.fusedContent);
console.log("Agreement score:", result.analysis.agreementScore);
console.log("Conflicts:", result.analysis.conflicts);
if (result.verification && !result.verification.isConsistent) {
  console.warn("Verification flagged issues:", result.verification.issues);
}
```

Response shape (key fields):

- `fusedContent` — the synthesized answer.
- `analysis.agreementScore` — 0–100, weighted by claim importance.
- `analysis.agreement` — array of `{ claim, confidence }` (confidence 0.0–1.0).
- `analysis.conflicts` — array with `severity: "factual" | "interpretive" | "omission"` and each model's position.
- `analysis.partialCoverage`, `analysis.uniqueInsights`, `analysis.blindSpots` — see `references/api-reference.md`.
- `provenance` — map of synthesized paragraph → contributing source model IDs.
- `verification` — present when `verify: true` or preset is `medfusion`/`legalfusion`. Contains `isConsistent`, `issues[]`, `overallConfidence`.
- `pipelineStages` — ordered list of stages executed (`proposers`, `analysis`, `synthesis`, `verification?`).
- `sessionId` — UUID. Log this; it is the audit handle for the request.
- `cost.totalUSD` — total cost across all model calls in the request.

## Procedure

1. **Read inputs.** Extract the user-facing question. Strip any agent scratchpad, prior tool output, or chain-of-thought before constructing the prompt.

2. **Select a preset.** If the task is medical, set `preset: "medfusion"`. If legal, `"legalfusion"`. If code review or generation, `"codefusion"`. Otherwise omit (defaults to `general`). The preset determines both the system prompt sent to proposers and the analytical focus of the judge.

3. **Decide on verification.** Set `verify: true` when the answer will be presented to a human as authoritative. The `medfusion` and `legalfusion` presets enable it automatically. Skipping verification saves ~1 judge call but removes the fabrication check.

4. **Decide on model pool.** Omit `models` to use the deployment default (cost-balanced). Pass an explicit array when budget or quality requires it. Smaller pools are cheaper and faster; larger pools yield richer analysis.

5. **Call `callModelFusion`.** The function returns a strictly-typed, schema-validated response or throws `ModelFusionToolError`. Set timeout to 90s minimum — fusion latency is typically 10–30s but can spike under model provider slowness.

6. **Inspect `analysis.conflicts` first.** A non-empty `severity: "factual"` array means the source models disagreed on a fact. Surface this to the user rather than presenting the synthesis as settled.

7. **Inspect `verification` if present.** `verification.isConsistent === false` means the synthesis introduced material the sources did not support. Show the issues, not just the synthesis.

8. **Use `fusedContent` as the answer.** Cite `provenance` if the downstream context requires source attribution.

9. **Log `sessionId`.** Any user-facing audit trail should include it. The session can be retrieved later from the ModelFusion session log.

## Pitfalls

- **Do not pass agent scratchpad as `prompt`.** The fusion engine treats `prompt` as the user-facing question. Internal chain-of-thought corrupts the proposers and skews the analysis.
- **Do not set timeout below 60s.** Fusion is a multi-call pipeline. Aggressive timeouts will spuriously abort otherwise-successful requests.
- **Do not retry on 4xx.** A `400`, `401`, `403`, `404`, or `422` means the request shape, key, or session is wrong. Retrying will not fix it. Retry only on `429`, `5xx`, or network errors, with exponential backoff.
- **Do not assume the synthesis is correct because all models agreed.** Use `verification.isConsistent` — high agreement with low verification confidence means the models share a blind spot or a common error.
- **Do not log `prompt` content unencrypted in shared logs** if your task involves PII, PHI, or privileged information. The ModelFusion server logs to your session record under your API key; your agent host's local logs are your responsibility.
- **Cost is per request, not per token at the skill boundary.** A `verify: true` request with four proposers and a verification pass can run 5–7 model calls. Budget accordingly with `models: ["deepseek-v3", "claude-sonnet-4"]` for low-stakes flows.
- **Self-hosted endpoints require the `endpoint` config override.** Air-gapped ModelFusion deployments use the same API contract but at a different URL. Set `skills.config.modelfusion.endpoint` in `config.yaml`.

## Verification

A successful call must satisfy all of:

- `response.pipelineStages` includes `"proposers"`, `"analysis"`, `"synthesis"`.
- `response.sessionId` matches `^[0-9a-fA-F-]{36}$`.
- `response.analysis.agreementScore` is a number in `[0, 100]`.
- `response.fusedContent` is a non-empty string.
- When `verify: true` (or preset is `medfusion`/`legalfusion`): `response.pipelineStages` also contains `"verification"` and `response.verification` is present with `isConsistent: boolean`.

If any of these fail, do not trust the response. Treat as a transport-level failure and surface the `sessionId` (if present) to the user for support.

For the complete API surface — including streaming mode, custom presets, and adapter configuration — see `references/api-reference.md`.
