# ModelFusion Skill — Invocation Examples

Five end-to-end examples covering the situations a Hermes agent most often
encounters. Each example shows the request, the response shape to expect, and
how the agent should reason about the result.

## 1. General fusion — broad question

**Use case:** the agent needs a verified answer to a question that doesn't fit
a domain preset.

```ts
const result = await callModelFusion(
  { prompt: "What are the main trade-offs of using gRPC instead of REST?" },
  { apiKey: process.env.MODELFUSION_API_KEY! },
);
```

**What the agent does with the response:**

1. Check `result.analysis.conflicts` — if any are `severity: "factual"`,
   surface them rather than presenting the synthesis as settled.
2. Use `result.fusedContent` as the answer.
3. Optionally show `result.analysis.agreementScore` to the user as a
   confidence signal.

## 2. MedFusion preset — high-stakes medical question

**Use case:** a regulated-domain question where fabrication is the dominant
failure mode. Verification is auto-enabled.

```ts
const result = await callModelFusion(
  {
    prompt:
      "Summarize the current evidence grading for SGLT2 inhibitors in heart failure with reduced ejection fraction. Include guideline source.",
    preset: "medfusion",
  },
  { apiKey: process.env.MODELFUSION_API_KEY! },
);
```

**Expected behavior:**

- `result.pipelineStages` will contain `"verification"`.
- `result.verification.isConsistent` should be checked **before** presenting
  the synthesis.
- If `verification.isConsistent === false`, list `verification.issues[]` to
  the user instead of (or alongside) `fusedContent`.

## 3. CodeFusion preset — code review

**Use case:** the agent is reviewing or generating production code and needs
multiple models to catch syntax, security, and design issues independently.

```ts
const result = await callModelFusion(
  {
    prompt: `Review this function for correctness, security, and idiom:

function loginUser(email, password) {
  const sql = "SELECT * FROM users WHERE email = '" + email + "' AND password = '" + password + "'";
  return db.query(sql);
}`,
    preset: "codefusion",
    verify: true,
  },
  { apiKey: process.env.MODELFUSION_API_KEY! },
);
```

**Expected behavior:**

- `analysis.agreement` should contain the SQL-injection finding with high
  confidence (multiple models will independently surface it).
- `analysis.uniqueInsights` may contain one model's mention of password
  hashing if other models focused on injection.
- Use `analysis.blindSpots` to check for issues no model addressed (rate
  limiting, audit logging, etc).

## 4. Cost-budgeted fusion — small model pool

**Use case:** the task is low-stakes and the agent is operating under a budget
cap. Restricting the pool to two models cuts cost.

```ts
const result = await callModelFusion(
  {
    prompt: "Summarize this paragraph in two sentences: …",
    models: ["deepseek-v3", "claude-sonnet-4"],
    verify: false,
  },
  { apiKey: process.env.MODELFUSION_API_KEY! },
);
```

**Trade-off:** smaller pool → fewer analysis signals. With only two proposers,
`agreement` and `uniqueInsights` are less informative. Use this mode for
summarization, not for high-stakes synthesis.

## 5. Self-hosted endpoint — enterprise deployment

**Use case:** the agent is running inside a customer's security perimeter
against a self-hosted ModelFusion instance.

```ts
const result = await callModelFusion(
  { prompt: "…" },
  {
    apiKey: process.env.MODELFUSION_API_KEY!,
    endpoint: "https://modelfusion.acme-internal.example/api/fusion",
  },
);
```

**No other code changes required.** The API contract is identical between the
hosted SaaS and self-hosted deployments. The skill config's `endpoint` value
is the only customer-specific switch.

## Handling partial degradation

If a proposer fails mid-request, the response will show it:

```ts
if (result.modelsFailed && result.modelsFailed.length > 0) {
  console.warn(
    `Fusion proceeded with ${result.modelsUsed?.length ?? 0} models; ` +
    `${result.modelsFailed.length} failed: ${result.modelsFailed.join(", ")}`,
  );
}

if (!result.pipelineStages.includes("analysis")) {
  // Solo fallback — only one model returned. fusedContent is that model's
  // raw output. analysis fields will be empty/minimal.
  console.warn("Solo fallback active — analysis stage was skipped");
}
```

## Surfacing audit detail to the user

For audit-sensitive workflows, include the session ID and a one-line
confidence summary in the agent's final message to the user:

```
[ModelFusion session 550e8400-e29b-41d4-a716-446655440000]
Agreement: 87/100  ·  Verification: pass (91%)  ·  Conflicts: 0 factual, 1 interpretive
```

This gives the downstream auditor a handle to retrieve the full session log
from ModelFusion later.
