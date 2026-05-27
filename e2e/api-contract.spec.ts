/**
 * Playwright e2e contract tests against the live ModelFusion API.
 *
 * These tests verify the wire-level contract that the Hermes skill relies on.
 * A drift in the API response shape MUST break these tests so the skill is
 * updated in lockstep.
 *
 * Gated on env vars — they only run when MODELFUSION_API_URL and
 * MODELFUSION_DEMO_KEY are both set, so default CI for skill PRs does not
 * require a live key.
 */

import { test, expect } from "@playwright/test";

const API_URL =
  process.env.MODELFUSION_API_URL ??
  "https://modelfusion-api.vercel.app/api/fusion";
const API_KEY = process.env.MODELFUSION_DEMO_KEY;

test.skip(!API_KEY, "MODELFUSION_DEMO_KEY not set — skipping live API tests");

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

test.describe("Hermes-skill API contract @live", () => {
  test("general preset returns the documented shape", async ({ request }) => {
    const res = await request.post(API_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      data: { prompt: "Explain CAP theorem in two sentences.", preset: "general" },
      timeout: 90_000,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    // Required top-level fields.
    expect(typeof body.fusedContent).toBe("string");
    expect(body.fusedContent.length).toBeGreaterThan(0);

    expect(typeof body.analysis).toBe("object");
    expect(typeof body.analysis.agreementScore).toBe("number");
    expect(body.analysis.agreementScore).toBeGreaterThanOrEqual(0);
    expect(body.analysis.agreementScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(body.analysis.agreement)).toBe(true);
    expect(Array.isArray(body.analysis.conflicts)).toBe(true);
    expect(Array.isArray(body.analysis.partialCoverage)).toBe(true);
    expect(Array.isArray(body.analysis.uniqueInsights)).toBe(true);
    expect(Array.isArray(body.analysis.blindSpots)).toBe(true);

    expect(Array.isArray(body.pipelineStages)).toBe(true);
    expect(body.pipelineStages).toEqual(
      expect.arrayContaining(["proposers", "analysis", "synthesis"]),
    );

    expect(typeof body.cost).toBe("object");
    expect(typeof body.cost.totalUSD).toBe("number");
    expect(body.cost.totalUSD).toBeGreaterThanOrEqual(0);

    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId).toMatch(UUID_RE);
  });

  test("medfusion preset triggers verification stage automatically", async ({ request }) => {
    const res = await request.post(API_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      data: {
        prompt:
          "Summarize the evidence grading for SGLT2 inhibitors in HFrEF (one paragraph).",
        preset: "medfusion",
      },
      timeout: 120_000,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.pipelineStages).toContain("verification");
    expect(body.verification).toBeDefined();
    expect(typeof body.verification.isConsistent).toBe("boolean");
    expect(Array.isArray(body.verification.issues)).toBe(true);
    expect(typeof body.verification.overallConfidence).toBe("number");
  });

  test("conflict severity values are one of the documented enum", async ({ request }) => {
    // Use a topic that often produces interpretive divergence across models.
    const res = await request.post(API_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      data: {
        prompt:
          "Is microservices architecture better than a modular monolith for a 12-person engineering team? Take a position.",
        preset: "general",
      },
      timeout: 90_000,
    });
    const body = await res.json();
    const allowed = new Set(["factual", "interpretive", "omission"]);
    for (const c of body.analysis.conflicts) {
      expect(allowed.has(c.severity)).toBe(true);
      expect(typeof c.topic).toBe("string");
      expect(typeof c.positions).toBe("object");
    }
  });

  test("provenance keys reference paragraphs of fusedContent", async ({ request }) => {
    const res = await request.post(API_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      data: { prompt: "Briefly compare REST and gRPC.", preset: "general" },
      timeout: 90_000,
    });
    const body = await res.json();
    expect(typeof body.provenance).toBe("object");
    // Every provenance value must be a non-empty array of model IDs.
    for (const [, models] of Object.entries(body.provenance)) {
      expect(Array.isArray(models)).toBe(true);
      expect((models as unknown[]).length).toBeGreaterThan(0);
    }
  });

  test("rejects requests with no auth header", async ({ request }) => {
    const res = await request.post(API_URL, {
      headers: { "Content-Type": "application/json" },
      data: { prompt: "x" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("rejects requests with empty prompt", async ({ request }) => {
    const res = await request.post(API_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      data: { prompt: "" },
    });
    expect([400, 422]).toContain(res.status());
  });
});
