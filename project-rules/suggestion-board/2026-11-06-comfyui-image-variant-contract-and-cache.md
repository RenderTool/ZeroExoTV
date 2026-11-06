---
状态: merged
创建: 2026-11-06
来源: 验收反馈
关联项目: zeroexo-comfyui（按 Plan#83/84 归属，注册表单列）
归属建议: 建议独立立项 Plan#85；本轮按项目惯例先做可验证闭环热修，归入 Plan#83 验收轮
---

# 预览图档位混乱：统一档位契约 + 入口自动派生 + 尺寸协商 + 明确缓存

## 一、需求 / 问题描述

用户原话：「然后我发现项目中的预览图出现严重混乱！除了画布中其他地方的预览图应该是和设计尺寸一致的，不应该出现设计尺寸是60px，然后预览图给的确实30px导致模糊不清！然后预览图很显然是多套的多尺寸类型的任何传入素材的入口都应该自动完成压缩和编码！任何每次有新接口和UI界面看看适配那一档的缩略图！并且缩略要明确缓存！而不是出现多处混乱！不清晰的糟糕体验！同时也要考虑性能本身！」

## 二、背景与现状（全仓诊断，2026-11-06）

1. **无单一事实源**：档位尺寸由 `packages/plugins/persistence-localforage/src/image-storage.ts`（THUMB 96 / PREVIEW 1024）与 `packages/plugins/nodes/src/utils/hydrate.ts`（五档像素预算 w256/w512/1280）各定义一套；物理 key 映射散在 `image-storage.ts` / `backend-upload.ts` / `resource-url.ts` / `hydrate.ts` 四处；链定义在 `resolve-media-blob.ts` / `thumb-image.tsx` / `hydrate.ts` 三处。`MediaVariant` / `ImageTier` / `ImageSizeParam` / `?size=sm` 四套命名互不对齐。注释仍停留 48px/256px，与常量 96/1024 漂移。
2. **消费侧全无尺寸协商**（除画布节点 `image-node-view.tsx` 的 `resolveBudgetTier`）：`ThumbImage` 默认一律 `thumb`、 `usePreviewImage` 固定 `preview`、`getResourceUrl` 默认 `thumb`、`useHydratedContent` 固定 `orig`。明确错配：
   - `image-grid-gallery.tsx` 80vw×80vh 灯箱复用 96px thumb（最典型「60px 设计给 30px 档」）；
   - `project-card.tsx` 项目卡封面拉 `full` 原图；
   - `media-lightbox.tsx` 云键大灯箱只取 preview，本地键取 orig，两边不对称；
   - 层级面板 36px 槽位（2x DPR 需 72px）命中存量 48px 图必糊；导演台/主体库 28/36/52/120/184 五种尺寸全部手写 `prefer`。
3. **主入库链路不生成派生档**：本地版默认 `uploadAsset → stageCasUpload → putCas`，`cas-upload.ts:8-10` 明确写「缩略图/预览图派生档暂不生成」。`resolve-media-blob.ts:45-48` 让 `cas:` 键一律补 `orig` 回退 → 所有本地上传/拖拽/开源库入库/AI 产物落库/晋升公共库都只能拿原图或小图撑大。完整派生链 `uploadImage()` 只被编辑器/同步/zip/旧抽屉使用。
4. **缓存不明确 / 性能**：
   - `media-url-provider.ts` 会话级 Map「永不 revoke」，`release` 为空操作，`entries` 无上限（长会话累积）；`makeResizedVariant` 每 (bucket, sourceUrl) 永久保留一个 URL。
   - `image-storage.ts` `deleteStoredImages()` 只删 `:thumb`、漏删 `:preview`/`:videothumb`；`cleanupUnusedImages()` 反而不跳过 `:preview` → 误删。
   - `use-auth-image.ts` 每组件各 fetch + createObjectURL，与 `backendUrlCache` 两套认证缓存；`useProgressiveImage` 同一原图 createImageBitmap 解码 3~4 次。
   - 现有防护须保留：`MAX_MEDIA_FETCH=6` 并发队列 + 429 退避、`resolveBudgetTier` 离散桶、上传队列 concurrency=5、`loading=lazy`/`decoding=async`、分页 60/页、`visible` 门控。

## 三、归属分析

