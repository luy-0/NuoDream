import { z } from "zod";

export const matchRequestSchema = z.object({
  wish: z.string().trim().min(2, "请至少写下两个字").max(280, "愿望请控制在 280 字以内")
}).strict();

export const matchResponseSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  cardId: z.string().min(1),
  provider: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1)
}).strict();

export type MatchRequest = z.infer<typeof matchRequestSchema>;
export type MatchResponse = z.infer<typeof matchResponseSchema>;

/**
 * Match metadata for a story the user picked from two candidates. It carries
 * no `confidence`: a model probability must never be re-labelled as the
 * user's certainty. Downstream code only needs `cardId`.
 */
export const chosenMatchSchema = z.object({
  schemaVersion: z.literal("2.0.0"),
  cardId: z.string().min(1),
  provider: z.string().min(1),
  reason: z.string().min(1)
}).strict();

export type ChosenMatch = z.infer<typeof chosenMatchSchema>;

/** Reads both the frozen single-story match and a user-chosen match. */
export const dreamSessionMatchSchema = z.union([matchResponseSchema, chosenMatchSchema]);
export type DreamSessionMatch = z.infer<typeof dreamSessionMatchSchema>;
