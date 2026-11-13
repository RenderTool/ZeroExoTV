/**
 * subject-prompt-templates - 基础形态(初始状态)提示词模板（Plan#71 T2）
 *
 * 来源：后端 `zeroexo_backend/.../skills/storyboard_assistant/references/asset-prompts.md`
 * （模板A 人形 / 模板B 巨兽 / 模板C 场景 / 模板D 道具）。
 * 2026-11-10 修订：画面数量必须写死（共几个画面、每个是什么），禁止用「三视图 / Lineup Sheet」
 * 这类名字诱导模型自己加一个侧面视图。
 * 用途：手动建树时给基础状态（states[0]）的 fullPrompt 一个「模板参数化」起点；
 * 有完整描述(roleDesc)才填充角色描述槽；无描述则返回模板骨架（占位符），提示后续由 AI/用户完善。
 * 色卡/质量标签等按 kind 内置（项目色卡在使用时由生成层锁定）。
 */
import type { ProductionItemKind } from '../production-manager/production-manager-types';

function descSlot(desc: string, placeholder: string): string {
  return desc ? desc : placeholder;
}

/** 全剧风格块：选中了画廊预设 → 一行风格片段；未选 → 旧 4 行默认（仅兜底） */
function styleBlock(stylePrompt?: string): string {
  const custom = (stylePrompt ?? '').trim();
  if (custom) return `风格：${custom}`;
  return [
    '风格：写实电影定妆照',
    '灯光：自然柔光为主，侧光塑形',
    '色彩：现代自然色调，低饱和',
    '质感：写实电影质感，真实皮肤与布料纹理',
  ].join('\n');
}

/** 模板A：人形角色 定妆参考图（正面特写 + 正背全身，画面数量固定） */
function characterFrontBack(desc: string, stylePrompt?: string): string {
  return `专业电影级角色定妆参考图（正面特写 + 正背全身）。
画面布局：16:9 横向宽银幕构图。画面中固定 3 个画面，数量不得增减：① 左侧 1 个正面大头特写；② 右侧 1 个正面全身；③ 右侧 1 个背面全身。禁止侧面视图、其它机位、第四个人物、多角度拼版。

角色描述：${descSlot(desc, '[英文，精确到年龄/朝代/民族/职业/身材/脸型/发型/服装/标志性特征]')}
角色一致性：严格锁定同一真人演员。三个画面必须是同一张脸、同一套服装；画面中只允许出现这一个角色，
禁止第二个人、多人合照、模特合集、候选人群像、旁人虚影。
体态：自然放松站姿（非T-pose/A-pose），重心微移，手臂自然下垂，杜绝僵硬模型感。

左侧特写：构图 微侧15°，中性自然表情，真实眼神；质感 极致写实皮肤，强调骨相与真实肤质；镜头 85mm 人像镜头，浅景深，电影级布光。

右侧全身：只有正面全身与背面全身这 2 个视图；身高对齐，底部平齐，真实演员试装照风格；服装 高级电影戏服质感，真实布料纹理、自然褶皱、缝线细节、哑光材质。

${styleBlock(stylePrompt)}

背景与排版：纯净中性灰(#C8C8C8)无缝背景纸，无任何道具；极简无衬线字体标注 FRONT 正面 | BACK 背面。

质量标签：AAA级电影制作质量，超高分辨率，写实人体解剖结构，专业可打印级精度，非动漫，非游戏渲染。`;
}

