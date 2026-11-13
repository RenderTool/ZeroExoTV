/**
 * style-shot-guides — 风格不只是画风，还决定镜头语言与节奏（2026-11-13 用户指出）
 *
 * 切换导演风格后，提示词与镜头时长往往要重写：
 * 韦斯·安德森的对称长镜、王家卫的手持碎片、诺兰的 IMAX 广角长镜，
 * 不可能共用同一套机位与段长。这里给每种风格一句可执行的「镜头/节奏」指南。
 */
import type { StylePreset } from './style-presets.js';

const SHOT_GUIDES: Record<string, string> = {
  'wes-anderson': '对称居中构图、固定机位、平面化调度、镜头偏长（6–12s），少用手持与快切',
  'wong-kar-wai': '手持、慢门拖影、碎片化短镜（3–6s）、霓虹特写与遮挡前景，允许跳切',
  'zhang-yimou': '大色块仪式感、广角大远景、对称/居中、镜头偏长（6–12s），强调色彩与人群阵列',
  'christopher-nolan': 'IMAX 广角、实景与冷色调、冷静长镜（6–10s）、交叉剪辑，少用花哨运镜',
  'quentin-tarantino': '低角度/仰角、长对白镜（8–15s）、突然的暴力特写，镜头内调度为主',
  'ridley-scott': '宽银幕、体积光与烟雾、硬光、慢速横移，镜头偏长（6–12s）',
  'akira-kurosawa': '多机位、长焦压缩、天气元素、群像调度，动作镜短、对峙镜长',
  'tim-burton': '哥特舞台光、俯仰畸变、对称与阴影，镜头偏慢、构图戏剧化',
  'ang-lee': '克制固定机位、自然光、情绪特写，镜头偏长，少运动',
  'film-noir': '高反差黑白、斜构图、雨夜与百叶窗阴影，固定机位偏多',
  'french-new-wave': '跳切、手持、街头抓拍、打破轴线，短镜与长镜混用',
  cyberpunk: '霓虹广角、低机位、雨夜反射、快速横移，短镜为主',
  'epic-fantasy': '大远景、体积光、慢速横移与升降，镜头偏长（8–15s）',
  'modern-urban': '自然光、城市几何、生活流、固定或轻手持，镜头中等（4–8s）',
  western: '宽银幕大远景、长镜对峙、黄金时刻，特写少而准',
  'chinese-ink-wash-animation': '水墨留白、横移长镜、空镜多，节奏慢',
  'studio-ghibli': '自然光、长镜、生活细节、固定机位偏多，节奏舒缓',
  'pixar-3d-animation': '清晰构图、明确表演、镜头服务动作，节奏中快',
  'anime-style': '夸张构图、速度线、特写与全景切换快，镜头短',
  'stop-motion': '舞台式固定机位、逐帧质感、镜头偏稳',
  'basic-real': '自然光、真实机位、生活化构图，镜头中等（4–8s）',
  'urban-real': '城市自然光、手持感、生活流，镜头 4–8s',
  'urban-romance': '柔光近景、浅景深、双人构图，镜头偏长（5–10s）',
  'suspense-crime': '硬光阴影、雨夜、突然特写，短镜与长镜混用制造压迫',
  'war-history': '手持纪实、宽银幕、尘土硝烟，短镜为主',
  'sci-fi-apocalypse': '广角废墟、硬边光、缓慢横移，镜头偏长',
  'shaw-brothers': '棚拍固定机位、全景/中景为主、动作段落短镜快切，胶片颗粒',
  'hk-classic': '霓虹夜景、手持与慢镜、英雄片构图，短镜与慢镜混用',
};

const CATEGORY_GUIDES: Record<string, string> = {
  director: '按该导演的构图、机位与节奏重写镜头；不要沿用旧风格的段长',
  mainstream: '按该类型的构图、光色与节奏重写镜头；不要沿用旧风格的段长',
  animation: '按该动画形态的构图与节奏重写镜头；不要沿用旧风格的段长',
  genre: '按该题材的构图、光色与节奏重写镜头；不要沿用旧风格的段长',
};

export function styleShotGuide(preset: StylePreset): string {
  return SHOT_GUIDES[preset.id] ?? CATEGORY_GUIDES[preset.category] ?? '按新风格重写构图/机位/节奏';
}
