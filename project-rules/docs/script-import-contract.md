# 剧本导入契约（mode 二选一 + 规范化）

> 生效：2026-11-05。标准剧本规范的**唯一准绳**：`D:\AICode\zerovideoAgent\references\script-format.md`
> （注：该文件当前实体位于 `D:\AICode\zerovideoAgent\archive\references\script-format.md`，`references\` 目录为空；
> 本契约不复制其内容，只引用——改规范改那份文件，本契约自动跟随）。

## 1. mode（必填，缺省直接报错）

`import_script.mode: 'standard' | 'raw'`，**必填**。缺省时 zod 校验失败，返回 VALIDATION 错误，
**禁止任何静默默认**。

| mode | 语义 | content 输入 | 入库内容 |
|---|---|---|---|
| `standard` | 已符合规范，直接入库 | 标准格式文本 | content 逐字原样 |
| `raw` | 原文直接入库（允许），返回「先 normalize_script」建议 | 任意原文 | content 逐字原样 |

`raw` 为成功响应，额外带 `hint`：`原文已导入。建议下次先调 normalize_script 按规范整理。`——不报错、不算失败。

**mode 与 strategy 正交**：mode 管「文本形态」（standard 规范化稿 / raw 原样稿，均允许入库），strategy 管落点
（`new_episode` 新建剧集 / `append` 追加 / `overwrite` 覆盖+备份）。两者独立组合，互不默认。

## 2. normalize_script（纯函数工具，不落库）

- 输入：`{ content: string }`（非空）
- 输出：`{ normalized: string, report: NormalizeScriptReport }`
- **不落库、不写任何文件**（审计日志除外——那是操作记录不是数据）
- **推荐在导入前调用（非强制）**：脚本规范化属于 MCP 流程，软件只做校验；
  `normalize_script` 的输出可直接作为 `import_script(mode:'standard')` 的 content。

### NormalizeScriptReport 字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `episodeCount` | number | 识别到的集数 |
| `sceneCount` | number | 识别到的场数 |
| `dialogueCount` | number | 对白行数 |
| `actionLineCount` | number | 动作行数（含括注行） |
| `subjects` | string[] | 识别到的主体名（去重） |
| `unknownSceneMeta` | number | 场标题缺 内/外·日/夜 元信息、补默认值的场数 |
| `discardedSegments` | string[] | 无法归入任何场的段落（**不写入**，原样列出供人工确认） |

## 3. 双侧对齐铁律

规范化纯函数存在两份逐字一致的实现（零依赖纯函数复制，禁止单侧漂移）：

- 前端：`src/features/canvas-nodes/storyboard/script-normalize.ts`（保留实现；导入弹窗不再调用，转换属于 MCP 流程）
- MCP：`mcp-server/src/lib/script-normalize.ts`（`normalize_script` 工具 / `import_script(mode:'standard')`）

改任意一侧必须同步另一侧，并跑两边测试——**两侧测试用同一份 fixture，断言逐字相同的输出**。

## 4. 网页导入确认流（前端契约）

1. 粘贴文本 / 选择文件（二选一）→ 直接 `commitScriptImport` 落盘，任何非空纯文本都放行；
2. 不做格式校验呈现：不列问题、不计数、不拦截，主按钮只有 `导入`；
3. 帮助只给「推荐模板」（可查看/复制标准样例）+ 一句 `只提供格式规范，转换由 MCP 模型处理`；
4. 落位方式三选一：新建一集 / 追加到当前集 / 替换当前集（替换需二次确认并自动备份）；
5. 落盘走同一条 commitScriptImport 管线；软件不做任何格式转换。

## 5. 断言清单（测试必须覆盖）

- [ ] `import_script` 缺 mode → 报错（不是默认 standard/raw 任何一个）
- [ ] `import_script(mode:'raw')` → 成功入库 + `hint` 建议先调 `normalize_script`（非错误）
- [ ] `import_script(mode:'standard')` → content 原样入库，不再内部 normalize
- [ ] `normalize_script` 调用后数据根无新文件/剧本版本不变（不落库）
- [ ] 报告 7 字段齐全、discardedSegments 原样列出
- [ ] 前端任意文本 → 无逐行清单/无计数，主按钮 `导入` 可用，三种落位均成功入库
- [ ] 前端「推荐模板」可查看并复制标准样例
- [ ] 前端与 MCP 的 normalizeScript 对同一 fixture 输出逐字一致
