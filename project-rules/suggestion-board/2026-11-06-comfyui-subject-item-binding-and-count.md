---
状态: merged
创建: 2026-11-06
来源: 验收反馈
关联项目: zeroexo-comfyui（本地版，Plan#83 验收修复轮）
归属建议: 独立处理（热修，收编征集 #179 遗留「树↔条目按 name 配对」+ #178 影响面预估已点名）
---

# 抽屉主体段无总数 / 新建主体不递增序号 / 同名主体被一起改类型

## 一、需求 / 问题描述（用户原话）

> 另外我发现几个问题 1 抽屉中主体Tab没有主体总个数统计 2 新建主体不会自动递增序号 3 同名主体会被错误的一起切换主体类型，即说明同名逻辑没有写对！

（第 3 条正是上一轮 #179「影响面预估 · 遗留」里点名的 name 配对缺陷，用户实测确认必须根治。）

## 二、背景与现状（逐条实锤）

| # | 根因 | 证据 |
|---|---|---|
| 1 | 抽屉分段胶囊 `ScopeCapsuleTabs` 的 subject 段写死 `count: null`，而 library/project/openlib 三段都传了数；#176 决策把 embedded 列表页头（含计数徽标）整块下线时，只删了页头那一份，没把计数搬到胶囊上 | `scope-capsule-tabs.tsx` subject 段 `count: null`；`MaterialGroup.tsx` 只传 `showSubject` |
| 2 | `useStoryboardSubjectData.addSubject` 固定用 `t('canvasTab.newSubject')` = 「新主体」，从不查重 → 连点三次得到三条同名条目 | `addSubject` 无命名逻辑 |
| 3 | 条目 ↔ 主体树**只按 name 配对**（`trees.find(tr => tr.name === it.name)`），而类型的事实源是 `SubjectTree.kind` → 同名多条命中同一棵树：改一条 = 全条一起变；删除一条 = 把同名别人的树**一起删掉**（数据损失，比串台更严重）；封面/集数筛选/状态计数同样串 | `subject-library-pages.tsx` cards / openSubject / handleDeleteCard / changeKind / changeKindByCard / itemOfTree / renameTree / stateCount 共 8 处；legacy `StoryboardSubjectTab.tsx` 另有 2 处 |

三者同源：**没有身份绑定，全靠名字当主键**。所以 2 与 3 一起修才成立（自动递增减少新增同名，绑定让历史同名不再互相覆盖）。

## 三、归属分析

- **类型**：bug 遗漏 ×2（1 胶囊计数缺失、3 同名串台/误删）+ 功能强化 ×1（2 默认名自动递增）
- **关联 Plan**：Plan#83 验收修复轮（与 #176/#177/#178/#179 同一批主体库反馈）
- **倾向性结论**：热修，不新建 Plan。绑定用**新增可选字段 `SubjectTree.itemId`**（不迁移、不猜）：
  - 新写路径一律带 itemId（建树、改类型、改名时自愈回写）；
  - 老数据只在「名字唯一」时配对；同名多条只让**第一条**继承无绑定老树，其余按无树处理（进详情各建一棵带 itemId 的新树）；
  - 归属不明时**宁可不改**，绝不写别人的树。

## 四、影响面预估

- `subject-tree-types.ts`：`SubjectTree.itemId?` + `findTreeForItem` / `findItemForTree`（唯一回落链）+ `createSubjectTree(kind, name, itemId?)`
- `production-manager-types.ts`：`nextUniqueName(existingNames, base)`（正则转义，取已有最大号 +1）
- `use-storyboard-subject-data.ts`：`addSubject` 自动命名（在刚读到的最新 entities 上算，连点不重名）+ 模块级 `useSubjectTotalCount`（写回即 publish，胶囊只订阅，不重复读盘）
- `scope-capsule-tabs.tsx` / `MaterialGroup.tsx`：新增可选 `subjectCount`（不传 = 原行为，资产库其它调用方零改动）
- `subject-library-pages.tsx` 8 处 + `StoryboardSubjectTab.tsx` 2 处（legacy 详情弹层，新增 `siblingItems` 入参）+ `subject-link-dialog.tsx` 建树带 itemId
- 兼容：`itemId` 缺省即老口径；`subjectTree-diff.cloneTrees` 用展开复制，字段自动跟随；MCP 侧 `subjectTree` 是 opaque unknown，无需改
- 风险：历史同名主体的树只归第一条 → 第二条进详情会**新建一棵空树**（看起来状态变少），但数据未丢、且这是停止串台与误删的必要代价；用户改名后各自独立

## 五、处理结果（2026-11-06 已热修）

- 归属：独立处理（热修）
- 结果摘要：
  - **① 胶囊总数**：抽屉分段「主体」显示总个数；计数与列表同源（`useSubjectTotalCount`），新建/删除后即时更新，未加载时不显示徽标（不假称 0）。
  - **② 自动递增**：`新主体 → 新主体 2 → 新主体 3`，取已有最大号 +1（删中间号不复用）。
  - **③ 唯一绑定**：新增 `SubjectTree.itemId`；8+2 处 name 配对全部换成 `findTreeForItem` / `findItemForTree`；改类型/改名时把 itemId 自愈写进老树；删除主体只动自己绑定的那棵树（不再连带删同名别人的树）。
  - **测试**：新增 `subject-item-binding.test.ts`（10 例：itemId 优先 / 老数据名字唯一才配对 / 同名只第一条继承 / 归属不明不猜 / nextUniqueName 三例）；`subject-kind-write.test.tsx` +3 例真实落盘（连点两次名字递增、两条同名改第二条类型不动第一条且不改写别人绑定、胶囊总数 1→2）；`scope-capsule-tabs.test.tsx` +1 例（subjectCount 显示 / 未传不显示）。
  - **验证**：4 个相关测试文件 = **52 passed**；`vitest run` storyboard+asset-library+canvas-assets+entities = **346 passed / 9 failed**，9 个全部为存量（`asset-card.test.tsx` 7 + `MaterialGroup.lightbox.test.tsx` 2 = 未包 ThemeProvider；`workbench-video-export.test.ts` = 缺 `src/vendor/mp4box.all.min.js`）；`tsc --noEmit` = **47**（基线不变，本轮 8 个文件 0 错误）。
  - **未做（等你定夺）**：历史同名主体的树不做批量迁移（现按「第一条继承 + 其余建新树」自愈）；如需一次性把老树按顺序绑定到各条目，我可以补一个只读诊断 + 迁移脚本。
