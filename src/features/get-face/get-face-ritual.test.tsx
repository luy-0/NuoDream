// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DREAM_SESSION_STORAGE_KEY, readDreamSession } from "@/domain/dream-session/storage";
import { GET_FACE_RITUAL_STORAGE_KEY, writeGetFaceRitualSession, type GetFaceRitualSession } from "@/domain/get-face/session";
import { GetFaceRitual } from "./get-face-ritual";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const preloader = vi.hoisted(() => ({
  preloadMatchedDreamResources: vi.fn<(cardId: string, scope: string) => Promise<void>>(async () => undefined)
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ ...router, prefetch: vi.fn() }) }));
vi.mock("@/features/preload/resource-preloader", () => preloader);

const KAILU = "dream.kailu-jiangjun.du-shan-ji";
const LIUYI = "dream.liuyi.yi-xin-du-shui";
const WISH = "我很难开口向别人求助，怕麻烦别人，也怕被拒绝";

function candidatesResponse(candidates: [string, string] = [LIUYI, KAILU], provider = "deterministic-local") {
  return {
    schemaVersion: "1.0.0",
    status: "candidates",
    candidates,
    provider,
    promptVersion: "get-face.profiles.v1"
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const SOURCE = { provider: "openrouter-jev", promptVersion: "get-face.profiles.v1" };

function matchingSession(wish = WISH): GetFaceRitualSession {
  return {
    schemaVersion: "3.0.0",
    phase: "matching",
    name: "阿渡",
    wish,
    candidateCardIds: null,
    candidateSource: null,
    selectedMaskIndex: null,
    cardId: null
  };
}

function choosingSession(source: GetFaceRitualSession["candidateSource"] = SOURCE): GetFaceRitualSession {
  return { ...matchingSession(), phase: "choosing", candidateCardIds: [LIUYI, KAILU], candidateSource: source };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  router.push.mockReset();
  preloader.preloadMatchedDreamResources.mockClear();
  window.sessionStorage.removeItem(GET_FACE_RITUAL_STORAGE_KEY);
  window.sessionStorage.removeItem(DREAM_SESSION_STORAGE_KEY);
});

describe("GetFaceRitual", () => {
  it("renders the brand mark in the lower-right corner before asking for a name", () => {
    const onReturn = vi.fn();
    const { container } = render(<GetFaceRitual onReturn={onReturn} />);
    expect(screen.getByRole("heading", { name: "来者何人？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(onReturn).toHaveBeenCalledOnce();
    expect(container.querySelector(".get-face-brand-mark img")?.getAttribute("src")).toContain("nuo-dream-logo-dark.png");
  });

  it("turns the ringing eight masks into two choices, then creates the session only after a pick", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(candidatesResponse()));
    writeGetFaceRitualSession(matchingSession());

    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);
    expect(container.querySelector(".mask-match-stage")).toBeTruthy();
    expect(container.querySelectorAll(".orbit-mask")).toHaveLength(8);

    await act(async () => { await vi.advanceTimersByTimeAsync(1450); });

    expect(container.querySelector('.get-face-ritual[data-phase="choosing"]')).toBeTruthy();
    expect(container.querySelectorAll(".orbit-mask.candidate")).toHaveLength(2);
    expect(container.querySelectorAll(".orbit-mask.dismissed")).toHaveLength(6);
    expect(container.querySelectorAll(".choice-card")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "入 戏" })).toBeNull();
    // Nothing is created, persisted or preloaded before the user chooses.
    expect(readDreamSession(window.sessionStorage)).toBeNull();
    expect(preloader.preloadMatchedDreamResources).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith("/api/dream/candidates", expect.objectContaining({ method: "POST" }));

    fireEvent.click(screen.getByRole("button", { name: /柳毅/ }));

    const session = readDreamSession(window.sessionStorage);
    expect(session?.match.cardId).toBe(LIUYI);
    expect(session?.selection).toMatchObject({
      kind: "user-choice",
      candidateCardIds: [LIUYI, KAILU],
      chosenCardId: LIUYI,
      provider: "deterministic-local"
    });
    expect(preloader.preloadMatchedDreamResources).toHaveBeenCalledWith(LIUYI, "first-act");
    expect(preloader.preloadMatchedDreamResources).not.toHaveBeenCalledWith(KAILU, "first-act");
    expect(container.querySelector('.get-face-ritual[data-phase="mask"]')).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(520); });
    fireEvent.click(screen.getByRole("button", { name: "入 戏" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(920); });

    expect(router.push).toHaveBeenCalledWith(`/dream/${LIUYI}`);
  });

  it("stops on an explicit pick and ignores a second click", async () => {
    vi.useFakeTimers();
    writeGetFaceRitualSession(choosingSession());
    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);

    const card = screen.getByRole("button", { name: /柳毅/ });
    fireEvent.click(card);
    fireEvent.click(card);

    expect(container.querySelector('.get-face-ritual[data-phase="mask"]')).toBeTruthy();
    expect(preloader.preloadMatchedDreamResources.mock.calls.filter(([cardId, scope]) => cardId === LIUYI && scope === "first-act")).toHaveLength(1);
  });

  it("restores the two choices after a refresh without creating a final session", () => {
    writeGetFaceRitualSession(choosingSession());
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);

    expect(container.querySelector('.get-face-ritual[data-phase="choosing"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: /柳毅/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /开路将军/ })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readDreamSession(window.sessionStorage)).toBeNull();
  });

  it("keeps waiting long enough for a real two-round candidate request", async () => {
    vi.useFakeTimers();
    let resolveFetch: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending);
    writeGetFaceRitualSession(matchingSession());

    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(container.querySelector('.get-face-ritual[data-phase="matching"]')).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      resolveFetch(jsonResponse(candidatesResponse()));
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1450); });

    expect(container.querySelector('.get-face-ritual[data-phase="choosing"]')).toBeTruthy();
    expect(container.querySelectorAll(".choice-card")).toHaveLength(2);
  });

  it("aborts a request that outlives the browser wait limit", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }));
    writeGetFaceRitualSession(matchingSession());

    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(22_000); });

    expect(container.querySelector('.get-face-ritual[data-phase="matching"]')).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("坛前暂未回应");
    expect(screen.getByRole("button", { name: "再问一次" })).toBeTruthy();
  });

  it("offers retry and a way back to the wish when the candidate request fails", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(candidatesResponse()));
    writeGetFaceRitualSession(matchingSession());

    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByRole("alert").textContent).toContain("坛前暂未回应");
    expect(container.querySelectorAll(".choice-card")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "再问一次" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1450); });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".choice-card")).toHaveLength(2);
  });

  it("returns to the editable wish form from a failed request", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    writeGetFaceRitualSession(matchingSession());

    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "返回修改问题" }));

    expect(container.querySelector('.get-face-ritual[data-phase="wish"]')).toBeTruthy();
    expect((screen.getByLabelText("现实困惑") as HTMLTextAreaElement).value).toBe(WISH);
  });

  it("asks for a clearer problem when the server cannot find two candidates", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      schemaVersion: "1.0.0",
      status: "needs_detail",
      provider: "deterministic-local",
      promptVersion: "get-face.profiles.v1"
    }));
    writeGetFaceRitualSession(matchingSession("说不清"));

    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(container.querySelector('.get-face-ritual[data-phase="wish"]')).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("更具体");
  });

  it("rejects a malformed candidate payload instead of guessing two stories", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(candidatesResponse([LIUYI, LIUYI])));
    writeGetFaceRitualSession(matchingSession());

    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(container.querySelector('.get-face-ritual[data-phase="matching"]')).toBeTruthy();
    expect(container.querySelectorAll(".choice-card")).toHaveLength(0);
    expect(readDreamSession(window.sessionStorage)).toBeNull();
  });

  it("exposes both restored choices as ordinary focusable buttons", () => {
    writeGetFaceRitualSession(choosingSession());
    render(<GetFaceRitual onReturn={vi.fn()} />);
    const card = screen.getByRole("button", { name: /开路将军/ });
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.click(card);
    const session = readDreamSession(window.sessionStorage);
    expect(session?.match.cardId).toBe(KAILU);
    expect(session?.selection?.provider).toBe("openrouter-jev");
    expect(session?.selection?.promptVersion).toBe("get-face.profiles.v1");
  });

  it("falls back to a labelled source only for pre-source restored choices", () => {
    writeGetFaceRitualSession(choosingSession(null));
    render(<GetFaceRitual onReturn={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /柳毅/ }));
    const session = readDreamSession(window.sessionStorage);
    expect(session?.selection).toMatchObject({ provider: "restored-session", promptVersion: "get-face.profiles.v1" });
  });

  it("keeps the legacy single-story mask reveal and dream entry working", async () => {
    vi.useFakeTimers();
    writeGetFaceRitualSession({
      schemaVersion: "3.0.0",
      phase: "mask",
      name: "阿渡",
      wish: "我想找到一条路",
      candidateCardIds: null,
      candidateSource: null,
      selectedMaskIndex: 0,
      cardId: KAILU
    });

    const { container } = render(<GetFaceRitual onReturn={vi.fn()} />);
    expect(container.querySelector(".mask-match-stage")).toBeTruthy();
    const orbitImages = Array.from(container.querySelectorAll(".orbit-mask img")).map((image) => image.getAttribute("src") ?? "");
    expect(orbitImages).toHaveLength(8);
    expect(orbitImages.every((src) => src.includes("/dream-assets/ui/ritual/masks/"))).toBe(true);
    expect(screen.queryByRole("button", { name: "入 戏" })).toBeNull();
    expect(screen.getByRole("heading", { name: "开路将军" })).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(520); });
    fireEvent.click(screen.getByRole("button", { name: "入 戏" }));
    expect(container.querySelector('.get-face-ritual[data-phase="wearing"]')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(920); });

    expect(router.push).toHaveBeenCalledWith(`/dream/${KAILU}`);
    expect(preloader.preloadMatchedDreamResources).toHaveBeenCalledWith(KAILU, "story");
  });
});
