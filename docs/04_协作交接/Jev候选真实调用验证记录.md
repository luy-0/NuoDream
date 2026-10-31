# Jev 候选真实调用验证记录

2026-10-31｜分支 `feat/jev-two-story-choice`｜执行：pi｜验收：Codex

本记录只保存合成测试样本与元信息。**未上传任何真实用户困惑，未记录 API Key、Authorization 头或含 Key 的请求。** 本地临时 Key 仅由服务端进程从被 Git 忽略的 `.env.local` 读取，测试日志不含其值。

**证据等级（先读）**：`candidate-samples.ts` 是执行代理（pi）编写的合成样本，`expected` 是代理给出的预期标签，仅经 Codex 桌面初审；**尚未经用户及另一人双人复核，不是盲测，也不是发布门槛**。下文的覆盖率只说明当前链路与策略可用，第二候选质量仍标为**待人工验收**。

## 接入事实

| 项 | 值 |
| --- | --- |
| Endpoint | `POST https://openrouter.ai/api/alpha/decisions` |
| 模型 | `typesafe/jev-1.14`（固定版本，响应中的具体实例例如 `typesafe/jev-1.14-20261014`） |
| 认证 | 服务端 `process.env.openrouter_jev_key`（Vercel 生产同名小写变量） |
| 单次超时 | 8s（`JEV_TIMEOUT_MS`） |
| 两轮总预算 | 18s（`JEV_TOTAL_TIMEOUT_MS`），覆盖首轮与可能的第二轮 |
| 组合 provider 外层上限 | 19s（`CANDIDATE_PROVIDER_TIMEOUT_MS`） |
| 浏览器等待上限 | 22s（`CANDIDATE_REQUEST_TIMEOUT_MS`），保证两次正常调用能完成 |
| 响应上限 | 32 KiB（`JEV_MAX_RESPONSE_BYTES`） |
| 请求体 | 仅 `state.wish` 与画像表生成的 `criteria`；不含姓名、会话 ID、故事全文或素材 |
| 使用字段 | 每轮的 `probabilities`（按概率降序）；第一轮判断最高概率是否严格为 `1`；第二轮取七项概率的 argmax（平分按画像表固定顺序）为第二候选；每轮 `choice` 必须属于本轮选项，且其概率必须等于当轮最大概率（并列时任一最高项都合法），否则视为无效响应并降级；`confidence` 忽略；不依赖键序 |
| 候选得分 | 成功响应新增 `candidateScores`：与候选等长的 `{ probability, round }` 元组，`probability` 为 Jev 原始值；首轮直取时 `round = 1/1`，二轮时 `1/2`；本地规则与降级为 `null`，`needs_detail` 不含此字段。前端不展示。候选 schemaVersion 为 `1.1.0`。 |

### 二选一策略（只存在于服务端代码）

1. 第一轮对八个选项发起 `Choice`；`instructions` 每轮固定为“哪一种困境最能解释用户当前的主要阻碍？”，`state` 只有修剪后的 `wish`，两轮完全相同。
2. 首轮最高概率 **严格小于 1**：直接按概率取前二，不发起第二轮。
3. 首轮出现概率 **严格等于 1** 的选项：把该选项从 `criteria` 剔除，用同一 wish 对其余七项发起第二轮；第二候选取**第二轮七项概率的 argmax**（平分按画像表固定顺序）。第二轮 `choice` 必须与当轮最高概率一致（并列时任一最高项合法），否则整轮判为无效响应并走降级；不会在 `choice` 指向低概率项时悄悄返回概率更低的故事。
4. 两轮都严格校验参与选项集合、概率（有限、[0,1]、恰好齐全）、`choice` 归属（属于本轮选项），并要求 `choice` 所处选项的概率等于当轮最大概率；并列时任一最高项都可作为合法 `choice`。选定候选仍按概率与固定画像顺序执行，不因 `choice` 改选低概率项。两个 `cardId` 必须不同且已注册。
5. 第二轮失败（HTTP/超时/结构异常）走统一降级：服务端本地确定性规则给出稳定两个候选，`provider` 标 `deterministic-local:fallback`；本地不足两个词命中则 `needs_detail`。
6. `instructions` 与 `state` 中不含任何二轮规则、概率判断或剔除说明；也不存在相邻故事边界规则。

## 如何复跑

```bash
# mock 契约测试（无需 Key）
npx vitest run src/server/ai/jev-candidate-provider.test.ts

# 真实 Jev 评估（读取 .env.local，不打印 Key 与愿望）
OPENROUTER_EVAL=1 npx vitest run src/server/ai/jev-candidate-provider.eval.test.ts --reporter=verbose
# 结果同时写入 $TMPDIR/jev-eval-report.json
```

样本定义：`src/server/ai/candidate-samples.ts`（执行代理编写的合成样本，`expected` 为代理预期标签，待用户及另一人复核；标注 `typical / near / vague / out-of-scope`）。

## 本次真实调用结果（两轮策略）

