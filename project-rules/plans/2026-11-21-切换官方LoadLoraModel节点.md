# C-23 批量 LoRA 改用官方 `Load LoRA (Model)` 节点

## 用户口径

> 然后是批量 lora 加载，我看了官方好像有一个叫「加载 LoRA（模型）」的节点？……当工作流需要向同一个模型应用一长串 LoRA 时，使用此节点，而不是串联多个单 LoRA 加载器。

官方节点 = `class_type: LoadLoraModel`（显示名 `Load LoRA (Model)`，category `model/loaders`），本机已注册。

## 事实核查（本机实测，不是文档抄写）

- 源码 `D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\comfy_extras\nodes_lora_stack.py`：
  `loras` 是 `COMFY_DYNAMICGROUP_V3` 动态行组，行模板 `lora_name`(COMBO) / `strength`(FLOAT -100~100) / `enabled`(BOOLEAN)，
  **min 1、max 20 行**；`execute` 里 `enabled=False` 或 `strength == 0` 直接跳过；加载走
  `comfy.utils.load_torch_file(..., return_metadata=True)` + `comfy.sd.load_lora_for_models(model, None, lora, strength, 0, lora_metadata=...)`。
- API 形态（`comfy_api/latest/_io.py:1426`）：行是**扁平键** `loras.<index>.<field>`，不是嵌套数组。
- 真实提交验证：`UNETLoader → LoadLoraModel(2 行，第 0 行 enabled=false) → PreviewAny`，`POST /prompt` 返回 `200`、`node_errors: {}`；
  `/history` 里有该任务，未被拒绝 → 行键写法正确。
- min=1 意味着**空 LoRA 不能发 0 行**，必须把节点从图里剪掉。

## 方案

1. `templates/reference_video.json`：`25` 号 `class_type` 由 `ZeroExoLoraChain` 改成 `LoadLoraModel`，`inputs` 只留 `model: ["45:66",0]`（行在提交时注入）；id 与下游 `12.model = ["25",0]` 保持不变。
2. `engine/graph_ops.py`：
   - 新增官方路径：命中 `LoadLoraModel` 时，先清掉所有 `loras.*` 旧行键，再按顺序写 `loras.<i>.lora_name / .strength / .enabled=true`；
   - 空列表 → 剪节点：把消费 `25` 的下游输入改接 `25.inputs.model`，再删 `25`；`model` 源缺失时 `RuntimeError`（不许留 0 行去撞校验）。
   - 保留 `ZeroExoLoraChain`（老模板兼容）与 `LoraLoaderModelOnly` 造链（更老的模板）两条路径。
3. 测试 `comfyui-plugin/tests/test_lora_chain.py`：`test_template_default_has_no_lora` 改为断言官方节点 + 无行键；新增「2 行按序注入」「不勾 = 剪节点 + 下游接回 UNETLoader」两条。
4. 前台 `MAX_LORAS` 保持 4（工程护栏，未获新口径不擅自放大；官方上限 20 只是能力上限）。
5. 版本 0.1.7（含尚未生效的 C-22 占位符修复），重打 zip，同步安装目录，需重启 ComfyUI 生效。

## 落地结果（2026-11-21）

- `templates/reference_video.json` 25 号 → `LoadLoraModel`，只有 `model: ["45:66",0]`，下游 `12.model = ["25",0]` 不变。
- `engine/graph_ops.py`：`apply_lora_chain` 先认官方节点（`_fill_official_rows` + 空列表 `_bypass_node`），再回退 `ZeroExoLoraChain` / `LoraLoaderModelOnly`；每行显式 `enabled=true`（只接收勾选行）。
- 测试 12/12：新增 official-rows / rows-replaced / empty-prune；老数组节点与老单节点路径仍在。
- 真底稿仿真：2 条 → `25` 保留、6 个行键、`12.model=["25",0]`；0 条 → `25` 被删、`12.model=["45:1",0]`（prune 后接正常链），class 全集只剩 6 个必需节点。
- 版本 0.1.7（`__init__.py` + `plugin-version.ts`），zip `ComfyUI_ZeroExoNodes-0.1.7.zip`（438430 B），安装目录已同步 `__init__.py` / `engine/graph_ops.py` / `templates/reference_video.json`。
- `tsc --noEmit` 通过；`comfyui-connect-button` 7/7、`director-plugin-payload` 6/6。

## 不做什么

- 不预勾任何 LoRA（延续「一切以勾选为准」）。
- 不删 `ZeroExoLoraChain` 代码与注册（老模板、老插件产物仍要能跑）。
- 不改前端参数面板出现 LoRA 选择的位置（仍只在「连接配置」Modal 的 LoRA Tab）。
