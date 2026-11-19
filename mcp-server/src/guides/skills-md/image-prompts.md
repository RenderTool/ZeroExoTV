# 技能：画布图片提示词（image-prompts：Moss / Krea2 / Qwen）

> 适用：要在画布上生成图片（定妆、场景、道具、封面、海报、插画）时。
> 工具：generate_canvas_images（写作业 → 网页画布在线时自动建节点生成）→ get_canvas_image_job 轮询。
> 硬规则：尺寸/步数/种子先跟用户确认；用户说「按默认」才用本文默认值。

## 0. 三个模型怎么选

| 模型 | model 值 | 最强项 | 默认参数（用户同意才用） |
|---|---|---|---|
| Moss Image | moss | 画面叙事、材质光影、英文长描述、版式内文字位置 | 1MP（1024²）、25 步、cfg 2.5、比例按题材 |
| Krea2 | krea2 | 视觉风格、氛围、电影感、参考风格 | 3MP、10 步、cfg 1.0 |
| Qwen Image 2.1 | qwen | 中文理解、长文字/海报/封面排版、图生图编辑 | 25 步、cfg 1.0、最长边 ≤2048（16 对齐） |

## 1. Moss Image 写法（推荐默认）

Moss 的文本编码器按「成品图的说明文」学出来的，所以要**描述画面本身**，不要写命令式要求：

- 英文、平实散文，1–3 段，通常 80–200 词；开头给媒介 + 主体，再场景/构图，最后光色与细节。
- 只写看得见的东西：不写声音、气味、前史、意图；不编造日期、价格、具体人名。
- 画面里的文字用双引号原样写出（保留用户语言、大小写、标点），并描述文字位置/大小/字体/颜色/读序。
- 用 left/right/top/bottom/foreground/background 定位；不要坐标、列表、JSON、Markdown。
- **不要** quality 关键词（masterpiece、best quality、8k、highly detailed），也不需要负面提示词。

示例（人物定妆）：
```
A cinematic studio portrait photograph of a young Chinese woman in a charcoal silk qipao, seated on a wooden stool against a deep teal paper backdrop. Three-quarter framing, camera at eye level, soft key light from the left with a warm rim on her hair, visible skin texture and fabric sheen. Her hands rest loosely in her lap, calm expression, gaze slightly off-camera. Shallow depth of field, 85mm lens look, muted teal and warm amber palette, fine 35mm film grain.
```

### 1.5 场景轴图写法（Moss/Krea2 通用，2026-11-14 复盘）

- **单机位**：一个机位一张单轴图（默认 16:9，需要更多空间信息用 4:3；比例走参数，提示词不写比例）；不要默认四宫格（四格同场景一致性无法保证）。机位写清：eye-level wide，前景框景构件、中景主体空间、远景层次。
- **调度空间必须入画**：写明入口/门槛、人物站位空地、进出通道；前景柱子/门框只作边缘框景，不能把动线堵死。场景图是给演员走位用的，不是道具居中的装饰剧照。
- **色光锁逐字复用**：同一角色场景的所有轴图共用同一条光色基线句（暗部色 / 光源色 / 地面色 / 木作色 / 唯一暖源），逐字抄进每条提示词；不要每张图换一套颜色词导致蓝绿漂移。
- **形制写死年代地域**：朝代/地域/构件（round pillars on stone bases、exposed beams、square brick、lattice door…）点名，禁止漂到日式、江南园林、隔壁朝代；IP 改编先查官方可考形制再写。
- **空场景**：no people, no animals, no movable props, no text；场景与意境不符时先文生图重出或图生图编辑，不硬挂不像的图。
- **暗部保材质可读**：雨夜/暗场用 soft cinematic contrast，木纹、砖地、湿石反光、梁架都要留在可读区间；禁止堆叠 crushed blacks / ink-black darkness / high contrast 这类压暗措辞，否则整图被压平、材质细节被吃掉。色光锁一句带过即可，不要在每条提示词里重复整段暗色词；走短散文，参照已认可的旧图口径。
- 场景图同样不写 quality 词；光色用具体材质与光源描述（wet stone sheen、single amber lamp against ink-blue shadows），不写「氛围感、高级感」。

## 2. Krea2 写法

Krea 2 吃**自然语言 + 明确视觉选择**，越像给摄影师/美术指导的 brief 越稳：

