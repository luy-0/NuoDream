import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { STORY_MATCH_PROFILES } from "@/domain/get-face";
import { CANDIDATE_SAMPLES, OPTION_ORDER_SAMPLE_ID, getCandidateSample } from "./candidate-samples";
import { createJevCandidateProvider } from "./jev-candidate-provider";

/**
 * Opt-in real Jev evaluation: `OPENROUTER_EVAL=1 npx vitest run
 * src/server/ai/jev-candidate-provider.eval.test.ts`.
 *
 * It never prints the key or the wish text, never mutates `process.env`, and
 * only writes an opaque sample id, category, candidate ids and latency.
 */
const ENABLED = process.env.OPENROUTER_EVAL === "1";

function readKeyFromEnvFile(): string | undefined {
  try {
    const text = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*openrouter_jev_key\s*=\s*(.+?)\s*$/);
      if (match) return match[1].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const apiKey = () => process.env.openrouter_jev_key?.trim() || readKeyFromEnvFile();
const reportPath = process.env.JEV_EVAL_REPORT ?? join(tmpdir(), "jev-eval-report.json");

interface SampleResult {
  id: string;
  category: string;
  expected: readonly string[];
  candidates: string[];
  rounds: 1 | 2;
  latencyMs: number;
}

describe.skipIf(!ENABLED)("real Jev candidate evaluation", () => {
  it("returns two registered candidates for every synthetic sample and reports top-2 coverage", async () => {
    const results: SampleResult[] = [];
    for (const sample of CANDIDATE_SAMPLES) {
      const secondRounds: string[] = [];
      const provider = createJevCandidateProvider({
        apiKey,
        log: (event) => { secondRounds.push(event.first); }
      });
      const startedAt = Date.now();
      // Evaluation-only retry for transient network errors; production keeps
      // the single-attempt degradation path.
      let attempts = 0;
      let response: Awaited<ReturnType<typeof provider.selectCandidates>> | null = null;
      for (; attempts < 2; attempts += 1) {
        try {
          response = await provider.selectCandidates({ wish: sample.wish }, STORY_MATCH_PROFILES);
          break;
        } catch (error) {
          const reason = (error as { reason?: string }).reason;
          if (attempts === 1 || reason !== "network_error") throw error;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!response) throw new Error(`sample ${sample.id} produced no response`);
      const latencyMs = Date.now() - startedAt;
      expect(response.status, sample.id).toBe("candidates");
      if (response.status !== "candidates") continue;
      expect(new Set(response.candidates).size, sample.id).toBe(2);
      for (const cardId of response.candidates) {
        expect(STORY_MATCH_PROFILES.some((profile) => profile.cardId === cardId), sample.id).toBe(true);
      }
      const rounds = secondRounds.length > 0 ? 2 : 1;
      results.push({ id: sample.id, category: sample.category, expected: sample.expected, candidates: [...response.candidates], rounds, latencyMs });
      console.info(`[jev-eval] id=${sample.id} category=${sample.category} rounds=${rounds} attempts=${attempts + 1} top2=${response.candidates.join(",")} latencyMs=${latencyMs}`);
    }

    const typical = results.filter((result) => result.category === "typical");
    const typicalHits = typical.filter((result) => result.candidates.some((cardId) => result.expected.includes(cardId)));
    const near = results.filter((result) => result.category === "near");
    const nearHits = near.filter((result) => result.candidates.some((cardId) => result.expected.includes(cardId)));
    const summary = {
      model: "typesafe/jev-1.14",
      ranAt: new Date().toISOString(),
      typicalCoverage: `${typicalHits.length}/${typical.length}`,
      nearCoverage: `${nearHits.length}/${near.length}`,
      secondRoundCount: results.filter((result) => result.rounds === 2).length,
      latencyMs: results.map((result) => result.latencyMs),
      results
    };
    console.info(`[jev-eval] summary typical=${summary.typicalCoverage} near=${summary.nearCoverage} secondRound=${summary.secondRoundCount}/${results.length}`);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  }, 240_000);

  it("records the pair for the same wish with the option order reversed", async () => {
    const provider = createJevCandidateProvider({ apiKey });
    const sample = getCandidateSample(OPTION_ORDER_SAMPLE_ID);
    if (!sample) throw new Error("missing order sample");
    const forward = await provider.selectCandidates({ wish: sample.wish }, STORY_MATCH_PROFILES);
    const reversedProfiles = [...STORY_MATCH_PROFILES].reverse();
    const reversed = await provider.selectCandidates({ wish: sample.wish }, reversedProfiles);
    expect(forward.status).toBe("candidates");
    expect(reversed.status).toBe("candidates");
    if (forward.status !== "candidates" || reversed.status !== "candidates") return;
    // Upstream probability estimates may vary between calls; record the actual
    // pairs instead of asserting bit-identical output. Our order-independence
    // for a *fixed* upstream answer is covered by the mocked unit test.
    console.info(`[jev-eval] order stability sample=${sample.id} forward=${forward.candidates.join(",")} reversed=${reversed.candidates.join(",")} samePair=${String([...forward.candidates].sort().join(",") === [...reversed.candidates].sort().join(","))}`);
  }, 60_000);
});
