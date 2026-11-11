---
编号: S-21
状态: merged
创建: 2026-11-11
来源: 用户需求
归属: 并入 C-05
---

# 项目 ZIP 导出范围补全：剧本转 MD、主体格式化、无缝迁移

## 一、需求 / 问题描述

用户原话：「导入导出项目的范围不对！！！要把剧本转成MD，以及主体也要有格式的导出！！你现在只导出了画布产出以及包括本项目的所有产出！相当于无缝迁移」

## 二、背景与现状

只读调研结论（`src/pages/home/services/`）：

| 项 | 现状 |
|---|---|
| 导出内容 | `projects.json`（meta + 主 graph + 副本画布 + 素材清单）+ `files/`（仅 graph/封面引用的二进制），`version:1` |
| 未进包 | `entities/script.json`（剧本）、`entities/storyboard.json`（主体树 + ProductionItem）、`entities/workbench.json`（导演台片段/轨道/参数）、`app_state/zeroexo:assets`（本项目资产与产出记录）、未被 graph 引用的 `media/cas/*` |
| 导入 | 只还原 meta/graph/素材/副本画布，纯追加新 ID；`remapObject` 只认 `storageKey` 字段，主体的 `media[].key` / `coverKey` 不认；`cas:` 会被 nanoid 重映射成死链 |
| 转换能力 | 无 html→markdown；`script-lines.ts` 有 `parseScriptHtml`（DOMParser）、`serializeScriptContent` 只出纯文本；无主体导出 |

## 三、归属分析

- **类型**：功能强化（跨模块、有数据格式决策）。
- **关联 Plan**：C-05（导出/导入格式与实体还原，改动交集大）。
- **倾向性结论**：立项。ZIP 升 v2，旧包仍可导入；MD 是**阅读视图**，必须伴生无损 JSON，否则无法「无缝迁移」。

## 四、影响面预估

`export-types.ts`、`export-projects.ts`、`import-projects.ts`、`version-migration.ts`、新增 `project-documents.ts`（HTML→MD、主体→MD、CAS 键收集）与 round-trip 单测；不改 MCP 侧协议。文档：本征集、C-05、索引。

## 五、处理结果

- 归属：C-05。
- 结果摘要：
  1. `project-documents.ts`：HTML 剧本块→MD（场景/动作/角色+台词/括注/转场/分页，HTML 实体解码）、主体树→MD（条目信息 + 每个形态全字段中文标签）、递归收集 `cas:/image:/video:/audio:` 键。
  2. 导出 `version:2`：`script/{pid}/EPxx_标题.md` + `script.json`、`subjects/{pid}/<主体>.md` + `subjects.json`、`entities/{pid}/workbench.json`、`assets/{pid}/assets.json`（本项目资产/产出），主体图与产出 CAS 一并进 `files/`。MD 是阅读视图，导入只读无损 JSON。
  3. 版本迁移：`CURRENT_ZIP_VERSION=2`，注册 v1→v2（只补空文档清单），并修复「无 version 字段时 while 不执行迁移」的旧 bug。
  4. 导入：还原 script/storyboard/workbench 到新项目目录、`addAssets` 合并资产并把 `projectId` 改到新 id、`ensureProjectMounts` 兜底；`cas:` 用 `putCas` 按内容 hash 写回（不再 nanoid 改名）；`remapObject` 扩展到 `key/coverKey/mediaKey/assetStorageKey` 等字段。
- 验证：`pnpm typecheck` 0 错误；新增 3 个测试文件共 14 例（阅读视图 7 / 版本迁移 5 / 真实 fflate 导出→导入 round-trip 2）全通过；全量单测见下方记录。浏览器实测（跨机器导入）待用户确认。
