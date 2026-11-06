---
状态: merged
创建: 2026-11-06
来源: 验收反馈
关联项目: zeroexo-comfyui（本地版，Plan#83 验收修复轮）
归属建议: 独立处理（热修，收编征集 #177 ④b 的未根治部分）
---

# 主体类型「点了没变、闪一下又变回去」——上一轮只修了跳转，没修丢写

## 一、需求 / 问题描述（用户原话）

> 然后我发现主体类型依然不能修改 zeroexo-comfyui 这个项目

（上一轮 #177 ④b 判定为「已热修」：当时修的是「点改类型反而跳进主体状态页」。）

## 二、背景与现状（逐条实锤）

| 层 | 现状 | 结论 |
|---|---|---|
| UI 事件 | `Dropdown` 菜单项已 `domEvent.stopPropagation()`，卡片另有 `closest('.ant-dropdown')` 兜底；单测「改类型不误跳」绿 | 上一轮修复仍在效，**不是**本轮根因 |
| 写回链 | `changeKind()` 同一 tick 连发两笔写回：`onChangeTree(subjectTree)` + `onUpdateItem(entities)` | **一笔操作 = 两笔并发容器写** |
| 存储层 | `updateStoryboardContainer()` 是无锁 read-merge-write（`ensure` 读盘 → 合并 → `writeJson`），且读写之间还夹 `preSaveSnapshot` 多步异步 | 两笔都在对方落盘前读到同一份旧内容 |
| 结局 | 后完成的那笔（entities）带着**旧 subjectTree** 覆盖回去；写回结果 `setContainer` 又把本地 `trees` 拉回旧值 | 徽标先到「场景」→ 几十毫秒后退回「角色」→ 用户读作「不能修改」 |

**为什么只有「类型」复发**：改名（`renameTree`）、删主体（`handleDeleteCard`）同样是双写，属同一根因；状态名/提示词是单写，所以看起来正常。

**为什么上一轮单测没抓到**：`subject-library-pages.test.tsx` 把 `onChangeTree` / `onUpdateItem` 换成 `vi.fn()`，只验 UI 分支，数据链完全被 mock 掉。

## 三、归属分析

- **类型**：bug 遗漏（#177 ④b 只修了症状的一半；真根因在存储层并发丢写）
- **疑似关联 Plan**：Plan#83（zeroexo-comfyui 纯前端剥离版）——容器写 API 属其本地目录存储地基
- **倾向性结论**：热修，不新建 Plan。修法 = **同一容器路径的读-改-写串行化**（存储层单点，覆盖页签 / 抽屉 / 发送弹层 / MCP 触发的全部写路径），并让写回补丁支持「读盘后才计算」的函数形态，杜绝用渲染期旧数组覆盖他人改动

## 四、影响面预估

- `src/entities/slot-containers.ts`：新增按路径的写队列 `withWriteLock`；`updateStoryboardContainer` / `updateWorkbenchContainer` 支持 `Patch | (current) => Patch`（对象形态向后兼容，全部既有调用点不改）
- `src/features/canvas-nodes/storyboard/use-storyboard-subject-data.ts`：`addSubject` / `updateItem` / `deleteItem` 改函数式补丁（不再依赖渲染期 `subjects`）
- 主体库 / 导演台所有容器写入链路（受益方，代码未改）
- 测试：新增 `src/entities/slot-containers-write-lock.test.ts`（5 例）+ `src/features/canvas-nodes/storyboard/subject-kind-write.test.tsx`（2 例，接真实 hook + 真实容器层 + 深拷贝假磁盘）
- 遗留（本轮不碰）：树↔条目仍按 **name** 配对（同名「新主体」会互相串台），需按 id 绑定 → 建议单独 Plan；写失败目前只 `console.error`，UI 仍提示成功

## 五、处理结果（2026-11-06 已热修）

- 归属：独立处理（热修）+ 收编 #177 ④b
- 结果摘要：
  - **存储层串行**：`withWriteLock(path, fn)` 按容器路径排队，前一笔结束（无论成败）才开下一笔，失败不堵队列；`updateStoryboardContainer` / `updateWorkbenchContainer` 全部走它。
  - **函数式补丁**：新增 `StoryboardContainerPatchFn` / `WorkbenchContainerPatchFn`，在真正读到最新容器之后才算新值；`useStoryboardSubjectData` 的 entities 三个写入口改用它。
  - **回归见证（关键）**：临时把锁旁路掉重跑，`subject-kind-write.test.tsx` 报 `expected '角色' to be '场景'`（就是用户看到的回退），加锁后 2/2 绿；`slot-containers-write-lock.test.ts` 旁路时 4/5 红、加锁后 5/5 绿。
  - **验证**：`tsc --noEmit` 本轮四文件 0 错误（全仓 51 条为存量，主要在 in-flight Plan#84 的 `sub-canvas/*`）；`vitest run` 相关目录 43 passed / 2 failed（`workbench-video-export`＝缺 `src/vendor/mp4box.all.min.js`、`MaterialGroup.lightbox`＝测试未包 ThemeProvider，均存量，与本轮无关）。
  - **⚠️ 出包被挡**：`npm run build` 失败于 `SubCanvasWorkspace.tsx` 引用的 `GroupDefaultsProvider` 引擎包未导出（Plan#84 在途，不属本轮，未代改）→ 新 dist 还没含本修复；实测请先走 `npm run dev`，或等 #84 补导出后重出包。
