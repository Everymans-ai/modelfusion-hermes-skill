# Error Handling Reference

Every error thrown by `callModelFusion` is an instance of `ModelFusionToolError`
with a stable `code` field. Agents should branch on `code`, not on
`message` (the message is informational and may change between versions).

## Error codes

| `code` | `status` | Meaning | Agent should |
|--------|----------|---------|--------------|
| `invalid_request` | 400 / 422 / undefined | Request shape or content rejected. | Inspect `message`, fix and re-emit. Do not retry. |
| `missing_api_key` | undefined | `MODELFUSION_API_KEY` not set or empty. | Prompt user to configure `skills.config.modelfusion` or set the env var. |
| `unauthorized` | 401 / 403 | API key invalid, revoked, or lacks permission. | Surface to user; do not retry. |
| `rate_limited` | 429 | Per-key or per-tenant rate limit exceeded. | The tool already retries with `Retry-After` honored. If the final error reaches the agent, back off for a longer interval (minutes). |
| `server_error` | 500 / 502 / 503 | ModelFusion or an upstream model provider failed. | Retried automatically. On final failure, surface `sessionId` if present and try again later. |
| `timeout` | 408 / 504 / undefined | Local timeout or upstream timeout. | Retried automatically. If persistent, raise `timeoutMs`. |
| `schema_violation` | 200 (with bad body) | Response did not match the documented schema. | **Do not trust the response.** Likely an API/version drift; check release notes. |
| `network_error` | undefined | DNS, connection refused, TLS, etc. | Retried automatically. On final failure, surface to user. |
| `unknown` | varies | Unclassified failure. | Treat as transient on first occurrence; surface on repeat. |

## Reading `sessionId` from errors

When the request reached ModelFusion's session-logging layer before failing,
the error will carry a `sessionId` field. **Always include this in any user-
facing error message** so the user (or downstream support) can correlate with
the server-side log:

```ts
try {
  const result = await callModelFusion(req, { apiKey });
} catch (err) {
  if (err instanceof ModelFusionToolError) {
    const handle = err.sessionId ? ` (session ${err.sessionId})` : "";
    return `ModelFusion call failed: ${err.code}${handle}`;
  }
  throw err;
}
```

## When NOT to retry

The tool retries automatically on `429`, `5xx`, `timeout`, and `network_error`
with exponential backoff and jitter. The agent should **never** wrap the call
in its own retry loop for these codes — it will multiply load against an
already-strained service.

The agent **should** consider retrying (after a long pause, e.g. minutes):

- `rate_limited` reaching the agent (means even the retries failed — system is
  hot, back off).
- `server_error` reaching the agent after the auto-retries (likely an active
  incident — back off and surface).

The agent should **never** retry:

- `invalid_request` — the request is wrong; retrying won't fix it.
- `unauthorized` — the credential is wrong; retrying won't fix it.
- `schema_violation` — there is an active API contract drift; retrying will
  produce the same broken response.

## Distinguishing solo fallback from total failure

A "solo fallback" is a **success** at the transport layer — the response is
200 — but the analysis stages were skipped because only one model returned.
Detect it by inspecting the response, not by catching an error:

```ts
const result = await callModelFusion(req, { apiKey });
const isSoloFallback =
  !result.pipelineStages.includes("analysis") &&
  (result.modelsUsed?.length ?? 0) === 1;

if (isSoloFallback) {
  // Treat the answer as a single-model answer, not as a fused answer.
}
```
