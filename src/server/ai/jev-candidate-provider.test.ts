import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_MATCH_PROFILES, type StoryMatchProfile } from "@/domain/get-face";
import { createFallbackCandidateProvider } from "./candidate-provider";
import { createDeterministicCandidateProvider } from "./deterministic-candidate-provider";
import {
  CANDIDATE_INSTRUCTIONS,
  JEV_DECISIONS_URL,
  JEV_MODEL,
  JEV_PROVIDER_ID,
  JevCandidateProviderError,
  buildJevDecisionRequest,
  createJevCandidateProvider,
  selectCandidatesFromDecision
} from "./jev-candidate-provider";

const WISH = "我很难开口向别人求助，怕麻烦别人，也怕被拒绝";
const KAILU = STORY_MATCH_PROFILES[0];
const TANGSHI = STORY_MATCH_PROFILES[3];
const GOUBU = STORY_MATCH_PROFILES[4];
const SAODI = STORY_MATCH_PROFILES[5];
const LIUYI = STORY_MATCH_PROFILES[6];
const ABUMO = STORY_MATCH_PROFILES[7];

function probabilities(overrides: Record<string, number> = {}): Record<string, number> {
  const base: Record<string, number> = {};
  for (const profile of STORY_MATCH_PROFILES) base[profile.optionId] = .01;
  return { ...base, ...overrides };
}

function decisionPayload(options: {
  story?: Record<string, unknown>;
  probabilityOverrides?: Record<string, number>;
  choice?: string;
} = {}): unknown {
  const values = probabilities(options.probabilityOverrides);
  // Default to a valid choice: one of the options with the highest probability.
  const defaultChoice = Object.entries(values).sort((left, right) => right[1] - left[1])[0][0];
  return {
    model: "typesafe/jev-1.14-20261014",
    id: "gen-test",
    provider: "OpenRouter",
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    answers: {
      story: {
        type: "choice",
        choice: options.choice ?? defaultChoice,
        probabilities: values,
        confidence: .42,
        ...options.story
      }
    }
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function createFetch(payload: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => jsonResponse(payload, status));
}

function createSequencedFetch(payloads: readonly unknown[], status = 200) {
  let index = 0;
  return vi.fn<typeof fetch>(async () => {
    const payload = payloads[Math.min(index, payloads.length - 1)];
    index += 1;
    return jsonResponse(payload, status);
  });
}

function certainPayload(first: StoryMatchProfile): unknown {
  const values: Record<string, number> = {};
  for (const profile of STORY_MATCH_PROFILES) values[profile.optionId] = 0;
  values[first.optionId] = 1;
  return { answers: { story: { type: "choice", choice: first.optionId, probabilities: values, confidence: 1 } } };
}

function roundPayload(roundProfiles: readonly StoryMatchProfile[], choice: StoryMatchProfile, overrides: Record<string, number> = {}): unknown {
  const values: Record<string, number> = {};
  for (const profile of roundProfiles) values[profile.optionId] = .05;
  values[choice.optionId] = .6;
  Object.assign(values, overrides);
  return { answers: { story: { type: "choice", choice: choice.optionId, probabilities: values, confidence: .8 } } };
}

function requestBody(init: RequestInit | undefined): { model: string; state: { wish: string }; questions: { story: { type: string; instructions: string; criteria: Record<string, string> } } } {
  return JSON.parse(String(init?.body));
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Jev decision request", () => {
  it("uses the agreed single instruction sentence for both rounds", () => {
    expect(CANDIDATE_INSTRUCTIONS).toBe("哪一种困境最能解释用户当前的主要阻碍？");
  });

  it("sends only the wish and the eight profile criteria to the fixed model", () => {
    const body = buildJevDecisionRequest({ wish: `  ${WISH}  ` }, STORY_MATCH_PROFILES);
    expect(body.model).toBe(JEV_MODEL);
    expect(body.model).toBe("typesafe/jev-1.14");
    expect(body.state.wish).toBe(WISH);
    expect(body.questions.story.type).toBe("choice");
    expect(body.questions.story.instructions).toBe(CANDIDATE_INSTRUCTIONS);
    expect(Object.keys(body.questions.story.criteria)).toEqual(STORY_MATCH_PROFILES.map((profile) => profile.optionId));
    expect(body.questions.story.criteria[LIUYI.optionId]).toBe(LIUYI.criteria);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/sessionId|阿渡|name/);
    expect(serialized).not.toContain("synopsis");
  });

  it("calls the decisions endpoint with a bearer key and the fixed model", async () => {
    const fetchImpl = createFetch(decisionPayload({ probabilityOverrides: { [LIUYI.optionId]: .5, [TANGSHI.optionId]: .3 } }));
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", maxResponseBytes: 64 * 1024 });
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(JEV_DECISIONS_URL);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body)).model).toBe(JEV_MODEL);
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    expect(response).toEqual({
      schemaVersion: "1.0.0",
      status: "candidates",
      candidates: [LIUYI.cardId, TANGSHI.cardId],
      provider: JEV_PROVIDER_ID,
      promptVersion: expect.any(String)
    });
    expect(JSON.stringify(response)).not.toContain('"probabilities"');
  });
});

