---
编号: S-29
状态: merged
创建: 2026-11-13
来源: 用户反馈
归属: 独立热修（MCP 升级查漏补缺）
---

# MCP 升级后主动查漏补缺（审计 + 询问修复）

## 一、用户原话

> 然后我发现你很不负责！MCP更新应该提醒用户的Agent上一个版本处理流程中可能存在的纰漏！！！
> 要提醒用户是否进行查漏补缺修复！！因为用户压根不清楚我们的产品结构核心变化了什么！！
> 所以必须交给Agent智能把控！！！而不是模糊的用版本更新糊弄过去

## 二、改造

- 新增 `get_upgrade_guide`（只读）：说明「旧项目可能是在新约束之前做的」，Agent 连上/更新后先读，
  再跑审计，别只说版本已更新。
- 新增 `audit_upgrade({ projectId })`（只读，不改文件）：按当前流程扫旧数据，返回 findings：
  - `GLOBAL_STYLE_UNSET`：全剧风格未设；
  - `SUBJECT_PROMPT_EMPTY`：主体基础状态没提示词（旧流程只建名、没跑 set_subject_profile）；
  - `PROMPT_PLACEHOLDER`：提示词里还有「按剧本…定 / 待补 / 占位」旧话术；
  - `SUBJECT_IMAGE_NO_PROMPT`：主体图挂了但没有反推 prompt；
  - `SHOT_EPISODE_UNASSIGNED`：导演台片段没 episodeId（多集项目）；
  - `SHOT_EPISODE_UNKNOWN`：片段指向已删除的集；
  - `SHOT_PROMPT_EMPTY`：片段双轨提示词为空。
  每条带 severity / count / detail / fix（用哪个工具修）。
- server instructions 增加硬性段落：连上/更新后先 `get_upgrade_guide` → `audit_upgrade` →
  按严重度报「旧流程漏了什么 → 现在会怎样 → 怎么修」→ **问用户是否现在修复**；修完再审计到 ok=true。
- `update_mcp_server` 的返回 nextSteps 与 `mcp_update_status` 的 nextSteps 都追加这条审计提醒。
- `zeroexo://guides/project` 模块规格登记这两个工具与规则。

## 三、边界

- `audit_upgrade` 只读；任何修复都要用户确认后逐项改，禁止静默批量。
- 检查是「结构缺口」，不判断创作质量；质量审查仍走 shots-prompts 的审片清单。
- 旧数据不会被自动改；Agent 必须把选择权交给用户。
