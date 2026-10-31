import { z } from "zod";
import { resolveChoiceCards } from "./choice-cards";
import { getRitualStoryMask, ritualMaskIndex } from "./ritual-story-masks";
import { readLegacyGetFaceRitualSession, LEGACY_RITUAL_STORAGE_KEY } from "./session-legacy-v2";

export const getFaceRitualPhaseSchema = z.enum(["name", "wish", "matching", "choosing", "mask", "wearing", "complete"]);
export type GetFaceRitualPhase = z.infer<typeof getFaceRitualPhaseSchema>;

export const GET_FACE_RITUAL_SCHEMA_VERSION = "3.0.0";

const cardIdSchema = z.string().min(1).max(160);

const candidateCardIdsSchema = z
  .tuple([cardIdSchema, cardIdSchema])
  .refine(([first, second]) => first !== second, "两个候选必须是不同故事");

/** Where the two candidates came from, so a refresh keeps the real source. */
export interface GetFaceRitualCandidateSource {
  provider: string;
  promptVersion: string;
}

const candidateSourceSchema = z.object({
  provider: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(120)
}).strict();

/**
 * The persisted请面 session. It stores exactly the two candidate ids and the
 * final user-chosen id — never the web of provider data behind them.
 */
export interface GetFaceRitualSession {
  schemaVersion: typeof GET_FACE_RITUAL_SCHEMA_VERSION;
  phase: GetFaceRitualPhase;
  name: string;
  wish: string;
  candidateCardIds: [string, string] | null;
  candidateSource: GetFaceRitualCandidateSource | null;
  selectedMaskIndex: number | null;
  cardId: string | null;
}

export const getFaceRitualSessionSchema = z.object({
  schemaVersion: z.literal(GET_FACE_RITUAL_SCHEMA_VERSION),
  phase: getFaceRitualPhaseSchema,
  name: z.string().max(80),
  wish: z.string().max(280),
  candidateCardIds: candidateCardIdsSchema.nullable(),
  // Optional on read so sessions written before this field keep parsing.
  candidateSource: candidateSourceSchema.nullable().default(null),
  selectedMaskIndex: z.number().int().min(0).max(7).nullable(),
  cardId: cardIdSchema.nullable()
}).strict().superRefine((value, context) => {
  if (value.candidateCardIds) {
    for (const cardId of value.candidateCardIds) {
      if (!getRitualStoryMask(cardId)) {
        context.addIssue({ code: "custom", path: ["candidateCardIds"], message: `候选必须是已注册且已映射面具的故事：${cardId}` });
      }
    }
  }
  if (value.cardId) {
    const maskIndex = ritualMaskIndex(value.cardId);
    if (maskIndex === null) {
      context.addIssue({ code: "custom", path: ["cardId"], message: "最终故事必须已注册且已映射面具" });
    } else if (value.selectedMaskIndex !== null && value.selectedMaskIndex !== maskIndex) {
      context.addIssue({ code: "custom", path: ["selectedMaskIndex"], message: "面具索引必须与最终故事一致" });
    }
  }
  if (value.phase === "choosing" && !value.candidateCardIds) {
    context.addIssue({ code: "custom", path: ["candidateCardIds"], message: "选择阶段必须保留两个候选" });
  }
  if (value.phase === "choosing" && value.candidateCardIds && value.cardId) {
    context.addIssue({ code: "custom", path: ["cardId"], message: "选择完成前不得写入最终故事" });
  }
  if ((value.phase === "mask" || value.phase === "wearing" || value.phase === "complete") && (!value.cardId || value.selectedMaskIndex === null)) {
    context.addIssue({ code: "custom", path: ["cardId"], message: "得面之后必须保留选定故事" });
  }
});

export type GetFaceRitualEvent =
  | { type: "restore"; state: GetFaceRitualSession }
  | { type: "nameSubmitted"; name: string }
  | { type: "wishSubmitted"; wish: string }
  | { type: "candidatesResolved"; candidates: readonly string[]; provider: string; promptVersion: string }
  | { type: "candidatesNeedDetail" }
  | { type: "chooseCandidate"; cardId: string }
  | { type: "returnToWish" }
  | { type: "enterStory" }
  | { type: "wearComplete" }
  | { type: "reset" };

