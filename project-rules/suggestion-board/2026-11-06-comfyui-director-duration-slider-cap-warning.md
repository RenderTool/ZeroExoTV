---
状态: merged
创建: 2026-11-06
来源: 验收反馈（附外部产品滑动条参考图）
关联项目: zeroexo-comfyui（本地版，Plan#83 验收轮）
归属建议: 独立处理（热修）；用户明示「参考图只给交互形式，风格按本项目来」
---

# 导演台时长下拉 → 0–30s 滑动条，滑动过程中实时提醒是否超推荐时长

## 一、需求 / 问题描述（用户原话）

> 另外导演台中时间下拉可以做成滑动条，从0-30s滑动，并且滑动过程中要提醒用户是否超过推荐时长！我给你的只是参考，实际风格要按我们的项目本身来

## 二、背景与现状（逐条实锤）

| 项 | 现状 | 结论 |
|---|---|---|
| 控件形态 | `DirectorPromptPanel` 的时长胶囊（`data-meta-duration`）点开是 Popover + `InputNumber`（min 0.2 / max 120 / step 0.1）+ 帧数只读文本 | 数字框适合精确回填，不适合"这段该多长"的直觉调节 → 换滑动条 |
| 0–30 的出处 | 引擎单段帧上限 `MAX_GEN_FRAMES = 736` @ `DIRECTOR_FPS = 24` ≈ 30.67s；`duration_sec` schema 却允许到 120s | 用户给的 30s 与引擎天花板天然一致，不是拍脑袋；上限取整 30s |
| 「推荐时长」定义 | 项目里**没有**现成常量；但延续法预算 `generationFrameBudget = align(可见帧 + ctx帧) ≤ 736`，`validateRunSelection` 的 `frame-overflow` 就是按这个判 | 推荐上限必须**随段间引导 ctx 动态扣回**（ctx=22 → 29s，ctx=56 → 28s），且与 dry-run 共用同一判据，不能 UI 自算一套 |
| 风格 | 抽屉/导轨已有原生 `input[type=range]`（`zx-timeline-zoom`、导轨 timeScale 用 `accentColor`）；antd `Slider` 只在封面编辑器用过，且导演台浮层一直靠自家深色 token 硬压 antd | 用原生 range + 浮层深色 token，与导轨滑块同一形态，不再新增 antd 覆盖 |

## 三、归属分析

- **类型**：交互决策（控件形态）+ 功能强化（超推荐实时提醒）
- **关联 Plan**：Plan#83 验收轮（导演台提示词面板系列）
- **倾向性结论**：热修。判据下沉到 `entities/director-params.ts`（帧数学唯一事实源），UI 只做展示；提醒分两级（超推荐 = 中性提示；超硬帧上限 = 升级措辞并点明 dry-run 会报 frame-overflow）。

## 四、影响面预估

- `entities/director-params.ts`：`DURATION_SLIDER_MIN/MAX/STEP_SEC`、`recommendedDurationCapSec(ctxFrames)`、`durationOverCapSec(sec, ctxFrames)`、`durationExceedsFrameCap(sec)`
- `canvas-tabs/director-prompt-panel.tsx`：时长 Popover 内容改滑块 + 帧数 + 推荐上限标注 + 实时警告；胶囊超限时文字转 danger 并带 `data-over-cap`；`directorCss` 增加 `.director-duration-range`（轨道前段中性、超推荐尾段 danger 渐变，拇指同步变色）
- `i18n/{zh,en,ja}.json`：`director.durationCapHint / durationOverCap / durationOverFrameCap / durationOverCapTitle`
- 兼容：老数据/MCP 写入的 >30s 值不会顶死在末端——滑块上限按 `max(30, ceil(duration))` 诚实扩展，保证拇指位置与数值一致
- 风险：`duration_sec` 参数 schema 的 max 仍是 120（pack 合法性不动）；UI 只能滑到当前上限，精确值靠 0.2s 步进（帧数走 17k+5 吸附，更细无意义）

## 五、处理结果（2026-11-06 已热修）

- 归属：独立处理（热修）
- 结果摘要：
  - 时长胶囊点开 = **range 滑块**：min 0.2（不给 0，零时长非法）/ max 30 / step 0.2；上方实时读数「Ns + 帧数 + 推荐 ≤Ns」，下方 0s / 上限标注。
  - **滑动即写回** `onShotChange({ duration })`，无二次确认弹窗（单一入口）。
  - **实时提醒两级**：① 超推荐 → 「超出推荐时长 Xs（单段建议 ≤Ns）」+ 胶囊与拇指转 danger；② 超单段硬帧上限 → 「已超单段帧上限 736 帧（≈Ns），运行预检会报 frame-overflow」。
  - 推荐上限随引导 ctx 动态：未开引导 30s；ctx=22 → 29s；ctx=56 → 28s（与 `validateRunSelection` 同判据，UI 不另算）。
  - 风格按本项目：原生 range + 导演台浮层深色 token（与导轨缩放滑块同形态），未引入 antd Slider；未抄参考图的蓝色底样式。
  - **测试**：`director-prompt-panel.test.tsx` 新增 7 例（range 属性与推荐标注 / 默认引导扣到 29s / 滑动写回 / 30.2s 超推荐但未超硬上限且 max 扩到 31 / 34s 升级 frame-overflow / ctx=56 时 29s 报警 1s / ctx=56 时 10s 不报警）；单跑该 describe **7 passed**，整文件 61 例中另 37 例失败属并行会话在改的槽位/缩略图链路（非本轮）。
  - **验证**：`tsc --noEmit` 本轮文件 0 错误；i18n 三语 JSON 解析通过。
