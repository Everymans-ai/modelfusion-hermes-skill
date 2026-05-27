#!/usr/bin/env node
/**
 * modelfusion-cli.js
 *
 * Shell-callable wrapper for SKILL.md procedures that prefer subprocess I/O
 * over an import. Reads a JSON FusionRequest from stdin (or --request flag),
 * writes the FusionResponse JSON to stdout, errors to stderr with a non-zero
 * exit code.
 *
 * Exit codes:
 *   0   success
 *   2   invalid_request / missing_api_key / schema_violation
 *   3   unauthorized
 *   4   rate_limited
 *   5   server_error / network_error / timeout
 *   1   unknown
 *
 * Usage:
 *   echo '{"prompt":"..."}' | MODELFUSION_API_KEY=sk_... node scripts/modelfusion-cli.js
 *   node scripts/modelfusion-cli.js --request '{"prompt":"..."}'
 *   node scripts/modelfusion-cli.js --request @./request.json
 *
 * The --endpoint and --timeout-ms flags override env defaults.
 * The --no-retry flag disables automatic retries.
 */

"use strict";

const fs = require("node:fs");
const { callModelFusion, ModelFusionToolError } = require("./modelfusion_tool.js");

const CODE_TO_EXIT = {
  invalid_request: 2,
  missing_api_key: 2,
  schema_violation: 2,
  unauthorized: 3,
  rate_limited: 4,
  server_error: 5,
  network_error: 5,
  timeout: 5,
  unknown: 1,
};

function parseArgs(argv) {
  const args = { request: null, endpoint: undefined, timeoutMs: undefined, retry: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--request") {
      args.request = argv[++i];
    } else if (a === "--endpoint") {
      args.endpoint = argv[++i];
    } else if (a === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else if (a === "--no-retry") {
      args.retry = false;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "modelfusion-cli — invoke the ModelFusion API from a Hermes Agent skill.",
      "",
      "Usage:",
      "  echo '<request-json>' | node modelfusion-cli.js",
      "  node modelfusion-cli.js --request '<request-json>'",
      "  node modelfusion-cli.js --request @./request.json",
      "",
      "Flags:",
      "  --request <json|@file>   Inline JSON or @path to a JSON file.",
      "  --endpoint <url>         Override endpoint (self-hosted deployments).",
      "  --timeout-ms <n>         Override timeout (default 90000).",
      "  --no-retry               Disable automatic retries.",
      "  -h, --help               Show this help.",
      "",
      "Environment:",
      "  MODELFUSION_API_KEY      Required.",
      "  MODELFUSION_ENDPOINT     Optional default endpoint.",
      "",
    ].join("\n"),
  );
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (buf += chunk));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

function loadRequest(raw) {
  if (!raw) return null;
  let source = raw;
  if (raw.startsWith("@")) {
    const path = raw.slice(1);
    source = fs.readFileSync(path, "utf8");
  }
  try {
    return JSON.parse(source);
  } catch (err) {
    process.stderr.write(`Failed to parse request JSON: ${err.message}\n`);
    process.exit(2);
  }
}

(async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.MODELFUSION_API_KEY;
  if (!apiKey) {
    process.stderr.write("MODELFUSION_API_KEY is not set\n");
    process.exit(2);
  }

  let request = args.request ? loadRequest(args.request) : null;
  if (!request) {
    if (!process.stdin.isTTY) {
      const raw = await readStdin();
      request = loadRequest(raw.trim());
    }
  }
  if (!request) {
    process.stderr.write("No request provided (use --request or pipe JSON via stdin)\n");
    process.exit(2);
  }

  try {
    const response = await callModelFusion(request, {
      apiKey,
      endpoint: args.endpoint ?? process.env.MODELFUSION_ENDPOINT,
      timeoutMs: args.timeoutMs,
      maxRetries: args.retry ? undefined : 0,
    });
    process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    process.exit(0);
  } catch (err) {
    if (err instanceof ModelFusionToolError) {
      const exitCode = CODE_TO_EXIT[err.code] ?? 1;
      const payload = {
        error: err.message,
        code: err.code,
        status: err.status,
        sessionId: err.sessionId,
      };
      process.stderr.write(JSON.stringify(payload) + "\n");
      process.exit(exitCode);
    }
    process.stderr.write(`Unexpected error: ${(err && err.message) || String(err)}\n`);
    process.exit(1);
  }
})();
