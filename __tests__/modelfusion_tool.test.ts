/**
 * Unit tests for callModelFusion + ModelFusionToolError.
 *
 * No network — all transport is mocked via the `fetchImpl` option.
 */

import {
  callModelFusion,
  ModelFusionToolError,
  FusionRequestSchema,
  FusionResponseSchema,
  DEFAULT_ENDPOINT,
} from "../src/modelfusion_tool";

const validResponse = {
  fusedContent: "The Earth is approximately spherical.",
  analysis: {
    agreement: [{ claim: "Earth is roughly spherical", confidence: 0.97 }],
    conflicts: [],
    partialCoverage: [],
    uniqueInsights: [],
    blindSpots: [],
    agreementScore: 95,
  },
  provenance: {
    "The Earth is approximately spherical.": ["claude-opus-4-6", "deepseek-v3"],
  },
  pipelineStages: ["proposers", "analysis", "synthesis"],
  cost: { totalUSD: 0.0123 },
  modelsUsed: ["claude-opus-4-6", "deepseek-v3", "o1-pro"],
  sessionId: "550e8400-e29b-41d4-a716-446655440000",
  latencyMs: 14_320,
};

function mockOk(body: unknown): typeof fetch {
  return jest.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

function mockStatus(status: number, body: unknown = "", headers: Record<string, string> = {}): typeof fetch {
  return jest.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      statusText: `HTTP ${status}`,
      headers,
    }),
  ) as unknown as typeof fetch;
}

describe("FusionRequestSchema", () => {
  it("applies the general preset by default", () => {
    const parsed = FusionRequestSchema.parse({ prompt: "Hi" });
    expect(parsed.preset).toBe("general");
  });

  it("rejects empty prompts", () => {
    expect(() => FusionRequestSchema.parse({ prompt: "" })).toThrow();
  });

  it("rejects invalid presets", () => {
    expect(() =>
      FusionRequestSchema.parse({ prompt: "x", preset: "bogus" as never }),
    ).toThrow();
  });

  it("rejects too many models", () => {
    expect(() =>
      FusionRequestSchema.parse({
        prompt: "x",
        models: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      }),
    ).toThrow();
  });

  it("accepts a fully specified request", () => {
    const parsed = FusionRequestSchema.parse({
      prompt: "Explain backpressure.",
      preset: "codefusion",
      models: ["claude-opus-4-6", "deepseek-v3"],
      judge: "claude-sonnet-4",
      verify: true,
      temperature: 0.2,
      maxTokens: 2_000,
    });
    expect(parsed.preset).toBe("codefusion");
    expect(parsed.verify).toBe(true);
  });
});

