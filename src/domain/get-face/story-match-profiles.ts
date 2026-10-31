/**
 * The single matching profile table for the eight registered stories.
 *
 * `criteria` is what the matcher sees: one sentence describing the concrete
 * dilemma a user is in. `prompt` is what the user sees on the choice card; it
 * is display copy only and never becomes a second matching rule. Neither
 * field names another story, and there is no “adjacent story” boundary rule.
 *
 * Keep all eight entries the same syntax and roughly the same length, and
 * re-review this table whenever `content/dream-cards/` changes.
 */
export interface StoryMatchProfile {
  /** Stable option name that is also meaningful to the matcher. */
  optionId: string;
  /** Registered `content/dream-cards/` id. */
  cardId: string;
  /** One sentence describing the user's situation (matcher input). */
  criteria: string;
  /** Non-spoiler copy shown on the two-choice cards. */
  prompt: string;
}

export const STORY_MATCH_PROFILE_VERSION = "get-face.profiles.v1.1";

export const STORY_MATCH_PROFILES: readonly StoryMatchProfile[] = [
  {
    optionId: "开路｜渡山记",
    cardId: "dream.kailu-jiangjun.du-shan-ji",
    criteria: "面对必须尝试的新事，因没有现成路径或成功保证而迟迟不敢开始。",
    prompt: "没有现成的路，你还愿意先走一步吗？"
  },
  {
    optionId: "承愿｜一梭花",
    cardId: "dream.xianfeng-xiaojie.yi-suo-hua",
    criteria: "清楚自己真心想做什么，却受钱、工具、时间或其他条件限制，怀疑能否继续。",
    prompt: "条件还不齐，你能怎样守住所愿？"
  },
  {
    optionId: "聚焦｜第九坛",
    cardId: "dream.jiu-wei-tu-di-shen.di-jiu-tan",
    criteria: "同时追逐多个目标，心力分散，难以决定此刻该把力量放在哪里。",
    prompt: "想做的事太多，你该先守哪一件？"
  },
  {
    optionId: "守住尺度｜归正记",
    cardId: "dream.tangshi-taipo.gui-zheng-ji",
    criteria: "他人的评价和要求不断牵动自己的判断，逐渐失去原本想做什么的把握。",
    prompt: "听过许多声音后，你怎样找回自己的尺度？"
  },
  {
    optionId: "整合身份｜合页记",
    cardId: "dream.goubu-panguan.he-ye-ji",
    criteria: "同时承担多种真实身份和对人的承诺，处处回应却不断失约，感到自己被撕成几份。",
    prompt: "面对这么多身份，你该怎样安排此刻的自己？"
  },
  {
    optionId: "结束余波｜余火记",
    cardId: "dream.saodi-heshang.yu-huo-ji",
    criteria: "事情已经结束或补救已经完成，愧疚、反复回想或自我惩罚仍占据现在的生活。",
    prompt: "记住过去以后，你能让今天继续吗？"
  },
  {
    optionId: "开口求助｜一信渡水",
    cardId: "dream.liuyi.yi-xin-du-shui",
    criteria: "需要帮助、回应或理解，却因怕丢脸、怕麻烦别人或怕被拒绝而难以开口。",
    prompt: "有些话难以说出，你愿意试着开口吗？"
  },
  {
    optionId: "重启生活｜荒年开火",
    cardId: "dream.abumo.huang-nian-kai-huo",
    criteria: "重大失去使原有生活崩塌，因想不明白生活的意义而连日常的事也难以继续。",
    prompt: "答案还没来，你能先把生活接起来吗？"
  }
];

export const STORY_MATCH_OPTION_IDS: readonly string[] = STORY_MATCH_PROFILES.map((profile) => profile.optionId);

/** Fixed option order; used for tie-breaking so candidate order is reproducible. */
export function storyMatchOptionOrder(cardId: string): number {
  return STORY_MATCH_PROFILES.findIndex((profile) => profile.cardId === cardId);
}

export function getStoryMatchProfile(cardId: string): StoryMatchProfile | null {
  return STORY_MATCH_PROFILES.find((profile) => profile.cardId === cardId) ?? null;
}

export function getStoryMatchProfileByOptionId(optionId: string): StoryMatchProfile | null {
  return STORY_MATCH_PROFILES.find((profile) => profile.optionId === optionId) ?? null;
}

/**
 * Builds the matcher-visible `criteria` map from the single profile table.
 * The map is the only source of option names and story ids sent upstream.
 */
export function buildStoryMatchCriteria(profiles: readonly StoryMatchProfile[] = STORY_MATCH_PROFILES): Record<string, string> {
  return Object.fromEntries(profiles.map((profile) => [profile.optionId, profile.criteria]));
}
