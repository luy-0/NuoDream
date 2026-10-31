import { z } from "zod";
import {
  CANDIDATE_PROMPT_VERSION,
  CANDIDATE_SCHEMA_VERSION,
  type CandidateRequest,
  type CandidateResponse,
  type StoryMatchProfile
} from "@/domain/get-face";
import type { CandidateProviderOptions, DreamCandidateProvider } from "./candidate-provider";

/** Fixed OpenRouter decisions endpoint and model; never a router or latest alias. */
export const JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.14";
export const JEV_PROVIDER_ID = "openrouter-jev";
/** Per-call cap. A normal second round must still fit in the total budget. */
export const JEV_TIMEOUT_MS = 8_000;
/** Total budget covering the first round and, when needed, the second round. */
export const JEV_TOTAL_TIMEOUT_MS = 18_000;
export const JEV_MAX_RESPONSE_BYTES = 32 * 1024;
/** Server-only environment variable configured in Vercel (lowercase, exact). */
export const OPENROUTER_KEY_ENV = "openrouter_jev_key";
export const CANDIDATE_INSTRUCTIONS = "哪一种困境最能解释用户当前的主要阻碍？";

export type JevFailureReason =
  | "missing_key"
  | "network_error"
  | "timeout"
  | "http_error"
  | "too_large"
  | "invalid_json"
  | "invalid_response";

export class JevCandidateProviderError extends Error {
  readonly reason: JevFailureReason;
  readonly upstreamStatus?: number;

  constructor(reason: JevFailureReason, message: string, upstreamStatus?: number) {
    super(message);
    this.name = "JevCandidateProviderError";
    this.reason = reason;
    this.upstreamStatus = upstreamStatus;
  }
}

export interface JevDecisionRequest {
  model: string;
  state: { wish: string };
  questions: {
    story: {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    };
  };
}

/**
 * Builds the upstream body strictly from the wish and the provided profiles:
 * no name, session id, story text or assets ever leave the server. Both rounds
 * use this exact shape — the second-round rule lives only in server code.
 */
export function buildJevDecisionRequest(request: CandidateRequest, profiles: readonly StoryMatchProfile[]): JevDecisionRequest {
  const criteria: Record<string, string> = {};
  for (const profile of profiles) criteria[profile.optionId] = profile.criteria;
  return {
    model: JEV_MODEL,
    state: { wish: request.wish.trim() },
    questions: {
      story: {
        type: "choice",
        instructions: CANDIDATE_INSTRUCTIONS,
        criteria
      }
    }
  };
}

const jevStoryAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().optional()
}).passthrough();

const jevEnvelopeSchema = z.object({
  model: z.string().optional(),
  answers: z.object({
    story: jevStoryAnswerSchema
  }).passthrough()
}).passthrough();

function invalidResponse(message: string): JevCandidateProviderError {
  return new JevCandidateProviderError("invalid_response", message);
}

export interface RankedJevDecision {
  /** The model's own selection; validated, and compared with the argmax. */
  choice: StoryMatchProfile;
  /** Options sorted by probability, ties broken by the fixed profile order. */
  ranked: { profile: StoryMatchProfile; probability: number }[];
}

/**
 * Validates one raw decision against the exact option set that was sent and
 * ranks it by probability. The model's `choice` must be one of the options
 * tied for the highest probability in that round; a lower-probability choice
 * is an inconsistent answer and never selects a candidate. The probability
 * object's key order is never trusted; `confidence` is ignored.
 */
export function parseJevDecision(payload: unknown, profiles: readonly StoryMatchProfile[]): RankedJevDecision {
  const envelope = jevEnvelopeSchema.safeParse(payload);
  if (!envelope.success) throw invalidResponse("missing answers.story choice payload");
  const answer = envelope.data.answers.story;
  const choice = profiles.find((profile) => profile.optionId === answer.choice);
  if (!choice) throw invalidResponse("choice is not one of the registered options for this round");

  const probabilityKeys = Object.keys(answer.probabilities);
  if (probabilityKeys.length !== profiles.length) {
    throw invalidResponse("probabilities must contain exactly the options sent in this round");
  }
  for (const profile of profiles) {
    const probability = answer.probabilities[profile.optionId];
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw invalidResponse(`probability for ${profile.optionId} must be a finite number in [0,1]`);
    }
  }

  const maxProbability = Math.max(...profiles.map((profile) => answer.probabilities[profile.optionId]));
  if (answer.probabilities[choice.optionId] !== maxProbability) {
    throw invalidResponse("choice does not match the highest probability of this round");
  }

  const ranked = profiles
    .map((profile, order) => ({ profile, order, probability: answer.probabilities[profile.optionId] }))
    .sort((left, right) => right.probability - left.probability || left.order - right.order)
    .map(({ profile, probability }) => ({ profile, probability }));
  return { choice, ranked };
}

