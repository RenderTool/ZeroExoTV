# zeroexo-comfyui 规则库与 Plan 归档

> **本目录是 zeroexo-comfyui 项目唯一的规则 / Plan / 需求征集权威位置。**
> 外部 `d:/AICode/zeroexo/.project-rules/` 是**前端线上项目 zeroexo_front** 的规则引擎（其 `_META.md`、`00-SUMMARY.md`、`projects.json`、Plan#NN 编号、需求征集铁律均只适用于该线上项目），**与本项目无关**。

## 一、为什么单独一份

zeroexo-comfyui 是纯前端剥离版：零后端、本地目录存储、只留画布与资产、规则/规格/契约自成体系。它不注册在外部 `projects.json`，也不使用外部 Plan 编号。历史上把 comfyui 的 Plan 与需求征集写进外部库，导致两个项目的看板、编号、索引互相污染——2026-11-06 已全部迁回本目录。

**给所有开发者与 Agent 的规则**：
1. comfyui 的 **Plan、SPEC 归档索引、需求征集、交接记录**一律写在本目录对应子目录下，不要写到外部 `.project-rules/*/plans/` 或 `suggestion-board/`。
2. 不要向外部 `00-SUMMARY.md` 看板追加 comfyui 条目，也不要引用外部 Plan#NN 编号来给本项目立项。
3. 项目根 `AGENTS.md` 是开发入口；本 `README.md` 是治理入口；`00-SUMMARY.md` 是每次对话唯一需要读的索引。

## 二、目录结构

```
zeroexo-comfyui/project-rules/
├── README.md              ← 本文件：规则库边界 + Plan 落点（必读）
├── 00-SUMMARY.md          ← 总索引：Plan 看板 / 征集 / 文档清单 / 经验
├── plans/                 ← 所有 Plan（含从外部库迁回的剥离版、子画布）
├── suggestion-board/      ← 需求征集（README 索引 + _template.md 模板）
│   ├── README.md
│   └── _template.md
├── docs/                  ← 交接 / 设计记录 + 技术契约（共 6 份）
├── rules/                 ← 开发经验规则（原双层嵌套内容 + 抽帧规则，共 7 份）
│   ├── 00-SUMMARY.md      ← 经验索引
│   └── *.md               ← 单条经验详情
└── specs/                 ← 全部规格 SPEC（原项目根 specs/ 9 份 + docs/specs/ 3 份）
```

## 三、Plan 生命周期（本项目自有，不套外部状态机）

| 状态 | 含义 |
|---|---|
| `in-progress` | 正在做 |
| `done` | 已完成、可查 |
| `deprecated` | 已作废（新方案替代时在此标注并互链） |

- 编号用 `C-NN`（comfyui 自有），命名 `YYYY-MM-DD-主题.md`，放 `plans/`。
- 文件内的历史 `Plan#65 / #83 / #84` 等只是**溯源**，不是本库编号；索引以 `00-SUMMARY.md` 为准。
- 需求 / 遗漏 / 决策先写 `suggestion-board/` 征集文档并登记 `README.md`，再决定并入哪个 Plan 或独立热修。
- 小改动（≤3 文件、无阶段、无决策点）直接热修，不立项；跨模块大改动才建 Plan。

## 四、文档落点对照（避免再次散落）

| 类型 | 落点 | 说明 |
|---|---|---|
| Plan / 交接 / 重构记录 | `project-rules/plans/`、`project-rules/docs/` | 已从外部库与根 `plans/`、`docs/` 迁回 |
| 需求征集 | `project-rules/suggestion-board/` | 已从外部库迁回 17 份 |
| 经验规则 | `project-rules/rules/` | 原双层嵌套已消除；项目根 `rules/` 的抽帧规则也已并入，不再有第二个 rules 目录 |
| 规格 SPEC | `project-rules/specs/` | 2026-11-06 全部迁入（原项目根 `specs/` 9 份 + `docs/specs/` 3 份）；源码与测试注释路径已批量同步 |
| 技术契约 / 交接 | `project-rules/docs/` | 3 份契约 + 3 份交接设计记录同目录登记；源码注释路径已同步 |
| 常驻文档 | 项目根 `AGENTS.md` / `DESIGN.md` / `README.md` / `CHANGELOG.md` | 不动 |

## 五、入口文件分工

| 文件 | 角色 |
|---|---|
| `zeroexo-comfyui/AGENTS.md` | 开发行为约束（项目身份、验收清单、技术栈、规则库指向） |
| `zeroexo-comfyui/project-rules/README.md` | 治理边界与 Plan 落点（本文件） |
| `zeroexo-comfyui/project-rules/00-SUMMARY.md` | 每次对话唯一索引 |
| `d:/AICode/zeroexo/.project-rules/AGENTS.md` | **仅前端线上项目**；其中「comfyui 例外」段只作指路，不承载本项目内容 |
