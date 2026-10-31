import { describe, expect, it } from "vitest";
import {
  createInitialGetFaceRitualSession,
  GET_FACE_RITUAL_STORAGE_KEY,
  getFaceRitualSessionSchema,
  readGetFaceRitualSession,
  transitionGetFaceRitual,
  writeGetFaceRitualSession,
  type GetFaceRitualSession
} from "./session";
import { LEGACY_RITUAL_STORAGE_KEY } from "./session-legacy-v2";

const KAILU = "dream.kailu-jiangjun.du-shan-ji";
const LIUYI = "dream.liuyi.yi-xin-du-shui";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

function legacyStorage(session: Record<string, unknown>) {
  const fake = storage();
  fake.setItem(LEGACY_RITUAL_STORAGE_KEY, JSON.stringify(session));
  return fake;
}

const SOURCE = { provider: "openrouter-jev", promptVersion: "get-face.profiles.v1" };

function atChoosing(): GetFaceRitualSession {
  let state = createInitialGetFaceRitualSession();
  state = transitionGetFaceRitual(state, { type: "nameSubmitted", name: "  阿渡  " });
  state = transitionGetFaceRitual(state, { type: "wishSubmitted", wish: "我想找到一条路" });
  return transitionGetFaceRitual(state, { type: "candidatesResolved", candidates: [KAILU, LIUYI], ...SOURCE });
}

describe("get-face ritual session", () => {
  it("walks name, wish, matching, choosing, reveal, wearing and complete", () => {
    let state = createInitialGetFaceRitualSession();
    expect(state.phase).toBe("name");
    state = transitionGetFaceRitual(state, { type: "nameSubmitted", name: "  阿渡  " });
    expect(state).toMatchObject({ phase: "wish", name: "阿渡" });
    state = transitionGetFaceRitual(state, { type: "wishSubmitted", wish: "我想找到一条路" });
    expect(state).toMatchObject({ phase: "matching", wish: "我想找到一条路", candidateCardIds: null, cardId: null });
    state = transitionGetFaceRitual(state, { type: "candidatesResolved", candidates: [KAILU, LIUYI], ...SOURCE });
    expect(state.phase).toBe("choosing");
    expect(state.candidateCardIds).toEqual([KAILU, LIUYI]);
    expect(state.candidateSource).toEqual(SOURCE);
    expect(state.cardId).toBeNull();
    state = transitionGetFaceRitual(state, { type: "chooseCandidate", cardId: LIUYI });
    expect(state).toMatchObject({ phase: "mask", cardId: LIUYI, selectedMaskIndex: 6, candidateSource: SOURCE });
    state = transitionGetFaceRitual(state, { type: "enterStory" });
    expect(state.phase).toBe("wearing");
    expect(transitionGetFaceRitual(state, { type: "wearComplete" }).phase).toBe("complete");
  });

  it("keeps the two candidate ids in the order the provider returned them", () => {
    const state = atChoosing();
    expect(state.candidateCardIds).toEqual([KAILU, LIUYI]);
    const swapped = atChoosing();
    const reversed = transitionGetFaceRitual(
      { ...swapped, phase: "matching", candidateCardIds: null, candidateSource: null },
      { type: "candidatesResolved", candidates: [LIUYI, KAILU], ...SOURCE }
    );
    expect(reversed.candidateCardIds).toEqual([LIUYI, KAILU]);
  });

  it("refuses fewer than two, repeated or unregistered candidates", () => {
    let state = createInitialGetFaceRitualSession();
    state = transitionGetFaceRitual(state, { type: "nameSubmitted", name: "阿渡" });
    state = transitionGetFaceRitual(state, { type: "wishSubmitted", wish: "我想找到一条路" });
    expect(transitionGetFaceRitual(state, { type: "candidatesResolved", candidates: [KAILU], ...SOURCE })).toEqual(state);
    expect(transitionGetFaceRitual(state, { type: "candidatesResolved", candidates: [KAILU, KAILU], ...SOURCE })).toEqual(state);
    expect(transitionGetFaceRitual(state, { type: "candidatesResolved", candidates: [KAILU, "dream.client.made-up"], ...SOURCE })).toEqual(state);
    expect(transitionGetFaceRitual(state, { type: "candidatesResolved", candidates: [KAILU, LIUYI], provider: "", promptVersion: "v" })).toEqual(state);
  });

  it("only accepts a choice among the two candidates", () => {
    const choosing = atChoosing();
    expect(transitionGetFaceRitual(choosing, { type: "chooseCandidate", cardId: "dream.saodi-heshang.yu-huo-ji" })).toEqual(choosing);
  });

  it("returns to the editable wish and drops stale candidates", () => {
    const choosing = atChoosing();
    const wish = transitionGetFaceRitual(choosing, { type: "returnToWish" });
    expect(wish).toMatchObject({ phase: "wish", wish: "我想找到一条路", candidateCardIds: null, candidateSource: null, cardId: null, selectedMaskIndex: null });
    const rematched = transitionGetFaceRitual(wish, { type: "wishSubmitted", wish: "换一个问题" });
    expect(rematched).toMatchObject({ phase: "matching", candidateCardIds: null, cardId: null });
  });

  it("sends the user back to the wish form when the candidates are too vague", () => {
    let state = createInitialGetFaceRitualSession();
    state = transitionGetFaceRitual(state, { type: "nameSubmitted", name: "阿渡" });
    state = transitionGetFaceRitual(state, { type: "wishSubmitted", wish: "说不清" });
    state = transitionGetFaceRitual(state, { type: "candidatesNeedDetail" });
    expect(state).toMatchObject({ phase: "wish", wish: "说不清", candidateCardIds: null });
  });

  it("persists only the ritual draft, candidate ids and final card id", () => {
    const fakeStorage = storage();
    const state: GetFaceRitualSession = { ...atChoosing(), phase: "mask", cardId: KAILU, selectedMaskIndex: 0 };
    writeGetFaceRitualSession(state, fakeStorage);
    const raw = fakeStorage.values.get(GET_FACE_RITUAL_STORAGE_KEY) ?? "";
    expect(raw).not.toMatch(/confidence|probabilit|criteria|camera|stream|video|portrait/i);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
      ["candidateCardIds", "candidateSource", "cardId", "name", "phase", "schemaVersion", "selectedMaskIndex", "wish"].sort()
    );
    expect(readGetFaceRitualSession(fakeStorage)).toEqual(state);
    expect(() => getFaceRitualSessionSchema.parse(JSON.parse(raw))).not.toThrow();
  });

  it("ignores invalid or out-of-order events", () => {
    const initial = createInitialGetFaceRitualSession();
    expect(transitionGetFaceRitual(initial, { type: "wishSubmitted", wish: "愿望" })).toEqual(initial);
    expect(transitionGetFaceRitual(initial, { type: "nameSubmitted", name: "" })).toEqual(initial);
    expect(transitionGetFaceRitual(initial, { type: "chooseCandidate", cardId: KAILU })).toEqual(initial);
  });

  it("rejects a persisted choosing state without candidates", () => {
    expect(() => getFaceRitualSessionSchema.parse({ ...createInitialGetFaceRitualSession(), phase: "choosing" })).toThrow();
  });

  it("rejects persisted candidates that are not registered or have no mask mapping", () => {
    const choosing = atChoosing();
    expect(() => getFaceRitualSessionSchema.parse({ ...choosing, candidateCardIds: [KAILU, "dream.client.fabricated"] })).toThrow();
    expect(() => getFaceRitualSessionSchema.parse({ ...choosing, candidateCardIds: [KAILU, "dream.goubu-panguan.he-ye-ji"], cardId: null })).not.toThrow();
  });

  it("rejects a final story whose stored mask index disagrees with the mapping", () => {
    const chosen: GetFaceRitualSession = { ...atChoosing(), phase: "mask", cardId: LIUYI, selectedMaskIndex: 6 };
    expect(() => getFaceRitualSessionSchema.parse({ ...chosen, selectedMaskIndex: 0 })).toThrow();
    expect(() => getFaceRitualSessionSchema.parse({ ...chosen, cardId: "dream.client.fabricated" })).toThrow();
    expect(getFaceRitualSessionSchema.parse(chosen)).toEqual(chosen);
  });

  it("keeps the real candidate source across a refresh in the choosing phase", () => {
    const fakeStorage = storage();
    const choosing = atChoosing();
    writeGetFaceRitualSession(choosing, fakeStorage);
    expect(readGetFaceRitualSession(fakeStorage)?.candidateSource).toEqual(SOURCE);
  });

  it("reads a session persisted before the candidate source field existed", () => {
    const fakeStorage = storage();
    const legacyV3 = {
      schemaVersion: "3.0.0",
      phase: "choosing",
      name: "阿渡",
      wish: "我想找到一条路",
      candidateCardIds: [KAILU, LIUYI],
      selectedMaskIndex: null,
      cardId: null
    };
    fakeStorage.setItem(GET_FACE_RITUAL_STORAGE_KEY, JSON.stringify(legacyV3));
    expect(readGetFaceRitualSession(fakeStorage)).toEqual({ ...legacyV3, candidateSource: null });
  });
});

