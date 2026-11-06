---
状态: merged
创建: 2026-11-06
来源: 验收反馈
关联项目: zeroexo-comfyui（本地版，Plan#83 验收修复轮）
归属建议: 独立处理（热修，收编 project-rules/specs/subject-library-ui §3.4/§3.5 + handoff「封面设置入口」缺口）
---

# 主体状态编辑页美化：删废话、按钮归位、支持音频、入口收敛、状态可当封面

## 一、需求 / 问题描述（用户原话）

> 然后这个主体的具体状态编辑页面仍然需要美化！！现在不太合理很多废话和不合理的按钮布局！例如"素材接收位"这种压根不需要，"基本信息 / 名称与提示词会写入生成上下文"这种也都是废话！ 然后替换图片和删除也该在图片卡片右上角！和外面统一！！然后不仅仅支持图片还要支持替换成音频！然后返回主体按钮压根不需要存在！以及删除状态也该是外面的卡片的星标来做的事情！以及最重要的一点要支持某个状态作为封面！！！

拆成 6 条：① 删「素材接收位」标签；② 删「基本信息 + 名称与提示词会写入生成上下文」；③ 替换/删除媒体挪到图片卡右上角，与外层卡片统一；④ 媒体不只支持图片，要能替换成音频；⑤ 删「返回主体」按钮；⑥ 删页头「删除状态」按钮（归外层卡片动作）；⑦（最重要）**支持把某个状态当封面**。

## 二、背景与现状（逐条实锤）

| # | 现状 | 结论 |
|---|---|---|
| ①② | 页头下先一个 `sectionTitle「基本信息」` + `basicInfoHint`，左列再来一个 `label「素材接收位」`，图下还有一行 `媒体已就绪 · 删除后不可恢复` | 三处都是解释性废话，project-rules/specs/subject-library-ui §3.5 把它们写成了口径 → 需同步改 spec |
| ③ | 动作是一排在图片**下方**的 antd `Button`（上传图片 / 替换 / 删除媒体）；外层状态卡却是封面右上角 `IconButton variant="overlay"` | 同一功能两套落位两套形态，违反「与资产/外层卡片同源」既有约定 |
| ④ | 基础状态走隐藏 `<input accept="image/*">` + `setBaseImage()` 直写 `baseState.referenceImages`，**不经过** `linkSubjectStateMedia` → 不能挂音频、不做 CAS 记账（删除时留孤儿文件）；状态卡缩略也只按 `type==='image'` 找 | 媒体写入出现第二条路径（文件头约束「统一走 linkSubjectStateMedia」被自己破掉） |
| ⑤⑥ | 页头右侧两个按钮：`返回主体`（面包屑「主体名」已可点）+ `删除状态`（外层状态卡 hover 已有 Trash2） | 重复入口，与 #176/#177「单一入口」决策相冲突 |
| ⑦ | 封面唯一解析入口 `resolveSubjectCover(item)` 只看 `ProductionItem.images/coverKey`；本地版主体的图**大多只活在主体树里**（`baseState.referenceImages` / `states[].media`），条目 `images` 常为空 → 列表卡永远「暂无封面图」，且 pages 模式**根本没有设封面入口**（旧 `StoryboardSubjectTab` 详情弹层里有，pages 重写时丢了） | 能力回归 + 数据双权威（树有图、条目不知道） |

## 三、归属分析

- **类型**：交互决策（①②⑤⑥ 精简与归位）+ bug 遗漏（④ 第二条写入路径、⑦ pages 模式丢封面入口）+ 功能强化（⑦ 树媒体参与封面解析）
- **关联 Plan**：Plan#83 验收修复轮（与 #176/#177/#178 同一批主体库验收反馈）
- **倾向性结论**：热修，不新建 Plan。封面**不新增字段、不加第二条权威**：仍写 `ProductionItem.coverKey`（既有唯一解析入口 + 旧详情弹层同一事实源），只把「候选集」扩展到主体树媒体键；写入仍是 entities 一笔，不触发 #178 那类双写互盖。

## 四、影响面预估

`subject-library-pages.tsx`（编辑页布局 / 状态卡动作 / 封面逻辑）、`subject-state-media.ts`（`linkSubjectStateMedia` 支持 `__base__` 槽位 + 释放/引用查询覆盖基础状态）、`subject-tree-types.ts`（新增 `firstCoverMediaKeyOfState` / `subjectCoverCandidates`）、`production-manager-types.ts`（`resolveSubjectCover` 加 `extraKeys` 候选，不传 = 旧行为）、`i18n/{zh,en,ja}.json`（封面 6 个 key）、测试 2 份、`project-rules/specs/subject-library-ui/spec.md`（§3.4/§3.5/§6 口径同步）。
不影响：导演台 `subject:<id>` 占槽解析（仍走同一函数，未传候选时行为逐字不变）。

## 五、处理结果（2026-11-06 已热修）

- 归属：独立处理（热修）
- 结果摘要：
  - **①②⑤⑥ 精简**：状态编辑页页头只剩「面包屑 + 修改即时保存」；`基本信息`/`basicInfoHint`/`素材接收位`/`媒体已就绪·删除后不可恢复` 四处文案与两个页头按钮全部下线；返回走面包屑，删除走状态卡。
  - **③ 归位**：媒体动作改到封面右上角 `IconButton sm variant="overlay"`（`data-media-action="replace" | "remove"`），与状态卡 / 主体卡同一落位同一形态；旧按钮行与隐藏 file input 删除。
  - **④ 音频 + 单一写入口**：`linkSubjectStateMedia` 接受 `stateId = SUBJECT_BASE_STATE_ID`，基础状态与状态同一取数（`slotMediaOf`）同一写入（含 CAS 记账与 null 移除）；`releaseSubjectStateMediaRefs` / `findSubjectMediaUsage` 一并覆盖基础状态槽位，不再漏释放。面板四个来源图片/语音均可选。
  - **⑦ 封面**：状态卡 hover 多一枚 `Star`（`data-state-action="cover"`，基础状态卡也有）→ 点一下写 `item.coverKey = 该状态首个非音频媒体键`，再点取消（回 null = 默认回落）；无图状态只提示「该状态还没有图片」不写入。当前封面卡左上留常驻「封面」徽标，主体列表卡封面直接跟着换。`resolveSubjectCover(item, extraKeys)` 候选集来自 `subjectCoverCandidates(tree)`（基础图 → 各状态图），所以条目 `images` 为空也能出封面。
  - **测试**：`subject-library-pages.test.tsx` 新增 4 例（废话文案零残留 / 动作归位+旧入口下线 / 基础状态无图也可开面板 / 无图点封面只提示不写）；`subject-kind-write.test.tsx` 新增 4 例真实落盘（默认封面=基础图、点封面 `coverKey` 落盘且徽标与列表封面同步、再点取消、基础状态挂音频写入 `referenceImages[0].type==='audio'`、删除媒体清空槽位）。
  - **验证**：`vitest run` 相关目录 = **677 passed / 2 failed**（2 个为存量：`MaterialGroup.lightbox` 未包 ThemeProvider、`workbench-video-export` 缺 `src/vendor/mp4box.all.min.js`）；`tsc --noEmit` = **47**（基线不变，本轮 6 个文件 0 错误）。
  - **未做（等你定夺）**：编辑页媒体卡右上角没放「设为封面」（按你的口径「卡片的事归卡片」，只留状态卡一处入口）；封面入口没有出现在整页「主体库」页签以外的位置；`npm run build` 仍被 Plan#84 在途的 `GroupDefaultsProvider` 未导出挡住，实测走 dev。
