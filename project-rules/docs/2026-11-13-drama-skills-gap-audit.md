# drama-skills 对照查漏补缺（2026-11-13）

> 参考仓库：<https://github.com/zenstory-ai/drama-skills>（12 个 skill，MIT）
> 方法：只取能落进我们 JSON 容器 + MCP 工具的规则，不照搬它的文件式交付与 12 个 CLI skill。
> 结论：分镜/主体两块补了「镜头卡」「图片八段式」「审片清单」；工具与数据模型保持不变。

## 一、它有什么（12 个 skill）

| skill | 职责 | 与我们的对应 |
|---|---|---|
| short-drama | 总控：五文档、Look Development、dashboard | 我们的 MCP 五阶段 + 页面 |
| novel-analyze | 长篇小说拆章、改编价值、分集候选 | `preflight_import` / `import_script`（弱） |
| develop | 改编方案、故事引擎、分集地图 | 我们的剧本页（无 develop 工具） |
| write | 写/修可拍摄剧本、去模板感 | 剧本页 + `import_script`（无写作门） |
| breakdown | 对标成片拆解、反推 | 无（可另立） |
| assets | 人物/造型/地点/道具、连续性锁 | 主体库 + `set_subject_profile` |
| image-prompts | 角色板/场景板/道具板提示词 | 主体提示词（部分） |
| storyboard | 分镜、场次站位、冻结关键帧、视觉依据 | 导演台片段 + `split_script_to_shots` |
| video-prompts | 单镜运动、时长、声音、参考槽位 | 导演台 `imagePrompt/videoPrompt` |
| produce | 确认后生产、回存 | `run_generation` / 画布生成 |
| edit | 出入点、字幕、响度、成片 | 无（剪辑不在本仓库） |
| review | 审查原稿/剧本/资产/提示词/分镜 | `audit_subjects`（结构级） |

## 二、真正的差距（按影响排序）

1. **分镜没有镜头卡**：我们 split 出来的片段只有 description + 5s 默认；没有「职责 / 来源场次 /
   起点→唯一动作→终点 / 景别机位运镜 / 声音 / 视觉依据 / 参考图」。→ 已补进 `shots-prompts` 1.5。
2. **没有场次站位**：多人/复杂空间直接从文字切镜，容易跳轴、站位漂。→ 已补「先写站位再写镜头」。
3. **起始帧不纯净**：容易把终点状态写进起始帧。→ 已补「起始帧只写起点可见内容，终点另写」。
4. **主体图提示词缺结构**：我们只有人设 + 风格 + 背景；它强调八段式、单一变体、身份 vs 变体、
   年代锚点、地点多视角、连续性锁。→ 已补 `subjects` 3.13。
5. **没有交付前审片**：只有 `audit_subjects` 与 `get_workbench` 结构核对，没有「每场有镜头 /
   无同义重复 / 连续性 / 缺图清单」的成品审查。→ 已补 `shots-prompts` 6。
6. **split 草案被当成分镜用**：工具描述与 stage 4 都写明「草案只是骨架，必须按镜头卡重设」。
7. **弱项（本轮未做）**：develop / breakdown / edit 三个 skill 我们没有对应能力；
   review 仍是结构级、不是逐镜质量审查；参考槽位没有强类型（用途/顺序/控制范围）。

## 三、已落地的改造

- `mcp-server/src/guides/skills.ts`
  - `shots-prompts` 新增 **1.5 镜头卡**（职责/来源/时长/景别机位运镜/起点→动作→终点/声音/视觉依据/参考图 +
    场次站位 + 起始帧纯净 + split 草案只是骨架）。
  - `shots-prompts` 新增 **6. 交付前审查**（每场有镜头、无同义重复、连续性、缺图清单、时长/对白、质量门）。
  - `subjects` 新增 **3.13 图片提示词八段式**（用途与身份锚点 → 单一变体 → 构图/视角 → 光色/材质 →
    背景边界 → 文字与禁止项；身份 vs 变体；年代锚点；地点多视角；连续性锁）。
- `mcp-server/src/tools/split.ts`：工具描述明确「草案只是骨架，必须按镜头卡重设，不得直接出片」。
- `mcp-server/src/guides/module-specs.ts`：阶段 4 动作改为按镜头卡重设，而不是只补景别/时长。
- 测试：现有 `guides.test.ts` 仍通过；新增文案不改变工具 schema。

## 四、明确不照搬

- **五份 Markdown 文档**：我们的数据源是 `entities/*.json`，文档式交付会形成第二套事实源；
  需要导出时另做 `export_project_docs`，不把写文件当流程。
- **12 个 CLI skill / dashboard / provider adapter**：与「MCP + 网页读写同一数据目录」的架构冲突。
- **剪辑（edit）与对标拆解（breakdown）**：不在本仓库能力范围，先不做。
- **机械校验脚本**（creator_markdown_check.py）：我们的容器已有 JSON schema/audit；如需要，
  后续做 `review_episode` 工具读容器核对，不引入 Markdown 解析链。

## 五、下一步候选（未做）

1. `review_episode({ projectId, episodeId })`：读剧本场次 + 导演台片段，检查「每场有镜头 / 空提示词 /
   缺参考图 / 时长越界 / 同义重复」，只报事实与修法。
2. `WorkbenchShot` 增 `sceneId / camera / sound` 字段（现在只能塞 description），让镜头卡结构化。
3. 主体图参考槽位强类型（用途 / 顺序 / 控制 / 不得控制），与 drama-skills 的 `REF-` 语法对齐。
