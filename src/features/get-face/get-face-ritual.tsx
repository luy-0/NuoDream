"use client";

import Image from "next/image";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createChosenDreamSession } from "@/domain/dream-session";
import { writeDreamSession } from "@/domain/dream-session/storage";
import {
  CANDIDATE_PROMPT_VERSION,
  candidateResponseSchema,
  getFaceData,
  getRitualStoryMask,
  isCandidateSuccess,
  resolveChoiceCards,
  RITUAL_MASK_THUMBNAILS,
  type CandidateResponse
} from "@/domain/get-face";
import { preloadMatchedDreamResources } from "@/features/preload/resource-preloader";
import {
  clearGetFaceRitualSession,
  createInitialGetFaceRitualSession,
  readGetFaceRitualSession,
  transitionGetFaceRitual,
  writeGetFaceRitualSession,
  type GetFaceRitualEvent,
  type GetFaceRitualSession
} from "@/domain/get-face/session";
import "./get-face-ritual.css";

const CANDIDATE_REQUEST_TIMEOUT_MS = 22_000;
const MIN_MATCHING_DISPLAY_MS = 1450;
const REDUCED_REVEAL_MS = 20;
const REVEAL_MS = 520;
const WEARING_REDUCED_MS = 40;
const WEARING_MS = 920;

/** Candidate source used when a restored session no longer knows the provider. */
const RESTORED_CANDIDATE_SOURCE = { provider: "restored-session", promptVersion: CANDIDATE_PROMPT_VERSION } as const;

function reducer(state: GetFaceRitualSession, event: GetFaceRitualEvent) { return transitionGetFaceRitual(state, event); }

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

async function requestCandidates(wish: string, signal: AbortSignal): Promise<CandidateResponse> {
  const response = await fetch("/api/dream/candidates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wish }),
    signal
  });
  if (!response.ok) throw new Error(`candidates:${response.status}`);
  return candidateResponseSchema.parse(await response.json());
}

function RitualQuestion({
  phase,
  name,
  initialName,
  initialWish,
  notice,
  error,
  onSubmitName,
  onSubmitWish
}: {
  phase: "name" | "wish";
  name: string;
  initialName: string;
  initialWish: string;
  notice: string;
  error: string;
  onSubmitName: (name: string) => void;
  onSubmitWish: (wish: string) => void;
}) {
  // The restored draft remounts this component with a new key after hydration.
  const [nameInput, setNameInput] = useState(initialName);
  const [wishInput, setWishInput] = useState(initialWish);
  return <section className="ritual-question" aria-live="polite">
    <span>{phase === "name" ? "问 · 名" : "问 · 心"}</span>
    <h1>{phase === "name" ? "来者何人？" : `${name}，此刻何事令你止步？`}</h1>
    <p>{phase === "name" ? "名字是你在幻梦里留下的第一道声音。" : "说出现实中最想面对的一件事，坛前会为你请出两面，由你选定一场。"}</p>
    {notice ? <p className="ritual-notice" role="status">{notice}</p> : null}
    <form
      className="ritual-input-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (phase === "name") onSubmitName(nameInput);
        else onSubmitWish(wishInput);
      }}
    >
      {phase === "name"
        ? <input aria-label="你的名字" autoFocus autoComplete="off" maxLength={80} placeholder="在此留名" value={nameInput} onChange={(event) => setNameInput(event.target.value)} />
        : <textarea aria-label="现实困惑" autoFocus maxLength={280} rows={3} placeholder="例如：我害怕踏出第一步……" value={wishInput} onChange={(event) => setWishInput(event.target.value)} />}
      <button type="submit" aria-label="继续">→</button>
    </form>
    {error ? <p className="ritual-error" role="alert">{error}</p> : null}
  </section>;
}

