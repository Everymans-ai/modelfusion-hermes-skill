# ModelFusion API Reference (skill-relevant subset)

This file documents the request/response surface the Hermes skill depends on.
The canonical and complete specification lives at
`https://docs.modelfusion.ai/api` and on the ModelFusion partner portal.
This file is the agent-facing subset the SKILL.md may load on demand.

## Endpoint

`POST {endpoint}` — defaults to `https://modelfusion-api.vercel.app/api/fusion`.
Override for self-hosted deployments via the `endpoint` skill config or the
`MODELFUSION_ENDPOINT` environment variable.

## Authentication

`Authorization: Bearer <MODELFUSION_API_KEY>`

API keys are per-tenant, per-purpose, with rate limits and budget enforcement
recorded on the server side.

## Request

```jsonc
{
  "prompt": "The user-facing question. Required. 1–32,000 characters.",
  "preset": "general | medfusion | legalfusion | codefusion",
  "models": ["claude-opus-4-6", "deepseek-v3", "o1-pro"],
  "judge": "claude-sonnet-4",
  "verify": true,
  "systemPrompt": "Optional override of the preset's system prompt.",
  "temperature": 0.2,
  "maxTokens": 2000
}
```

- `preset` — selects the domain-tuned system prompt and the analytical focus
  applied during the analysis stage. `medfusion` and `legalfusion` auto-enable
  `verify`.
- `models` — explicit proposer pool. Omit for the deployment default.
- `judge` — overrides the default judge model. The judge runs Stage 2
  (analysis), Stage 3 (synthesis), and optionally Stage 4 (verification).
- `verify` — enables the verification pass. Auto-enabled for `medfusion` and
  `legalfusion` regardless of the flag.

## Response (200)

```jsonc
{
  "fusedContent": "The synthesized answer as a string.",

  "analysis": {
    "agreement": [
      { "claim": "A claim all models substantively share.", "confidence": 0.92 }
    ],
    "conflicts": [
      {
        "topic": "Concise description of the disputed point.",
        "severity": "factual | interpretive | omission",
        "positions": {
          "claude-opus-4-6": "What this model said.",
          "deepseek-v3":     "What this model said.",
          "o1-pro":          "What this model said."
        }
      }
    ],
    "partialCoverage": [
      {
        "claim": "Covered by some, missed by others.",
        "coveredBy": ["claude-opus-4-6"],
        "missedBy":  ["deepseek-v3", "o1-pro"]
      }
    ],
    "uniqueInsights": [
      {
        "claim": "An insight only one model raised.",
        "source": "claude-opus-4-6",
        "isValuable": true,
        "rationale": "Why the judge classified this as valuable or not."
      }
    ],
    "blindSpots": [
      {
        "topic": "What every model missed.",
        "resolution": "Suggested direction to address it."
      }
    ],
    "agreementScore": 87
  },

  "provenance": {
    "Paragraph text of fusedContent.": ["claude-opus-4-6", "deepseek-v3"]
  },

  "verification": {
    "isConsistent": true,
    "issues": [
      {
        "kind": "fabrication | misattribution | omission | distortion",
        "severity": "minor | major | critical",
        "description": "Plain-language description."
      }
    ],
    "overallConfidence": 91
  },

  "pipelineStages": ["proposers", "analysis", "synthesis", "verification"],
  "modelsUsed": ["claude-opus-4-6", "deepseek-v3", "o1-pro"],
  "modelsFailed": [],
  "cost": {
    "totalUSD": 0.0234,
    "perModel": {
      "claude-opus-4-6": 0.0091,
      "deepseek-v3":     0.0012,
      "o1-pro":          0.0078,
      "claude-sonnet-4": 0.0053
    }
  },
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "latencyMs": 14320
}
```

### Field semantics

- `agreementScore` — 0–100, weighted by claim importance, not raw count. A high
  score with non-empty `conflicts` of `severity: "factual"` is meaningful:
  models agreed broadly but disagreed on a specific fact.
- `confidence` (per agreement claim) — 0.0–1.0, reflecting substantive overlap
  depth across the source responses. Surface coincidence scores lower than
  independent reasoning to the same conclusion.
- `severity` (per conflict):
  - `factual` — models stated opposing facts.
  - `interpretive` — models drew different conclusions from the same facts.
  - `omission` — one model asserted what another denied or ignored.
- `isValuable` (per unique insight) — judge's classification of whether the
  insight adds depth or is a tangent.
- `provenance` — keys are paragraph strings extracted from `fusedContent`;
  values are arrays of source model IDs that contributed to that paragraph.
- `verification.isConsistent` — `false` means the synthesis introduced material
  not supported by any source response or the blind-spots analysis. Treat this
  as a signal to surface the issues to the user, not a reason to discard the
  synthesis silently.

## Error responses

All error responses share this shape where possible:

```jsonc
{
  "error": "Human-readable message.",
  "code": "stable_error_code",
  "sessionId": "uuid-if-the-request-reached-session-logging"
}
```

| Status | Meaning | Retryable? |
|--------|---------|------------|
| 400    | Malformed request | No |
| 401    | Missing/invalid API key | No |
| 403    | API key valid but lacks permission for this preset/model | No |
| 422    | Request validates but semantically rejected (e.g. budget exceeded) | No |
| 429    | Rate limited (per-key or per-tenant) | Yes, honor `Retry-After` |
| 500    | Server error | Yes |
| 502    | Upstream model provider error | Yes |
| 503    | Service unavailable / partial outage | Yes |
| 504    | Upstream timeout | Yes |

The `callModelFusion` tool implements exponential backoff with jitter on
retryable codes and honors `Retry-After` when present.

## Graceful degradation

If proposers partially fail (e.g. one of three returned an error), the engine
proceeds with the survivors. If only one model survived, a **solo fallback**
returns that model's content directly, without running the analysis/synthesis
stages, with `pipelineStages: ["proposers"]` and a `blindSpots[]` entry
describing the degradation. If all models fail, the engine returns 503.

The tool surfaces this transparently — check `modelsFailed` and
`pipelineStages` to detect partial degradation.

## Self-hosted deployments

Self-hosted (air-gapped Docker, customer VPC, Ollama or vLLM-backed) ModelFusion
deployments expose the **same API contract**. Set the `endpoint` skill config
to the customer's URL; everything else (request/response shape, error codes,
preset names) is identical.
