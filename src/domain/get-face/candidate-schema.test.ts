import { describe, expect, it } from "vitest";
import { candidateRequestSchema, candidateResponseSchema, isCandidateSuccess } from "./candidate-schema";
import { STORY_MATCH_PROFILES } from "./story-match-profiles";

const [first, second] = STORY_MATCH_PROFILES;

function successPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.1.0",
    status: "candidates",
    candidates: [first.cardId, second.cardId],
    candidateScores: [{ probability: .82, round: 1 }, { probability: .31, round: 1 }],
    provider: "deterministic-local",
    promptVersion: "get-face.profiles.v1.1",
    ...overrides
  };
}

describe("candidate contract", () => {
  it("accepts a versioned two-candidate response with raw scores", () => {
    const parsed = candidateResponseSchema.parse(successPayload());
    expect(isCandidateSuccess(parsed)).toBe(true);
    if (isCandidateSuccess(parsed)) {
      expect(parsed.candidates).toEqual([first.cardId, second.cardId]);
      expect(parsed.candidateScores).toEqual([{ probability: .82, round: 1 }, { probability: .31, round: 1 }]);
    }
  });

  it("accepts null scores for the local rule or a degraded answer", () => {
    expect(candidateResponseSchema.parse(successPayload({ candidateScores: null })).status).toBe("candidates");
  });

  it("accepts a second-round score for the second candidate", () => {
    const parsed = candidateResponseSchema.parse(successPayload({ candidateScores: [{ probability: 1, round: 1 }, { probability: .6, round: 2 }] }));
    expect(isCandidateSuccess(parsed)).toBe(true);
  });

  it("accepts a needs_detail response without scores", () => {
    const parsed = candidateResponseSchema.parse({
      schemaVersion: "1.1.0",
      status: "needs_detail",
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1.1"
    });
    expect(isCandidateSuccess(parsed)).toBe(false);
    expect(() => candidateResponseSchema.parse({
      schemaVersion: "1.1.0",
      status: "needs_detail",
      candidateScores: null,
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1.1"
    })).toThrow();
  });

  it("rejects malformed score payloads", () => {
    expect(() => candidateResponseSchema.parse(successPayload({ candidateScores: undefined }))).toThrow();
    expect(() => candidateResponseSchema.parse(successPayload({ candidateScores: [{ probability: .5, round: 1 }] }))).toThrow();
    expect(() => candidateResponseSchema.parse(successPayload({ candidateScores: [{ probability: 1.2, round: 1 }, { probability: .3, round: 1 }] }))).toThrow();
    expect(() => candidateResponseSchema.parse(successPayload({ candidateScores: [{ probability: .5, round: 1 }, { probability: .3, round: 3 }] }))).toThrow();
    expect(() => candidateResponseSchema.parse(successPayload({ candidateScores: [{ probability: .5, round: 2 }, { probability: .3, round: 1 }] }))).toThrow();
    expect(() => candidateResponseSchema.parse(successPayload({ candidateScores: [{ probability: Number.NaN, round: 1 }, { probability: .3, round: 1 }] }))).toThrow();
  });

  it("rejects repeated candidates, free text and unversioned payloads", () => {
    expect(() => candidateResponseSchema.parse(successPayload({ candidates: [first.cardId, first.cardId] }))).toThrow();
    expect(() => candidateResponseSchema.parse(successPayload({ candidates: [first.cardId] }))).toThrow();
    expect(() => candidateResponseSchema.parse(successPayload({ reason: "模型写的解释" }))).toThrow();
    expect(() => candidateResponseSchema.parse(successPayload({ schemaVersion: "1.0.0" }))).toThrow();
  });

  it("reuses the frozen 2–280 character wish validation", () => {
    expect(candidateRequestSchema.safeParse({ wish: "找一条路" }).success).toBe(true);
    expect(candidateRequestSchema.safeParse({ wish: "短" }).success).toBe(false);
    expect(candidateRequestSchema.safeParse({ wish: "路".repeat(281) }).success).toBe(false);
    expect(candidateRequestSchema.safeParse({ wish: "找一条路", card: { id: first.cardId } }).success).toBe(false);
  });
});
