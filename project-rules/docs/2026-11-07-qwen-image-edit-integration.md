# Qwen Image 2.1 图像编辑接入（2026-11-07）

> 目标：把用户提供的 `qwen_image_2_1_image_edit.json` 接成 ZeroExo 的**第三条本机工作流**
> （前两条：参考生视频 / H3 导演台），供画布图片节点与图片编辑页（含局部遮罩）使用。
> 工作流 API 走 `ComfyUI_ZeroExoNodes` 的 `/zeroexo/v1/jobs`（kind = `qwen_image_edit`）。

## 一、原工作流必须先修的接线

用户导出的 API JSON 有两个**会导致编辑无效/校验失败**的问题：

1. `input_image`（`459:485 BatchImagesNode`）只连到了 `459:500 TextGenerate`（LLM 改写），
   **没有连到 `459:474 TextEncodeQwenImage21.images`** → 编辑模型拿不到参考图，实际是纯文生图。
   已补：`459:474.inputs["images.image_1"] = ["459:485", 0]`。
2. `BatchImagesNode` 的 autogrow 子输入在 API prompt 里是**点号路径**（`images.image0`），
   不是 `image0` / `image1`；写成扁平键会被 ComfyUI 判为「Required input is missing: image0」。
   已改为 `459:485.inputs["images.image0"] = ["zx_load_image", 0]`，并新增 `LoadImage` 节点
   `zx_load_image`（`image` 由服务端替换为上传后的文件名）。

## 二、三个模板

| 模板 | 何时用 | 关键差异 |
|---|---|---|
| `templates/qwen_image_edit.json` | 有输入图、无遮罩 | LoadImage → BatchImages → 编码器 `images.image_1` |
| `templates/qwen_image_edit_mask.json` | 有输入图 + 遮罩 | 按官方 Paint Pen 原理：红色标记烘焙进 image_1 → 生成 → `ImageCompositeMasked` 用同一遮罩把结果合成回原图 |
| `templates/qwen_image_t2i.json` | 无输入图（文生图） | 移除输入图/LoadImage/编码器 image 连线，走 `EmptyLatentImage` |

服务端按参数自动选模板；`edit_mode` 仍由 `459:468 ComfySwitchNode` 控制
（false = 图生图，true = 文生图），但前端在无输入图时直接走 t2i 模板，避免空 LoadImage。

## 三、参数契约（`kind = qwen_image_edit`）

| 参数 | 工作流节点 | 说明 |
|---|---|---|
| `edit_prompt` | `459:484.on_false` + `459:500.prompt` | 原始指令；LLM 开启时 `on_true` 走 459:500 |
| `input_image` | `zx_load_image.image` | ComfyUI input 文件名；先 `/upload/image` |
| `mask_image` | `zx_load_mask.image` | 有值 → 遮罩模板 |
| `seed` | `459:458.seed` + `459:500.sampling_mode.seed` | 两处同步 |
| `steps` / `cfg` / `denoise` | `459:458` | 采样参数 |
| `edit_mode` | `459:468.switch` | false=图生图，true=文生图 |
| `use_llm_enhance` | `459:484.switch` | true=先用 TextGenerate 改写指令 |
| `width` / `height` | `459:456` | 仅文生图（EmptyLatent）生效 |
| `negative_prompt` | `459:474.negative_prompt` | 可为空 |

## 四、前端

- `local-qwen-image.ts`：上传输入图/遮罩 → 提交 `qwen_image_edit` → 轮询 → `/view` 取回 Blob。
- 画布图片节点：模型下拉新增 `QwenImage2.1`（`zeroexo:qwen-image-2.1`）；有连线参考图 = 图生图，
  无参考图 = 文生图；参数面板暴露步数/CFG/Denoise/种子/LLM 改写。
  - 画面尺寸：有参考图默认「跟随原图」，比例按钮始终可见（1:1 / 4:3 / 3:4 / 16:9 / 9:16）；
    显式尺寸会先把输入图按填满居中裁切缩放到目标尺寸。无参考图默认 4:3（1344×1008）。
  - 官方 2K 约束：最长边 2048、最大 2048×2048；UI 与本地作业都夹取，超过 2K 的参考图先按比例缩到 2K。
  - 「透明背景」开关：提示词追加 PNG alpha 要求；Qwen VAE 原生输出 RGBA，SaveImageAdvanced 直接保存透明 PNG。
  - 文案：开关叫「优化提示词」（不写「大模型改写指令」）；CFG 叫「贴合度」、denoise 叫「修改幅度」、
    seed 叫「随机种子」，步数/贴合度/修改幅度/种子收进「高级」。
- 图片编辑页「局部」：不再提示「需要接入生成后端」，确认后走遮罩模板；遮罩区先标红，生成后按遮罩把
  原图合成回来（区域外不变），结果生成在原图右侧的新图片节点（原图不动）。
- 产物落库：复用 `autoLandGenerationOutput`（图片），节点写回 CAS `storageKey`，历史/资产可继续导出。

## 五、验证

- 插件：`python -m py_compile __init__.py` 通过；三个模板在 ComfyUI 中校验通过。
- 真实作业（`steps=1`，ComfyUI 本机）：
  - 图生图：`zx_smoke_img_real` → success，产物 `output/zeroexo/smoke/image/img_00001.png`；
  - 遮罩：`zx_smoke_img_mask_real` → success，产物 `img_00002.png`；
  - 文生图：`zx_smoke_img_t2i_real` → success，产物 `img_00003.png`。
- 失败路径：`steps=0` 时插件明确返回
  `ComfyUI 工作流校验失败: 459:458 KSampler: Value 0 smaller than min of 1（steps）`，
  不再出现「队列 accepted 但无产物却标 success」。
- 注意：`/prompt` 即使有 node_errors 也会返回 prompt_id；插件现在检查 `node_errors` 并把作业标 error，
  同时「success 但 outputs 为空」也判 error。

## 六、已知边界

- 当前只接**一张输入图**（BatchImages 的 `images.image0`）；多图参考可继续加 `images.image1…`。
- 遮罩模板的 `denoise=1` 表示遮罩区完整重绘；需要更保守时前端可传 <1。
- 真实出图质量依赖 `steps`（默认 25）；1 步只用于链路 smoke，不要当最终质量。