describe("Jev decision validation", () => {
  it("ranks by probability and ignores the probability key order", () => {
    const reversed = Object.fromEntries(Object.entries(probabilities({ [LIUYI.optionId]: .5, [TANGSHI.optionId]: .3 })).reverse());
    const payload = decisionPayload({ probabilityOverrides: { [LIUYI.optionId]: .5, [TANGSHI.optionId]: .3 } });
    (payload as { answers: { story: { probabilities: unknown } } }).answers.story.probabilities = reversed;
    expect(selectCandidatesFromDecision(payload, STORY_MATCH_PROFILES).map((profile) => profile.cardId))
      .toEqual([LIUYI.cardId, TANGSHI.cardId]);
  });

  it("selects the same pair from a fixed answer regardless of option order", () => {
    const fixedAnswer = { answers: { story: {
      type: "choice",
      choice: LIUYI.optionId,
      probabilities: probabilities({ [LIUYI.optionId]: .5, [SAODI.optionId]: .3, [ABUMO.optionId]: .2 })
    } } };
    const forward = selectCandidatesFromDecision(fixedAnswer, STORY_MATCH_PROFILES).map((profile) => profile.cardId);
    const reversed = selectCandidatesFromDecision(fixedAnswer, [...STORY_MATCH_PROFILES].reverse()).map((profile) => profile.cardId);
    expect(forward).toEqual([LIUYI.cardId, SAODI.cardId]);
    expect(reversed).toEqual(forward);
  });

  it("breaks probability ties with the fixed profile order", () => {
    const tie = selectCandidatesFromDecision(
      decisionPayload({ probabilityOverrides: { [ABUMO.optionId]: .4, [KAILU.optionId]: .4 } }),
      STORY_MATCH_PROFILES
    );
    expect(tie.map((profile) => profile.cardId)).toEqual([KAILU.cardId, ABUMO.cardId]);
  });

  it("accepts any tied highest-probability choice but still ranks by probability and fixed order", () => {
    const tie = selectCandidatesFromDecision(
      decisionPayload({ choice: ABUMO.optionId, probabilityOverrides: { [KAILU.optionId]: .4, [ABUMO.optionId]: .4 } }),
      STORY_MATCH_PROFILES
    );
    expect(tie.map((profile) => profile.cardId)).toEqual([KAILU.cardId, ABUMO.cardId]);
  });

  it("rejects a first-round choice below the highest probability", () => {
    expect(() => selectCandidatesFromDecision(
      decisionPayload({ choice: GOUBU.optionId, probabilityOverrides: { [LIUYI.optionId]: .5 } }),
      STORY_MATCH_PROFILES
    )).toThrow(/choice does not match the highest probability/);
  });

  it("ignores confidence", () => {
    const values = probabilities({ [LIUYI.optionId]: .5, [GOUBU.optionId]: .3 });
    const low = selectCandidatesFromDecision({ answers: { story: { type: "choice", choice: LIUYI.optionId, probabilities: values, confidence: .01 } } }, STORY_MATCH_PROFILES);
    const high = selectCandidatesFromDecision({ answers: { story: { type: "choice", choice: LIUYI.optionId, probabilities: values, confidence: .99 } } }, STORY_MATCH_PROFILES);
    expect(low.map((profile) => profile.cardId)).toEqual([LIUYI.cardId, GOUBU.cardId]);
    expect(high.map((profile) => profile.cardId)).toEqual(low.map((profile) => profile.cardId));
  });

  it.each([
    ["an extra probability key", { ...(decisionPayload() as object), answers: { story: { type: "choice", choice: KAILU.optionId, probabilities: { ...probabilities(), "额外选项": .01 } } } }],
    ["an out-of-range probability", decisionPayload({ probabilityOverrides: { [LIUYI.optionId]: 1.2 } })],
    ["a non-numeric probability", decisionPayload({ probabilityOverrides: { [LIUYI.optionId]: Number.NaN } })],
    ["an unregistered choice", decisionPayload({ choice: "隔壁故事" })],
    ["a non-choice answer", { ...(decisionPayload() as object), answers: { story: { type: "rank", choice: KAILU.optionId, probabilities: probabilities() } } }],
    ["a missing story answer", { answers: {} }]
  ])("rejects %s", (_label, payload) => {
    expect(() => selectCandidatesFromDecision(payload, STORY_MATCH_PROFILES)).toThrow(JevCandidateProviderError);
    try {
      selectCandidatesFromDecision(payload, STORY_MATCH_PROFILES);
    } catch (error) {
      expect((error as JevCandidateProviderError).reason).toBe("invalid_response");
    }
  });

  it("drops one probability when a key is deleted", () => {
    const payload = decisionPayload();
    const story = (payload as { answers: { story: { probabilities: Record<string, number> } } }).answers.story;
    delete story.probabilities[SAODI.optionId];
    expect(() => selectCandidatesFromDecision(payload, STORY_MATCH_PROFILES)).toThrow(/exactly the options sent in this round/);
  });
});

