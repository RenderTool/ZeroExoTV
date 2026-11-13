# 需求征集索引 — zeroexo-comfyui

> 本目录是 **zeroexo-comfyui 唯一**的需求 / 遗漏 / 决策征集位。
> 2026-11-06 从外部前端规则库 `zeroexo/.project-rules/suggestion-board/` 迁回 17 份；此后禁止再往外部库写 comfyui 征集。
> 新增流程：`_template.md` 复制 → 命名 `YYYY-MM-DD-主题.md` → 归属分析（功能强化 / bug 遗漏 / 决策）→ 决定并入 `../plans/` 哪个 Plan 或独立热修 → 在本表登记。

| # | 日期 | 主题 | 归属 | 状态 | 文件 |
|---|---|---|---|---|---|
| S-01 | 2026-11-02 | 本地 ComfyUI 作为部署底座 / 画布是否剥离成独立前端 | C-02 立项依据 | 🟢 merged | [2026-11-02-comfyui-as-channel-vs-strip-canvas.md](2026-11-02-comfyui-as-channel-vs-strip-canvas.md) |
| S-02 | 2026-11-05 | 资源显示机制 / 日文素材与发送按钮 / 服务停摆 / 交接烂摊子 | 独立热修 · C-02 验收轮 | 🟢 merged | [2026-11-05-comfyui-asset-display-and-service-recovery.md](2026-11-05-comfyui-asset-display-and-service-recovery.md) |
| S-03 | 2026-11-05 | 拖入画布节点尺寸与「发送到画布」不一致 + 抽屉「剧本」分组移除 | 独立热修 | 🟢 merged | [2026-11-05-comfyui-drop-node-size-and-drawer-script-tab.md](2026-11-05-comfyui-drop-node-size-and-drawer-script-tab.md) |
| S-04 | 2026-11-05 | 子画布 Sub-Canvas 新模块 | C-03 | 🟢 merged | [2026-11-05-comfyui-sub-canvas-module.md](2026-11-05-comfyui-sub-canvas-module.md) |
| S-05 | 2026-11-05 | 主体库标题/新建入口形态 + 状态色去红去绿 | 独立热修 | 🟢 merged | [2026-11-05-comfyui-subject-add-tile-and-state-colors.md](2026-11-05-comfyui-subject-add-tile-and-state-colors.md) |
| S-06 | 2026-11-06 | 导演台衔接箭头胶囊化 + 提示词面板镜头跳转胶囊 | 独立热修 | 🟢 merged | [2026-11-06-comfyui-director-arrow-capsule-and-shot-nav.md](2026-11-06-comfyui-director-arrow-capsule-and-shot-nav.md) |
| S-07 | 2026-11-06 | 导演台时长下拉改 0–30s 滑动条 + 超推荐时长提醒 | 独立热修 | 🟢 merged | [2026-11-06-comfyui-director-duration-slider-cap-warning.md](2026-11-06-comfyui-director-duration-slider-cap-warning.md) |
| S-08 | 2026-11-06 | 素材分段批量操作 + 「我的资产」改名「全局」+ 开源库排末位 | 独立热修 | 🟢 merged | [2026-11-06-comfyui-drawer-asset-batch-and-scope-rename.md](2026-11-06-comfyui-drawer-asset-batch-and-scope-rename.md) |
| S-09 | 2026-11-06 | 抽屉瀑布流宽度区间抖动（三环反馈） | 独立热修 | 🟢 merged | [2026-11-06-comfyui-drawer-masonry-jitter-hysteresis.md](2026-11-06-comfyui-drawer-masonry-jitter-hysteresis.md) |
| S-10 | 2026-11-06 | 抽屉主体分段工具栏与素材对齐 + 批量编辑 | 独立热修 | 🟢 merged | [2026-11-06-comfyui-drawer-subject-toolbar-parity-and-batch-edit.md](2026-11-06-comfyui-drawer-subject-toolbar-parity-and-batch-edit.md) |
| S-11 | 2026-11-06 | 预览图档位混乱：统一契约 + 入口自动派生 + 尺寸协商 + 明确缓存 | 独立热修 · 建议后续 Plan | 🟢 merged | [2026-11-06-comfyui-image-variant-contract-and-cache.md](2026-11-06-comfyui-image-variant-contract-and-cache.md) |
| S-12 | 2026-11-06 | 弹层居中 + 主体选中/弹性排列对齐 + 状态页冗余提示 + 插槽拖入正文 | 独立热修 | 🟢 merged | [2026-11-06-comfyui-modal-centering-subject-masonry-slot-drop.md](2026-11-06-comfyui-modal-centering-subject-masonry-slot-drop.md) |
| S-13 | 2026-11-06 | 画布节点引脚默认值改到 12 | 独立热修 | 🟢 merged | [2026-11-06-comfyui-pin-default-size-12.md](2026-11-06-comfyui-pin-default-size-12.md) |
| S-14 | 2026-11-06 | 抽屉主体段总数 / 新建序号递增 / 同名主体身份绑定 | 独立热修 | 🟢 merged | [2026-11-06-comfyui-subject-item-binding-and-count.md](2026-11-06-comfyui-subject-item-binding-and-count.md) |
| S-15 | 2026-11-06 | 主体类型修改丢写竞态（无锁 read-merge-write） | 独立热修 | 🟢 merged | [2026-11-06-comfyui-subject-kind-lost-write-race.md](2026-11-06-comfyui-subject-kind-lost-write-race.md) |
| S-16 | 2026-11-06 | 主体状态编辑页美化 + 状态可当封面 | 独立热修 | 🟢 merged | [2026-11-06-comfyui-subject-state-page-trim-and-cover.md](2026-11-06-comfyui-subject-state-page-trim-and-cover.md) |
| S-17 | 2026-11-06 | 项目 = N 个画布 + 剧本 + 出片 的挂载模型（C-03） | C-03 | 🟢 merged | [2026-11-06-project-canvases-mount-model.md](2026-11-06-project-canvases-mount-model.md) |
| S-18 | 2026-11-10 | 画布视频生成验收反馈 5 项：采样进度 / 打包下载 / 一键同款 / 参数浮层下拉 / 输出比例恒 1:1 | 独立热修 | 🟢 merged | [2026-11-10-comfyui-canvas-video-generation-five-feedbacks.md](2026-11-10-comfyui-canvas-video-generation-five-feedbacks.md) |
| S-19 | 2026-11-10 | 素材导入失败：目录授权与 MCP 服务无关，失败被空态吞掉 | 独立热修 | 🟢 merged | [2026-11-10-comfyui-directory-auth-not-mcp.md](2026-11-10-comfyui-directory-auth-not-mcp.md) |
| S-20 | 2026-11-10 | 历史分组类型标签改简约名词（图片 / 视频） | 独立热修 | 🟢 merged | [2026-11-10-comfyui-history-kind-labels.md](2026-11-10-comfyui-history-kind-labels.md) |
| S-21 | 2026-11-11 | 项目 ZIP 导出范围补全：剧本转 MD、主体格式化、无缝迁移 | C-05 | 🟢 merged | [2026-11-11-project-zip-full-migration.md](2026-11-11-project-zip-full-migration.md) |

