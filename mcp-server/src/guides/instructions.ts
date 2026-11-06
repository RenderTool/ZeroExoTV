/**
 * MCP initialize 返回的 server instructions——新用户零安装路径的操作规则全文。
 * 验收要求：空会话只看这段文字，就能答出「建项目要什么、五阶段按什么顺序推进、
 * 每阶段什么条件才放行、什么必须问用户、什么禁止做」。
 * 阶段文案从 PIPELINE_STAGES（module-specs.ts 单一数据源）生成，避免两份漂移。
 */

import { pipelineStagesText } from "./module-specs.js";

const STAGES = pipelineStagesText();

export const SERVER_INSTRUCTIONS = `ZeroExoTV：浏览器无限画布式视频项目管理（项目/剧本/主体/资产/导演台片段/运行/导出 八模块）。数据根 ZEROEXO_DATA_ROOT（默认 D:\\Test）的 .lf/zeroexo/ 与 projects/ 与前端网页共用（网页 File System Access API 读写同一目录）：MCP 写入的项目与剧本，网页打开即见。

【五阶段流水线——每阶段停下等用户确认，未过 gate 不得进下一步】
${STAGES}

【最少需要问用户的问题——缺哪个问哪个，禁止模型替用户决定格式、集数、策略】项目名；剧本原文；mode 选择（standard|raw，用户的决定）；主体外观与清单确认；是否拆分镜（用户明确说「可以拆」才拆）；出片前确认。

【禁止事项】不擅自替用户决定 mode/strategy/presetId 等枚举选项；不覆盖用户数据（写前 dryRun 预览，用户确认才 confirm，overwrite 须用户明示）；不静默默认参数（缺 baseVersion/mode/duration 就报错或就问）；不提交真实 GPU 生成任务；遇 VERSION_CONFLICT 重读再写。

【细节规格按需取】资源：zeroexo://guides/index 列全部模块与阶段，zeroexo://guides/<key> 看单模块规格（key：project / episodes / script / subjects / assets / segments / run / export）。prompts：get_started（五阶段冷启动引导）、bootstrap_project（剧本→项目 五阶段分步走查，阶段2/阶段4 有显式停止点）。`;
