---
编号: S-25
状态: merged
创建: 2026-11-13
来源: 用户反馈
归属: 独立热修（MCP 主体环节硬闸门 + 生产技能）
---

# 主体环节：先看图、再反推提示词、再挂图

## 一、需求 / 问题描述（用户原话）

> 说明主体提取环节出现大问题！！！他不清楚要怎么处理各自主体！！以及要给用户提供什么！！按照什么方法提供！以及需要怎么提供！
> 另外我觉得相当有必要进行图片资产提示词反推！而不是出现这种瞎配图片资产的情况！！！

> 部分 LLM 压根不会按照要求生成主体相关的提示词！并且他还会胡乱配图！！如图 2 根本不是一个人！！
> 说明他们压根没有理解图片多模态就开始瞎搞

## 二、根因

1. `set_subject_image` 只要 `storageKey` 就能写，Agent 从不 `read_asset` 看图；
   图内容对不对全靠模型自觉，弱模型直接把「六人模特合集」挂成主角状态图。
2. 主体环节的交付物不明确：只说要列主体清单，没说清单里必须有身份锚点句 / 状态 / 出现集数 /
   图片来源 / 缺图清单，也没说缺图时该让用户提供什么、按什么规格提供。
3. **没有强制字段模板**：三视图 / 场景宫格 / 道具参考图只写在技能文档里，没有工具校验；
   模型可以随手写一句提示词就交差，也可以不写。
4. 没有「图片 → 提示词」的反推要求：`prompt` 可空，Agent 挂图时不写画面事实。

## 三、处理结果

- **强制字段模板 `set_subject_profile`**（新增工具）：按 kind 提交人设/场景/道具字段，服务端校验后
  生成标准提示词——角色 = 三视图（16:9 固定 3 画面、同一张脸、只允许这一个角色）；场景 = 2×2 空场景；
  道具 = 单品参考图。身份锚点句写 `item.note`，提示词写主体树基础状态 `fullPrompt/deltaPrompt`；
  字段不全返回 `SUBJECT_PROFILE_INCOMPLETE` 并列出缺项；有参考图必须 `read_asset` 看过、按图反推字段
  再带 `sourceImage` 提交。
- **`read_asset` 登记看过的图**：返回 MCP image 内容块时按 token 记录 `storageKey`（进程内 1h）。
- **`set_subject_image` 硬闸门**（真实写入，dryRun 不受限）：
  - 没命中 `read_asset` 登记 → `IMAGE_REVIEW_REQUIRED`，提示先看图；
  - `prompt` 少于 12 字 → `IMAGE_PROMPT_REQUIRED`：必须把画面反推成提示词再挂。
- **生产技能（zeroexo://skills/subjects）新增**：
  - `1.5 先交交付物`：主体清单表（名称/类型/别名/身份锚点句/状态/出现集数/图片来源）+ 缺图清单；
  - `1.6 每个主体逐个走`：查重 → 看图 → 反推 → 用户确认 → 写库 → audit；
  - `1.7 强制字段模板`：角色/场景/道具字段表 + 三视图/宫格/单品模板，有图按图反推；
  - `3.12 先看图、再反推提示词、再挂图`：角色必须单人同一张脸；禁止多人合照/模特合集/候选人群像/
    别的角色图；场景空场景、道具单品；看不到图就停下问用户。
- **阶段 3 文案**（register.ts / module-specs.ts）同步：清单交付 + 强制字段 + read_asset + 反推 prompt 闸门。
- **前端定妆模板**（subject-prompt-templates.ts）：角色模板补「三个画面同一张脸、只允许这一个角色，
  禁止第二个人 / 多人合照 / 模特合集」。
- **版本**：0.2.35。

## 四、影响面

`mcp-server/src/lib/image-review.ts`（新增）、`tools/assets.ts`（read_asset 登记）、
`tools/subjects.ts`（set_subject_image 闸门）、`errors.ts`（两个错误码）、
`guides/skills.ts` / `guides/register.ts` / `guides/module-specs.ts`（文案）、
`src/features/canvas-nodes/storyboard/subject-prompt-templates.ts`（模板一句硬约束）。

## 五、边界

- 图片内容无法服务端自动识别（无 CV）：闸门保证「模型真的把图读进上下文 + 写出画面描述」，
  不能让模型不作弊；多次挂错仍要靠 `audit_subjects` + 用户复核。
- 旧数据（无 prompt 的图）不回填；只在新的 `set_subject_image` 写入时强制。