/** Single-round selection helper (top two by probability). */
export function selectCandidatesFromDecision(
  payload: unknown,
  profiles: readonly StoryMatchProfile[]
): [StoryMatchProfile, StoryMatchProfile] {
  const { ranked } = parseJevDecision(payload, profiles);
  return [ranked[0].profile, ranked[1].profile];
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    if (byteLength(text) > maxBytes) throw new JevCandidateProviderError("too_large", "response exceeded the byte limit");
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JevCandidateProviderError("too_large", "response exceeded the byte limit");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function timeoutSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

/** Metadata-only audit of the second-round branch; never contains the wish. */
export interface JevRoundAuditEvent {
  event: "second-round";
  model: string;
  promptVersion: string;
  first: string;
  latencyMs: number;
}

export interface JevCandidateProviderOptions {
  fetchImpl?: typeof fetch;
  /** Resolved per call so a missing key never leaks into module state or logs. */
  apiKey?: () => string | undefined;
  endpoint?: string;
  /** Per-call cap; the total budget below still bounds both rounds together. */
  timeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseBytes?: number;
  log?: (event: JevRoundAuditEvent) => void;
}

export function readOpenRouterJevKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[OPENROUTER_KEY_ENV]?.trim();
  return value ? value : undefined;
}

export function createJevCandidateProvider(options: JevCandidateProviderOptions = {}): DreamCandidateProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? JEV_DECISIONS_URL;
  const timeoutMs = options.timeoutMs ?? JEV_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? JEV_TOTAL_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? JEV_MAX_RESPONSE_BYTES;
  const apiKey = options.apiKey ?? (() => readOpenRouterJevKey());
  const log = options.log ?? ((event: JevRoundAuditEvent) => {
    console.info("[dream-candidates:round-two]", JSON.stringify(event));
  });

  const buildResponse = ([first, second]: [StoryMatchProfile, StoryMatchProfile]): CandidateResponse => {
    if (first.cardId === second.cardId) throw invalidResponse("two candidates must be different stories");
    return {
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
      status: "candidates",
      candidates: [first.cardId, second.cardId],
      provider: JEV_PROVIDER_ID,
      promptVersion: CANDIDATE_PROMPT_VERSION
    };
  };

  return {
    id: JEV_PROVIDER_ID,
    model: JEV_MODEL,
    async selectCandidates(request: CandidateRequest, profiles: readonly StoryMatchProfile[], providerOptions: CandidateProviderOptions = {}): Promise<CandidateResponse> {
      const key = apiKey();
      if (!key) throw new JevCandidateProviderError("missing_key", "OpenRouter key is not configured");

      const deadline = timeoutSignal(totalTimeoutMs, providerOptions.signal);
      const startedAt = Date.now();

      const requestDecision = async (roundProfiles: readonly StoryMatchProfile[]): Promise<RankedJevDecision> => {
        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json"
            },
            body: JSON.stringify(buildJevDecisionRequest(request, roundProfiles)),
            cache: "no-store",
            signal: timeoutSignal(timeoutMs, deadline)
          });
        } catch (error) {
          if (isAbortError(error)) throw new JevCandidateProviderError("timeout", "OpenRouter request timed out");
          throw new JevCandidateProviderError("network_error", "OpenRouter request failed");
        }

        if (!response.ok) {
          throw new JevCandidateProviderError("http_error", `OpenRouter returned ${response.status}`, response.status);
        }

        let text: string;
        try {
          text = await readLimitedText(response, maxResponseBytes);
        } catch (error) {
          if (error instanceof JevCandidateProviderError) throw error;
          if (isAbortError(error)) throw new JevCandidateProviderError("timeout", "OpenRouter response timed out");
          throw new JevCandidateProviderError("network_error", "OpenRouter response could not be read");
        }

        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new JevCandidateProviderError("invalid_json", "OpenRouter response was not JSON");
        }
        return parseJevDecision(payload, roundProfiles);
      };

      const first = await requestDecision(profiles);
      const [top, runnerUp] = first.ranked;

      // Below 1: take the two most probable options from the first round.
      if (top.probability < 1) {
        return buildResponse([top.profile, runnerUp.profile]);
      }

      // Exactly 1: remove that option in server code and ask Jev for a second
      // choice among the remaining seven. Instructions and state are unchanged.
      const remaining = profiles.filter((profile) => profile.cardId !== top.profile.cardId);
      const second = await requestDecision(remaining);
      const secondTop = second.ranked[0];
      // The second candidate is the highest-probability option of round two
      // (ties use the fixed profile order). `parseJevDecision` already rejects
      // a `choice` that is not tied for that maximum or is outside the seven.
      log({
        event: "second-round",
        model: JEV_MODEL,
        promptVersion: CANDIDATE_PROMPT_VERSION,
        first: top.profile.cardId,
        latencyMs: Date.now() - startedAt
      });
      return buildResponse([top.profile, secondTop.profile]);
    }
  };
}
