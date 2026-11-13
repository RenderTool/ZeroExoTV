/**
 * style-presets — 全剧风格预设（MCP 侧只读数据，来源同前端 src/shared/style-presets.ts）
 * 来源：https://www.uisdc.com/ai-cinema-prompts（23 套：9 导演 / 6 主流 / 8 动画）
 * 全剧只选一套；主体提示词拼 promptZh（去掉 [主体], 前缀）。
 */

export type StyleCategory = 'director' | 'mainstream' | 'animation';

export interface StylePreset {
  id: string;
  nameZh: string;
  nameEn: string;
  category: StyleCategory;
  promptZh: string;
  promptEn: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "wes-anderson",
    nameZh: "韦斯·安德森",
    nameEn: "Wes Anderson",
    category: "director",
    promptZh: "[主体], 韦斯·安德森电影风格, 完美对称构图, 中心取景, 糖果色配色(粉色、黄色、薄荷绿), 精致场景设计, 平铺美学, 复古道具, 奇想氛围, 古怪角色造型, 布达佩斯大饭店风格, 极致精准分镜",
    promptEn: "[subject], Wes Anderson cinematography, perfectly symmetrical composition, centered framing, pastel candy color palette (pink, yellow, mint green), meticulous production design, flat lay aesthetic, retro vintage props, whimsical atmosphere, quirky character styling, The Grand Budapest Hotel inspired, ultra-precise staging",
  },
  {
    id: "wong-kar-wai",
    nameZh: "王家卫",
    nameEn: "Wong Kar-wai",
    category: "director",
    promptZh: "[主体], 王家卫电影风格, 高饱和度情绪化色彩(深红色、翡翠绿、电蓝色), 慢镜头效果, 手持摄影美学, 都市疏离氛围, 运动模糊, 香港霓虹招牌, 怀旧浪漫情绪, 花样年华风格, 梦幻焦外, 香烟氛围",
    promptEn: "[subject], Wong Kar-wai cinematography, highly saturated emotional color grading (deep red, emerald green, electric blue), slow motion effect, handheld camera aesthetic, urban isolation atmosphere, motion blur, Hong Kong neon signs, nostalgic romantic mood, In the Mood for Love inspired, dreamy bokeh, cigarette smoke atmosphere\n\n中文提示词模板：",
  },
  {
    id: "zhang-yimou",
    nameZh: "张艺谋",
    nameEn: "Zhang Yimou",
    category: "director",
    promptZh: "[主体], 张艺谋电影风格, 大胆单色配色方案(主导红色、黑色或白色), 中国文化象征, 史诗级宏大场面, 强烈视觉冲击, 中国传统建筑, 水墨画美学, 戏剧性构图, 英雄或大红灯笼风格, 武侠优雅",
    promptEn: "[subject], Zhang Yimou cinematography, bold monochromatic color scheme (dominant red, black, or white), Chinese cultural symbolism, epic historical scale, strong visual impact, traditional Chinese architecture, ink wash painting aesthetic, dramatic composition, Hero or Raise the Red Lantern inspired, martial arts elegance\n\n中文提示词模板：",
  },
  {
    id: "christopher-nolan",
    nameZh: "克里斯托弗·诺兰",
    nameEn: "Christopher Nolan",
    category: "director",
    promptZh: "[主体], 克里斯托弗·诺兰电影风格, 冷色调低饱和度配色(钢蓝色、灰色), 史诗级建筑尺度, IMAX宽幅格式, 实拍特效美学, 现实主义科幻视觉, 时间操纵或碎片叙事视觉, 戏剧性明暗对照光照, 盗梦空间或星际穿越风格, 理性氛围",
    promptEn: "[subject], Christopher Nolan cinematography, cool desaturated color palette (steel blue, grey), epic architectural scale, IMAX wide format, practical effects aesthetic, realistic sci-fi visual, time manipulation or fragmented narrative visual, dramatic chiaroscuro lighting, Inception or Interstellar inspired, cerebral atmosphere\n\n中文提示词模板：",
  },
  {
    id: "quentin-tarantino",
    nameZh: "昆汀·塔伦蒂诺",
    nameEn: "Quentin Tarantino",
    category: "director",
    promptZh: "[主体], 昆汀·塔伦蒂诺电影风格, 暴力美学, 鲜艳饱和复古色彩(黄色、橙色、红色), 戏剧性低角度或仰角, 风格化动作编排, 1970年代B级片美学, 极端特写, 后备箱视角, 低俗小说或杀死比尔风格, 戏剧性血液效果",
    promptEn: "[subject], Quentin Tarantino cinematography, violence aesthetics, vivid saturated retro color palette (yellow, orange, red), dramatic low or high angles, stylized action choreography, 1970s grindhouse aesthetic, extreme close-ups, trunk shot perspective, Pulp Fiction or Kill Bill inspired, theatrical blood effects\n\n中文提示词模板：",
  },
  {
    id: "ridley-scott",
    nameZh: "雷德利·斯科特",
    nameEn: "Ridley Scott",
    category: "director",
    promptZh: "[主体], 雷德利·斯科特电影风格, 史诗级宽幕构图, 工业设计美学, 大气体积光照, 戏剧性丁达尔光效果, 高度精细场景设计, 低饱和度大地色调, 烟雾大气效果, 银翼杀手或角斗士风格, 电影宏大感, 粗粝现实主义",
    promptEn: "[subject], Ridley Scott cinematography, epic widescreen composition, industrial design aesthetic, atmospheric volumetric lighting, dramatic god rays or light shafts, highly detailed production design, desaturated earth tone palette, smoke and fog atmospheric effects, Blade Runner or Gladiator inspired, cinematic grandeur, gritty realism\n\n中文提示词模板：",
  },
  {
    id: "akira-kurosawa",
    nameZh: "黑泽明",
    nameEn: "Akira Kurosawa",
    category: "director",
    promptZh: "[主体], 黑泽明电影风格, 动态对称构图, 武士战士美学, 戏剧性天气元素(雨、风、雾), 黑白或低饱和度色彩, 日本古典建筑, 史诗级动作编排, 七武士或罗生门风格, 人文主义叙事, 自然作为叙事元素",
    promptEn: "[subject], Akira Kurosawa cinematography, dynamic symmetrical composition, samurai warrior aesthetic, dramatic weather elements (rain, wind, fog), black and white or desaturated color palette, Japanese classical architecture, epic movement choreography, Seven Samurai or Rashomon inspired, humanistic storytelling, nature as narrative element",
  },
  {
    id: "tim-burton",
    nameZh: "蒂姆·波顿",
    nameEn: "Tim Burton",
    category: "director",
    promptZh: "[主体], 蒂姆·波顿电影风格, 哥特美学, 黑暗奇幻氛围, 夸张角色设计(大眼睛细肢体), 定格动画手工质感, 黑白螺旋图案, 扰曲超现实建筑, 奇异阴森情绪, 剪刀手爱德华或圣诞夜惊魂风格, 德国表现主义光照",
    promptEn: "[subject], Tim Burton cinematography, gothic aesthetic, dark fantasy atmosphere, exaggerated character design with large eyes and thin limbs, stop-motion handcrafted texture, black and white spiral patterns, twisted surreal architecture, whimsical macabre mood, Edward Scissorhands or Nightmare Before Christmas inspired, German expressionism lighting",
  },
  {
    id: "ang-lee",
    nameZh: "李安",
    nameEn: "Ang Lee",
    category: "director",
    promptZh: "[主体], 李安电影风格, 东西方美学融合, 诗意自然光照, 细腻情感表达, 克制优雅构图, 文化象征与反思, 沉思内省情绪, 卧虎藏龙或断背山风格, 柔和色彩, 技术摄影创新",
    promptEn: "[subject], Ang Lee cinematography, East-meets-West aesthetic fusion, poetic natural lighting, emotionally subtle expression, restrained elegant composition, cultural symbolism and reflection, contemplative introspective mood, Crouching Tiger Hidden Dragon or Brokeback Mountain inspired, soft color palette, technical cinematographic innovation",
  },
  {
    id: "film-noir",
    nameZh: "黑色电影",
    nameEn: "Film Noir",
    category: "mainstream",
    promptZh: "[主体], 黑色电影风格, 高对比度黑白摄影, 低调照明, 戏剧性阴影, 都市夜景, 百叶窗光影效果, 明暗对照法, 1940年代犯罪剧美学, 阴郁氛围, 硬汉侦探场景",
    promptEn: "[subject], film noir style, high contrast black and white photography, low-key lighting, dramatic shadows, urban nightscape, venetian blind light patterns, chiaroscuro effect, 1940s crime drama aesthetic, moody atmosphere, hardboiled detective scene",
  },
  {
    id: "french-new-wave",
    nameZh: "法国新浪潮",
    nameEn: "French New Wave",
    category: "mainstream",
    promptZh: "[主体], 法国新浪潮电影风格, 手持摄影美学, 自然光照明, 街头抓拍摄影风格, 实景拍摄, 1960年代巴黎氛围, 存在主义情绪, 电影现实主义, 作者论视觉语言, 自发式构图",
    promptEn: "[subject], French New Wave cinematography, handheld camera aesthetic, natural lighting, candid street photography style, on-location shooting, 1960s Parisian atmosphere, existential mood, cinematic realism, auteur theory visual language, spontaneous composition",
  },
  {
    id: "cyberpunk",
    nameZh: "赛博朋克",
    nameEn: "Cyberpunk",
    category: "mainstream",
    promptZh: "[主体], 赛博朋克美学, 霓虹浸染的城市景观, 未来都市夜景, 高科技低生活氛围, 鲜艳霓虹色彩(青色、洋红、紫色), 雨湿街道, 全息广告, 都市衰败感, 银翼杀手风格, 科技反乌托邦, 情绪化电影光影",
    promptEn: "[subject], cyberpunkaesthetic, neon-drenchedcityscape, futuristicmetropolisnightscene, high-techlow-lifeatmosphere, vibrantneoncolors (cyan, magenta, purple), rain-soakedstreets, holographicadvertisements, urbandecay, BladeRunnerinspired, technologicaldystopia, moodycinematic lighting",
  },
  {
    id: "epic-fantasy",
    nameZh: "史诗奇幻",
    nameEn: "Epic Fantasy",
    category: "mainstream",
    promptZh: "[主体], 史诗奇幻电影风格, 魔幻现实主义, 空灵光照, 神秘氛围, 魔法森林或城堡场景, 神话元素, 中世纪建筑, 梦幻质感, 超凡色彩, 电影宏大感, 戏剧性天空, 指环王风格",
    promptEn: "[subject], epic fantasy cinematography, magical realism style, ethereal lighting, mystical atmosphere, enchanted forest or castle setting, mythical elements, medieval architecture, dreamlike quality, otherworldly color palette, cinematic grandeur, dramatic sky, Lord of the Rings inspired",
  },
  {
    id: "modern-urban",
    nameZh: "现代都市",
    nameEn: "Modern Urban",
    category: "mainstream",
    promptZh: "[主体], 现代都市电影风格, 当代城市景观, 自然光照明, 建筑摄影风格, 城市几何美学, 大都会氛围, 街头生活美学, 现代建筑, 城市灯光, 黄金时段或蓝调时段光照, 都市现实主义, 日常生活瞬间",
    promptEn: "[subject], modern urban cinematography, contemporary cityscape, natural lighting, architectural photography style, urban geometry, metropolitan atmosphere, street life aesthetic, modern architecture, city lights, golden hour or blue hour lighting, urban realism, everyday life moments",
  },
  {
    id: "western",
    nameZh: "西部片",
    nameEn: "Western",
    category: "mainstream",
    promptZh: "[主体], 经典西部片电影风格, 荒漠景观, 黄金时段光照, 尘土飞扬氛围, 拓荒美学, 辽阔平原, 崎岖地形, 暖色调(橙色、棕色、棕褐色), 强烈阳光, 宽幅电影视野, 牛仔电影风格, 塞尔吉奥·莱昂内风格",
    promptEn: "[subject], classic western cinematography, desert landscape, golden hour lighting, dusty atmosphere, frontier aesthetic, vast open plains, rugged terrain, warm color grading (orange, brown, sepia), harsh sunlight, wide cinematic scope, cowboy movie style, Sergio Leone inspired",
  },
  {
    id: "chinese-ink-wash-animation",
    nameZh: "中国水墨动画",
    nameEn: "Chinese Ink Wash Animation",
    category: "animation",
    promptZh: "[主体], 中国水墨动画风格, 传统水墨画美学, 单色墨色渐变, 边缘晕染的柔和笔触, 诗意散点透视, 流动水效果, 精致竹子山水细节, 空灵的朦胧氛围, 上海美术电影制片厂风格, 书法线条",
    promptEn: "[subject], Chinese ink wash animation style, traditional sumi-e painting aesthetic, monochromatic black ink gradients, soft brush strokes with bleeding edges, poetic atmospheric perspective, flowing water effects, delicate bamboo and landscape details, ethereal misty atmosphere, Shanghai Animation Film Studio inspired, calligraphic line work",
  },
  {
    id: "classic-disney-animation",
    nameZh: "迪士尼经典风格",
    nameEn: "Classic Disney Animation",
    category: "animation",
    promptZh: "[主体], 迪士尼经典动画风格, 鲜艳饱和色彩, 粗线条清晰轮廓, 大眼睛表现力角色设计, 柔和渐变阴影, 童话魔幻氛围, 戏剧性情绪表达, 公主或拟人化动物设计, 白雪公主或狮子王风格, 手绘2D美学",
    promptEn: "[subject], classic Disney animation style, vibrant saturated color palette, bold clean outlines, expressive character design with large eyes, soft gradient shadows, fairy tale magical atmosphere, theatrical emotional expressions, princess or anthropomorphic animal design, Snow White or Lion King inspired, hand-drawn 2D aesthetic",
  },
  {
    id: "studio-ghibli",
    nameZh: "吉卜力工作室",
    nameEn: "Studio Ghibli",
    category: "animation",
    promptZh: "[主体], 吉卜力工作室动画风格, 柔和马卡龙色调(绿色、蓝色、金色), 手绘水彩美学, 高度精细的自然环境, 蓬松的积云, 柔和漫射光照, 郁郁葱葱的景观, 奇幻梦境氛围, 千与千寻或龙猫风格, 怀旧情感情绪, 细腻线条",
    promptEn: "[subject], Studio Ghibli animation style, soft pastel color palette (green, blue, gold), hand-drawn watercolor aesthetic, highly detailed natural environments, fluffy cumulus clouds, gentle diffused lighting, lush landscapes, whimsical dreamy atmosphere, Spirited Away or My Neighbor Totoro inspired, nostalgic emotional mood, fine linework",
  },
  {
    id: "pixar-3d-animation",
    nameZh: "皮克斯3D动画",
    nameEn: "Pixar 3D Animation",
    category: "animation",
    promptZh: "[主体], 皮克斯3D动画风格, 真实的物理渲染, 光滑风格化质感, 圆润可爱的角色比例, 鲜艳饱和色彩, 电影级光照和构图, 柔和环境光遮蔽, 高质量着色, 玩具总动员或寻梦环游记风格, 情感化叙事美学, 专业级CG质量",
    promptEn: "[subject], Pixar 3D animation style, realistic physically-based rendering, smooth stylized textures, rounded cute character proportions, vibrant saturated color palette, cinematic lighting and composition, soft ambient occlusion, high-quality shading, Toy Story or Coco inspired, emotional storytelling aesthetic, professional CG quality",
  },
  {
    id: "dreamworks-stylized",
    nameZh: "梦工厂风格化",
    nameEn: "DreamWorks Stylized",
    category: "animation",
    promptZh: "[主体], 梦工厂风格化动画, 图形化边缘光效果, 水彩绘画质感, 大胆饱和色彩, 赛璐璐着色元素, 2D风格的3D渲染, 动态构图, 穿靴子的猫2或功夫熊猫风格, 表现力角色动画, 艺术化边缘处理",
    promptEn: "[subject], DreamWorks stylized animation, graphic rim lighting effects, watercolor painterly textures, bold saturated color palette, cel-shading elements, 2D-inspired 3D rendering, dynamic composition, Puss in Boots The Last Wish or Kung Fu Panda inspired, expressive character animation, artistic edge treatment",
  },
  {
    id: "anime-style",
    nameZh: "日本动漫",
    nameEn: "Anime Style",
    category: "animation",
    promptZh: "[主体], 日本动漫风格, 清晰精准线条, 大眼睛带高光, 戏剧性高对比光照, 赛璐璐平涂色彩, 鲜艳饱和配色, 锐利清晰阴影, 动态动作姿势, 速度线和运动效果, 情绪化面部表达, 漫画风格构图",
    promptEn: "[subject], Japanese anime style, clean precise line art, large expressive eyes with highlights, dramatic high-contrast lighting, cel-shaded flat colors, vibrant saturated palette, sharp defined shadows, dynamic action poses, speed lines and motion effects, emotional facial expressions, manga-inspired composition",
  },
  {
    id: "stop-motion",
    nameZh: "定格动画",
    nameEn: "Stop Motion",
    category: "animation",
    promptZh: "[主体], 定格动画风格, 手工物理质感, 黏土或木偶美学, 真实材质质感(布料、黏土、木头), 实物微缩场景设计, 自然物理光照, 不完美的手工细节, 逐帧动画魅力, 莱卡工作室或阿德曼风格, 触感真实表面",
    promptEn: "[subject], stop motion animation style, handcrafted physical textures, claymation or puppet aesthetic, tangible material quality (fabric, clay, wood), practical miniature set design, natural physical lighting, imperfect artisanal details, frame-by-frame animation charm, Laika Studios or Aardman inspired, tactile realistic surfaces",
  },
  {
    id: "chinese-theatrical-animation",
    nameZh: "中国剧场动画",
    nameEn: "Chinese Theatrical Animation",
    category: "animation",
    promptZh: "[主体], 现代中国剧场动画风格, 中国神话元素, 动态流动能量特效, 浓郁饱和色彩, 传统文化象征, 现代CG渲染, 史诗级场面构图, 风格化角色设计, 哪吒或姜子牙风格, 武侠动作编排, 仙侠氛围",
    promptEn: "[subject], modern Chinese theatrical animation style, Chinese mythological elements, dynamic flowing energy effects, rich saturated color palette, traditional cultural symbolism, modern CG rendering, epic scale composition, stylized character design, Nezha or Jiang Ziya inspired, martial arts action choreography, spiritual atmosphere",
  },
];

export function stylePresetById(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((s) => s.id === id);
}

export function stylePresetPrompt(preset: StylePreset): string {
  return preset.promptZh.replace(/^\[主体\]\s*[,，]\s*/, '').trim();
}
