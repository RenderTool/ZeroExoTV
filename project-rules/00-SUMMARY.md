# zeroexo-comfyui 总索引

> 每次对话只读本文件 + 项目根 `AGENTS.md`。**本库与外部 `zeroexo/.project-rules/` 无任何编号/看板关联。**
> 历史 `Plan#65/#83/#84`、征集 `#172–#186` 均为外部库编号，仅作溯源；本库以 `C-NN` / `S-NN` 编号。

## 一、Plan 看板（comfyui 自有）

| # | Plan | 状态 | 文件 |
|---|---|---|---|
| C-01 | 色卡节点（原 Plan#65） | done | [plans/2026-09-02-color-card-node.md](plans/2026-09-02-color-card-node.md) |
| C-02 | zeroexo-comfyui 纯前端剥离版（原 Plan#83） | in-progress | [plans/2026-11-02-zeroexo-comfyui-standalone.md](plans/2026-11-02-zeroexo-comfyui-standalone.md) |
| C-03 | 子画布 Sub-Canvas（原 Plan#84，含画布挂载模型） | in-progress | [plans/2026-11-05-sub-canvas.md](plans/2026-11-05-sub-canvas.md) |
| C-04 | 图片编辑改为独立页签（裁剪/局部/分割） | in-progress | [plans/2026-11-06-image-edit-in-node.md](plans/2026-11-06-image-edit-in-node.md) |

状态：in-progress 3 / done 1 / 待拍板 0 / deprecated 0。

## 二、需求征集（17 条，全部 merged）

索引见 [suggestion-board/README.md](suggestion-board/README.md)；模板见 [suggestion-board/_template.md](suggestion-board/_template.md)。
2026-11-02 起全部为 comfyui 需求，2026-11-06 由外部库迁回本目录。

## 三、交接 / 设计记录

| 文件 | 主题 |
|---|---|
| [docs/handoff-2026-11-05.md](docs/handoff-2026-11-05.md) | 未完成项与反复修复失败 Bug 交接 |
| [docs/entities-redesign-2026-11-04.md](docs/entities-redesign-2026-11-04.md) | 三页签取证 + 实体层 schema |
| [docs/mcp-server-design.md](docs/mcp-server-design.md) | MCP Server 设计 |

## 四、规格与技术契约（2026-11-06 全部迁入本库）

> 原项目根 `specs/`、`docs/specs/`、`docs/`、`rules/` 四个散落目录已整体并入 `project-rules/`；
> 源码与 MCP 测试注释里的引用路径已批量同步，项目根不再有第二个文档目录。完整清单见下表。

**SPEC**
- `project-rules/specs/director-h3-workspace/rail-visual-spec.md`、`drag-spec.md`
- `project-rules/specs/openlib-page-rework/spec.md`、`tasks.md`
- `project-rules/specs/sub-canvas/spec.md`
- `project-rules/specs/subject-library-redesign/spec.md`、`drawer-feasibility.md`
- `project-rules/specs/subject-library-ui/spec.md`
- `project-rules/specs/subject-pages/spec.md`
- `project-rules/specs/20261104-ghost-nodes/spec.md`、`tasks.md`
- `project-rules/specs/comfyui-global-workflows/spec.md`

**技术契约**
- `project-rules/docs/image-variant-contract.md`（图片档位契约，2026-11-06）
- `project-rules/docs/script-import-contract.md`、`project-rules/docs/mcp-auth-scope-contract.md`
- `project-rules/rules/media-frame-extraction-main-thread.md`（视频抽帧只能主线程）

## 五、经验索引

见 [rules/00-SUMMARY.md](rules/00-SUMMARY.md)（6 条经验，命中关键词后再读详情）。
新增经验写 `rules/` 并同步该索引；**不要写外部 `.project-rules/*/rules/`**。

## 六、常驻文档（项目根，不移动）

`AGENTS.md` · `DESIGN.md`（UI/数据规范） · `README.md` · `CHANGELOG.md`

## 七、类型门（简化版）

| 类型 | 行为 |
|---|---|
| 业务代码 | 读本索引 → 查命中经验 → 实现 → `pnpm typecheck` + 相关单测 + 构建 → 更新文档 |
| 规则库 / 本目录改造 | 不建 Plan、不写经验、不改看板；改完报 diff |
| 整理 / 归档 / 迁移 | 单次操作，不提议建 Plan；读历史文档后主动建议是否格式化 |
