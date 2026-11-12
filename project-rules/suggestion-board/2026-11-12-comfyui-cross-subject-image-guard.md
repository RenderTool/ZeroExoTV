# S-24｜跨主体共用图防呆 + 主体编辑面板美化

> 2026-11-12｜来源：云顶天罚项目实测（沈少误挂主演秦羽定妆图）｜状态：🟢 merged（本次直接热修）

## 需求

1. **MCP 层面杜绝「张冠李戴」图**：主体库导入曾把秦羽的三张备用造型挂到「沈少」（基础状态即主演脸）、夜昙的套裙图挂到「霍绮罗」。要求 MCP 绝对避免此类低级错误。
2. **主体编辑面板美化**：基础状态面板里「出现集数」按钮把 58 个集数平铺成一行长文本、下方 58 枚红色标签铺满卡片，观感差。

## 归属分析

- 强化（bug 遗漏）：`auditSubjects` 老口径只看第一张/封面，漏掉基础/普通状态误挂他人状态图 → 全量扫描升级。
- 防呆（新能力）：`set_subject_image` 写路径加跨主体共用图闸门。
- 体验：StateEditPanel 集数区间压缩 + 标签区限高滚动。

## 落地（本次热修，已验证）

- `mcp-server/src/store/storyboard.ts`：audit 新增 `cross_subject_image`（全量扫描 entity.images + 状态 media，逐主体报碰撞对）；`setSubjectImage` 拒绝把已属于其它主体的 storageKey 挂到当前主体（幂等更新不受影响），显式 `allowCrossSubject:true` 才放行。
- `mcp-server/src/tools/subjects.ts`：两个工具描述同步；`set_subject_image` schema 增 `allowCrossSubject`。
- `subject-library-pages.tsx`：`compressEpisodeRanges` 区间压缩（>5 段或 >12 集只显示「已选 N 集」）；集数标签容器 maxHeight 76 滚动。
- i18n zh/en/ja 增 `subject.appearEpisodesRanges`。
- 验证：mcp typecheck ✓；subject-library-pages 43/43 ✓；vite build ✓（存量 17 个 mcp 测试失败为 AUTH 鉴权漂移，与本次无关）。

## 数据修复（云顶天罚项目）

- 沈少：移除误挂的 3 张秦羽图（含基础状态），候选状态删除。
- 霍绮罗：移除误挂的叶千媚·名媛风尚套裙图（归属保留给夜昙）。
- 两主体现为待补图（audit `no_image` 会提示），全库跨角色共用图 = 0。
