import { CARD_TO_CODEX_MASK_ID, DETAIL_ASSETS } from "@/domain/codex/assets";
import { getRitualStoryMask } from "./ritual-story-masks";
import { getStoryMatchProfile } from "./story-match-profiles";

/** Everything a choice card needs, resolved from one `cardId`. */
export interface ChoiceCard {
  cardId: string;
  maskIndex: number;
  maskName: string;
  storyTitle: string;
  duty: string;
  artwork: string;
  prompt: string;
}

export function resolveChoiceCard(cardId: string): ChoiceCard | null {
  const mask = getRitualStoryMask(cardId);
  const profile = getStoryMatchProfile(cardId);
  if (!mask || !profile) return null;
  return {
    cardId,
    maskIndex: mask.maskIndex,
    maskName: mask.maskName,
    storyTitle: mask.storyTitle,
    duty: mask.duty,
    artwork: DETAIL_ASSETS[CARD_TO_CODEX_MASK_ID[cardId]]?.mainMask ?? mask.thumbnail,
    prompt: profile.prompt
  };
}

/**
 * Resolves candidate ids into displayable choice cards, preserving the given
 * order and dropping unknown or repeated ids. A caller needs exactly two
 * results to leave the matching stage.
 */
export function resolveChoiceCards(cardIds: readonly string[]): ChoiceCard[] {
  const seen = new Set<string>();
  const cards: ChoiceCard[] = [];
  for (const cardId of cardIds) {
    if (seen.has(cardId)) continue;
    const card = resolveChoiceCard(cardId);
    if (!card) continue;
    seen.add(cardId);
    cards.push(card);
  }
  return cards;
}
