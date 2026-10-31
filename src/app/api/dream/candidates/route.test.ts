import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  dreamCandidateProvider: {
    id: "test-upstream",
    selectCandidates: vi.fn()
  }
}));

vi.mock("@/server/ai", () => ({ dreamCandidateProvider: provider.dreamCandidateProvider }));

const { POST } = await import("./route");

const KAILU = "dream.kailu-jiangjun.du-shan-ji";
const LIUYI = "dream.liuyi.yi-xin-du-shui";

function request(wish: string) {
  return new Request("http://localhost/api/dream/candidates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wish })
  });
}

const success = {
  schemaVersion: "1.1.0",
  status: "candidates",
  candidates: [KAILU, LIUYI],
  candidateScores: [
    { probability: .123456789123, round: 1 },
    { probability: .5, round: 2 }
  ],
  provider: "openrouter-jev",
  promptVersion: "get-face.profiles.v1.1"
};

beforeEach(() => {
  provider.dreamCandidateProvider.selectCandidates.mockReset();
});

describe("candidates route", () => {
  it("passes raw Jev scores through without normalizing, rounding or reordering", async () => {
    provider.dreamCandidateProvider.selectCandidates.mockResolvedValue(success);
    const response = await POST(request("我明明很需要帮忙，却开不了口，怕麻烦别人，也怕被拒绝。"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(success);
    expect(body.candidateScores[0].probability).toBe(.123456789123);
    expect(body.candidateScores.map((score: { round: number }) => score.round)).toEqual([1, 2]);
  });

  it("passes needs_detail through without a score field", async () => {
    provider.dreamCandidateProvider.selectCandidates.mockResolvedValue({
      schemaVersion: "1.1.0",
      status: "needs_detail",
      provider: "openrouter-jev",
      promptVersion: "get-face.profiles.v1.1"
    });
    const response = await POST(request("云朵落在雨后石头背面。"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("needs_detail");
    expect(body).not.toHaveProperty("candidateScores");
  });

  it("rejects an upstream score outside 0..1 instead of forwarding it", async () => {
    provider.dreamCandidateProvider.selectCandidates.mockResolvedValue({
      ...success,
      candidateScores: [{ probability: 1.5, round: 1 }, { probability: .5, round: 1 }]
    });
    const response = await POST(request("我明明很需要帮忙，却开不了口，怕麻烦别人，也怕被拒绝。"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "provider_returned_invalid_candidates" });
  });

  it("marks provider failure as unavailable", async () => {
    provider.dreamCandidateProvider.selectCandidates.mockRejectedValue(new Error("down"));
    const response = await POST(request("我明明很需要帮忙，却开不了口，怕麻烦别人，也怕被拒绝。"));
    expect(response.status).toBe(503);
  });
});