| S-22 | 2026-11-11 | 首页三项：回收站弹窗尺寸 / 复制项目 / 资产选择模式对齐 | 独立热修 | 🟢 merged | [2026-11-11-homepage-three-fixes.md](2026-11-11-homepage-three-fixes.md) |
| S-23 | 2026-11-12 | 取消状态详情页：两级整页 + 卡片内编辑面板（提示词文本块 / 集数下拉按钮），清开发者文案 | 独立热修 | 🟢 merged | [2026-11-12-comfyui-drop-state-detail-page.md](2026-11-12-comfyui-drop-state-detail-page.md) |
| S-24 | 2026-11-12 | MCP 防跨主体共用图（audit cross_subject_image + set_subject_image 闸门）；主体编辑面板集数区间压缩美化 | 独立热修 | 🟢 merged | [2026-11-12-comfyui-cross-subject-image-guard.md](2026-11-12-comfyui-cross-subject-image-guard.md) |
| S-25 | 2026-11-13 | 主体环节硬闸门：read_asset 先看图 + 反推提示词才许 set_subject_image；主体清单交付物与缺图清单写死 | 独立热修 | 🟢 merged | [2026-11-13-comfyui-subject-image-review-and-prompt-caption.md](2026-11-13-comfyui-subject-image-review-and-prompt-caption.md) |

状态：open 0 / merged 25。
