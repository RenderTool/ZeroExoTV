# MCP 鉴权与作用域契约（mcp-auth-scope-contract）

> ⚠️ 说明：本文件由 2026-11-04 MCP M1 任务按需求方口述条款补建（仓库中原本不存在此文件），作为 `docs/mcp-server-design.md` 与 `mcp-server/` 实现的前提契约。后续如与原始契约冲突，以需求方提供的原始版本为准。

## 1. Token 形态

| 类型 | 前缀 | 持有者 | 典型用途 |
|------|------|--------|----------|
| PAT（个人访问令牌） | `zxp_` | 人类用户 | 本地 Agent / Claude Code / Trae 直连，可授予多个 project |
| 项目 token | `zxs_` | 单项目自动化 | CI、定时脚本、单项目 Agent，projectIds 固定且只允许 1 个 |

- token 原文 = 前缀 + 48 位 base62 随机串，如 `zxp_Ab3...`。
- 服务端（mcp-server）**只存 SHA-256 哈希**，存于 `<dataRoot>/.mcp/tokens.json`，不落明文。
- bootstrap：首次启动时若 `tokens.json` 为空且环境变量 `ZEROEXO_MCP_TOKEN` 有值，则把该值登记为一条拥有全部能力位、全部项目可见的 `zxp` token。

## 2. 作用域模型

作用域 = **project_ids × 能力位（capability bits）** 的笛卡尔约束：

- token 记录字段：`{ id, hash, prefix, projectIds: string[] | "*", bits: string[], createdAt, note }`
- 每次工具调用校验顺序：
  1. token 存在且哈希命中 → 否则 `AUTH_INVALID`
  2. 工具所需能力位 ∈ token.bits → 否则 `AUTH_FORBIDDEN`
  3. 调用目标 projectId ∈ token.projectIds（`*` 通配）→ 否则 `AUTH_PROJECT_DENIED`
- 跨项目越权**必须拒绝并写审计**（result=error, code=AUTH_PROJECT_DENIED）。

## 3. 能力位清单

```
project.read    project.write
script.read     script.write
split.write                       # 剧本拆解（写入导演台）
subject.read    subject.write
asset.read      asset.write
workbench.read  workbench.write
```

## 4. 工具权限矩阵（24 槽位）

M1 实现 20 个工具（读 9 / 写 11），M2 预留 4 槽位。**所有写类工具必须携带 `baseVersion`（读后写乐观锁）**；M1 **不提供任何 delete 类工具**。

| # | 工具 | 读/写 | 能力位 | M1 |
|---|------|-------|--------|----|
| 1 | list_projects | 读 | project.read | ✅ |
| 2 | get_project | 读 | project.read | ✅ |
| 3 | open_project | 读 | project.read | ✅ |
| 4 | create_project | 写 | project.write | ✅ |
| 5 | update_project_meta | 写 | project.write | M2 |
| 6 | list_episodes | 读 | script.read | ✅ |
| 7 | get_script | 读 | script.read | ✅ |
| 8 | create_episode | 写 | script.write | ✅ |
| 9 | import_script | 写 | script.write | ✅ |
| 10 | split_script_to_shots | 写 | split.write + script.read | ✅ |
| 11 | list_subjects | 读 | subject.read | ✅ |
| 12 | upsert_subject | 写 | subject.write | ✅ |
| 13 | link_subject_to_shot | 写 | subject.write + workbench.write | ✅ |
| 14 | list_assets | 读 | asset.read | ✅ |
| 15 | upload_asset | 写 | asset.write | ✅ |
| 16 | attach_asset_to_slot | 写 | asset.write + workbench.write | ✅ |
| 17 | get_workbench | 读 | workbench.read | ✅ |
| 18 | set_shared_params | 写 | workbench.write | ✅ |
| 19 | set_shot_prompt | 写 | workbench.write | ✅ |
| 20 | add_segment | 写 | workbench.write | ✅ |
| 21 | export_director_pack | 读 | workbench.read | M2 |
| 22 | get_asset_binary | 读 | asset.read | M2 |
| 23 | remove_asset_ref | 写 | asset.write | M2 |
| 24 | ingest_storyboard_images | 读 | asset.read + workbench.read | ✅（仅返回待确认清单，不落盘） |

## 5. 审计

- 落盘：`<dataRoot>/.audit/mcp-<YYYY-MM-DD>.jsonl`，一行一条 JSON。
- 字段：`{ ts, tool, tokenId, projectId, argsSummary, result: "ok"|"error", code, durationMs }`。
- `argsSummary` 只保留标识类字段（projectId/episodeId/shotId/subjectId/dryRun/strategy），**不记录剧本正文、prompt 全文、asset base64**。

## 6. 批量与安全

- 所有批量写入工具支持 `dryRun: true` 返回 before/after 预览，不落盘；真实写入必须显式 `confirm: true`。`dryRun` 与 `confirm` 互斥。
- `import_script` 的 `strategy: "overwrite"` 在覆盖前把原 `script.json` 备份到 `entities/backups/script-<ts>.json`。
- 冲突统一返回 `VERSION_CONFLICT`，携带 `expected`/`actual` 版本号。
