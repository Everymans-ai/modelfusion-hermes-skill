/**
 * modelfusion-hermes-skill — public entrypoint.
 *
 * The skill body in SKILL.md references `./scripts/modelfusion_tool.js`,
 * which is the compiled artifact of `src/modelfusion_tool.ts`. Library
 * consumers (Node/TS projects depending on this package as a module)
 * should import from this file.
 */

export {
  callModelFusion,
  FusionRequestSchema,
  FusionResponseSchema,
  ModelFusionToolError,
  DEFAULT_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
} from "./modelfusion_tool.js";

export type {
  FusionRequest,
  FusionRequestParsed,
  FusionResponse,
  CallOptions,
  ModelFusionErrorCode,
} from "./modelfusion_tool.js";
