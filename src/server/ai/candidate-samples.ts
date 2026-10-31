/**
 * Synthetic Chinese samples written by the implementing agent (pi) to exercise
 * the two-candidate matcher. They are authored fixtures — never real user
 * wishes — and are only used by the opt-in `OPENROUTER_EVAL=1` test.
 *
 * Evidence status: the `expected` labels are the agent's provisional guesses.
 * Codex has done a desk review only. The set has NOT been double-annotated by
 * humans, is NOT a blind test, and must NOT be treated as a release gate.
 */
export type CandidateSampleCategory = "typical" | "near" | "vague" | "out-of-scope";

export interface CandidateSample {
  /** Opaque id so evaluation logs never need to print the wish text. */
  id: string;
  category: CandidateSampleCategory;
  /** Agent-written provisional label; needs human review before it counts. */
  expected: readonly string[];
  wish: string;
}

const KAILU = "dream.kailu-jiangjun.du-shan-ji";
const XIANFENG = "dream.xianfeng-xiaojie.yi-suo-hua";
const JIUWEI = "dream.jiu-wei-tu-di-shen.di-jiu-tan";
const TANGSHI = "dream.tangshi-taipo.gui-zheng-ji";
const GOUBU = "dream.goubu-panguan.he-ye-ji";
const SAODI = "dream.saodi-heshang.yu-huo-ji";
const LIUYI = "dream.liuyi.yi-xin-du-shui";
const ABUMO = "dream.abumo.huang-nian-kai-huo";

export const CANDIDATE_SAMPLES: readonly CandidateSample[] = [
  {
    id: "typical-kailu",
    category: "typical",
    expected: [KAILU],
    wish: "我想转行做设计，但完全没有相关经验，也不敢迈出第一步。"
  },
  {
    id: "typical-xianfeng",
    category: "typical",
    expected: [XIANFENG],
    wish: "我很想继续做自己的手作，可要还房贷、照顾孩子，没时间也没钱，不知道该不该坚持下去。"
  },
  {
    id: "typical-jiuwei",
    category: "typical",
    expected: [JIUWEI],
    wish: "我同时在准备考研、找工作、学英语，每天都很忙，却不知道真正该把力气放在哪里。"
  },
  {
    id: "typical-tangshi",
    category: "typical",
    expected: [TANGSHI],
    wish: "我总在意同事和父母怎么评价我，慢慢不知道自己到底想要什么。"
  },
  {
    id: "typical-goubu",
    category: "typical",
    expected: [GOUBU],
    wish: "我既是女儿、妻子又是团队负责人，每一边都在等我回应，我总在失约，觉得自己被撕成几块。"
  },
  {
    id: "typical-saodi",
    category: "typical",
    expected: [SAODI],
    wish: "那件事已经过去两年了，我还是反复回想，觉得当时都是我的错。"
  },
  {
    id: "typical-liuyi",
    category: "typical",
    expected: [LIUYI],
    wish: "我明明很需要帮忙，却开不了口，怕麻烦别人，也怕被拒绝。"
  },
  {
    id: "typical-abumo",
    category: "typical",
    expected: [ABUMO],
    wish: "亲人走后，我什么都不想做，连每天吃饭睡觉都维持不下去。"
  },
  {
    id: "near-saodi-tangshi",
    category: "near",
    expected: [SAODI, TANGSHI],
    wish: "分手已经一年了，我还是反复想自己哪里做错了，也总担心别人怎么看我。"
  },
  {
    id: "near-xianfeng-abumo",
    category: "near",
    expected: [XIANFENG, ABUMO],
    wish: "我很想继续做自己的工作室，但钱快用完了；家里又刚出了事，连日常都提不起劲。"
  },
  {
    id: "near-goubu-jiuwei",
    category: "near",
    expected: [GOUBU, JIUWEI],
    wish: "我同时带两个项目和两个孩子的课外班，什么都想做好，结果每件事都做得不够。"
  },
  {
    id: "near-kailu-xianfeng",
    category: "near",
    expected: [KAILU, XIANFENG],
    wish: "我想做一个自己的产品，但没钱没资源，也不敢开始。"
  },
  {
    id: "vague-direction",
    category: "vague",
    expected: [],
    wish: "最近有点迷茫，不知道该往哪里走。"
  },
  {
    id: "vague-unease",
    category: "vague",
    expected: [],
    wish: "总觉得生活哪里不对劲。"
  },
  {
    id: "out-of-scope-movie",
    category: "out-of-scope",
    expected: [],
    wish: "帮我推荐一部适合周末看的电影。"
  },
  {
    id: "out-of-scope-weather",
    category: "out-of-scope",
    expected: [],
    wish: "明天上海会下雨吗？"
  }
];

/** Wish used to check that reversing the option order does not change the pair. */
export const OPTION_ORDER_SAMPLE_ID = "typical-liuyi";

export function getCandidateSample(id: string): CandidateSample | null {
  return CANDIDATE_SAMPLES.find((sample) => sample.id === id) ?? null;
}
