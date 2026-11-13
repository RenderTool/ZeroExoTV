---
编号: S-27
状态: merged
创建: 2026-11-13
来源: 用户反馈
归属: 独立热修（全剧风格直达 + MCP 读写权）
---

# 全剧风格：主体面板直达画廊 + MCP 可读可改

## 一、用户原话

> 很显然这个要直接打开风格预设页面啊！！为什么还要让用户先去信息页？？？？？信息页本身就是一个展示+编辑页啊！！
> 另外这个风格也要能通过 MCP 读取和修改！！MCP 是整个大脑他必须有一切修改权以及他必须明白这一切是怎么组织的！用什么规范组织的！！

## 二、改造

### 前端

- 主体状态编辑面板的「全剧风格」整行改成**按钮**：点一下直接打开同一个风格画廊，不用先去「本剧信息」；
  未设置时描边强调，已设置时显示「更换」。
- 抽 `saveGlobalStyle(projectId, preset)` 唯一写入口（`global-style.ts`）：
  写 `script.meta.visualStyle` + 统一改写所有主体提示词的风格块 + 返回同步数量；
  「本剧信息」保存与主体面板画廊共用这条路径，不各写一套。
- 选中后立刻重读 storyboard 容器，面板里的提示词同步刷新。

### MCP（全剧风格可读可改）

| 工具 | 作用 |
|---|---|
| `list_style_presets` | 列出 23 套（id / 中文名 / 英文名 / 分类 / 风格片段） |
| `get_global_style` | 读 `script.meta.visualStyle`（presetId / name / prompt / image） |
| `set_global_style` | 选一套：写 meta + 改写所有主体/状态提示词；`dryRun` 预览，写入必须 `userConfirmed:true` + script `baseVersion` |

- 规范写进 `zeroexo://guides/subjects` 模块规格与 `zeroexo://skills/subjects` §1.8：
  风格是项目级单值，23 套固定数据（导演 9 / 主流 6 / 动画 8），主体继承，单主体不覆盖；
  `set_global_style` 改所有提示词的风格块，先确认再写。
- MCP 侧 `src/lib/style-presets.ts` 保存同一份 23 套数据（与前端 `src/shared/style-presets.ts` 同源）。

## 三、边界

- 写入会改多个文件（script + storyboard），必须 `userConfirmed`；`dryRun` 可先看将写入的 visualStyle。
- 只改风格块：「风格/灯光/色彩/质感」旧行删除，末尾追加一行「风格：<片段>」；人设/版式/硬约束、空提示词不动。
- 单主体覆盖不做（用户已拍板只做全剧统一）。
- 预设数据两份（前端 TS / MCP TS）来自同一篇来源，增删预设时必须两边同步；后续可改为构建期共享 JSON。
