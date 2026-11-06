# 图片档位契约（Image Variant Contract）

> 2026-11-06 征集 #186。单一事实源：`packages/plugins/persistence-localforage/src/image-variants.ts`。
> 本文件是「档位 → 尺寸 → 物理 key → 选档规则」的人类可读索引；**改数值先改代码，再同步本表**。

## 1. 档位表

| 档位 | 物理最大边长 | JPEG 质量 | 物理 key（旧 image: 键） | 物理路径（CAS 键） | 用途 |
|---|---|---|---|---|---|
| `thumb` | 96px | 0.6 | `{storageKey}:thumb` | `media/cas/<hash>.thumb.jpg` | ≤48px 设计尺寸的小槽位 |
| `preview` | 1024px | 0.8 | `{storageKey}:preview` | `media/cas/<hash>.preview.jpg` | 60~512px 设计尺寸、卡片封面、灯箱 |
| `orig` | 原图 | — | storageKey 本体 | `media/cas/<hash>.<ext>` | 画布节点像素预算、图片浏览器、导出/运行 |

- 96px 来自 Plan#48-T7：层级面板 36px 槽位在 2x DPR 下需 72px，存量 48px 缩略图不迁移。
- 1024px 来自 2026-11-02：原 256px 在本地版（无后端 LOD）让画布节点发糊，故抬升。
- `DEFAULT_DPR = 2`：所有非画布 UI 默认按 2x 预留。

## 2. 选档规则（新 UI 必查）

```
need = max(设计 CSS px, 1) × min(devicePixelRatio, 2)（默认 2）
need ≤ 96     → thumb
need ≤ 1024   → preview
否则          → orig
```

`pickImageVariant(cssPx, dpr)` / `imageVariantChain(cssPx, dpr)` 是全仓唯一入口。
解析链始终「首选档 → 更清晰档 → 原图」，**低档缺失绝不向下取更糊的档**；CAS 键链尾自动补 `orig`，存量零迁移。

| 典型 UI | 设计尺寸 | 2x 需求 | 取档 |
|---|---|---|---|
| 提及 chip / 导航圆点 | 16 / 34px | 32 / 68px | `thumb` |
| 层级面板、素材槽位 | 28 / 36px | 56 / 72px | `thumb` |
| 生成器节点小槽位 | 52px | 104px | `preview`（旧实现取 48px thumb 必糊） |
| 设计 60px 的预览位 | 60px | 120px | `preview`（本次用户点名的错配） |
| 瀑布流卡片 / 项目封面 | 220~321px | 440~642px | `preview` |
| 80vw 灯箱 / 图片浏览器 | 视口级 | >1024 | `orig` |
| 画布节点 | 动态 | 节点宽 × viewport.k × DPR | 例外：`useProgressiveImage` 的五档像素预算 |

## 3. 生成：任何入口自动压缩编码

- **CAS 主链路**（本地上传 / 拖拽 / 粘贴落库 / 开源库入库 / AI 产物落库 / 晋升公共库）：
  `stageCasUpload()` → `putCas()` → `generateImageVariantBlobs()` **一次解码产出两档** →
  `writeFileBlob(casVariantPath(hash, variant), ..., 'image/jpeg')`。
  非图片、SVG、解码/写盘失败一律静默跳过，派生档是加速缓存而非数据真相。
- **旧 image: 链路**（图片编辑器 / 同步 / zip 导入 / 替换节点图）：`uploadImage()` / `setImageBlob()`
  继续写 `:thumb` / `:preview`，常量已改为从契约读入。
- 视频首帧 `:videothumb` 保持既有链路；音频不生成图片派生档。

## 4. 缓存（明确、有界、可回退）

| 层 | 策略 | 回收 |
|---|---|---|
| blob URL（`media-url-provider.ts`） | 会话级 LRU Map，同一 key 共享一个 URL；组件卸载不 revoke | 超过 `MAX_CACHED_URLS=512` 时只回收**无活跃订阅者**的最久未用条目 |
| 派生档内存 Map（`image-storage.ts`） | `thumbUrls` / `previewUrls` / `objectUrls` | `deleteStoredImages()` 一并删除 `:thumb`/`:preview`/`:videothumb` 的 URL 与物理键；`cleanupUnusedImages()` 跳过全部派生键 |
| 磁盘派生档 | `image_files` 桶 / `media/cas/*.jpg` | 跟随原图生命周期；缺失即回退链内下一档 |
| 后端认证 URL | `backendUrlCache` + `MAX_MEDIA_FETCH=6` 并发队列 + 429 退避 | 既有防护保留 |

`invalidate()` 只丢条目并通知重解析；`release()` 保持空操作（兼容历史调用点）。

## 5. 性能约束

- 生成侧一次 `createImageBitmap` 产出两档，禁止每档各解码一次。
- 消费侧 `<img>` 一律 `loading="lazy"` + `decoding="async"`；列表分页 60/页、`visible` 门控。
- 卡片 / 封面禁拉 `full` 原图（项目卡已由 `full` 改 `preview`）；原图只在图片浏览器 / 画布预算 / 导出。
- 保留 `MAX_MEDIA_FETCH=6`、`resolveBudgetTier` 离散像素桶、上传队列 `concurrency=5`、断点滞回。

## 6. 新增 UI / 接口接入清单

1. 先量出设计显示 CSS px（宽高取较大者）；
2. 调 `pickImageVariant(cssPx, dpr)` 或 `imageVariantChain(...)`，不要手写 `'thumb'` / `'preview'`；
3. 有 storageKey 一律走 `useMediaObjectUrl` / `ThumbImage`，不要自己 `createObjectURL`；
4. 需要新档位时先改 `IMAGE_VARIANT_SPECS` 并同步本表 + 生成/解析两侧，禁止在组件里另写尺寸常量；
5. 大图（灯箱、浏览器）显式 `orig` / `full`，小图交给自动协商。

## 7. 本轮未收口（Plan#85 第二步候选）

- 缺 256px 中间档：96~220px 显示区当前取 1024px preview（清晰但带宽偏重），补 `sm` 档可再省。
- `use-auth-image.ts` 每组件各 fetch + createObjectURL，与 `backendUrlCache` 双缓存待合并。
- `useProgressiveImage` 同一原图仍可能 createImageBitmap 3~4 次；`needLocalFull` 拉原图待收敛。
- 开源库 `public/openlib/thumbs/` 打包小图被 `width:100%` 撑满整卡，需换中档源或改尺寸协商。
- `hydrate.ts` / `backend-upload.ts` / `resource-url.ts` 的 `ImageTier` / `ImageSizeParam` / `?size=sm` 命名待并入同一枚举。