export function createInitialGetFaceRitualSession(): GetFaceRitualSession {
  return {
    schemaVersion: GET_FACE_RITUAL_SCHEMA_VERSION,
    phase: "name",
    name: "",
    wish: "",
    candidateCardIds: null,
    candidateSource: null,
    selectedMaskIndex: null,
    cardId: null
  };
}

function cleanText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

/** Drops any candidate or selection state so a new problem starts clean. */
function withoutSelection(state: GetFaceRitualSession): GetFaceRitualSession {
  return { ...state, candidateCardIds: null, candidateSource: null, selectedMaskIndex: null, cardId: null };
}

export function transitionGetFaceRitual(state: GetFaceRitualSession, event: GetFaceRitualEvent): GetFaceRitualSession {
  if (event.type === "restore") return getFaceRitualSessionSchema.parse(event.state);
  if (event.type === "reset") return createInitialGetFaceRitualSession();
  if (state.phase === "name" && event.type === "nameSubmitted") {
    const name = cleanText(event.name, 80);
    return name ? { ...state, phase: "wish", name } : state;
  }
  if (state.phase === "wish" && event.type === "wishSubmitted") {
    const wish = cleanText(event.wish, 280);
    return wish.length >= 2 ? { ...withoutSelection(state), phase: "matching", wish } : state;
  }
  if (state.phase === "matching" && event.type === "candidatesResolved") {
    const cards = resolveChoiceCards(event.candidates);
    const provider = cleanText(event.provider, 120);
    const promptVersion = cleanText(event.promptVersion, 120);
    if (event.candidates.length !== 2 || cards.length !== 2 || !provider || !promptVersion) return state;
    return {
      ...withoutSelection(state),
      phase: "choosing",
      candidateCardIds: [cards[0].cardId, cards[1].cardId],
      candidateSource: { provider, promptVersion }
    };
  }
  if (state.phase === "matching" && event.type === "candidatesNeedDetail") {
    return { ...withoutSelection(state), phase: "wish" };
  }
  if (state.phase === "choosing" && event.type === "chooseCandidate" && state.candidateCardIds) {
    if (!state.candidateCardIds.includes(event.cardId)) return state;
    const maskIndex = ritualMaskIndex(event.cardId);
    if (maskIndex === null) return state;
    return { ...state, phase: "mask", cardId: event.cardId, selectedMaskIndex: maskIndex };
  }
  if ((state.phase === "choosing" || state.phase === "matching") && event.type === "returnToWish") {
    return { ...withoutSelection(state), phase: "wish" };
  }
  if (state.phase === "mask" && event.type === "enterStory" && state.cardId && state.selectedMaskIndex !== null) return { ...state, phase: "wearing" };
  if (state.phase === "wearing" && event.type === "wearComplete") return { ...state, phase: "complete" };
  return state;
}

export const GET_FACE_RITUAL_STORAGE_KEY = "nuo.get-face.ritual.v3";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserSessionStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * Reads the current session, then falls back to the previous single-story
 * session. A legacy `matching` session returns to `wish` so the user submits
 * the problem again instead of resuming an unrepeatable reveal.
 */
export function readGetFaceRitualSession(storage: StorageLike | null = browserSessionStorage()): GetFaceRitualSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GET_FACE_RITUAL_STORAGE_KEY);
    if (raw) {
      const parsed = getFaceRitualSessionSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch { /* fall through to the legacy reader */ }
  return readLegacyGetFaceRitualSession(storage);
}

export function writeGetFaceRitualSession(state: GetFaceRitualSession, storage: StorageLike | null = browserSessionStorage()): void {
  if (!storage) return;
  try { storage.setItem(GET_FACE_RITUAL_STORAGE_KEY, JSON.stringify(getFaceRitualSessionSchema.parse(state))); } catch { /* best effort */ }
}

export function clearGetFaceRitualSession(storage: StorageLike | null = browserSessionStorage()): void {
  try {
    storage?.removeItem(GET_FACE_RITUAL_STORAGE_KEY);
    storage?.removeItem(LEGACY_RITUAL_STORAGE_KEY);
  } catch { /* best effort */ }
}

export const readGetFaceSession = readGetFaceRitualSession;
export const writeGetFaceSession = writeGetFaceRitualSession;
export const clearGetFaceSession = clearGetFaceRitualSession;