- 运行时间：2026-10-31T07:27:52Z（本地 15:27，使用新 `instructions`）
- 模型：`typesafe/jev-1.14`
- 样本：16 条（8 典型 + 4 相近主题 + 2 含糊 + 2 范围外）+ 1 次选项顺序反转对照
- 代理预期标签命中前二（待用户及另一人复核，非发布门槛）：典型 **8/8**，相近主题 **4/4**
- 触发第二轮：**6/16**（kailu、jiuwei、tangshi、saodi、liuyi、abumo 六条典型样本首轮出现 1.0；xianfeng 与 goubu 改用新句后首轮最高概率小于 1）；相近、含糊、范围外样本均只调用一次
- 延迟：两轮 2175–3202ms（均值约 2708ms）；单轮 1016–1307ms（均值约 1102ms）

| 样本 ID | 类别 | 轮次 | 代理预期标签（待复核） | 实际前二（第一候选、第二候选） |
| --- | --- | --- | --- | --- |
| typical-kailu | 典型 | 2 | 渡山记 | 渡山记、一梭花 |
| typical-xianfeng | 典型 | 1 | 一梭花 | 一梭花、合页记 |
| typical-jiuwei | 典型 | 2 | 第九坛 | 第九坛、合页记 |
| typical-tangshi | 典型 | 2 | 归正记 | 归正记、合页记 |
| typical-goubu | 典型 | 1 | 合页记 | 合页记、第九坛 |
| typical-saodi | 典型 | 2 | 余火记 | 余火记、归正记 |
| typical-liuyi | 典型 | 2 | 一信渡水 | 一信渡水、归正记 |
| typical-abumo | 典型 | 2 | 荒年开火 | 荒年开火、余火记 |
| near-saodi-tangshi | 相近 | 1 | 余火记 / 归正记 | 余火记、归正记 |
| near-xianfeng-abumo | 相近 | 1 | 一梭花 / 荒年开火 | 一梭花、荒年开火 |
| near-goubu-jiuwei | 相近 | 1 | 合页记 / 第九坛 | 第九坛、合页记 |
| near-kailu-xianfeng | 相近 | 1 | 渡山记 / 一梭花 | 一梭花、渡山记 |
| vague-direction | 含糊 | 1 | —（需用户改述） | 渡山记、第九坛 |
| vague-unease | 含糊 | 1 | —（需用户改述） | 归正记、荒年开火 |
| out-of-scope-movie | 范围外 | 1 | —（需用户改述） | 第九坛、渡山记 |
| out-of-scope-weather | 范围外 | 1 | —（需用户改述） | 一信渡水、渡山记 |

### 选项顺序对照（同一条愿望）

| 方向 | 轮次 | 前二 |
| --- | --- | --- |
| 画像表正序 | 2 | 一信渡水、归正记 |
| 画像表反序 | 2 | 一信渡水、归正记 |

本次反转后两次所得候选对一致（`samePair=true`）。注意上游概率估计仍可能在不同调用间波动；代码对**同一份固定上游答案**的顺序无关性由 mock 单测保证（键序、选项顺序、平分固定序）。

## 第二候选质量与争议案例

- 两轮规则生效后，典型样本的第二候选从“几乎总是渡山记”变为合页记（×3）、第九坛、归正记（×2）、余火记、一梭花。执行代理的阅读是这些第二项与首项形成可解释的邻近困境（例如「一梭花→合页记」：条件不足的守愿 vs 多重身份失约），但这是**代理判断，不是人工双人评审结论**。
- **第二候选质量：待人工验收。** 争议点包括 `typical-xianfeng` 与 `typical-jiuwei` 的第二候选同为合页记、区分度有限；`typical-kailu` 的第二候选一梭花是否比“另一条开路式困境”更贴近，评审意见可能分歧。
- 含糊与范围外输入仍会得到两面（Choice 必选一项）；用户出口是选择页“都不贴近，重新描述”。如果后续盲测显示这类输入容易被误读为“诊断”，应在本地增加明显的范围外拦截，而不是伪装成模型结论。
- 样本量小（16 条、单次运行），只能证明链路与分支可用，**不能宣称全面可靠，也不构成发布门槛达成**。发布门槛仍需按规格扩充人工标注样本、完成双人复核并保留调词后的盲测集。

### 已知边界

- 首轮概率恰好 `1` 是真实 Jev 在典型输入上的常见输出；策略只处理严格相等，`0.999` 不会触发第二轮（有单测）。
- 两轮都要求 `choice` 的概率等于当轮最大概率；`choice` 指向较低概率项时判为无效响应并统一降级，避免静默采用低概率故事。概率并列时任一最高项都是合法 `choice`，实际候选仍按固定画像顺序选定。
- 另做了一次小规模内部探测（8 条典型样本的第二轮，非正式评估，旧句时期）：8/8 次 `choice` 与最高概率项一致。样本仍很小，只说明当时没有观察到分歧，不构成长期保证；换用新 `instructions` 后以本次评估结果为准。
- 第二轮仍可能返回被剔除的选项（上游未遵守选项集合）→ 严格校验判为非法 → 统一降级。

## 相关实现

- `src/server/ai/jev-candidate-provider.ts`（真实调用、两轮策略、严格校验、超时/大小上限）
- `src/server/ai/candidate-provider.ts`（组合与降级、结构异常降级、元信息日志）
- `src/server/ai/candidate-samples.ts`、`src/server/ai/jev-candidate-provider.eval.test.ts`（样本与评估）
- `src/app/api/dream/candidates/route.ts`（对外契约与审计日志）
- `src/domain/get-face/candidate-schema.ts`（`candidateScores` 校验与 `1.1.0` 契约）