describe("Jev upstream failures", () => {
  it("reports a missing key without calling the network", async () => {
    const fetchImpl = vi.fn();
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => undefined });
    await expect(provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES))
      .rejects.toMatchObject({ reason: "missing_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports HTTP, JSON and transport failures", async () => {
    const http = createJevCandidateProvider({ fetchImpl: createFetch({ error: "nope" }, 502) as unknown as typeof fetch, apiKey: () => "test-key" });
    await expect(http.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "http_error", upstreamStatus: 502 });

    const notJson = createJevCandidateProvider({
      fetchImpl: (async () => new Response("<html>nope</html>", { status: 200 })) as unknown as typeof fetch,
      apiKey: () => "test-key"
    });
    await expect(notJson.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "invalid_json" });

    const offline = createJevCandidateProvider({
      fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch,
      apiKey: () => "test-key"
    });
    await expect(offline.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "network_error" });
  });

  it("aborts on timeout", async () => {
    const hanging = (async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })), { once: true });
    })) as unknown as typeof fetch;
    const provider = createJevCandidateProvider({ fetchImpl: hanging, apiKey: () => "test-key", timeoutMs: 10 });
    await expect(provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "timeout" });
  });

  it("rejects an oversized response", async () => {
    const provider = createJevCandidateProvider({
      fetchImpl: createFetch(decisionPayload()) as unknown as typeof fetch,
      apiKey: () => "test-key",
      maxResponseBytes: 16
    });
    await expect(provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("degrades through the wrapper without logging the wish", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = createFallbackCandidateProvider(
      createJevCandidateProvider({ fetchImpl: createFetch({ answers: {} }) as unknown as typeof fetch, apiKey: () => "test-key" }),
      createDeterministicCandidateProvider()
    );
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    expect(response.provider).toBe("deterministic-local:fallback");
    const logged = warn.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).toContain("candidate-provider-degraded");
    expect(logged).not.toContain(WISH);
    expect(logged).not.toContain("test-key");
    expect(logged).not.toContain("Bearer");
  });
});

