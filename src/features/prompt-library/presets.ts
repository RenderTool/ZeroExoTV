/**
 * 提示词预设（只读）—— 来源：zerovideoAgent「角色三视图」资产提示词
 *
 * 口径（2026-11-09 用户定稿）：
 * - 不再区分公共/私有，所有预设统一进提示词库；
 * - 页面只读，不跟资产页混排；
 * - 图片节点参数旁的下拉、画布抽屉提示词分组、主页提示词页共用这一份数据。
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

function threeViewCover(wide: boolean): string {
  const w = wide ? 720 : 640;
  const h = wide ? 360 : 400;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#202329"/><stop offset="1" stop-color="#3a3f4a"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="22" y="30" fill="#ffffff" fill-opacity=".4" font-family="sans-serif" font-size="11" letter-spacing="2">CHARACTER LINEUP</text>
  <g fill="#ded8c8" fill-opacity=".16" stroke="#ded8c8" stroke-opacity=".22">
    <rect x="${w * 0.18}" y="${h * 0.24}" width="${w * 0.2}" height="${h * 0.58}" rx="4"/>
    <rect x="${w * 0.45}" y="${h * 0.3}" width="${w * 0.15}" height="${h * 0.52}" rx="4"/>
    <rect x="${w * 0.64}" y="${h * 0.3}" width="${w * 0.15}" height="${h * 0.52}" rx="4"/>
  </g>
  <g fill="#ffffff" fill-opacity=".45" font-family="sans-serif" font-size="9" text-anchor="middle">
    <text x="${w * 0.28}" y="${h * 0.79}">FRONT</text>
    <text x="${w * 0.525}" y="${h * 0.79}">BACK</text>
    <text x="${w * 0.715}" y="${h * 0.79}">SIDE</text>
  </g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const THREE_VIEW_16_9 = `专业电影级角色定妆参考图（Cinematic Character Lineup Sheet）。
画面布局 (Layout)：
16:9 横向宽银幕构图。左侧 正面大头特写，右侧为三视图（正面、背面）。
角色描述：{角色描述段：身份/身型/特征签名/武器签名}

角色一致性 (Consistency)：严格锁定同一真人演员。
体态：自然放松站姿（非 T-pose/A-pose），重心微移，手臂自然下垂，杜绝僵硬模型感。
头部纪律：正面与背面两视图的头部均随身体朝向正前方、视线水平，绝不转头、偏头、回眸或回首望向镜头；背面即纯背身，头不后转、不从肩线探出侧脸。

左侧特写 (Portrait)：
构图：正面平视，中性自然表情，真实眼神
质感：极致写实皮肤，强调骨相与真实肤质。
镜头：85mm 人像镜头，浅景深，电影级布光。

右侧三视图 (Lineup)：
要求：身高对齐，底部平齐。真实演员试装照风格（Movie Costume Fitting）。正背两面为同一站姿：背面是同一条铅垂轴线的纯背视角，头朝前方，绝不再现面部、绝不回头。
服装：高级电影戏服质感。真实布料编织纹理，自然褶皱，缝线细节，哑光材质（无塑料感、无湿身效果）。

灯光：戏剧性主光，高对比度，非自然主义布光，柔和补光配合微弱轮廓光。
色彩：特艺彩色（Technicolor）取向，自然对比
质感：模拟 1970s 香港片场氛围，邵氏电影风格 (Shaw Brothers Aesthetic)
背景与排版：
背景：纯净中性灰（#C8C8C8），无缝背景纸，无任何道具
文字：极简无衬线字体标注：FRONT 正面 | BACK 背面。

质量标签 (Quality Tags)：AAA级电影制作质量，超高分辨率，写实人体解剖结构，专业可打印级精度，复古胶片感，非动漫，非游戏渲染。
硬性禁止 (Negative)：回眸、回首、侧头回看镜头、颈部后转、背视图露正脸或侧脸、T-pose/A-pose、塑料质感、湿身、道具入镜。`;

const THREE_VIEW_21_9 = `专业电影级角色定妆参考图（Cinematic Character Lineup Sheet）。
画面布局：21:9 横向宽银幕构图。左侧 正面大头特写，右侧为三视图（正面、背面）。
角色描述：{角色描述段：身份/身型/特征签名/武器签名}
体态：自然放松站姿，重心微移，手臂自然下垂，杜绝僵硬模型感。
头部纪律：正面与背面两视图头部均随身体朝正前方、视线水平，绝不转头、偏头、回眸或回首；背面为纯背身，头不后转。
左侧特写：正面平视，中性自然表情，真实眼神；85mm 人像镜头，浅景深，电影级布光。
右侧三视图：身高对齐，底部平齐；真实演员试装照风格，正背两面同一站姿；背面是同一条铅垂轴线的纯背视角。
服装：高级电影戏服质感，真实布料编织纹理、自然褶皱、缝线细节，哑光材质（无塑料感、无湿身效果）。
灯光：戏剧性主光，高对比度，柔和补光配合微弱轮廓光。
色彩：特艺彩色（Technicolor）取向，自然对比。
质感：模拟 1970s 香港片场氛围，邵氏电影风格 (Shaw Brothers Aesthetic)。
背景与排版：纯净中性灰（#C8C8C8）无缝背景纸，无任何道具；极简无衬线字体标注 FRONT 正面 | BACK 背面。
色卡锁定：{主色/边光/过渡色，可留空}。
质量标签：AAA 级电影制作质量，超高分辨率，写实人体解剖结构，专业可打印级精度，复古胶片感，非动漫，非游戏渲染。
硬性禁止：回眸、回首、侧头回看镜头、颈部后转、背视图露正脸或侧脸、T-pose/A-pose、塑料质感、湿身、道具入镜。`;

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'character-three-view-16-9',
    title: '电影级角色三视图 · 16:9',
    category: '角色',
    description: '左侧正面大头特写 + 右侧正背三视图，纯灰背景、真实戏服、锁同一演员。',
    tags: ['三视图', '角色定妆', '16:9'],
    body: THREE_VIEW_16_9,
    coverUrl: threeViewCover(false),
  },
  {
    id: 'character-three-view-21-9',
    title: '电影级角色三视图 · 21:9',
    category: '角色',
    description: '宽银幕 21:9 定妆版，适合电影感角色设定与跨集一致性参考。',
    tags: ['三视图', '角色定妆', '21:9'],
    body: THREE_VIEW_21_9,
    coverUrl: threeViewCover(true),
  },
];

export const PROMPT_CATEGORIES = ['全部', '角色', '场景', '道具'] as const;
