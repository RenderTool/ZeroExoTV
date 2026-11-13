/**
 * 提示词预设（只读）—— 角色定妆参考图（正面特写 + 正背全身）
 *
 * 口径（2026-11-09 用户定稿，2026-11-10 修订）：
 * - 不再区分公共/私有，所有预设统一进提示词库；
 * - 页面只读，不跟资产页混排；
 * - 图片节点参数旁的下拉、画布抽屉提示词分组、主页提示词页共用这一份数据；
 * - 提示词必须写明「画面共几个」，禁止用「三视图 / Lineup Sheet」这类名字诱导模型自己加视图。
 */
export interface PromptPreset {
  id: string;
  title: string;
  category: '角色' | '场景' | '道具';
  description: string;
  tags: string[];
  body: string;
  /** 卡片封面（data URL；预设专用，用户提示词可无） */
  coverUrl?: string;
}

function frontBackCover(wide: boolean): string {
  const w = wide ? 720 : 640;
  const h = wide ? 360 : 400;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#202329"/><stop offset="1" stop-color="#3a3f4a"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="22" y="30" fill="#ffffff" fill-opacity=".4" font-family="sans-serif" font-size="11" letter-spacing="2">CHARACTER REFERENCE</text>
  <g fill="#ded8c8" fill-opacity=".16" stroke="#ded8c8" stroke-opacity=".22">
    <rect x="${w * 0.18}" y="${h * 0.24}" width="${w * 0.2}" height="${h * 0.58}" rx="4"/>
    <rect x="${w * 0.45}" y="${h * 0.3}" width="${w * 0.15}" height="${h * 0.52}" rx="4"/>
  </g>
  <g fill="#ffffff" fill-opacity=".45" font-family="sans-serif" font-size="9" text-anchor="middle">
    <text x="${w * 0.28}" y="${h * 0.79}">FRONT</text>
    <text x="${w * 0.525}" y="${h * 0.79}">BACK</text>
  </g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const FRONT_BACK_16_9 = `专业电影级角色定妆参考图（正面特写 + 正背全身）。
画面布局 (Layout)：
16:9 横向宽银幕构图。画面中固定 3 个画面，数量不得增减：
① 左侧 1 个正面大头特写；② 右侧 1 个正面全身；③ 右侧 1 个背面全身。
禁止侧面视图、其它机位、第四个人物、多角度拼版。
角色描述：{角色描述段：身份/身型/特征签名/武器签名}

角色一致性 (Consistency)：严格锁定同一真人演员。
体态：自然放松站姿（非 T-pose/A-pose），重心微移，手臂自然下垂，杜绝僵硬模型感。
头部纪律：正面与背面两个全身视图的头部均随身体朝向正前方、视线水平，绝不转头、偏头、回眸或回首望向镜头；背面即纯背身，头不后转、不从肩线探出侧脸。

左侧特写 (Portrait)：
构图：正面平视，中性自然表情，真实眼神
质感：极致写实皮肤，强调骨相与真实肤质。
镜头：85mm 人像镜头，浅景深，电影级布光。

右侧全身 (Front & Back)：
要求：只有正面全身与背面全身这 2 个视图；身高对齐，底部平齐。真实演员试装照风格（Movie Costume Fitting）。正背两面为同一站姿：背面是同一条铅垂轴线的纯背视角，头朝前方，绝不再现面部、绝不回头。
服装：高级电影戏服质感。真实布料编织纹理，自然褶皱，缝线细节，哑光材质（无塑料感、无湿身效果）。

灯光：按剧本时代与题材定（自然主义柔光或戏剧化主光）
色彩：按剧本时代/题材定调（古装暖黄、民国低饱和、现代自然、科幻冷青）
质感：写实电影质感，与全剧美术统一；胶片颗粒只在剧本明确是复古年代时才用
背景与排版：
背景：纯白无缝背景纸（#FFFFFF），无任何道具
文字：极简无衬线字体标注：FRONT 正面 | BACK 背面。

质量标签 (Quality Tags)：AAA级电影制作质量，超高分辨率，写实人体解剖结构，专业可打印级精度，非动漫，非游戏渲染。
硬性禁止 (Negative)：回眸、回首、侧头回看镜头、颈部后转、背视图露正脸或侧脸、T-pose/A-pose、塑料质感、湿身、道具入镜、侧面视图、额外机位、第四个人物、多角度拼版。`;

const FRONT_BACK_21_9 = `专业电影级角色定妆参考图（正面特写 + 正背全身）。
画面布局：21:9 横向宽银幕构图。画面中固定 3 个画面，数量不得增减：① 左侧 1 个正面大头特写；② 右侧 1 个正面全身；③ 右侧 1 个背面全身。禁止侧面视图、其它机位、第四个人物、多角度拼版。
角色描述：{角色描述段：身份/身型/特征签名/武器签名}
体态：自然放松站姿，重心微移，手臂自然下垂，杜绝僵硬模型感。
头部纪律：正面与背面两个全身视图头部均随身体朝正前方、视线水平，绝不转头、偏头、回眸或回首；背面为纯背身，头不后转。
左侧特写：正面平视，中性自然表情，真实眼神；85mm 人像镜头，浅景深，电影级布光。
右侧全身：只有正面全身与背面全身这 2 个视图；身高对齐，底部平齐；真实演员试装照风格，正背两面同一站姿；背面是同一条铅垂轴线的纯背视角。
服装：高级电影戏服质感，真实布料编织纹理、自然褶皱、缝线细节，哑光材质（无塑料感、无湿身效果）。
灯光：按剧本时代与题材定（自然主义柔光或戏剧化主光）。
色彩：按剧本时代/题材定调（古装暖黄、民国低饱和、现代自然、科幻冷青）。
质感：写实电影质感，与全剧美术统一；胶片颗粒只在剧本明确是复古年代时才用。
背景与排版：纯白无缝背景纸（#FFFFFF），无任何道具；极简无衬线字体标注 FRONT 正面 | BACK 背面。
色卡锁定：{主色/边光/过渡色，可留空}。
质量标签：AAA 级电影制作质量，超高分辨率，写实人体解剖结构，专业可打印级精度，非动漫，非游戏渲染。
硬性禁止：回眸、回首、侧头回看镜头、颈部后转、背视图露正脸或侧脸、T-pose/A-pose、塑料质感、湿身、道具入镜、侧面视图、额外机位、第四个人物、多角度拼版。`;

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'character-three-view-16-9',
    title: '角色定妆（正面特写 + 正背全身）· 16:9',
    category: '角色',
    description: '固定 3 个画面：正面大头特写 + 正面全身 + 背面全身，不增减、不出现侧面；纯白背景、真实戏服、锁同一演员。',
    tags: ['角色定妆', '正背全身', '16:9'],
    body: FRONT_BACK_16_9,
    coverUrl: frontBackCover(false),
  },
  {
    id: 'character-three-view-21-9',
    title: '角色定妆（正面特写 + 正背全身）· 21:9',
    category: '角色',
    description: '宽银幕 21:9 定妆版，同样固定 3 个画面，适合电影感角色设定与跨集一致性参考。',
    tags: ['角色定妆', '正背全身', '21:9'],
    body: FRONT_BACK_21_9,
    coverUrl: frontBackCover(true),
  },
];

export const PROMPT_CATEGORIES = ['全部', '角色', '场景', '道具'] as const;