export function GetFaceRitual({ onReturn }: { onReturn: () => void }) {
  const router = useRouter();
  // SSR and the first client render must match; sessionStorage is restored
  // after mount instead of inside the initializer.
  const [state, dispatch] = useReducer(reducer, undefined, createInitialGetFaceRitualSession);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [matchError, setMatchError] = useState("");
  const [revealedCardId, setRevealedCardId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [chosenCandidateId, setChosenCandidateId] = useState<string | null>(null);
  const selectingRef = useRef(false);
  const choiceTimerRef = useRef(0);
  const restoreRef = useRef<{ restored: GetFaceRitualSession | null; applied: boolean }>({ restored: null, applied: false });

  const candidateCardIds = state.candidateCardIds;
  const choiceCards = resolveChoiceCards(candidateCardIds ?? []);
  const selectedStoryMask = state.cardId ? getRitualStoryMask(state.cardId) : null;
  const selected = state.selectedMaskIndex ?? 0;

  useEffect(() => {
    const restored = readGetFaceRitualSession();
    if (restored) {
      restoreRef.current.restored = restored;
      dispatch({ type: "restore", state: restored });
    } else {
      restoreRef.current.applied = true;
    }
  }, []);

  useEffect(() => {
    const tracker = restoreRef.current;
    // Do not persist the initial name state over a stored session while the
    // post-mount restore is still pending.
    if (tracker.restored && !tracker.applied) {
      if (JSON.stringify(state) !== JSON.stringify(tracker.restored)) return;
      tracker.applied = true;
    }
    writeGetFaceRitualSession(state);
  }, [state]);

  useEffect(() => { selectingRef.current = false; }, [state.phase]);
  useEffect(() => () => window.clearTimeout(choiceTimerRef.current), []);

  useEffect(() => {
    if (state.phase !== "matching") return;
    let active = true;
    const controller = new AbortController();
    const started = Date.now();
    const timeout = window.setTimeout(() => controller.abort(), CANDIDATE_REQUEST_TIMEOUT_MS);
    let revealTimer = 0;

    void requestCandidates(state.wish, controller.signal).then((response) => {
      if (!active) return;
      if (!isCandidateSuccess(response)) {
        setNotice("还看不出两种可选择的照面方式。请把困惑写得更具体一些，再说一次。");
        dispatch({ type: "candidatesNeedDetail" });
        return;
      }
      const cards = resolveChoiceCards(response.candidates);
      if (cards.length !== 2) throw new Error("incomplete candidates");
      const remaining = Math.max(0, MIN_MATCHING_DISPLAY_MS - (Date.now() - started));
      revealTimer = window.setTimeout(() => {
        if (!active) return;
        dispatch({
          type: "candidatesResolved",
          candidates: [cards[0].cardId, cards[1].cardId],
          provider: response.provider,
          promptVersion: response.promptVersion
        });
      }, remaining);
    }).catch(() => {
      if (!active) return;
      setMatchError("坛前暂未回应。可以再问一次，或返回修改你的问题。");
    }).finally(() => { window.clearTimeout(timeout); });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.clearTimeout(revealTimer);
      controller.abort();
    };
  }, [state.phase, state.wish, attempt]);

  useEffect(() => {
    if (state.phase !== "mask" || !state.cardId) return;
    const cardId = state.cardId;
    const timer = window.setTimeout(() => setRevealedCardId(cardId), prefersReducedMotion() ? REDUCED_REVEAL_MS : REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [state.cardId, state.phase]);

  useEffect(() => {
    if (state.phase !== "mask" || !state.cardId) return;
    void preloadMatchedDreamResources(state.cardId, "story");
    router.prefetch?.(`/dream/${encodeURIComponent(state.cardId)}`);
  }, [router, state.cardId, state.phase]);

  useEffect(() => {
    if (state.phase !== "wearing" || !state.cardId) return;
    const cardId = state.cardId;
    let fallbackTimer = 0;
    void preloadMatchedDreamResources(cardId, "story");
    const timer = window.setTimeout(() => {
      const path = `/dream/${encodeURIComponent(cardId)}`;
      writeGetFaceRitualSession(transitionGetFaceRitual(state, { type: "wearComplete" }));
      router.push(path);
      fallbackTimer = window.setTimeout(() => {
        if (window.location.pathname !== path) window.location.assign(path);
      }, 120);
    }, prefersReducedMotion() ? WEARING_REDUCED_MS : WEARING_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(fallbackTimer);
    };
  }, [router, state]);

  const submitName = useCallback((value: string) => {
    if (!value.trim()) return setError("请留下你的名字。");
    setError(""); dispatch({ type: "nameSubmitted", name: value });
  }, []);

  const submitWish = useCallback((value: string) => {
    if (value.trim().length < 2) return setError("请说出至少两个字的现实困惑。");
    setError(""); setNotice(""); setMatchError(""); setChosenCandidateId(null);
    dispatch({ type: "wishSubmitted", wish: value });
  }, []);

  const chooseCandidate = useCallback((cardId: string) => {
    if (selectingRef.current || state.phase !== "choosing" || !state.candidateCardIds) return;
    if (!state.candidateCardIds.includes(cardId)) return;
    selectingRef.current = true;
    // A refresh keeps the real candidate source; only pre-field sessions fall back.
    const source = state.candidateSource ?? RESTORED_CANDIDATE_SOURCE;
    try {
      // The final single-story session exists only after an explicit choice.
      writeDreamSession(createChosenDreamSession(state.wish, {
        cardId,
        candidateCardIds: state.candidateCardIds,
        provider: source.provider,
        promptVersion: source.promptVersion
      }));
    } catch {
      // Storage can be unavailable; the ritual must not freeze on the cards.
    }
    void preloadMatchedDreamResources(cardId, "first-act");
    // Let the chosen card lift and the other one retire before the reveal.
    setChosenCandidateId(cardId);
    window.clearTimeout(choiceTimerRef.current);
    choiceTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "chooseCandidate", cardId });
    }, prefersReducedMotion() ? 0 : 240);
  }, [state]);

  const returnToWish = useCallback(() => {
    window.clearTimeout(choiceTimerRef.current);
    setMatchError(""); setNotice(""); setError(""); setChosenCandidateId(null);
    dispatch({ type: "returnToWish" });
  }, []);

  const retryMatching = useCallback(() => { setMatchError(""); setAttempt((value) => value + 1); }, []);

  return <main className="get-face-ritual" data-phase={state.phase}>
    <div className="get-face-altar" aria-hidden="true" />
    <div className="get-face-mist" aria-hidden="true" />
    <header className="get-face-header"><small>龙 · 坛 · 请 · 面</small></header>
    <span className="get-face-brand-mark"><Image className="get-face-brand-mark-image" src="/dream-assets/brand/nuo-dream-logo-dark.png" alt="大傩幻梦品牌标识" fill sizes="(max-width: 700px) 124px, 190px" loading="eager" /></span>

    {(state.phase === "name" || state.phase === "wish") ? <RitualQuestion
      key={`${state.phase}:${state.name}:${state.wish}`}
      phase={state.phase}
      name={state.name}
      initialName={state.name}
      initialWish={state.wish}
      notice={notice}
      error={error}
      onSubmitName={submitName}
      onSubmitWish={submitWish}
    /> : null}

    {state.phase === "choosing" ? <section className="choice-stage" aria-live="polite" aria-label="两面照见，请选择一面进入幻梦">
      <div className="choice-copy">
        <span>择 · 面</span>
        <h1>两面照见</h1>
        <p>两面已落在案前，翻开你更想面对的那一张。</p>
      </div>
      <div className="choice-grid" role="group" aria-label="选择一面进入幻梦">
        {choiceCards.map((card) => {
          const chosen = chosenCandidateId === card.cardId;
          const retired = chosenCandidateId !== null && !chosen;
          return <button
            key={card.cardId}
            type="button"
            className={`choice-card${chosen ? " is-chosen" : ""}${retired ? " is-dismissed" : ""}`}
            aria-label={`${card.maskName}：${card.prompt}`}
            aria-disabled={chosenCandidateId !== null || undefined}
            onClick={() => chooseCandidate(card.cardId)}
          >
            <span className="choice-card-inner">
              <span className="choice-card-back" aria-hidden="true" />
              <span className="choice-card-front">
                <span className="choice-card-mask"><span className="choice-card-mask-image"><Image src={card.artwork} alt="" fill sizes="(max-width: 700px) 45vw, 400px" loading="eager" /></span></span>
                <span className="choice-card-veil" aria-hidden="true" />
                <span className="choice-card-frame" aria-hidden="true" />
                <span className="choice-card-meta">
                  <span className="choice-card-name">{card.maskName}</span>
                  <span className="choice-card-prompt">{card.prompt}</span>
                </span>
              </span>
            </span>
          </button>;
        })}
      </div>
      <button type="button" className="choice-reset" onClick={returnToWish}>都不贴近，重新描述</button>
    </section> : null}

    {(state.phase === "matching" || state.phase === "mask" || state.phase === "wearing") ? <section className="mask-match-stage" aria-live="polite">
      <div className="mask-orbit" aria-label="八面傩面正在匹配">
        {getFaceData.masks.slice(0, RITUAL_MASK_THUMBNAILS.length).map((mask, index) => {
          const classes = ["orbit-mask", `orbit-mask-${index}`];
          const isSelected = state.phase === "mask" || state.phase === "wearing" ? index === selected : false;
          if (isSelected) classes.push("selected");
          const dismissed = state.phase !== "matching" && !isSelected;
          if (dismissed) classes.push("dismissed");
          return <div
            aria-label={mask.name}
            aria-hidden={dismissed ? true : undefined}
            className={classes.join(" ")}
            key={mask.id}
            role="img"
            style={{ "--mask-a": mask.visual.card.primary, "--mask-b": mask.visual.card.secondary } as React.CSSProperties}
          >
            <Image className="orbit-mask-thumbnail" src={RITUAL_MASK_THUMBNAILS[index]} alt="" width={150} height={200} loading="eager" unoptimized />
          </div>;
        })}
      </div>

      <div className="match-copy">
        <span>{state.phase === "matching" ? "识 · 惑 · 请 · 面" : "得 · 面"}</span>
        <h1>{state.phase === "matching" ? "八面寻心" : (selectedStoryMask?.maskName ?? getFaceData.masks[selected]?.name ?? "")}</h1>
        {state.phase === "matching" && matchError ? <>
          <p className="ritual-error" role="alert">{matchError}</p>
          <div className="match-actions">
            <button type="button" className="enter-dream-button" onClick={retryMatching}>再问一次</button>
            <button type="button" className="choice-reset" onClick={returnToWish}>返回修改问题</button>
          </div>
        </> : <p>{state.phase === "matching" ? "面具正在围绕你的困惑旋转，两面的轮廓正从八面中浮现。" : `职司 · ${selectedStoryMask?.duty ?? ""}`}</p>}
        {state.phase === "mask" && revealedCardId === state.cardId ? <button type="button" className="enter-dream-button" onClick={() => dispatch({ type: "enterStory" })}>入 戏</button> : null}
      </div>
      {state.phase === "wearing" ? <div className="wearing-flash" aria-hidden="true" /> : null}
    </section> : null}

    <button className="get-face-return" type="button" aria-label="返回首页" onClick={() => { clearGetFaceRitualSession(); onReturn(); }}>← 返回首页</button>
  </main>;
}
