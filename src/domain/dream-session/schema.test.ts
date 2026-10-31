import { describe, expect, it } from "vitest";
import { createChosenDreamSession, createDreamSession, dreamSessionSchema } from "./schema";

const KAILU = "dream.kailu-jiangjun.du-shan-ji";
const LIUYI = "dream.liuyi.yi-xin-du-shui";

describe("DreamSession v1", () => {
  it("creates a versioned matched session", () => {
    const session = createDreamSession("我想找到一条路", { schemaVersion: "1.0.0", cardId: KAILU, provider: "deterministic-local", confidence: .8, reason: "fixture" }, new Date("2026-08-28T00:00:00.000Z"));
    expect(dreamSessionSchema.parse(session).status).toBe("matched");
    expect(session.schemaVersion).toBe("1.0.0");
    expect(session.selection).toBeNull();
  });

  it("records the user's pick without reusing the model confidence field", () => {
    const session = createChosenDreamSession("我想找到一条路", {
      cardId: LIUYI,
      candidateCardIds: [LIUYI, KAILU],
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1.1"
    }, new Date("2026-08-28T00:00:00.000Z"));

    expect(session.match.cardId).toBe(LIUYI);
    expect(session.match).not.toHaveProperty("confidence");
    expect(session.selection).toEqual({
      schemaVersion: "1.0.0",
      kind: "user-choice",
      candidateCardIds: [LIUYI, KAILU],
      chosenCardId: LIUYI,
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1.1"
    });
    expect(dreamSessionSchema.parse(session)).toEqual(session);
  });

  it("still reads a pre-choice session that has no selection field", () => {
    const legacy = {
      schemaVersion: "1.0.0",
      sessionId: "session-1",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
      status: "matched",
      wish: "我想找到一条路",
      match: { schemaVersion: "1.0.0", cardId: KAILU, provider: "deterministic-local", confidence: .8, reason: "fixture" },
      playback: { completedAt: null },
      interpretation: null
    };
    expect(dreamSessionSchema.parse(legacy).match.cardId).toBe(KAILU);
  });

  it("rejects a chosen story that is not one of the candidates", () => {
    const session = createChosenDreamSession("我想找到一条路", {
      cardId: LIUYI,
      candidateCardIds: [LIUYI, KAILU],
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1.1"
    });
    expect(() => dreamSessionSchema.parse({
      ...session,
      selection: { ...session.selection!, chosenCardId: "dream.saodi-heshang.yu-huo-ji" }
    })).toThrow();
    expect(dreamSessionSchema.parse(session)).toEqual(session);
  });

  it("rejects a selection that disagrees with the final story", () => {
    const session = createChosenDreamSession("我想找到一条路", {
      cardId: LIUYI,
      candidateCardIds: [LIUYI, KAILU],
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1.1"
    });
    expect(() => dreamSessionSchema.parse({ ...session, match: { ...session.match, cardId: KAILU } })).toThrow();
  });
});
