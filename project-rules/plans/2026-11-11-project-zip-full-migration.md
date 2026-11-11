# C-05 项目 ZIP 完整迁移（剧本 MD / 主体格式 / 实体还原）

状态：done
依据：S-21（2026-11-11 用户验收反馈）

## 目标

导出的 ZIP 在另一台机器导入后，剧本、主体、导演台、画布、资产与产出全部还原，无需二次补数据。旧版 v1 包仍可导入。

## 包结构（v2）

```
projects.json                         manifest（version:2，含 documents 路径索引）
files/{oldPid}/...                    全部二进制：graph 素材 + 主体图 + 产出 CAS
script/{oldPid}/EP01_标题.md          每集一个阅读用 Markdown
script/{oldPid}/script.json           无损 ScriptEntity（导入优先）
subjects/{oldPid}/{name}.md           每主体一个阅读用 Markdown
subjects/{oldPid}/subjects.json       无损 StoryboardContainer
entities/{oldPid}/workbench.json      无损 WorkbenchContainer
assets/{oldPid}/assets.json           本项目资产/产出记录（无损）
```

MD 只作阅读视图；无损 JSON 是导入唯一依据。理由：HTML 剧本块含 `INT./EXT.`、分页、HTML 实体、`segments`，纯 MD 会丢字段；主体树含 `deriveFrom` / `mediaHistory` / `aiStableKey` 等，MD 无法表达。

## 阶段

| # | 内容 | 状态 |
|---|---|---|
| 1 | `project-documents.ts`：HTML→MD、主体→MD、递归收集 `cas:`/`image:`/`video:`/`audio:` 键 | 完成 |
| 2 | 导出侧：读实体三件套 + 本项目资产，生成 MD/JSON，合并二进制清单，version 2 | 完成 |
| 3 | 版本迁移：v1→v2 补空 documents，`CURRENT_ZIP_VERSION=2`（并修无 version 字段不迁移的旧 bug） | 完成 |
| 4 | 导入侧：还原 script/storyboard/workbench/assets，重映射 `projectId` 与 `storageKey`/`key`/`coverKey`/`mediaKey`；`cas:` 用 `putCas` 按内容 hash 写回，不用 nanoid | 完成 |
| 5 | round-trip 单测（真实 fflate 导出→导入）+ typecheck + 全量单测 | 完成 |

## 约束

- 旧 v1 包必须仍可导入（缺字段按空处理），新字段全部可选。
- 导入仍是「新建项目 + 追加」，不覆盖用户既有项目；资产合并按 storageKey 去重。
- 只读偏好（view-prefs / localStorage）、回收站、系统预设不导。
- 不改 MCP 侧协议；MCP 与浏览器授权目录无关（见 AGENTS.md 排障铁律）。