/** 模板B：巨兽/大型生物 Creature Reference Sheet */
function creatureReference(desc: string): string {
  return `专业电影级生物定妆参考图（Cinematic Creature Reference Sheet）。
画面布局：16:9 横向宽银幕构图。左侧 头部/面部特写，右侧为全身展示（含比例尺参考）。

生物描述：${descSlot(desc, '[英文，精确到物种/体型/鳞甲/毛色/角冠/尾部/爪牙/特殊特征]')}
角色一致性：严格锁定同一生物模型/设计。体态：自然站立，展示完整体态轮廓，禁止遮挡主体。

左侧特写：头部正面/半侧面，展示面部特征、眼睛、口鼻结构；中长焦，浅景深。
右侧全身：完整全身入画，底部留白、顶部留空，附比例尺示意。

灯光：戏剧化布光，侧逆光勾勒轮廓；质感：电影级生物特效质感，真实皮肤纹理。
背景：纯净中性灰(#C8C8C8)；文字标注 FRONT 正面 | SIDE 侧面 | FULL BODY 全身。

质量标签：AAA级电影制作质量，超高分辨率，写实生物解剖结构，专业可打印级精度，非动漫，非游戏渲染。`;
}

/** 模板C：场景 Environment Panorama */
function environmentPanorama(desc: string): string {
  return `专业电影级场景参考图（Cinematic Environment Reference）。
画面布局：16:9 横向宽银幕全景构图，含前景/中景/背景三层空间层次。

场景描述：${descSlot(desc, '[英文，精确到时代/地点/天气/季节/建筑风格/植被/主要物体]')}
空间纵深：前景元素 + 中景主体 + 背景远景，三层层次分明。
光照方向：主光源方向 + 色温 + 阴影方向。色调基调：整体色调倾向 + 色相饱和度分布。
视觉重点：核心视觉元素(3-5 个) + 氛围关键词。

灯光：主光源方向 + 辅助光源 + 环境光遮蔽；色彩：季节/时间对应自然色调。
质感：真实环境质感，自然材质细节，光影过渡自然。
背景：无边界的自然过渡，避免割裂感；文字标注 WIDE 全景 | DEPTH 纵深。

质量标签：AAA级电影制作质量，超高分辨率，真实环境质感，自然光影，非动漫，非游戏渲染。`;
}

/** 模板D：道具 Prop Detail Sheet */
function propDetail(desc: string): string {
  return `专业电影级道具参考图（Cinematic Prop Reference Sheet）。
画面布局：16:9 横向构图。左侧 道具整体展示，右侧为细节特写（材质/纹理/边缘）。

道具描述：${descSlot(desc, '[英文，精确到名称/材质/颜色/尺寸/年代/磨损程度/工艺特征]')}
一致性：严格锁定同一道具设计/尺寸/材质。

整体展示：正面/45°角完整入画，均匀柔光无强烈阴影，纯净中性灰(#C8C8C8)或纯白背景。
细节特写：局部特写展示材质纹理、边缘处理、做工细节；微距镜头，侧光强调纹理。

质感：真实材质质感（金属/木材/布料/陶瓷/皮革），自然纹理细节，做旧效果自然。
色彩：真实道具色彩，色差准确，还原年代感。
背景：纯净中性灰(#C8C8C8)无缝背景纸；文字标注 FRONT 正面 | DETAIL 细节。

质量标签：AAA级电影制作质量，超高分辨率，真实材质质感，道具级别精度，非动漫，非游戏渲染。`;
}

/**
 * 按 kind 生成基础形态(初始状态)提示词起点。
 * roleDesc 优先用已有形象描述(consistency/锚点句)；没有时保留占位符骨架由 AI/用户后续填充。
 */
export function buildBaseStatePrompt(
  kind: ProductionItemKind,
  opts: { roleDesc?: string; name?: string; stylePrompt?: string } = {},
): string {
  const desc = (opts.roleDesc ?? '').trim() || (opts.name ?? '').trim();
  switch (kind) {
    case 'character':
      return characterFrontBack(desc, opts.stylePrompt);
    case 'prop':
      return propDetail(desc);
    case 'scene':
      return environmentPanorama(desc);
    default:
      return characterFrontBack(desc, opts.stylePrompt);
  }
}

/** 供「巨兽」类主体选用(角色但需 Creature Reference) */
export function buildCreatureBaseStatePrompt(opts: { roleDesc?: string } = {}): string {
  return creatureReference((opts.roleDesc ?? '').trim());
}
