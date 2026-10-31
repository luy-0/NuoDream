import { describe, expect, it } from "vitest";
import { listDreamCardIds } from "@/domain/dream-card";
import { matchResponseSchema } from "@/domain/dream-session";
import { candidateResponseSchema, STORY_MATCH_PROFILES } from "@/domain/get-face";
import { interpretResponseSchema } from "@/domain/interpretation";
import { POST as match } from "./match/route";
import { POST as candidates } from "./candidates/route";
import { POST as interpret } from "./interpret/route";
import { GET as preload } from "./preload/[cardId]/route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("dream route handlers", () => {
  it("returns two distinct registered candidates for the two-choice page", async () => {
    const response = await candidates(jsonRequest({ wish: "我很难开口向别人求助，怕麻烦别人，也怕被拒绝" }));
    expect(response.status).toBe(200);
    const raw = await response.json();
    // The browser sees ids and version metadata only, never probabilities or model text.
    expect(Object.keys(raw).sort()).toEqual(["candidates", "promptVersion", "provider", "schemaVersion", "status"]);
    expect(JSON.stringify(raw)).not.toMatch(/probabilities|confidence/);
    const body = candidateResponseSchema.parse(raw);
    expect(body.status).toBe("candidates");
    if (body.status !== "candidates") throw new Error("expected candidates");
    expect(new Set(body.candidates).size).toBe(2);
    const profileIds = STORY_MATCH_PROFILES.map((profile) => profile.cardId);
    for (const cardId of body.candidates) {
      expect(profileIds).toContain(cardId);
      expect(listDreamCardIds()).toContain(cardId);
    }
  });

  it("asks the user to rewrite an unmatched wish instead of returning a random pair", async () => {
    const response = await candidates(jsonRequest({ wish: "云朵落在雨后石头背面" }));
    expect(response.status).toBe(200);
    const body = candidateResponseSchema.parse(await response.json());
    expect(body.status).toBe("needs_detail");
  });

  it("rejects candidate requests that carry story content or an invalid wish", async () => {
    expect((await candidates(jsonRequest({ wish: "我想开始", card: { meta: { id: "dream.client.fabricated" } } }))).status).toBe(400);
    expect((await candidates(jsonRequest({ wish: "短" }))).status).toBe(400);
    expect((await candidates(jsonRequest({}))).status).toBe(400);
  });

  it("keeps the legacy single-story match contract working", async () => {
    const response = await match(jsonRequest({ wish: "我想从迷茫里找到一条路" }));
    expect(response.status).toBe(200);
    const body = matchResponseSchema.parse(await response.json());
    expect(listDreamCardIds()).toContain(body.cardId);
  });

  it("rejects client-uploaded card data", async () => {
    const response = await interpret(jsonRequest({ cardId: listDreamCardIds()[0], wish: "我想开始行动", card: { data: { acts: [] } } }));
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown card instead of trusting the client", async () => {
    const response = await interpret(jsonRequest({ cardId: "dream.client.fabricated", wish: "我想开始行动" }));
    expect(response.status).toBe(404);
  });

  it("returns a valid deterministic interpretation for an authoritative card", async () => {
    const cardId = listDreamCardIds()[0];
    const response = await interpret(jsonRequest({ cardId, wish: "我想开始行动" }));
    expect(response.status).toBe(200);
    expect(interpretResponseSchema.parse(await response.json()).cardId).toBe(cardId);
  });

  it("returns only the selected card preload manifest", async () => {
    const cardId = "dream.kailu-jiangjun.du-shan-ji";
    const response = await preload(new Request(`http://localhost/api/dream/preload/${cardId}`), { params: Promise.resolve({ cardId }) });
    expect(response.status).toBe(200);
    const body = await response.json() as { firstAct: string[]; story: string[]; codex: string[] };
    expect(body.firstAct.length).toBeLessThan(body.story.length);
    expect(body.story.some((url) => url.includes("stone-sill-village"))).toBe(true);
    expect(body.story.some((url) => url.includes("weaving-house"))).toBe(false);
    expect(body.codex.some((url) => url.includes("details/kailu-jiangjun"))).toBe(true);
    expect(body.codex.some((url) => url.includes("details/abu-mo"))).toBe(false);
  });
});
