import { RITUAL_MASK_THUMBNAILS } from "./ritual-mask-thumbnails";

/**
 * The single `cardId → 傩面` mapping shared by the ritual orbit, the choice
 * cards and the story-backed reveal. The array order is the fixed option
 * order used for tie-breaking; it is deliberately independent from the
 * registry order so the ritual stays stable when the registry is re-sorted.
 */
export interface RitualStoryMask {
  cardId: string;
  /** Index into `getFaceData.masks` and `RITUAL_MASK_THUMBNAILS`. */
  maskIndex: number;
  maskName: string;
  storyTitle: string;
  duty: string;
  thumbnail: string;
}

const ROWS = [
  { cardId: "dream.kailu-jiangjun.du-shan-ji", maskIndex: 0, maskName: "开路将军", storyTitle: "渡山记", duty: "勇气与开始" },
  { cardId: "dream.xianfeng-xiaojie.yi-suo-hua", maskIndex: 1, maskName: "先锋小姐", storyTitle: "一梭花", duty: "承愿与践行" },
  { cardId: "dream.jiu-wei-tu-di-shen.di-jiu-tan", maskIndex: 2, maskName: "九位土地神", storyTitle: "第九坛", duty: "寻找位置" },
  { cardId: "dream.tangshi-taipo.gui-zheng-ji", maskIndex: 3, maskName: "唐氏太婆", storyTitle: "归正记", duty: "守界与重建" },
  { cardId: "dream.goubu-panguan.he-ye-ji", maskIndex: 4, maskName: "勾簿判官", storyTitle: "合页记", duty: "归档旧事" },
  { cardId: "dream.saodi-heshang.yu-huo-ji", maskIndex: 5, maskName: "扫地和尚", storyTitle: "余火记", duty: "清理余响" },
  { cardId: "dream.liuyi.yi-xin-du-shui", maskIndex: 6, maskName: "柳毅", storyTitle: "一信渡水", duty: "传递真意" },
  { cardId: "dream.abumo.huang-nian-kai-huo", maskIndex: 7, maskName: "阿布摩", storyTitle: "荒年开火", duty: "荒年留种" }
] as const;

export const RITUAL_STORY_MASKS: readonly RitualStoryMask[] = ROWS.map((row) => ({
  ...row,
  thumbnail: RITUAL_MASK_THUMBNAILS[row.maskIndex]
}));

export const RITUAL_CARD_IDS: readonly string[] = RITUAL_STORY_MASKS.map((mask) => mask.cardId);

export function getRitualStoryMask(cardId: string): RitualStoryMask | null {
  return RITUAL_STORY_MASKS.find((mask) => mask.cardId === cardId) ?? null;
}

export function ritualMaskIndex(cardId: string): number | null {
  return getRitualStoryMask(cardId)?.maskIndex ?? null;
}
