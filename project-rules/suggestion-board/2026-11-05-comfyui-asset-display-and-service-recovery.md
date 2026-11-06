---
状态: merged
创建: 2026-11-05
来源: 验收反馈
关联项目: zeroexo_front / zeroexo-comfyui
归属建议: 并入 Plan#83 验收修复轮
---

# zeroexo-comfyui 资源显示机制、页面污染与服务停摆一次性修复

## 一、需求 / 问题描述

用户原话：「当前这个项目一堆BUG！尤其是资源显示机制，1 我拖入画布后完全看不到图片 2 如图一堆日文？以及主页中为什么会出现发送到画布和导演台的按钮？？？ 3 服务也给我重启！4 这是之前一个垃圾 IDE 留下的烂摊子你把他修复」。

## 二、背景与现状

交接文档 `handoff-2026-11-05.md` 记录图片全空白经 5 轮修复均失败；4173 服务的是被标记坏包 `index-DVrdNJNY.js`；4173/5180/8790 全停；`D:\Test\.lf\zeroexo\app_state\` 记录被删。实际排查新增结论：boot 不探测 8790 且驱动注册晚于异步探测，localforage 实例在 `httpFs` 上线前 init 后永久粘滞到 IndexedDB，`cas:` 键从不读 `media/cas` 真实文件，这是「记录重建成功但图片仍全空白」的最后一层根因。

## 三、归属分析

- **类型**：bug 遗漏
- **疑似关联 Plan**：Plan#83「zeroexo-comfyui 纯前端剥离版」（同链路：本地目录权威存储 / 显示层 / 出包）
- **倾向性结论**：作为 Plan#83 验收修复轮直接处理，不新建 Plan；均为存量缺陷，无产品决策点。

## 四、影响面预估

`src/platform/{boot,http-fs,fs}.ts`、`media-url-provider.ts`、`use-media-object-url.ts`、`resolve-media-blob.ts`、`asset-store.ts`、`upload-asset.ts`、`asset-card.tsx`、`open-lib-browser.tsx`、`open-lib-page.tsx`、`vite.config.ts`、`dist/`；数据根 `D:\Test` 的 assets.json / projects.json。

## 五、处理结果（归属确定后填写）

- 归属：并入 Plan#83 验收修复轮（直接处理）
- 结果摘要：修复启动时序竞态 + 会话级 blob URL 缓存 + CAS 变体链 + 持久化死 blob；重建 dist 并隔离坏包；开源库独立页移除发送动作、日文标题降级为「素材 + 编号」；恢复 assets.json / projects.json；重启 4173/5180/8790。浏览器实测：资产页 3/3 图加载、模拟拖入画布新增节点 1/1 图加载、开源库 60/60 缩略图加载、日文 0、卡片发送按钮 0、MCP 弹层可打开；相关单测 24/24 绿。
- 遗留：`pnpm typecheck` 仍有约 43 个存量错误（集中在 agent-bridge / sync / backend-upload 等未触及模块）；handoff 的 Bug 2/3/4/6/7 未做真实输入与生成链路回归。
