import { getDreamCard } from "@/domain/dream-card";
import {
  CANDIDATE_PROMPT_VERSION,
  CANDIDATE_SCHEMA_VERSION,
  type CandidateResponse,
  type StoryMatchProfile
} from "@/domain/get-face";
import type { DreamCandidateProvider } from "./candidate-provider";

export interface RankedStoryMatchProfile {
  profile: StoryMatchProfile;
  /** Fixed option order from the profile table; the tie-breaker. */
  order: number;
  score: number;
}

export function searchableProfileTerms(profile: StoryMatchProfile): string[] {
  const card = getDreamCard(profile.cardId);
  if (!card) return [];
  const match = card.meta.match;
  return [...match.tags, ...match.situations, ...match.emotions, ...match.dilemmas, ...match.relationships, ...match.excludeTags];
}

/**
 * Scores the eight profiles against the wish using only the registered story
 * vocabulary. Sorted by score, then by the fixed option order, so the same
 * wish always yields the same ranking (no weighted random draw).
 */
export function rankStoryMatchProfiles(wish: string, profiles: readonly StoryMatchProfile[]): RankedStoryMatchProfile[] {
  return profiles
    .map((profile, order) => {
      const card = getDreamCard(profile.cardId);
      if (!card) return { profile, order, score: 0 };
      const terms = searchableProfileTerms(profile);
      const hits = terms.filter((term) => term.length > 0 && wish.includes(term)).length;
      const excluded = card.meta.match.excludeTags.some((term) => term.length > 0 && wish.includes(term));
      return { profile, order, score: excluded ? 0 : hits };
    })
    .sort((left, right) => right.score - left.score || left.order - right.order);
}

/** Two distinct, positively matched profiles; otherwise the user must rephrase. */
export function selectLocalCandidateProfiles(wish: string, profiles: readonly StoryMatchProfile[]): StoryMatchProfile[] {
  const matched = rankStoryMatchProfiles(wish, profiles).filter((entry) => entry.score > 0);
  return matched.slice(0, 2).map((entry) => entry.profile);
}

export function createDeterministicCandidateProvider(): DreamCandidateProvider {
  return {
    id: "deterministic-local",
    async selectCandidates(request, profiles): Promise<CandidateResponse> {
      const selected = selectLocalCandidateProfiles(request.wish, profiles);
      if (selected.length < 2) {
        return {
          schemaVersion: CANDIDATE_SCHEMA_VERSION,
          status: "needs_detail",
          provider: "deterministic-local",
          promptVersion: CANDIDATE_PROMPT_VERSION
        };
      }
      return {
        schemaVersion: CANDIDATE_SCHEMA_VERSION,
        status: "candidates",
        candidates: [selected[0].cardId, selected[1].cardId],
        provider: "deterministic-local",
        promptVersion: CANDIDATE_PROMPT_VERSION
      };
    }
  };
}

export const deterministicCandidateProvider = createDeterministicCandidateProvider();