describe("FusionResponseSchema", () => {
  it("accepts a minimal valid payload", () => {
    expect(() => FusionResponseSchema.parse(validResponse)).not.toThrow();
  });

  it("rejects when agreementScore is out of range", () => {
    const bad = {
      ...validResponse,
      analysis: { ...validResponse.analysis, agreementScore: 150 },
    };
    expect(() => FusionResponseSchema.parse(bad)).toThrow();
  });

  it("rejects an invalid conflict severity", () => {
    const bad = {
      ...validResponse,
      analysis: {
        ...validResponse.analysis,
        conflicts: [{ topic: "x", severity: "vibes", positions: {} }],
      },
    };
    expect(() => FusionResponseSchema.parse(bad)).toThrow();
  });

  it("rejects a non-UUID sessionId", () => {
    expect(() =>
      FusionResponseSchema.parse({ ...validResponse, sessionId: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("callModelFusion — happy path", () => {
  it("returns validated response on 200", async () => {
    const fetchImpl = mockOk(validResponse);
    const res = await callModelFusion(
      { prompt: "Is the earth round?" },
      { apiKey: "test-key", fetchImpl },
    );
    expect(res.analysis.agreementScore).toBe(95);
    expect(res.sessionId).toBe(validResponse.sessionId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the default endpoint when none is provided", async () => {
    const fetchImpl = mockOk(validResponse);
    await callModelFusion(
      { prompt: "x" },
      { apiKey: "k", fetchImpl },
    );
    expect((fetchImpl as jest.Mock).mock.calls[0][0]).toBe(DEFAULT_ENDPOINT);
  });

  it("uses the override endpoint when provided", async () => {
    const fetchImpl = mockOk(validResponse);
    const endpoint = "https://internal.example.com/api/fusion";
    await callModelFusion({ prompt: "x" }, { apiKey: "k", endpoint, fetchImpl });
    expect((fetchImpl as jest.Mock).mock.calls[0][0]).toBe(endpoint);
  });

  it("sets bearer auth header", async () => {
    const fetchImpl = mockOk(validResponse);
    await callModelFusion({ prompt: "x" }, { apiKey: "secret-key", fetchImpl });
    const init = (fetchImpl as jest.Mock).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer secret-key");
  });
});

describe("callModelFusion — validation errors", () => {
  it("throws invalid_request on bad input shape", async () => {
    const fetchImpl = mockOk(validResponse);
    await expect(
      callModelFusion({ prompt: "" }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({
      name: "ModelFusionToolError",
      code: "invalid_request",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws missing_api_key on empty key", async () => {
    await expect(
      callModelFusion({ prompt: "hi" }, { apiKey: "" }),
    ).rejects.toMatchObject({ code: "missing_api_key" });
  });

  it("throws missing_api_key on whitespace key", async () => {
    await expect(
      callModelFusion({ prompt: "hi" }, { apiKey: "   " }),
    ).rejects.toMatchObject({ code: "missing_api_key" });
  });
});

describe("callModelFusion — HTTP error classification", () => {
  it("classifies 401 as unauthorized and does not retry", async () => {
    const fetchImpl = mockStatus(401, { error: "bad key" });
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl, maxRetries: 3 }),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies 403 as unauthorized", async () => {
    const fetchImpl = mockStatus(403);
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("classifies 400 as invalid_request and does not retry", async () => {
    const fetchImpl = mockStatus(400, { error: "bad shape" });
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl, maxRetries: 3 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces sessionId from error body when present", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440099";
    const fetchImpl = mockStatus(500, { error: "boom", sessionId });
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: "server_error", sessionId });
  });
});

describe("callModelFusion — retry behavior", () => {
  it("retries on 429 and eventually succeeds", async () => {
    const calls: Array<typeof Response> = [];
    const fetchImpl = jest.fn(async () => {
      calls.push(Response);
      if (calls.length === 1) {
        return new Response("", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify(validResponse), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await callModelFusion(
      { prompt: "x" },
      { apiKey: "k", fetchImpl, maxRetries: 2 },
    );
    expect(res.sessionId).toBe(validResponse.sessionId);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 then 502 then succeeds", async () => {
    let i = 0;
    const fetchImpl = jest.fn(async () => {
      i++;
      if (i === 1) return new Response("", { status: 503 });
      if (i === 2) return new Response("", { status: 502 });
      return new Response(JSON.stringify(validResponse), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await callModelFusion(
      { prompt: "x" },
      { apiKey: "k", fetchImpl, maxRetries: 3 },
    );
    expect(res.sessionId).toBe(validResponse.sessionId);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxRetries with the last error", async () => {
    const fetchImpl = mockStatus(503);
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl, maxRetries: 2 }),
    ).rejects.toMatchObject({ code: "server_error", status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry on non-retryable 422", async () => {
    const fetchImpl = mockStatus(422, { error: "shape" });
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl, maxRetries: 3 }),
    ).rejects.toMatchObject({ code: "invalid_request", status: 422 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("callModelFusion — schema violations", () => {
  it("throws schema_violation when response is invalid JSON", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response("not-json{", { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ code: "schema_violation" });
  });

  it("throws schema_violation when response shape is wrong", async () => {
    const fetchImpl = mockOk({
      ...validResponse,
      analysis: { ...validResponse.analysis, agreementScore: "high" },
    });
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ code: "schema_violation" });
  });

  it("preserves sessionId on schema_violation when present", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440099";
    const fetchImpl = mockOk({
      ...validResponse,
      sessionId,
      analysis: { ...validResponse.analysis, agreementScore: 999 },
    });
    await expect(
      callModelFusion({ prompt: "x" }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ code: "schema_violation", sessionId });
  });
});

describe("callModelFusion — timeout and abort", () => {
  it("aborts on timeout", async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    await expect(
      callModelFusion(
        { prompt: "x" },
        { apiKey: "k", fetchImpl, timeoutMs: 20, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("respects a caller-provided AbortSignal", async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    setTimeout(() => controller.abort(), 10);
    await expect(
      callModelFusion(
        { prompt: "x" },
        { apiKey: "k", fetchImpl, signal: controller.signal, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("callModelFusion — verification flag", () => {
  it("returns verification block when API includes one", async () => {
    const withVerify = {
      ...validResponse,
      pipelineStages: ["proposers", "analysis", "synthesis", "verification"],
      verification: {
        isConsistent: true,
        issues: [],
        overallConfidence: 91,
      },
    };
    const fetchImpl = mockOk(withVerify);
    const res = await callModelFusion(
      { prompt: "x", verify: true },
      { apiKey: "k", fetchImpl },
    );
    expect(res.verification?.isConsistent).toBe(true);
    expect(res.pipelineStages).toContain("verification");
  });
});
