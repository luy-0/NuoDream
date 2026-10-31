import { NextResponse } from "next/server";
import { getDreamCard } from "@/domain/dream-card";
import {
  candidateRequestSchema,
  candidateResponseSchema,
  isCandidateSuccess,
  STORY_MATCH_PROFILES
} from "@/domain/get-face";
import { dreamCandidateProvider } from "@/server/ai";

const PROFILE_CARD_IDS = new Set(STORY_MATCH_PROFILES.map((profile) => profile.cardId));

interface CandidateAuditEvent {
  status: "candidates" | "needs_detail" | "rejected" | "provider_error";
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  candidates?: string[];
}

/** Auditable summary only: never the wish, the name or any free text. */
function logCandidateAudit(event: CandidateAuditEvent): void {
  console.info("[dream-candidates]", JSON.stringify(event));
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = candidateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    logCandidateAudit({
      status: "rejected",
      provider: "none",
      model: "none",
      promptVersion: "none",
      latencyMs: Date.now() - startedAt
    });
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await dreamCandidateProvider.selectCandidates(parsed.data, STORY_MATCH_PROFILES);
  } catch {
    logCandidateAudit({
      status: "provider_error",
      provider: dreamCandidateProvider.id,
      model: dreamCandidateProvider.model ?? "none",
      promptVersion: "none",
      latencyMs: Date.now() - startedAt
    });
    return NextResponse.json({ error: "candidate_provider_unavailable" }, { status: 503 });
  }

  const response = candidateResponseSchema.safeParse(body);
  if (!response.success) {
    logCandidateAudit({
      status: "provider_error",
      provider: dreamCandidateProvider.id,
      model: dreamCandidateProvider.model ?? "none",
      promptVersion: "unknown",
      latencyMs: Date.now() - startedAt
    });
    return NextResponse.json({ error: "provider_returned_invalid_candidates" }, { status: 502 });
  }

  if (isCandidateSuccess(response.data)) {
    const [first, second] = response.data.candidates;
    const known = PROFILE_CARD_IDS.has(first) && PROFILE_CARD_IDS.has(second) && first !== second;
    if (!known || !getDreamCard(first) || !getDreamCard(second)) {
      logCandidateAudit({
        status: "provider_error",
        provider: response.data.provider,
        model: dreamCandidateProvider.model ?? "none",
        promptVersion: response.data.promptVersion,
        latencyMs: Date.now() - startedAt
      });
      return NextResponse.json({ error: "provider_returned_unknown_candidates" }, { status: 502 });
    }
  }

  logCandidateAudit({
    status: response.data.status,
    provider: response.data.provider,
    model: dreamCandidateProvider.model ?? "none",
    promptVersion: response.data.promptVersion,
    latencyMs: Date.now() - startedAt,
    ...(isCandidateSuccess(response.data) ? { candidates: [...response.data.candidates] } : {})
  });
  return NextResponse.json(response.data);
}
