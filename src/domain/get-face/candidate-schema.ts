import { z } from "zod";
import { matchRequestSchema } from "@/domain/dream-session/match-schema";
import { STORY_MATCH_PROFILE_VERSION } from "./story-match-profiles";

export const CANDIDATE_SCHEMA_VERSION = "1.0.0";
export const CANDIDATE_PROMPT_VERSION = STORY_MATCH_PROFILE_VERSION;

/** The candidate request intentionally reuses the frozen `wish` validation. */
export const candidateRequestSchema = matchRequestSchema;

const cardIdSchema = z.string().min(1).max(160);

export const candidateCardIdsSchema = z
  .tuple([cardIdSchema, cardIdSchema])
  .refine(([first, second]) => first !== second, "两个候选必须是不同故事");

const candidateMetadataSchema = {
  schemaVersion: z.literal(CANDIDATE_SCHEMA_VERSION),
  provider: z.string().min(1),
  promptVersion: z.string().min(1)
} as const;

export const candidateResponseSchema = z.discriminatedUnion("status", [
  z.object({
    ...candidateMetadataSchema,
    status: z.literal("candidates"),
    candidates: candidateCardIdsSchema
  }).strict(),
  z.object({
    ...candidateMetadataSchema,
    status: z.literal("needs_detail")
  }).strict()
]);

export type CandidateRequest = z.infer<typeof candidateRequestSchema>;
export type CandidateResponse = z.infer<typeof candidateResponseSchema>;
export type CandidateSuccessResponse = Extract<CandidateResponse, { status: "candidates" }>;

export function isCandidateSuccess(response: CandidateResponse): response is CandidateSuccessResponse {
  return response.status === "candidates";
}
