import { z } from "zod";
import { ritualMaskIndex } from "./ritual-story-masks";
import type { GetFaceRitualSession } from "./session";

/** Storage key of the previous (v2) single-story请面 session. */
export const LEGACY_RITUAL_STORAGE_KEY = "nuo.get-face.ritual.v2";

const legacyPhaseSchema = z.enum(["name", "wish", "matching", "mask", "wearing", "complete"]);

export const legacyGetFaceRitualSessionSchema = z.object({
  schemaVersion: z.literal("2.0.0"),
  phase: legacyPhaseSchema,
  name: z.string().max(80),
  wish: z.string().max(280),
  selectedMaskIndex: z.number().int().min(0).max(7).nullable(),
  cardId: z.string().min(1).max(160).nullable()
}).strict();

export type LegacyGetFaceRitualSession = z.infer<typeof legacyGetFaceRitualSessionSchema>;

/**
 * Migrates a v2 session into the v3 shape.
 *
 * `mask`/`wearing`/`complete` keep going: their single story was already
 * chosen and persisted. A v2 `matching` session cannot be replayed — the
 * reveal was never recorded — so it returns to the editable `wish` phase.
 */
export function migrateLegacyGetFaceRitualSession(legacy: LegacyGetFaceRitualSession): GetFaceRitualSession {
  const base: GetFaceRitualSession = {
    schemaVersion: "3.0.0",
    phase: "wish",
    name: legacy.name,
    wish: legacy.wish,
    candidateCardIds: null,
    candidateSource: null,
    selectedMaskIndex: null,
    cardId: null
  };
  if (legacy.phase === "name" && !legacy.name) return { ...base, phase: "name" };
  if (legacy.phase === "name") return { ...base, phase: "wish" };
  const chosen = legacy.cardId ? ritualMaskIndex(legacy.cardId) : null;
  if (legacy.phase === "mask" || legacy.phase === "wearing" || legacy.phase === "complete") {
    if (legacy.cardId && chosen !== null) {
      return { ...base, phase: legacy.phase, cardId: legacy.cardId, selectedMaskIndex: chosen };
    }
  }
  return base;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readLegacyGetFaceRitualSession(storage: StorageLike | null): GetFaceRitualSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LEGACY_RITUAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = legacyGetFaceRitualSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? migrateLegacyGetFaceRitualSession(parsed.data) : null;
  } catch {
    return null;
  }
}
