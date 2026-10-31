import { describe, expect, it } from "vitest";
import { candidateRequestSchema, candidateResponseSchema, isCandidateSuccess } from "./candidate-schema";
import { STORY_MATCH_PROFILES } from "./story-match-profiles";

const [first, second] = STORY_MATCH_PROFILES;

describe("candidate contract", () => {
  it("accepts a versioned two-candidate response", () => {
    const parsed = candidateResponseSchema.parse({
      schemaVersion: "1.0.0",
      status: "candidates",
      candidates: [first.cardId, second.cardId],
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1"
    });
    expect(isCandidateSuccess(parsed)).toBe(true);
    if (isCandidateSuccess(parsed)) expect(parsed.candidates).toEqual([first.cardId, second.cardId]);
  });

  it("accepts a needs_detail response", () => {
    const parsed = candidateResponseSchema.parse({
      schemaVersion: "1.0.0",
      status: "needs_detail",
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1"
    });
    expect(isCandidateSuccess(parsed)).toBe(false);
  });

  it("rejects repeated candidates, free text and unversioned payloads", () => {
    const base = {
      schemaVersion: "1.0.0",
      status: "candidates",
      candidates: [first.cardId, second.cardId],
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1"
    };
    expect(() => candidateResponseSchema.parse({ ...base, candidates: [first.cardId, first.cardId] })).toThrow();
    expect(() => candidateResponseSchema.parse({ ...base, candidates: [first.cardId] })).toThrow();
    expect(() => candidateResponseSchema.parse({ ...base, reason: "模型写的解释" })).toThrow();
    expect(() => candidateResponseSchema.parse({ ...base, schemaVersion: "0.0.0" })).toThrow();
  });

  it("reuses the frozen 2–280 character wish validation", () => {
    expect(candidateRequestSchema.safeParse({ wish: "找一条路" }).success).toBe(true);
    expect(candidateRequestSchema.safeParse({ wish: "短" }).success).toBe(false);
    expect(candidateRequestSchema.safeParse({ wish: "路".repeat(281) }).success).toBe(false);
    expect(candidateRequestSchema.safeParse({ wish: "找一条路", card: { id: first.cardId } }).success).toBe(false);
  });
});