- **类型**：bug 遗漏（尺寸错配 / 入口漏生成）+ 功能强化（档位契约 / 缓存策略）+ 架构决策
- **疑似关联 Plan**：[Plan#83](../shared/plans/2026-11-02-zeroexo-comfyui-standalone.md) 验收修复轮（本地版存储与显示链路）；历史口径 CHANGELOG Plan#48「像素预算五档 + 缩略图 96px 上限」/ 征集 #77「三档图片契约」
- **倾向性结论**：影响面跨 10+ 文件、含数据格式决策（CAS 派生档物理路径与零迁移回退），按 _META 属多步骤任务，建议独立立项 Plan#85 并登记看板；本轮按项目近期惯例（#173–#185 均独立热修）先完成可验证闭环。**执行前需询问是否先做 git 基线提交**（_META 二.3）。

## 四、影响面预估

新增 `src/shared/media/image-variants.ts`（单一事实源：档位表 / pickVariant(cssPx,dpr) / 链 / 物理 key）；改 `cas-upload.ts` + `cas-store.ts`（CAS 入口自动派生）、`resolve-media-blob.ts`（按档读 CAS 派生文件）、`thumb-image.tsx`（按尺寸×DPR 自动选档）、`image-grid-gallery.tsx` / `project-card.tsx` / `media-lightbox.tsx`（错配修正）、`media-url-provider.ts`（明确缓存上限）、`image-storage.ts`（缓存生命周期修复）；同步 `DESIGN.md` / `CHANGELOG.md` 契约表。风险：CAS 派生档属新增物理文件，必须零迁移回退（文件缺失→orig）；改 LRU 上限须避开既有「卸载不 revoke」单测；动 `ThumbImage` 默认档会牵动 20+ 调用方与结构断言类测试。

## 五、处理结果（归属确定后填写）

- 归属：本轮独立热修，归入 Plan#83 验收轮；Plan#85 立项待用户确认
- 结果摘要：
  - 新增 `packages/plugins/persistence-localforage/src/image-variants.ts` 单一事实源（档位表 / `pickImageVariant(cssPx,dpr)` / 链 / 物理 key / 一次解码两档生成），`index.ts` 导出；`image-storage.ts` 常量改由契约读入，修 `deleteStoredImages` 漏删 `:preview`、`cleanupUnusedImages` 误删 `:preview`。
  - `cas-upload.ts` 所有 CAS 入库口自动压缩编码 thumb(96)/preview(1024)，`resolve-media-blob.ts` 按档读 `media/cas/<hash>.<variant>.jpg`，缺档零迁移回退 orig；`usePreviewImage` 的 cas: 分支由「一律拉原图」改为档位链（覆盖资产卡片等主要消费侧）。
  - `ThumbImage` 按设计尺寸 × DPR 自动选档（未显式 `prefer` 时），修 80vw 灯箱用 thumb、项目卡拉 full、云键大灯箱取 preview 三处错配；层级面板过时 256/48px 注释同步。
  - `media-url-provider.ts` 明确会话级 LRU（上限 512，仅回收无订阅者闲置项）；契约表落 `project-rules/docs/image-variant-contract.md`。
  - 验证：改动文件 typecheck / lint 零错误；本次直接相关 **16 套件 217/217 全绿**；`pnpm build` 产出 `index-DNp_hfqk.js`；浏览器真实上传 `director-ui.png` → 落盘 `241KB 原图 + 1.6KB thumb + 42.6KB preview`，刷新后 6 个 CAS 卡片全部先请求 `.preview.jpg`，存量缺档键自动回退原图，5/5 图片正常显示；4173/5180/8790 在线。
  - 全量 1175 测试中 11 个失败分属 5 个套件，均为存量：3 个 `useTheme must be used within ThemeProvider`（AssetScopeBadge 测试未包 Provider）、1 个 `mp4box.all.min.js?raw` vendor 缺文件、1 个 11-05 媒体 URL 层重做后的过时断言（仍 mock `resolvePreviewUrl`）。
  - 本轮遗留（Plan#85 第二步候选）：256px 中间档、`use-auth-image` 双缓存、`useProgressiveImage` 重复解码、开源库打包小图撑满整卡、四套档位命名枚举统一；详见 `project-rules/docs/image-variant-contract.md` §7。
