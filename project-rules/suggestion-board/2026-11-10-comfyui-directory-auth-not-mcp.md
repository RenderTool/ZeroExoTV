---
编号: S-19
状态: merged
创建: 2026-11-10
来源: 验收反馈
归属: 独立热修
---

# 素材导入失败：目录授权与 MCP 服务无关，且失败被空态吞掉

## 一、需求 / 问题描述

用户原话（2026-11-10，附图）：「还是那个问题 MCP服务和我们授权目录操作没有任何关系！！为什么我导入不了资产到本项目？」

截图：左侧「本项目」素材抽屉显示「该文件夹内容为空」，画布里已有图片；控制台 `net::ERR_CONNECTION_REFUSED`（`/health`）、`[boot]`/`[hook]` 类「本地数据服务不可用…刷新后未提供授权无法读盘」告警。

## 二、背景与现状

实测（2026-11-10）：`5180 / 4173 / 8787 / 8790 / 8188` 全部离线，无 node 进程；即 `http://127.0.0.1:8790/health` 探测必然失败。

1. **MCP（8787 / stdio）与浏览器目录授权是两条独立链路**：授权唯一来源是 `showDirectoryPicker` 的句柄，存在浏览器 IndexedDB `zeroexo-local/handles/dataRoot`（`src/platform/fs.ts`）；`ZEROEXO_DATA_ROOT` 只决定 MCP 进程与 fs-server（8790）的磁盘根，不产生、也不代表浏览器授权。用户判断正确。
2. **8790 是 vite 插件自动拉起的 HTTP 文件服务**（`vite.config.ts:17-55`，spawn `mcp-server/dist/index.js --fs-server`），只是与 MCP 打包在同一 dist，**不是 MCP 协议服务**；直接打开 dist 静态文件、或 dev/preview 未运行时必然离线。
3. **刷新后不自动恢复授权**（`RootGate.tsx:48-51`、`app.tsx:143-147` 用 `restoreRoot(false)` 只 queryPermission），必须由用户手势点「选择目录 / 重新授权」。
4. **导入失败被吞成空态**：未授权时 `putCas` 写盘抛错、`writeAll` 静默回退 IndexedDB（`asset-store.ts:348-359`），读侧磁盘空列表被当权威；`use-assets.ts:47-49` 的 error 不渲染，`MaterialGroup.tsx:285-288` 只判 `assets.length===0` → 显示「该文件夹暂无内容」。用户完全看不到真实原因。
5. **误导性 UI**：`LocalServicePanel` 挂在 MCP 设置弹窗内（`mcp-settings-dialog.tsx:401`），提示写着「MCP 与网页必须指向同一个目录」（`local-service-panel.tsx:171`），让人误以为配 MCP / 填绝对路径就等于授权。

## 三、归属分析

- **类型**：bug 遗漏（失败静默）+ 决策型（排障纪律与文案口径）。
- **关联 Plan**：无，独立热修。
- **倾向性结论**：不改存储架构；只把「未授权 / 服务离线」变成可见、可一键恢复的状态，并把 MCP 与目录授权在文案/规则上彻底解耦。

## 四、影响面预估

`MaterialGroup.tsx`、`canvas-assets/store.ts`、`local-service-panel.tsx`、AGENTS.md、本征集与索引；新增空态诊断单测。`pnpm typecheck` + 前端全量 vitest。

## 五、处理结果

- 归属：独立热修。
- 结果摘要：
  1. 抽屉素材空态区分「数据目录未就绪」与真·空：显示未授权/临时存储诊断，说明与 MCP 无关，并提供「重新授权 / 选择目录」一键入口（成功后整页刷新重绑驱动）。
  2. 上传前校验 `isAuthorized()`，未授权直接给出可读原因与恢复路径；零新增（去重/作用域不匹配）也给提示，不再静默。
  3. `LocalServicePanel` 文案与文件头注释去掉 MCP 绑定，明确「目录授权由浏览器保存，与 MCP 服务、登记的路径字符串都无关；绝对路径只给外部工具参考，不产生授权」。
  4. `AGENTS.md` 写入排障铁律：先测 8790 → 再看目录授权 → 最后才看 MCP；禁止用「启动 MCP / 配 MCP 数据根」回答素材导入失败。
- 验证：`pnpm typecheck`；前端全量 vitest；浏览器实测（授权后导入到「本项目」）待用户确认。
