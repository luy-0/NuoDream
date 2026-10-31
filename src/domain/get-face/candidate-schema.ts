import { z } from "zod";
import { matchRequestSchema } from "@/domain/dream-session/match-schema";
import { STORY_MATCH_PROFILE_VERSION } from "./story-match-profiles";

export const CANDIDATE_SCHEMA_VERSION = "1.1.0";
export const CANDIDATE_PROMPT_VERSION = STORY_MATCH_PROFILE_VERSION;

/** The candidate request intentionally reuses the frozen `wish` validation. */
export const candidateRequestSchema = matchRequestSchema;

const cardIdSchema = z.string().min(1).max(160);

export const candidateCardIdsSchema = z
  .tuple([cardIdSchema, cardIdSchema])
  .refine(([first, second]) => first !== second, "两个候选必须是不同故事");

const candidateScoreSchema = z.object({
  /** Raw Jev probability for that round; never normalized or rounded. */
  probability: z.number().finite().min(0).max(1),
  round: z.union([z.literal(1), z.literal(2)])
}).strict();

/**
 * Position-aligned with `candidates`. The first candidate always comes from
 * round one; the second is either the same-round runner-up or a second-round
 * answer. Scores from different rounds are not comparable, hence `round`.
 */
export const candidateScoresSchema = z
  .tuple([
    candidateScoreSchema.extend({ round: z.literal(1) }).strict(),
    candidateScoreSchema
  ])
  .refine(([first, second]) => first.round === 1 && (second.round === 1 || second.round === 2), "第二项得分必须来自第一或第二轮");

const candidateMetadataSchema = {
  schemaVersion: z.literal(CANDIDATE_SCHEMA_VERSION),
  provider: z.string().min(1),
  promptVersion: z.string().min(1)
} as const;

export const candidateResponseSchema = z.discriminatedUnion("status", [
  z.object({
    ...candidateMetadataSchema,
    status: z.literal("candidates"),
    candidates: candidateCardIdsSchema,
    // null for the local deterministic rule and every degraded response.
    candidateScores: candidateScoresSchema.nullable()
  }).strict(),
  z.object({
    ...candidateMetadataSchema,
    status: z.literal("needs_detail")
  }).strict()
]);

export type CandidateRequest = z.infer<typeof candidateRequestSchema>;
export type CandidateResponse = z.infer<typeof candidateResponseSchema>;
export type CandidateSuccessResponse = Extract<CandidateResponse, { status: "candidates" }>;
export type CandidateScore = z.infer<typeof candidateScoreSchema>;
export type CandidateScores = z.infer<typeof candidateScoresSchema>;

export function isCandidateSuccess(response: CandidateResponse): response is CandidateSuccessResponse {
  return response.status === "candidates";
}
