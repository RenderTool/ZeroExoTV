# ComfyUI 全局地址与约定工作流接入规格

日期：2026-11-05
范围：ComfyUI 地址唯一入口、约定工作流登记/校验/试跑。不含导轨、资产库、主体库与视觉样式。

## 1. 地址：唯一来源

| 项 | 约定 |
|---|---|
| 存储键 | `zeroexo.comfyuiEndpoint`，envelope `{ schemaVersion: 1, data: { address } }` |
| 写入点 | 顶栏右上角「ComfyUI」弹层（`src/features/top-bar/components/top-bar.tsx` 挂载 `ComfyuiConnectButton`），只有这一处输入框 |
| 读取点 | 所有功能通过 `loadComfyuiEndpoint()` / `useComfyuiEndpointStore.getState().address` 读；禁止新增第二个地址键或第二处输入框 |
| 规范化 | `normalizeBaseUrl`：补 `http(s)://`、去尾斜杠 |
| 旧数据 | 首次读取时一次性迁移 `zeroexo.genChannels` / `zeroexo.comfyuiBridge` 的地址字段；新键写入后不再读旧键 |

导演台运行链路不变：`getRunConfigFromEndpoint()` 继续从同一个 store 推导直连（`/zeroexo/h3/*`）或兼容口（`/v1/*`）配置。

## 2. 工作流存储

| 项 | 约定 |
|---|---|
| 存储键 | `zeroexo.comfyuiWorkflows`，envelope `{ schemaVersion: 1, data: { workflows: Entry[] } }` |
| Entry | `{ id, name, purpose, workflow, inputMapping, outputMapping, updatedAt }` |
| purpose | `text2image` / `image2image` / `video` / `other` |
| workflow | API 格式对象：`{ "<节点id>": { "class_type": string, "inputs": Record<string, unknown> } }` |
| inputMapping | `{ positivePrompt, negativePrompt, seed, width, height, image, steps, cfg }`，每项 `{ nodeId, input }`（`image` 的取值是 ComfyUI `input` 目录下的图片文件名） |
| outputMapping | `{ nodeId, kind }`，`kind` ∈ `image` / `video` / `gif` |

## 3. 第三方工作流必须满足的接入条件

1. **API 格式**：在 ComfyUI 菜单使用 `Workflow → Export (API) / Save (API Format)` 导出。
   顶层必须是「节点 id → 节点对象」，节点对象必须含 `class_type` 与 `inputs`。
   UI 格式（含 `nodes` / `links` 数组）在保存入口明确拒绝，并提示重新导出；不做隐式转换。
2. **节点 id 稳定**：登记后不得随意重排/重建节点，否则映射（`nodeId`）会失效。需要改图时重新登记一条新工作流。
3. **必填字段清单**：
   - `positivePrompt` 映射：必填；
   - `outputMapping.nodeId`：必填；
   - 其余映射可选；`image` 仅在 `image2image` 用途下使用。
4. **可校验**：工作流所有 `class_type` 必须能在目标 ComfyUI 的 `/object_info` 中找到。
5. **模型可解析**：`inputs` 中作为下拉取值的模型文件名（`.safetensors / .ckpt / .pt / .pth / .bin / .onnx / .gguf`）
   必须出现在对应节点的候选清单里。
6. **输出可取**：输出节点必须在 `/history/{prompt_id}` 的 `outputs[nodeId]` 下产出
   `images` / `gifs` / `videos` 之一（视频节点通常落在 `gifs` 或 `videos`，本规格按 `kind` 顺序回退查找）。

## 4. 参数注入规则

实现：`applyWorkflowInputs(workflow, mapping, values)`。

- 深拷贝工作流后再写值，不修改登记原值；
- 逐项处理映射：`workflow[nodeId].inputs[input] = value`；
- 映射存在但指向不存在的 `nodeId` → 直接报错，不提交；
- `values` 中为 `undefined` 的字段保持工作流原值（不覆盖）。

试跑使用的最小参数：

| 字段 | 值 |
|---|---|
| positivePrompt | `__zeroexo_probe__` |
| negativePrompt | `""`（仅当映射存在） |
| seed | `0`（仅当映射存在） |
| width / height | `512`（仅当映射存在） |
| steps / cfg | `20` / `7`（仅当映射存在） |
| image | 用户在面板填写的文件名（仅当映射存在且必填） |

## 5. 保存时校验（`/object_info`）

流程：解析 JSON → 检查映射完整性 → `GET {base}/object_info` → 逐节点校验。

必须能具体指出以下问题：

| 问题 | 报出内容 |
|---|---|
| 插件未安装/未启用 | `节点 {id} 的 class_type「{class}」在 /object_info 中不存在` |
| 必填字段缺失 | `节点 {id}（{class}）缺少必填字段「{key}」` |
| 下拉取值不存在 | `节点 {id}（{class}）字段「{key}」：取值不在可选清单「{value}」` |
| 模型文件不存在 | `节点 {id}（{class}）字段「{key}」：模型文件不存在「{value}」` |

有错误时不落库；`/object_info` 请求失败时同样不落库，并显示失败原因。

## 6. 试跑流程

1. 按第 4 节注入参数；
2. `POST {base}/prompt`，body `{ prompt, client_id }`；
3. 轮询 `GET {base}/history/{prompt_id}`（默认 2s/次，120s 超时）；
4. `status.status_str === "error"` → 原样回显 `status.messages`；
5. 成功时按 `outputMapping` 取产物，拼 `GET {base}/view?filename=&subfolder=&type=`；
6. 面板回显：产物数量、`prompt_id`、首个图片预览、原始 JSON。

## 7. 验收清单

- [ ] 顶栏右上角只有一处 ComfyUI 地址输入；`src/features/canvas-tabs` 内无第二个地址输入框。
- [ ] `zeroexo.comfyuiEndpoint` 是唯一地址存储键。
- [ ] 导演台运行仍能通过 `getRunConfigFromEndpoint()` 取到地址与模型。
- [ ] 工作流可登记、编辑、删除，刷新后仍在。
- [ ] UI 格式 JSON 被拒绝并提示 `Save (API Format)`。
- [ ] 保存前必须通过 `/object_info` 校验，错误逐条列出。
- [ ] 试跑能真实提交 `/prompt`，并回显产物或原始错误。
