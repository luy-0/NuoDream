import { describe, expect, it, vi } from "vitest";
import { STORY_MATCH_PROFILES } from "@/domain/get-face";
import { createFallbackCandidateProvider, withTimeout, type DreamCandidateProvider } from "./candidate-provider";
import {
  createDeterministicCandidateProvider,
  rankStoryMatchProfiles,
  selectLocalCandidateProfiles
} from "./deterministic-candidate-provider";

const KAILU = "dream.kailu-jiangjun.du-shan-ji";
const LIUYI = "dream.liuyi.yi-xin-du-shui";
const ABUMO = "dream.abumo.huang-nian-kai-huo";

const HELPFUL_WISH = "我很难开口向别人求助，怕麻烦别人，也怕被拒绝";
const AMBIGUOUS_WISH = "云朵落在雨后石头背面";

describe("deterministic candidate provider", () => {
  it("returns two distinct registered candidates with the local provider marked", async () => {
    const response = await createDeterministicCandidateProvider().selectCandidates({ wish: HELPFUL_WISH }, STORY_MATCH_PROFILES);
    expect(response.status).toBe("candidates");
    if (response.status !== "candidates") throw new Error("expected candidates");
    expect(response.candidates[0]).toBe(LIUYI);
    expect(new Set(response.candidates).size).toBe(2);
    expect(response.provider).toBe("deterministic-local");
    for (const cardId of response.candidates) {
      expect(STORY_MATCH_PROFILES.some((profile) => profile.cardId === cardId)).toBe(true);
    }
  });

  it("is stable across repeated calls", async () => {
    const provider = createDeterministicCandidateProvider();
    const first = await provider.selectCandidates({ wish: HELPFUL_WISH }, STORY_MATCH_PROFILES);
    const second = await provider.selectCandidates({ wish: HELPFUL_WISH }, STORY_MATCH_PROFILES);
    expect(second).toEqual(first);
  });

  it("breaks ties with the fixed option order instead of a random draw", () => {
    const ranked = rankStoryMatchProfiles("我不知道该不该辞职重新开始", STORY_MATCH_PROFILES);
    expect(ranked[0]).toMatchObject({ profile: { cardId: KAILU }, score: 1, order: 0 });
    expect(ranked[1]).toMatchObject({ profile: { cardId: ABUMO }, score: 1, order: 7 });
  });

  it("asks for a clearer problem when fewer than two profiles have a keyword hit", async () => {
    const response = await createDeterministicCandidateProvider().selectCandidates({ wish: AMBIGUOUS_WISH }, STORY_MATCH_PROFILES);
    expect(response).toEqual({
      schemaVersion: "1.0.0",
      status: "needs_detail",
      provider: "deterministic-local",
      promptVersion: expect.any(String)
    });
    expect(selectLocalCandidateProfiles(AMBIGUOUS_WISH, STORY_MATCH_PROFILES)).toEqual([]);
  });

  it("only ranks positively matched profiles", () => {
    const ranked = selectLocalCandidateProfiles(HELPFUL_WISH, STORY_MATCH_PROFILES);
    expect(ranked[0].cardId).toBe(LIUYI);
    expect(ranked).toHaveLength(2);
    expect(ranked[1].cardId).not.toBe(LIUYI);
  });
});

describe("candidate provider fallback", () => {
  const fallback = createDeterministicCandidateProvider();

  it("falls back to the local rule and marks the answer as degraded", async () => {
    const primary: DreamCandidateProvider = {
      id: "fake-upstream",
      selectCandidates: vi.fn(async () => { throw new Error("upstream down"); })
    };
    const provider = createFallbackCandidateProvider(primary, fallback);
    const response = await provider.selectCandidates({ wish: HELPFUL_WISH }, STORY_MATCH_PROFILES);
    expect(response.status).toBe("candidates");
    expect(response.provider).toBe("deterministic-local:fallback");
    expect(primary.selectCandidates).toHaveBeenCalledOnce();
  });

  it("falls back when the upstream exceeds the timeout", async () => {
    const primary: DreamCandidateProvider = {
      id: "slow-upstream",
      selectCandidates: () => new Promise((_, reject) => {
        // Never resolves on its own; the timeout must win.
        void reject;
      })
    };
    const provider = createFallbackCandidateProvider(primary, fallback, { timeoutMs: 10, logger: { warn: () => undefined } });
    const response = await provider.selectCandidates({ wish: HELPFUL_WISH }, STORY_MATCH_PROFILES);
    expect(response.provider).toBe("deterministic-local:fallback");
  });

  it("falls back when the upstream returns a structurally invalid answer on a valid HTTP call", async () => {
    const warnings: unknown[] = [];
    const primary: DreamCandidateProvider = {
      id: "fake-upstream",
      selectCandidates: async () => ({ status: "candidates", candidates: ["dream.client.fabricated", KAILU], provider: "fake-upstream" }) as never
    };
    const provider = createFallbackCandidateProvider(primary, fallback, { logger: { warn: (event) => warnings.push(event) } });
    const response = await provider.selectCandidates({ wish: HELPFUL_WISH }, STORY_MATCH_PROFILES);
    expect(response.status).toBe("candidates");
    expect(response.provider).toBe("deterministic-local:fallback");
    expect(warnings).toEqual([expect.objectContaining({ reason: "invalid_response", primary: "fake-upstream" })]);
    if (response.status !== "candidates") throw new Error("expected candidates");
    expect(response.candidates.every((cardId) => STORY_MATCH_PROFILES.some((profile) => profile.cardId === cardId))).toBe(true);
  });

  it("degrades unregisterable or duplicate upstream candidates instead of passing them through", async () => {
    const primary: DreamCandidateProvider = {
      id: "fake-upstream",
      selectCandidates: async () => ({
        schemaVersion: "1.0.0",
        status: "candidates",
        candidates: [KAILU, KAILU],
        provider: "fake-upstream",
        promptVersion: "test"
      }) as never
    };
    const response = await createFallbackCandidateProvider(primary, fallback, { logger: { warn: () => undefined } })
      .selectCandidates({ wish: HELPFUL_WISH }, STORY_MATCH_PROFILES);
    expect(response.provider).toBe("deterministic-local:fallback");
  });

  it("returns the upstream answer untouched when it succeeds", async () => {
    const primary: DreamCandidateProvider = {
      id: "fake-upstream",
      selectCandidates: async () => ({
        schemaVersion: "1.0.0",
        status: "candidates",
        candidates: [KAILU, LIUYI],
        provider: "fake-upstream",
        promptVersion: "test"
      })
    };
    const response = await createFallbackCandidateProvider(primary, fallback).selectCandidates({ wish: HELPFUL_WISH }, STORY_MATCH_PROFILES);
    expect(response.provider).toBe("fake-upstream");
  });

  it("rejects when the timeout elapses and the work never settles", async () => {
    await expect(withTimeout(() => new Promise<never>(() => undefined), 5)).rejects.toThrow(/timed out/);
  });
});
