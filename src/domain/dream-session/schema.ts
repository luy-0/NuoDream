import { z } from "zod";
import { interpretationSchema } from "@/domain/interpretation";
import { dreamSessionMatchSchema } from "./match-schema";

const candidateCardIdsSchema = z
  .tuple([z.string().min(1), z.string().min(1)])
  .refine(([first, second]) => first !== second, "两个候选必须是不同故事");

/**
 * Versioned record of "the user picked this story out of two candidates".
 * Deliberately independent from the legacy `match.confidence` field.
 */
export const dreamSessionSelectionSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  kind: z.literal("user-choice"),
  candidateCardIds: candidateCardIdsSchema,
  chosenCardId: z.string().min(1),
  provider: z.string().min(1),
  promptVersion: z.string().min(1)
}).strict().superRefine((value, context) => {
  if (!value.candidateCardIds.includes(value.chosenCardId)) {
    context.addIssue({ code: "custom", path: ["chosenCardId"], message: "选择的故事必须来自本次候选列表" });
  }
});

export type DreamSessionSelection = z.infer<typeof dreamSessionSelectionSchema>;

export const dreamSessionSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  sessionId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: z.enum(["matched", "dream-completed", "interpreted"]),
  wish: z.string().min(2).max(280),
  match: dreamSessionMatchSchema,
  // Optional so sessions written before candidate choice keep parsing.
  selection: dreamSessionSelectionSchema.nullable().optional(),
  playback: z.object({
    completedAt: z.string().datetime().nullable()
  }).strict(),
  interpretation: interpretationSchema.nullable()
}).strict().superRefine((value, context) => {
  if (value.selection && value.selection.chosenCardId !== value.match.cardId) {
    context.addIssue({ code: "custom", path: ["selection", "chosenCardId"], message: "选择记录必须与最终故事一致" });
  }
});

export type DreamSession = z.infer<typeof dreamSessionSchema>;

export function createDreamSession(wish: string, match: z.infer<typeof dreamSessionMatchSchema>, now = new Date()): DreamSession {
  const timestamp = now.toISOString();
  return dreamSessionSchema.parse({
    schemaVersion: "1.0.0",
    sessionId: globalThis.crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "matched",
    wish,
    match,
    selection: null,
    playback: { completedAt: null },
    interpretation: null
  });
}

export interface ChosenStoryInput {
  cardId: string;
  candidateCardIds: [string, string];
  provider: string;
  promptVersion: string;
}

/**
 * Creates the final session only after the user has chosen one of the two
 * candidates. The match keeps the single `cardId` downstream code needs, and
 * the selection metadata records where that story came from.
 */
export function createChosenDreamSession(wish: string, choice: ChosenStoryInput, now = new Date()): DreamSession {
  const timestamp = now.toISOString();
  return dreamSessionSchema.parse({
    schemaVersion: "1.0.0",
    sessionId: globalThis.crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "matched",
    wish,
    match: {
      schemaVersion: "2.0.0",
      cardId: choice.cardId,
      provider: choice.provider,
      reason: "你从两面候选中选定了这一场。"
    },
    selection: {
      schemaVersion: "1.0.0",
      kind: "user-choice",
      candidateCardIds: choice.candidateCardIds,
      chosenCardId: choice.cardId,
      provider: choice.provider,
      promptVersion: choice.promptVersion
    },
    playback: { completedAt: null },
    interpretation: null
  });
}
