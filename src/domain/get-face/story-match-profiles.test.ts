import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDreamCard, listDreamCardIds } from "@/domain/dream-card";
import { resolveChoiceCard, resolveChoiceCards } from "./choice-cards";
import { getFaceData } from "./data";
import { RITUAL_CARD_IDS, RITUAL_STORY_MASKS, ritualMaskIndex } from "./ritual-story-masks";
import { STORY_MATCH_OPTION_IDS, STORY_MATCH_PROFILE_VERSION, STORY_MATCH_PROFILES } from "./story-match-profiles";

describe("story match profiles", () => {
  it("covers the eight registered stories exactly once", () => {
    const profileIds = STORY_MATCH_PROFILES.map((profile) => profile.cardId);
    expect(profileIds).toHaveLength(8);
    expect(new Set(profileIds).size).toBe(8);
    expect([...profileIds].sort()).toEqual([...listDreamCardIds()].sort());
    expect(new Set(STORY_MATCH_OPTION_IDS).size).toBe(8);
  });

  it("names every option after its mask and story", () => {
    for (const profile of STORY_MATCH_PROFILES) {
      const card = getDreamCard(profile.cardId);
      const mask = RITUAL_STORY_MASKS.find((entry) => entry.cardId === profile.cardId);
      expect(card).not.toBeNull();
      expect(mask).not.toBeUndefined();
      const [label, storyTitle] = profile.optionId.split("｜");
      expect(storyTitle).toBe(card!.meta.title);
      expect(label.length).toBeGreaterThanOrEqual(2);
      expect(label.length).toBeLessThanOrEqual(6);
      expect(mask!.maskName.length).toBeGreaterThan(0);
    }
  });

  it("keeps one situation sentence and one non-spoiler question per story", () => {
    for (const profile of STORY_MATCH_PROFILES) {
      expect(profile.criteria.endsWith("。")).toBe(true);
      expect(profile.criteria).not.toMatch(/相邻|排除|不属于|其他故事|不适用/);
      expect(profile.prompt.endsWith("？")).toBe(true);
      expect(profile.criteria.length).toBeGreaterThanOrEqual(20);
      expect(profile.criteria.length).toBeLessThanOrEqual(50);
      expect(profile.prompt.length).toBeGreaterThanOrEqual(10);
      expect(profile.prompt.length).toBeLessThanOrEqual(30);
      // The user-facing copy must never leak the internal matching sentence.
      expect(profile.prompt).not.toBe(profile.criteria);
      const card = getDreamCard(profile.cardId);
      expect(profile.prompt).not.toContain(card!.meta.title);
    }
  });

  it("addresses the user in the second person and never shows a story title", () => {
    expect(STORY_MATCH_PROFILE_VERSION).toBe("get-face.profiles.v1.1");
    for (const profile of STORY_MATCH_PROFILES) {
      expect(profile.prompt).toContain("你");
      expect(profile.prompt).not.toContain("我");
      expect(profile.prompt).not.toContain("《");
      expect(profile.prompt).not.toContain("》");
    }
  });
});

describe("ritual story masks", () => {
  it("maps the eight stories to the eight ritual mask slots in fixed order", () => {
    expect(RITUAL_STORY_MASKS).toHaveLength(8);
    expect(RITUAL_CARD_IDS).toEqual(STORY_MATCH_PROFILES.map((profile) => profile.cardId));
    expect(RITUAL_STORY_MASKS.map((mask) => mask.maskIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const mask of RITUAL_STORY_MASKS) {
      expect(getFaceData.masks[mask.maskIndex]?.name).toBe(mask.maskName);
      expect(mask.thumbnail).toMatch(/^\/dream-assets\/ui\/ritual\/masks\/.+\.png$/);
      expect(existsSync(join(process.cwd(), "public", mask.thumbnail))).toBe(true);
    }
  });

  it("resolves one displayable choice card per story", () => {
    for (const profile of STORY_MATCH_PROFILES) {
      const card = resolveChoiceCard(profile.cardId);
      expect(card).not.toBeNull();
      expect(card).toMatchObject({
        cardId: profile.cardId,
        prompt: profile.prompt,
        maskIndex: ritualMaskIndex(profile.cardId)
      });
      const artworkPath = join(process.cwd(), "public", card!.artwork);
      expect(card!.artwork).toContain("/ui/codex/details/");
      expect(existsSync(artworkPath)).toBe(true);
      const png = readFileSync(artworkPath);
      expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(600);
      expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(600);
    }
  });

  it("keeps candidate order, drops repeats and ignores unknown ids", () => {
    const [first, second] = STORY_MATCH_PROFILES;
    expect(resolveChoiceCards([second.cardId, first.cardId]).map((card) => card.cardId)).toEqual([second.cardId, first.cardId]);
    expect(resolveChoiceCards([first.cardId, first.cardId])).toHaveLength(1);
    expect(resolveChoiceCards([first.cardId, "dream.client.fabricated"])).toHaveLength(1);
    expect(resolveChoiceCard("dream.client.fabricated")).toBeNull();
  });
});
