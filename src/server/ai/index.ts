import { createFallbackCandidateProvider } from "./candidate-provider";
import { deterministicCandidateProvider } from "./deterministic-candidate-provider";
import { createJevCandidateProvider } from "./jev-candidate-provider";

export { deterministicDreamProvider as dreamAiProvider } from "./deterministic-provider";
export type { DreamAiProvider, DreamAiProviderId } from "./provider";
export {
  CANDIDATE_PROVIDER_TIMEOUT_MS,
  CandidateProviderTimeoutError,
  createFallbackCandidateProvider,
  validateCandidateSelection,
  withTimeout
} from "./candidate-provider";
export type {
  CandidateProviderAuditEvent,
  CandidateProviderId,
  CandidateProviderLogger,
  CandidateProviderOptions,
  DreamCandidateProvider,
  FallbackCandidateProviderOptions
} from "./candidate-provider";
export {
  createDeterministicCandidateProvider,
  deterministicCandidateProvider,
  rankStoryMatchProfiles,
  selectLocalCandidateProfiles
} from "./deterministic-candidate-provider";
export type { RankedStoryMatchProfile } from "./deterministic-candidate-provider";
export {
  CANDIDATE_INSTRUCTIONS,
  JEV_DECISIONS_URL,
  JEV_MAX_RESPONSE_BYTES,
  JEV_MODEL,
  JEV_PROVIDER_ID,
  JEV_TIMEOUT_MS,
  JEV_TOTAL_TIMEOUT_MS,
  JevCandidateProviderError,
  OPENROUTER_KEY_ENV,
  buildJevDecisionRequest,
  createJevCandidateProvider,
  parseJevDecision,
  readOpenRouterJevKey,
  selectCandidatesFromDecision
} from "./jev-candidate-provider";
export type {
  JevCandidateProviderOptions,
  JevDecisionRequest,
  JevFailureReason,
  JevRoundAuditEvent,
  RankedJevDecision
} from "./jev-candidate-provider";
export { deepseekOmenProvider, generateOmen } from "./omen-provider";
export type { OmenContext } from "./omen-provider";

/**
 * Production wiring: the fixed Jev model ranks the eight options, and every
 * failure path degrades to the local deterministic rule with a marked
 * `provider`. No key is read until a request is actually made.
 */
export const dreamCandidateProvider = createFallbackCandidateProvider(
  createJevCandidateProvider(),
  deterministicCandidateProvider
);