describe("legacy v2 ritual sessions", () => {
  const base = { schemaVersion: "2.0.0", name: "阿渡", wish: "我想找到一条路" };

  it("keeps a completed single-story session usable", () => {
    const fake = legacyStorage({ ...base, phase: "mask", cardId: KAILU, selectedMaskIndex: 0 });
    expect(readGetFaceRitualSession(fake)).toEqual({
      schemaVersion: "3.0.0",
      phase: "mask",
      name: "阿渡",
      wish: "我想找到一条路",
      candidateCardIds: null,
      candidateSource: null,
      selectedMaskIndex: 0,
      cardId: KAILU
    });
  });

  it("recomputes the mask index from the chosen story", () => {
    const fake = legacyStorage({ ...base, phase: "complete", cardId: LIUYI, selectedMaskIndex: 0 });
    expect(readGetFaceRitualSession(fake)).toMatchObject({ phase: "complete", cardId: LIUYI, selectedMaskIndex: 6 });
  });

  it("reopens the wish form for a legacy matching session", () => {
    const fake = legacyStorage({ ...base, phase: "matching", cardId: null, selectedMaskIndex: null });
    expect(readGetFaceRitualSession(fake)).toMatchObject({ phase: "wish", wish: "我想找到一条路", candidateCardIds: null });
  });

  it("reopens the wish form when a legacy selection points at an unknown story", () => {
    const fake = legacyStorage({ ...base, phase: "mask", cardId: "dream.client.fabricated", selectedMaskIndex: 0 });
    expect(readGetFaceRitualSession(fake)).toMatchObject({ phase: "wish", cardId: null, selectedMaskIndex: null });
  });

  it("prefers the current session over a leftover legacy one", () => {
    const fake = legacyStorage({ ...base, phase: "matching", cardId: null, selectedMaskIndex: null });
    const current: GetFaceRitualSession = { ...atChoosing() };
    writeGetFaceRitualSession(current, fake);
    expect(readGetFaceRitualSession(fake)).toEqual(current);
  });
});
