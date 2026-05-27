/**
 * modelfusion-hermes-skill
 *
 * Hermes-compatible tool wrapper for the ModelFusion fusion API.
 *
 * The ModelFusion API is the product; this module is a thin, schema-validated
 * client that lets a Hermes Agent skill (or any SKILL.md-compatible host:
 * Claude Code, Cursor, Codex CLI, OpenClaw) invoke ModelFusion from inside
 * an agent loop without touching the underlying HTTP details.
 *
 * No fusion logic lives here. This is transport + validation + retry only.
 */

import { z } from "zod";

// -----------------------------------------------------------------------------
// Schemas — co-published with the API contract so a contract drift breaks
// loudly at parse time rather than silently downstream.
// -----------------------------------------------------------------------------

export const FusionRequestSchema = z.object({
  prompt: z.string().min(1).max(32_000),
  preset: z
    .enum(["general", "medfusion", "legalfusion", "codefusion"])
    .optional()
    .default("general"),
  models: z.array(z.string().min(1)).max(8).optional(),
  judge: z.string().min(1).optional(),
  verify: z.boolean().optional(),
  systemPrompt: z.string().max(8_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(16_000).optional(),
});

const ConflictSchema = z.object({
  topic: z.string(),
  severity: z.enum(["factual", "interpretive", "omission"]),
  positions: z.record(z.string(), z.string()),
});

const AgreementClaimSchema = z.object({
  claim: z.string(),
  confidence: z.number().min(0).max(1),
});

const PartialCoverageSchema = z.object({
  claim: z.string(),
  coveredBy: z.array(z.string()),
  missedBy: z.array(z.string()),
});

const UniqueInsightSchema = z.object({
  claim: z.string(),
  source: z.string(),
  isValuable: z.boolean(),
  rationale: z.string(),
});

const BlindSpotSchema = z.object({
  topic: z.string(),
  resolution: z.string(),
});

const VerificationIssueSchema = z.object({
  kind: z.enum(["fabrication", "misattribution", "omission", "distortion"]),
  severity: z.enum(["minor", "major", "critical"]),
  description: z.string(),
});

export const FusionResponseSchema = z.object({
  fusedContent: z.string().min(1),
  analysis: z.object({
    agreement: z.array(AgreementClaimSchema),
    conflicts: z.array(ConflictSchema),
    partialCoverage: z.array(PartialCoverageSchema),
    uniqueInsights: z.array(UniqueInsightSchema),
    blindSpots: z.array(BlindSpotSchema),
    agreementScore: z.number().min(0).max(100),
  }),
  provenance: z.record(z.string(), z.array(z.string())),
  verification: z
    .object({
      isConsistent: z.boolean(),
      issues: z.array(VerificationIssueSchema),
      overallConfidence: z.number().min(0).max(100),
    })
    .optional(),
  pipelineStages: z.array(z.string()).min(1),
  cost: z.object({
    totalUSD: z.number().nonnegative(),
    perModel: z.record(z.string(), z.number()).optional(),
  }),
  modelsUsed: z.array(z.string()).optional(),
  modelsFailed: z.array(z.string()).optional(),
  sessionId: z.string().uuid(),
  latencyMs: z.number().nonnegative().optional(),
});

export type FusionRequest = z.input<typeof FusionRequestSchema>;
export type FusionRequestParsed = z.output<typeof FusionRequestSchema>;
export type FusionResponse = z.output<typeof FusionResponseSchema>;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export type ModelFusionErrorCode =
  | "invalid_request"
  | "missing_api_key"
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "schema_violation"
  | "network_error"
  | "unknown";

export class ModelFusionToolError extends Error {
  public readonly code: ModelFusionErrorCode;
  public readonly status?: number;
  public readonly sessionId?: string;
  public readonly cause?: unknown;

  constructor(
    message: string,
    code: ModelFusionErrorCode,
    opts: { status?: number; sessionId?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ModelFusionToolError";
    this.code = code;
    this.status = opts.status;
    this.sessionId = opts.sessionId;
    this.cause = opts.cause;
  }
}

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export const DEFAULT_ENDPOINT = "https://modelfusion-api.vercel.app/api/fusion";
export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_USER_AGENT = "modelfusion-hermes-skill/0.1.0";

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

export interface CallOptions {
  /** ModelFusion API key. Required. Loaded from MODELFUSION_API_KEY env in CLI usage. */
  apiKey: string;
  /** Endpoint URL. Override for self-hosted deployments. */
  endpoint?: string;
  /** Per-request timeout. Set ≥ 60s. Default 90s. */
  timeoutMs?: number;
  /** Max retry attempts on retryable errors. Default 2 (3 total attempts). */
  maxRetries?: number;
  /** Custom fetch impl. Defaults to global fetch. Provide for tests or proxy contexts. */
  fetchImpl?: typeof fetch;
  /** Optional User-Agent override. */
  userAgent?: string;
  /** AbortSignal from the caller (e.g. agent cancellation). */
  signal?: AbortSignal;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Call the ModelFusion fusion API and return a strictly-typed, validated response.
 *
 * Throws ModelFusionToolError with a stable `code` for all failure modes.
 * Retries are automatic for 408/429/5xx and network errors, with exponential backoff.
 */
export async function callModelFusion(
  request: FusionRequest,
  opts: CallOptions,
): Promise<FusionResponse> {
  // 1. Validate request shape locally before spending a network call.
  const parsed = FusionRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new ModelFusionToolError(
      `Invalid request: ${parsed.error.message}`,
      "invalid_request",
      { cause: parsed.error },
    );
  }

  if (!opts.apiKey || opts.apiKey.trim().length === 0) {
    throw new ModelFusionToolError(
      "MODELFUSION_API_KEY is required",
      "missing_api_key",
    );
  }

  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  if (typeof fetchImpl !== "function") {
    throw new ModelFusionToolError(
      "No fetch implementation available. Pass opts.fetchImpl on Node < 18.",
      "unknown",
    );
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const localController = new AbortController();
    const timer = setTimeout(() => localController.abort(), timeoutMs);

    // Combine caller's signal with our timeout signal.
    const onCallerAbort = () => localController.abort();
    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer);
        throw new ModelFusionToolError("Request aborted by caller", "timeout");
      }
      opts.signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
          "User-Agent": userAgent,
          Accept: "application/json",
        },
        body: JSON.stringify(parsed.data),
        signal: localController.signal,
      });

      // 2xx → validate and return.
      if (res.ok) {
        let json: unknown;
        try {
          json = await res.json();
        } catch (err) {
          throw new ModelFusionToolError(
            "Response was not valid JSON",
            "schema_violation",
            { status: res.status, cause: err },
          );
        }
        const validated = FusionResponseSchema.safeParse(json);
        if (!validated.success) {
          // Try to surface the sessionId even on schema failure for support.
          const sessionId =
            typeof (json as { sessionId?: unknown })?.sessionId === "string"
              ? (json as { sessionId: string }).sessionId
              : undefined;
          throw new ModelFusionToolError(
            `Response failed schema validation: ${validated.error.message}`,
            "schema_violation",
            { status: res.status, sessionId, cause: validated.error },
          );
        }
        return validated.data;
      }

      // Non-2xx — classify and decide whether to retry.
      const bodyText = await safeReadBody(res);
      const sessionId = tryExtractSessionId(bodyText);
      const code = classifyHttpStatus(res.status);

      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
        lastError = new ModelFusionToolError(
          `Retryable error: ${res.status} ${res.statusText}`,
          code,
          { status: res.status, sessionId },
        );
        await sleep(backoff(attempt, res.headers.get("retry-after")));
        continue;
      }

      throw new ModelFusionToolError(
        `ModelFusion API error: ${res.status} ${res.statusText}${
          bodyText ? ` — ${bodyText.slice(0, 500)}` : ""
        }`,
        code,
        { status: res.status, sessionId },
      );
    } catch (err) {
      // Already a ModelFusionToolError — propagate unless retryable.
      if (err instanceof ModelFusionToolError) {
        if (isRetryable(err) && attempt < maxRetries) {
          lastError = err;
          await sleep(backoff(attempt));
          continue;
        }
        throw err;
      }

      // AbortError — distinguish caller-cancel vs timeout.
      if (isAbortError(err)) {
        if (opts.signal?.aborted) {
          throw new ModelFusionToolError(
            "Request aborted by caller",
            "timeout",
            { cause: err },
          );
        }
        if (attempt < maxRetries) {
          lastError = new ModelFusionToolError(
            `Request timed out after ${timeoutMs}ms`,
            "timeout",
            { cause: err },
          );
          await sleep(backoff(attempt));
          continue;
        }
        throw new ModelFusionToolError(
          `Request timed out after ${timeoutMs}ms`,
          "timeout",
          { cause: err },
        );
      }

      // Network/DNS/etc.
      if (attempt < maxRetries) {
        lastError = err;
        await sleep(backoff(attempt));
        continue;
      }
      throw new ModelFusionToolError(
        `Network error calling ModelFusion: ${(err as Error).message ?? String(err)}`,
        "network_error",
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onCallerAbort);
    }
  }

  // Exhausted retries.
  if (lastError instanceof ModelFusionToolError) throw lastError;
  throw new ModelFusionToolError(
    "Exhausted retries calling ModelFusion",
    "unknown",
    { cause: lastError },
  );
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function classifyHttpStatus(status: number): ModelFusionErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server_error";
  if (status >= 400) return "invalid_request";
  return "unknown";
}

function isRetryable(err: ModelFusionToolError): boolean {
  return (
    err.code === "rate_limited" ||
    err.code === "server_error" ||
    err.code === "timeout" ||
    err.code === "network_error"
  );
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR")
  );
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function tryExtractSessionId(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { sessionId?: unknown };
    if (typeof parsed.sessionId === "string") return parsed.sessionId;
  } catch {
    /* swallow — not JSON */
  }
  return undefined;
}

function backoff(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 30_000);
  }
  // Exponential with jitter, capped at 8s.
  const exp = BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * BASE_BACKOFF_MS;
  return Math.min(exp + jitter, 8_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
