import {
  candidateResponseSchema,
  type CandidateRequest,
  type CandidateResponse,
  type StoryMatchProfile
} from "@/domain/get-face";

/** Provider identifiers are open to future server-side implementations. */
export type CandidateProviderId = "deterministic-local" | (string & {});

export interface CandidateProviderOptions {
  signal?: AbortSignal;
}

/**
 * Replaceable boundary for the two-candidate ranking. The route and the
 * domain contract never depend on a specific upstream.
 */
export interface DreamCandidateProvider {
  readonly id: CandidateProviderId;
  /** Optional model identifier for metadata-only audit logs. */
  readonly model?: string;
  selectCandidates(
    request: CandidateRequest,
    profiles: readonly StoryMatchProfile[],
    options?: CandidateProviderOptions
  ): Promise<CandidateResponse>;
}

/**
 * Outer cap for the composite provider. It stays slightly above the Jev
 * client's own total budget (18s for up to two rounds) so the upstream call
 * degrades on its own terms.
 */
export const CANDIDATE_PROVIDER_TIMEOUT_MS = 19_000;

export class CandidateProviderTimeoutError extends Error {
  constructor() {
    super("candidate provider timed out");
    this.name = "CandidateProviderTimeoutError";
  }
}

export function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, external?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  external?.addEventListener("abort", abortFromExternal, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CandidateProviderTimeoutError());
    }, timeoutMs);
  });
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    external?.removeEventListener("abort", abortFromExternal);
  };
  return Promise.race([work(controller.signal), timeout]).finally(cleanup);
}

/**
 * Validates any provider answer against the shared schema and the profile
 * table, so a structurally wrong upstream reply can never reach the browser.
 */
export function validateCandidateSelection(value: unknown, profiles: readonly StoryMatchProfile[]): CandidateResponse | null {
  const parsed = candidateResponseSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.status === "candidates") {
    const known = new Set(profiles.map((profile) => profile.cardId));
    if (!parsed.data.candidates.every((cardId) => known.has(cardId))) return null;
  }
  return parsed.data;
}

/** Metadata-only degradation audit; never receives the wish or the name. */
export interface CandidateProviderAuditEvent {
  event: "candidate-provider-degraded";
  primary: string;
  reason: string;
  latencyMs: number;
}

export interface CandidateProviderLogger {
  warn(event: CandidateProviderAuditEvent): void;
}

const consoleLogger: CandidateProviderLogger = {
  warn(event) { console.warn("[dream-candidates]", JSON.stringify(event)); }
};

function failureReason(error: unknown): string {
  if (error instanceof CandidateProviderTimeoutError) return "timeout";
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (typeof reason === "string") return reason;
  return "provider_error";
}

export interface FallbackCandidateProviderOptions {
  timeoutMs?: number;
  logger?: CandidateProviderLogger;
}

/**
 * Wraps an upstream provider with the local deterministic rule. Any upstream
 * error, timeout, unreadable answer **or structurally invalid answer** falls
 * back to a stable pair from the local rule, and the response `provider` says
 * the answer was degraded.
 */
export function createFallbackCandidateProvider(
  primary: DreamCandidateProvider,
  fallback: DreamCandidateProvider,
  options: FallbackCandidateProviderOptions = {}
): DreamCandidateProvider {
  const timeoutMs = options.timeoutMs ?? CANDIDATE_PROVIDER_TIMEOUT_MS;
  const logger = options.logger ?? consoleLogger;
  return {
    id: `${primary.id}+${fallback.id}`,
    model: primary.model,
    async selectCandidates(request, profiles, providerOptions = {}) {
      const startedAt = Date.now();
      try {
        const upstream = await withTimeout(
          (signal) => primary.selectCandidates(request, profiles, { ...providerOptions, signal }),
          timeoutMs,
          providerOptions.signal
        );
        const validated = validateCandidateSelection(upstream, profiles);
        if (validated) return validated;
        logger.warn({
          event: "candidate-provider-degraded",
          primary: primary.id,
          reason: "invalid_response",
          latencyMs: Date.now() - startedAt
        });
      } catch (error) {
        logger.warn({
          event: "candidate-provider-degraded",
          primary: primary.id,
          reason: failureReason(error),
          latencyMs: Date.now() - startedAt
        });
      }

      const fallbackResult = validateCandidateSelection(
        await fallback.selectCandidates(request, profiles, providerOptions),
        profiles
      );
      if (!fallbackResult) throw new Error("fallback candidate provider returned an invalid response");
      return { ...fallbackResult, provider: `${fallback.id}:fallback` };
    }
  };
}