describe("Jev certainty branch (second round)", () => {
  it("does not run a second round when the top probability is below 1", async () => {
    const fetchImpl = createSequencedFetch([decisionPayload({ probabilityOverrides: { [LIUYI.optionId]: .9, [TANGSHI.optionId]: .1 } })]);
    const log = vi.fn();
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log });
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    expect(response.status).toBe("candidates");
    if (response.status !== "candidates") return;
    expect(response.candidates).toEqual([LIUYI.cardId, TANGSHI.cardId]);
  });

  it("does not treat 0.999 as certainty", async () => {
    const values = probabilities({ [LIUYI.optionId]: .999 });
    const fetchImpl = createSequencedFetch([{ answers: { story: { type: "choice", choice: LIUYI.optionId, probabilities: values } } }]);
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key" });
    await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("removes the certain option and asks Jev again over the remaining seven", async () => {
    const remaining = STORY_MATCH_PROFILES.filter((profile) => profile.cardId !== LIUYI.cardId);
    const fetchImpl = createSequencedFetch([
      certainPayload(LIUYI),
      roundPayload(remaining, TANGSHI)
    ]);
    const log = vi.fn();
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log });
    const response = await provider.selectCandidates({ wish: `  ${WISH}  ` }, STORY_MATCH_PROFILES);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(response.status).toBe("candidates");
    if (response.status !== "candidates") return;
    expect(response.candidates).toEqual([LIUYI.cardId, TANGSHI.cardId]);

    const secondBody = requestBody(fetchImpl.mock.calls[1][1]);
    expect(Object.keys(secondBody.questions.story.criteria)).toHaveLength(7);
    expect(secondBody.questions.story.criteria).not.toHaveProperty(LIUYI.optionId);
    expect(secondBody.questions.story.criteria).toHaveProperty(TANGSHI.optionId, TANGSHI.criteria);
    // The rule lives only in code: identical instructions/state, no extra fields.
    expect(secondBody.questions.story.instructions).toBe(CANDIDATE_INSTRUCTIONS);
    expect(secondBody.questions.story.type).toBe("choice");
    expect(secondBody.state).toEqual({ wish: WISH });
    expect(secondBody.questions.story.instructions).not.toMatch(/第二|剔除|概率|排除|移除|round/i);
    expect(Object.keys(secondBody).sort()).toEqual(["model", "questions", "state"]);
    expect(Object.keys(secondBody.questions)).toEqual(["story"]);
    expect(Object.keys(secondBody.questions.story).sort()).toEqual(["criteria", "instructions", "type"]);

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({ event: "second-round", first: LIUYI.cardId });
    expect(JSON.stringify(log.mock.calls)).not.toContain(WISH);
  });

  it("rejects a second round whose choice has a lower probability than the round maximum", async () => {
    const remaining = STORY_MATCH_PROFILES.filter((profile) => profile.cardId !== SAODI.cardId);
    const fetchImpl = createSequencedFetch([
      certainPayload(SAODI),
      roundPayload(remaining, TANGSHI, { [ABUMO.optionId]: .95 })
    ]);
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log: () => undefined });
    await expect(provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES))
      .rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("uses the highest-probability option of the second round", async () => {
    const remaining = STORY_MATCH_PROFILES.filter((profile) => profile.cardId !== SAODI.cardId);
    const fetchImpl = createSequencedFetch([
      certainPayload(SAODI),
      roundPayload(remaining, ABUMO, { [ABUMO.optionId]: .9 })
    ]);
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log: () => undefined });
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    if (response.status !== "candidates") throw new Error("expected candidates");
    expect(response.candidates).toEqual([SAODI.cardId, ABUMO.cardId]);
  });

  it("accepts either tied top option as the second-round choice but uses the fixed order for the candidate", async () => {
    const remaining = STORY_MATCH_PROFILES.filter((profile) => profile.cardId !== SAODI.cardId);
    const payload = roundPayload(remaining, GOUBU, { [GOUBU.optionId]: .6, [TANGSHI.optionId]: .6 });
    const fetchImpl = createSequencedFetch([certainPayload(SAODI), payload]);
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log: () => undefined });
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    if (response.status !== "candidates") throw new Error("expected candidates");
    // Choice GOUBU is tied for the maximum, so it is legal; the candidate is
    // still the earlier profile in the fixed order (TANGSHI).
    expect(response.candidates).toEqual([SAODI.cardId, TANGSHI.cardId]);
  });

  it("breaks second-round probability ties with the fixed profile order", async () => {
    const remaining = STORY_MATCH_PROFILES.filter((profile) => profile.cardId !== SAODI.cardId);
    const payload = roundPayload(remaining, TANGSHI, { [GOUBU.optionId]: .6, [TANGSHI.optionId]: .6 });
    const fetchImpl = createSequencedFetch([certainPayload(SAODI), payload]);
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log: () => undefined });
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    if (response.status !== "candidates") throw new Error("expected candidates");
    expect(response.candidates).toEqual([SAODI.cardId, TANGSHI.cardId]);
  });

  it("rejects a second round that still contains the excluded option", async () => {
    const fetchImpl = createSequencedFetch([
      certainPayload(LIUYI),
      decisionPayload({ probabilityOverrides: { [LIUYI.optionId]: 1 } })
    ]);
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log: () => undefined });
    await expect(provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("rejects a second round whose probabilities do not cover exactly the seven sent options", async () => {
    const remaining = STORY_MATCH_PROFILES.filter((profile) => profile.cardId !== LIUYI.cardId);
    const payload = roundPayload(remaining, TANGSHI);
    const story = (payload as { answers: { story: { probabilities: Record<string, number> } } }).answers.story;
    story.probabilities[LIUYI.optionId] = 0;
    const fetchImpl = createSequencedFetch([certainPayload(LIUYI), payload]);
    const provider = createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log: () => undefined });
    await expect(provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("degrades through the wrapper when the second round fails", async () => {
    const warnings: unknown[] = [];
    const fetchImpl = createSequencedFetch([certainPayload(LIUYI), { answers: {} }]);
    const provider = createFallbackCandidateProvider(
      createJevCandidateProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => "test-key", log: () => undefined }),
      createDeterministicCandidateProvider(),
      { logger: { warn: (event) => warnings.push(event) } }
    );
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    expect(response.provider).toBe("deterministic-local:fallback");
    expect(warnings).toEqual([expect.objectContaining({ reason: "invalid_response" })]);
  });

  it("degrades when the second round returns HTTP 500", async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1 ? jsonResponse(certainPayload(LIUYI)) : jsonResponse({ error: "upstream" }, 500);
    });
    const provider = createFallbackCandidateProvider(
      createJevCandidateProvider({ fetchImpl, apiKey: () => "test-key", log: () => undefined }),
      createDeterministicCandidateProvider(),
      { logger: { warn: () => undefined } }
    );
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    expect(response.provider).toBe("deterministic-local:fallback");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("Jev timeout budget", () => {
  const delay = (ms: number, payload: unknown) => new Promise<Response>((resolve) => {
    setTimeout(() => resolve(jsonResponse(payload)), ms);
  });

  it("completes two normal rounds inside the total budget", async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;
      return call === 1
        ? delay(10, certainPayload(LIUYI))
        : delay(10, roundPayload(STORY_MATCH_PROFILES.filter((profile) => profile.cardId !== LIUYI.cardId), TANGSHI));
    });
    const provider = createJevCandidateProvider({
      fetchImpl,
      apiKey: () => "test-key",
      timeoutMs: 1_000,
      totalTimeoutMs: 1_000,
      log: () => undefined
    });
    const response = await provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES);
    if (response.status !== "candidates") throw new Error("expected candidates");
    expect(response.candidates).toEqual([LIUYI.cardId, TANGSHI.cardId]);
  });

  it("aborts the second round when the total budget is exhausted", async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      call += 1;
      if (call === 1) return jsonResponse(certainPayload(LIUYI));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })), { once: true });
      });
    });
    const provider = createJevCandidateProvider({
      fetchImpl,
      apiKey: () => "test-key",
      timeoutMs: 1_000,
      totalTimeoutMs: 40,
      log: () => undefined
    });
    await expect(provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "timeout" });
  });

  it("aborts a single slow round at the per-call cap", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })), { once: true });
    }));
    const provider = createJevCandidateProvider({ fetchImpl, apiKey: () => "test-key", timeoutMs: 20, totalTimeoutMs: 1_000 });
    await expect(provider.selectCandidates({ wish: WISH }, STORY_MATCH_PROFILES)).rejects.toMatchObject({ reason: "timeout" });
  });
});