- 先定「媒介/风格 + 主体 + 场景」，再给 1–2 个决定性视觉特征（光位、镜头、材质、色板），不要堆同义词。
- 关键词列表效果差；一句话说清「像什么」优于十个形容词。
- 风格参考用具体作品类型/年代/工艺描述（如「1970s Kodachrome editorial photography」），不要写作者名。
- 文字排版不是强项：需要大量文字时改用 Qwen 或 Moss。
- 默认 10 步 / cfg 1.0；提高步数收益很小，优先改提示词。

## 3. Qwen Image 2.1 写法

- 中文场景直接用中文写，主体 + 动作 + 环境 + 光线 + 风格，一段话即可；不要翻译腔。
- **文字能力最强**：海报/封面/菜单/招牌把文案逐字写进提示词（用引号），并说明位置、字号层级、字体气质、配色。
- 有参考图（图生图/编辑）时：先点名「参考图1」再写改动（前端会自动加前缀），否则会被当文生图重画。
- 角色定妆必须写死「画面共 3 个：正面大头特写 + 正面全身 + 背面全身」，禁止写「三视图 / Lineup Sheet」这类会诱导侧视图的名字。
- 负面提示词只在确有要排除的元素时写；默认空。

## 4. 尺寸与参数口径

- 1MP = 1024×1024（1024²），不是十进制 1e6。
- Moss：宽高 16 对齐（1024²、1280×720、720×1280、1536×1024…）；默认 1MP。
- Krea2：32 对齐；百万像素档 1/2/3/4，默认 3MP。
- Qwen：最长边 ≤2048、16 对齐；有参考图可「跟随原图」。
- 种子：用户要可复现就固定 seed；否则 -1 随机。**任何尺寸/步数/种子改动都要先问用户。**

## 5. 投递与验收

1. 逐条确认：模型、比例、百万像素/尺寸、步数、种子、张数。
   - **同一批 seed 必须互不相同**：要多张不同结果用 `seed:-1`，或逐张给不同 seed；同一个 seed + 同一 prompt/参数在 ComfyUI 会命中缓存，编辑时会返回同一张图（看起来像原图）。
   - **每次批量必须新的 jobId**；复用 jobId 会命中旧 status 的 done 条目并跳过生成。
2. `generate_canvas_images({ projectId, requests:[{model, prompt, aspect, megapixels, steps, seed, title}] })`。
3. `get_canvas_image_job({ projectId, jobId })` 轮询；state=done 后把 nodeId/storageKey 报给用户，让他在画布上核对。
4. pending 超过 30 秒：先确认网页是否打开同一项目（作业只在当前项目被消费）。
5. 失败项看 items[].error；不要静默重试，把原因报给用户。

## 6. 改图 / 图生图（用户说「把这张图的 X 改掉」时）

**必须走 generate_canvas_images 并带上原图**，禁止不传原图直接重生成（那是另一张图），也禁止用 Agent 自己的内置生图能力改图。

1. 先确定原图：
   - 画布节点：`get_canvas` 找到该节点的 `storageKey`，用 `sourceNodeId` 传节点 id；
   - 资产/历史：`list_assets` 或 `list_history` 拿 `storageKey`（`cas:<hash>.<ext>` / `image:<id>`），用 `sourceStorageKey`。
   - **画布上手动生成/改过的图不在 get_canvas 的「提交节点」里也可能存在**：先调 `list_history({ projectId, source:"canvas" })`，它会返回 `storageKey`、`width/height`、`prompt`、`originNodeId`；不要只凭 get_canvas 的节点数判断「没有生成图」。
2. 提示词写法：**「只改什么 + 其余保持不变 + 原图关键元素复述」**，例如：
   `只把画面中的玻璃罩煤油灯换成明代陶/铜油灯（矮身、无玻璃罩、暖色油焰），其余保持不变：人物姿势、服装、构图、光线、背景街道与雨夜氛围都保持原样。`
   不要写「重新生成一张…」；不要把整张图重新描述成新构图。
3. 调用：`generate_canvas_images({ projectId, requests:[{ model:'qwen', prompt:'…只改…其余保持不变…', sourceNodeId 或 sourceStorageKey }] })`。
   需要局部重绘时再给 `maskStorageKey`（白=可改区）。
4. 结果落在**新节点**（标题「MCP 改图」），原节点原图不动；告诉用户新节点位置。
5. 改完必须让用户看结果再决定是否继续；不要把「改图」做成覆盖式重生成。