/**
 * style-presets — 全剧风格预设（2026-11-13 用户指令：把 uisdc 23 套电影美学提示词 + 配图做成可视化面板）
 *
 * 数据来源：https://www.uisdc.com/ai-cinema-prompts（23 套：9 导演 / 6 主流 / 8 动画）
 * 缩略图：public/style-presets/<id>.webp（文章每套的第一张示例图，仅作风格预览）
 * 用法：全剧只选一套；主体提示词拼这套的 promptZh（去掉 [主体], 前缀），不再每个主体各写风格。
 */

export type StylePresetCategory = 'director' | 'mainstream' | 'animation' | 'genre';

export interface StylePreset {
  id: string;
  name: string;
  nameZh: string;
  nameEn: string;
  category: StylePresetCategory;
  intro: string;
  /** 中文提示词模板（含 [主体] 占位） */
  promptZh: string;
  /** 英文提示词模板（含 [subject] 占位） */
  promptEn: string;
  /** public 下的缩略图文件名（题材风格没有示例图时为空，画廊用渐变卡） */
  image?: string;
  /** 无示例图时的渐变配色 */
  palette?: [string, string];
}

export const STYLE_CATEGORY_LABELS: Record<'all' | StylePresetCategory, string> = {
  all: '全部',
  director: '导演',
  mainstream: '主流',
  animation: '动画',
  genre: '题材',
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "wes-anderson",
    name: "韦斯·安德森 (Wes Anderson)",
    nameZh: "韦斯·安德森",
    nameEn: "Wes Anderson",
    category: "director",
    intro: "美国导演，以极致对称构图、糖果色配色和强迫症式精细布景闻名。代表作：《布达佩斯大饭店》、《月升王国》。",
    promptZh: "[主体], 韦斯·安德森电影风格, 完美对称构图, 中心取景, 糖果色配色(粉色、黄色、薄荷绿), 精致场景设计, 平铺美学, 复古道具, 奇想氛围, 古怪角色造型, 布达佩斯大饭店风格, 极致精准分镜",
    promptEn: "[subject], Wes Anderson cinematography, perfectly symmetrical composition, centered framing, pastel candy color palette (pink, yellow, mint green), meticulous production design, flat lay aesthetic, retro vintage props, whimsical atmosphere, quirky character styling, The Grand Budapest Hotel inspired, ultra-precise staging",
    image: "style-presets/wes-anderson.webp",
  },
  {
    id: "wong-kar-wai",
    name: "王家卫 (Wong Kar-wai)",
    nameZh: "王家卫",
    nameEn: "Wong Kar-wai",
    category: "director",
    intro: "香港导演，以高饱和度情绪化色彩、慢镜头运用和都市疏离感著称。代表作：《花样年华》、《重庆森林》。",
    promptZh: "[主体], 王家卫电影风格, 高饱和度情绪化色彩(深红色、翡翠绿、电蓝色), 慢镜头效果, 手持摄影美学, 都市疏离氛围, 运动模糊, 香港霓虹招牌, 怀旧浪漫情绪, 花样年华风格, 梦幻焦外, 香烟氛围",
    promptEn: "[subject], Wong Kar-wai cinematography, highly saturated emotional color grading (deep red, emerald green, electric blue), slow motion effect, handheld camera aesthetic, urban isolation atmosphere, motion blur, Hong Kong neon signs, nostalgic romantic mood, In the Mood for Love inspired, dreamy bokeh, cigarette smoke atmosphere\n\n中文提示词模板：",
    image: "style-presets/wong-kar-wai.webp",
  },
  {
    id: "zhang-yimou",
    name: "张艺谋 (Zhang Yimou)",
    nameZh: "张艺谋",
    nameEn: "Zhang Yimou",
    category: "director",
    intro: "中国导演，以高纯度单色美学、中国文化符号和强烈视觉冲击力闻名。代表作：《英雄》、《大红灯笼高高挂》。",
    promptZh: "[主体], 张艺谋电影风格, 大胆单色配色方案(主导红色、黑色或白色), 中国文化象征, 史诗级宏大场面, 强烈视觉冲击, 中国传统建筑, 水墨画美学, 戏剧性构图, 英雄或大红灯笼风格, 武侠优雅",
    promptEn: "[subject], Zhang Yimou cinematography, bold monochromatic color scheme (dominant red, black, or white), Chinese cultural symbolism, epic historical scale, strong visual impact, traditional Chinese architecture, ink wash painting aesthetic, dramatic composition, Hero or Raise the Red Lantern inspired, martial arts elegance\n\n中文提示词模板：",
    image: "style-presets/zhang-yimou.webp",
  },
  {
    id: "christopher-nolan",
    name: "克里斯托弗·诺兰 (Christopher Nolan)",
    nameZh: "克里斯托弗·诺兰",
    nameEn: "Christopher Nolan",
    category: "director",
    intro: "英国导演，以冷峻现实主义色调、宏大科幻场景和非线性叙事视觉化著称。代表作：《盗梦空间》、《星际穿越》。",
    promptZh: "[主体], 克里斯托弗·诺兰电影风格, 冷色调低饱和度配色(钢蓝色、灰色), 史诗级建筑尺度, IMAX宽幅格式, 实拍特效美学, 现实主义科幻视觉, 时间操纵或碎片叙事视觉, 戏剧性明暗对照光照, 盗梦空间或星际穿越风格, 理性氛围",
    promptEn: "[subject], Christopher Nolan cinematography, cool desaturated color palette (steel blue, grey), epic architectural scale, IMAX wide format, practical effects aesthetic, realistic sci-fi visual, time manipulation or fragmented narrative visual, dramatic chiaroscuro lighting, Inception or Interstellar inspired, cerebral atmosphere\n\n中文提示词模板：",
    image: "style-presets/christopher-nolan.webp",
  },
  {
    id: "quentin-tarantino",
    name: "昆汀·塔伦蒂诺 (Quentin Tarantino)",
    nameZh: "昆汀·塔伦蒂诺",
    nameEn: "Quentin Tarantino",
    category: "director",
    intro: "美国导演，以暴力美学、华丽复古色调和戏剧性场景调度闻名。代表作：《低俗小说》、《杀死比尔》。",
    promptZh: "[主体], 昆汀·塔伦蒂诺电影风格, 暴力美学, 鲜艳饱和复古色彩(黄色、橙色、红色), 戏剧性低角度或仰角, 风格化动作编排, 1970年代B级片美学, 极端特写, 后备箱视角, 低俗小说或杀死比尔风格, 戏剧性血液效果",
    promptEn: "[subject], Quentin Tarantino cinematography, violence aesthetics, vivid saturated retro color palette (yellow, orange, red), dramatic low or high angles, stylized action choreography, 1970s grindhouse aesthetic, extreme close-ups, trunk shot perspective, Pulp Fiction or Kill Bill inspired, theatrical blood effects\n\n中文提示词模板：",
    image: "style-presets/quentin-tarantino.webp",
  },
  {
    id: "ridley-scott",
    name: "雷德利·斯科特 (Ridley Scott)",
    nameZh: "雷德利·斯科特",
    nameEn: "Ridley Scott",
    category: "director",
    intro: "英国导演，以史诗感构图、工业设计美学和强烈光影对比著称。代表作：《银翼杀手》、《角斗士》。",
    promptZh: "[主体], 雷德利·斯科特电影风格, 史诗级宽幕构图, 工业设计美学, 大气体积光照, 戏剧性丁达尔光效果, 高度精细场景设计, 低饱和度大地色调, 烟雾大气效果, 银翼杀手或角斗士风格, 电影宏大感, 粗粝现实主义",
    promptEn: "[subject], Ridley Scott cinematography, epic widescreen composition, industrial design aesthetic, atmospheric volumetric lighting, dramatic god rays or light shafts, highly detailed production design, desaturated earth tone palette, smoke and fog atmospheric effects, Blade Runner or Gladiator inspired, cinematic grandeur, gritty realism\n\n中文提示词模板：",
    image: "style-presets/ridley-scott.webp",
  },
  {
    id: "akira-kurosawa",
    name: "黑泽明 (Akira Kurosawa)",
    nameZh: "黑泽明",
    nameEn: "Akira Kurosawa",
    category: "director",
    intro: "日本导演，以简练对称构图、武士美学和自然元素叙事闻名。代表作：《七武士》、《罗生门》。",
    promptZh: "[主体], 黑泽明电影风格, 动态对称构图, 武士战士美学, 戏剧性天气元素(雨、风、雾), 黑白或低饱和度色彩, 日本古典建筑, 史诗级动作编排, 七武士或罗生门风格, 人文主义叙事, 自然作为叙事元素",
    promptEn: "[subject], Akira Kurosawa cinematography, dynamic symmetrical composition, samurai warrior aesthetic, dramatic weather elements (rain, wind, fog), black and white or desaturated color palette, Japanese classical architecture, epic movement choreography, Seven Samurai or Rashomon inspired, humanistic storytelling, nature as narrative element",
    image: "style-presets/akira-kurosawa.webp",
  },
  {
    id: "tim-burton",
    name: "蒂姆·波顿 (Tim Burton)",
    nameZh: "蒂姆·波顿",
    nameEn: "Tim Burton",
    category: "director",
    intro: "美国导演，以哥特风格、暗黑童话和夸张造型著称。代表作：《爱丽丝梦游仙境》、《剪刀手爱德华》。",
    promptZh: "[主体], 蒂姆·波顿电影风格, 哥特美学, 黑暗奇幻氛围, 夸张角色设计(大眼睛细肢体), 定格动画手工质感, 黑白螺旋图案, 扰曲超现实建筑, 奇异阴森情绪, 剪刀手爱德华或圣诞夜惊魂风格, 德国表现主义光照",
    promptEn: "[subject], Tim Burton cinematography, gothic aesthetic, dark fantasy atmosphere, exaggerated character design with large eyes and thin limbs, stop-motion handcrafted texture, black and white spiral patterns, twisted surreal architecture, whimsical macabre mood, Edward Scissorhands or Nightmare Before Christmas inspired, German expressionism lighting",
    image: "style-presets/tim-burton.webp",
  },
  {
    id: "ang-lee",
    name: "李安 (Ang Lee)",
    nameZh: "李安",
    nameEn: "Ang Lee",
    category: "director",
    intro: "华裔导演，以东西方美学融合、细腻情感表达和技术创新闻名。代表作：《卧虎藏龙》、《断背山》。",
    promptZh: "[主体], 李安电影风格, 东西方美学融合, 诗意自然光照, 细腻情感表达, 克制优雅构图, 文化象征与反思, 沉思内省情绪, 卧虎藏龙或断背山风格, 柔和色彩, 技术摄影创新",
    promptEn: "[subject], Ang Lee cinematography, East-meets-West aesthetic fusion, poetic natural lighting, emotionally subtle expression, restrained elegant composition, cultural symbolism and reflection, contemplative introspective mood, Crouching Tiger Hidden Dragon or Brokeback Mountain inspired, soft color palette, technical cinematographic innovation",
    image: "style-presets/ang-lee.webp",
  },
  {
    id: "film-noir",
    name: "黑色电影 (Film Noir)",
    nameZh: "黑色电影",
    nameEn: "Film Noir",
    category: "mainstream",
    intro: "源于20世纪40-50年代好莱坞的经典风格，以高对比度的黑白影像、阴暗压抑的氛围和城市夜景著称。适合犯罪、侦探、悬疑题材。",
    promptZh: "[主体], 黑色电影风格, 高对比度黑白摄影, 低调照明, 戏剧性阴影, 都市夜景, 百叶窗光影效果, 明暗对照法, 1940年代犯罪剧美学, 阴郁氛围, 硬汉侦探场景",
    promptEn: "[subject], film noir style, high contrast black and white photography, low-key lighting, dramatic shadows, urban nightscape, venetian blind light patterns, chiaroscuro effect, 1940s crime drama aesthetic, moody atmosphere, hardboiled detective scene",
    image: "style-presets/film-noir.webp",
  },
  {
    id: "french-new-wave",
    name: "法国新浪潮 (French New Wave)",
    nameZh: "法国新浪潮",
    nameEn: "French New Wave",
    category: "mainstream",
    intro: "20世纪60年代法国电影运动的代表风格，以手持摄影、自然光、跳切剪辑和真实街景为特色。适合文艺、叙事、城市生活题材。",
    promptZh: "[主体], 法国新浪潮电影风格, 手持摄影美学, 自然光照明, 街头抓拍摄影风格, 实景拍摄, 1960年代巴黎氛围, 存在主义情绪, 电影现实主义, 作者论视觉语言, 自发式构图",
    promptEn: "[subject], French New Wave cinematography, handheld camera aesthetic, natural lighting, candid street photography style, on-location shooting, 1960s Parisian atmosphere, existential mood, cinematic realism, auteur theory visual language, spontaneous composition",
    image: "style-presets/french-new-wave.webp",
  },
  {
    id: "cyberpunk",
    name: "赛博朋克 (Cyberpunk)",
    nameZh: "赛博朋克",
    nameEn: "Cyberpunk",
    category: "mainstream",
    intro: "未来主义科幻美学的代表，以霓虹色调、雨夜都市、高科技低生活的视觉矛盾为核心。适合科幻、未来都市、赛博题材。",
    promptZh: "[主体], 赛博朋克美学, 霓虹浸染的城市景观, 未来都市夜景, 高科技低生活氛围, 鲜艳霓虹色彩(青色、洋红、紫色), 雨湿街道, 全息广告, 都市衰败感, 银翼杀手风格, 科技反乌托邦, 情绪化电影光影",
    promptEn: "[subject], cyberpunkaesthetic, neon-drenchedcityscape, futuristicmetropolisnightscene, high-techlow-lifeatmosphere, vibrantneoncolors (cyan, magenta, purple), rain-soakedstreets, holographicadvertisements, urbandecay, BladeRunnerinspired, technologicaldystopia, moodycinematic lighting",
    image: "style-presets/cyberpunk.webp",
  },
  {
    id: "epic-fantasy",
    name: "史诗奇幻 (Epic Fantasy)",
    nameZh: "史诗奇幻",
    nameEn: "Epic Fantasy",
    category: "mainstream",
    intro: "魔幻题材的视觉呈现，以宏大场景、饱和色彩、戏剧性光影和神话元素为特征。适合奇幻、魔法、神话题材。",
    promptZh: "[主体], 史诗奇幻电影风格, 魔幻现实主义, 空灵光照, 神秘氛围, 魔法森林或城堡场景, 神话元素, 中世纪建筑, 梦幻质感, 超凡色彩, 电影宏大感, 戏剧性天空, 指环王风格",
    promptEn: "[subject], epic fantasy cinematography, magical realism style, ethereal lighting, mystical atmosphere, enchanted forest or castle setting, mythical elements, medieval architecture, dreamlike quality, otherworldly color palette, cinematic grandeur, dramatic sky, Lord of the Rings inspired",
    image: "style-presets/epic-fantasy.webp",
  },
  {
    id: "modern-urban",
    name: "现代都市 (Modern Urban)",
    nameZh: "现代都市",
    nameEn: "Modern Urban",
    category: "mainstream",
    intro: "聚焦当代城市生活的真实美学，以自然光、城市几何、现代建筑和生活质感为特点。适合都市、现代生活、写实题材。",
    promptZh: "[主体], 现代都市电影风格, 当代城市景观, 自然光照明, 建筑摄影风格, 城市几何美学, 大都会氛围, 街头生活美学, 现代建筑, 城市灯光, 黄金时段或蓝调时段光照, 都市现实主义, 日常生活瞬间",
    promptEn: "[subject], modern urban cinematography, contemporary cityscape, natural lighting, architectural photography style, urban geometry, metropolitan atmosphere, street life aesthetic, modern architecture, city lights, golden hour or blue hour lighting, urban realism, everyday life moments",
    image: "style-presets/modern-urban.webp",
  },
  {
    id: "western",
    name: "西部片 (Western)",
    nameZh: "西部片",
    nameEn: "Western",
    category: "mainstream",
    intro: "美国西部拓荒时代的经典视觉风格,以广阔荒漠、暖色调、强烈阳光和粗粝质感为标志。适合西部、历史、冒险题材。",
    promptZh: "[主体], 经典西部片电影风格, 荒漠景观, 黄金时段光照, 尘土飞扬氛围, 拓荒美学, 辽阔平原, 崎岖地形, 暖色调(橙色、棕色、棕褐色), 强烈阳光, 宽幅电影视野, 牛仔电影风格, 塞尔吉奥·莱昂内风格",
    promptEn: "[subject], classic western cinematography, desert landscape, golden hour lighting, dusty atmosphere, frontier aesthetic, vast open plains, rugged terrain, warm color grading (orange, brown, sepia), harsh sunlight, wide cinematic scope, cowboy movie style, Sergio Leone inspired",
    image: "style-presets/western.webp",
  },
  {
    id: "chinese-ink-wash-animation",
    name: "中国水墨动画 (Chinese Ink Wash Animation)",
    nameZh: "中国水墨动画",
    nameEn: "Chinese Ink Wash Animation",
    category: "animation",
    intro: "上海美术电影制片厂开创的东方美学风格，以中国水墨画技法表现动画艺术。代表作：《小蝌蚪找妈妈》、《山水情》。",
    promptZh: "[主体], 中国水墨动画风格, 传统水墨画美学, 单色墨色渐变, 边缘晕染的柔和笔触, 诗意散点透视, 流动水效果, 精致竹子山水细节, 空灵的朦胧氛围, 上海美术电影制片厂风格, 书法线条",
    promptEn: "[subject], Chinese ink wash animation style, traditional sumi-e painting aesthetic, monochromatic black ink gradients, soft brush strokes with bleeding edges, poetic atmospheric perspective, flowing water effects, delicate bamboo and landscape details, ethereal misty atmosphere, Shanghai Animation Film Studio inspired, calligraphic line work",
    image: "style-presets/chinese-ink-wash-animation.webp",
  },
  {
    id: "classic-disney-animation",
    name: "迪士尼经典风格 (Classic Disney Animation)",
    nameZh: "迪士尼经典风格",
    nameEn: "Classic Disney Animation",
    category: "animation",
    intro: "美国迪士尼经典动画风格，以梦幻的色彩、流畅的线条和富有表现力的角色设计闻名。代表作：《白雪公主》、《狮子王》。",
    promptZh: "[主体], 迪士尼经典动画风格, 鲜艳饱和色彩, 粗线条清晰轮廓, 大眼睛表现力角色设计, 柔和渐变阴影, 童话魔幻氛围, 戏剧性情绪表达, 公主或拟人化动物设计, 白雪公主或狮子王风格, 手绘2D美学",
    promptEn: "[subject], classic Disney animation style, vibrant saturated color palette, bold clean outlines, expressive character design with large eyes, soft gradient shadows, fairy tale magical atmosphere, theatrical emotional expressions, princess or anthropomorphic animal design, Snow White or Lion King inspired, hand-drawn 2D aesthetic",
    image: "style-presets/classic-disney-animation.webp",
  },
  {
    id: "studio-ghibli",
    name: "吉卜力工作室 (Studio Ghibli)",
    nameZh: "吉卜力工作室",
    nameEn: "Studio Ghibli",
    category: "animation",
    intro: "日本吉卜力工作室的细腻手绘风格，以柔和的色调、精美的自然环境和梦幻氛围著称。代表作：宫崎骏的《千与千寻》、《龙猫》。",
    promptZh: "[主体], 吉卜力工作室动画风格, 柔和马卡龙色调(绿色、蓝色、金色), 手绘水彩美学, 高度精细的自然环境, 蓬松的积云, 柔和漫射光照, 郁郁葱葱的景观, 奇幻梦境氛围, 千与千寻或龙猫风格, 怀旧情感情绪, 细腻线条",
    promptEn: "[subject], Studio Ghibli animation style, soft pastel color palette (green, blue, gold), hand-drawn watercolor aesthetic, highly detailed natural environments, fluffy cumulus clouds, gentle diffused lighting, lush landscapes, whimsical dreamy atmosphere, Spirited Away or My Neighbor Totoro inspired, nostalgic emotional mood, fine linework",
    image: "style-presets/studio-ghibli.webp",
  },
  {
    id: "pixar-3d-animation",
    name: "皮克斯3D动画 (Pixar 3D Animation)",
    nameZh: "皮克斯3D动画",
    nameEn: "Pixar 3D Animation",
    category: "animation",
    intro: "皮克斯开创的3D动画视觉标准，以先进的渲染技术、圆润可爱的角色和情感化叙事闻名。代表作：《玩具总动员》、《寻梦环游记》。",
    promptZh: "[主体], 皮克斯3D动画风格, 真实的物理渲染, 光滑风格化质感, 圆润可爱的角色比例, 鲜艳饱和色彩, 电影级光照和构图, 柔和环境光遮蔽, 高质量着色, 玩具总动员或寻梦环游记风格, 情感化叙事美学, 专业级CG质量",
    promptEn: "[subject], Pixar 3D animation style, realistic physically-based rendering, smooth stylized textures, rounded cute character proportions, vibrant saturated color palette, cinematic lighting and composition, soft ambient occlusion, high-quality shading, Toy Story or Coco inspired, emotional storytelling aesthetic, professional CG quality",
    image: "style-presets/pixar-3d-animation.webp",
  },
  {
    id: "dreamworks-stylized",
    name: "梦工厂风格化 (DreamWorks Stylized)",
    nameZh: "梦工厂风格化",
    nameEn: "DreamWorks Stylized",
    category: "animation",
    intro: "梦工厂动画的新风格化语言，融合2D和3D的美学，以大胆的色彩和图形化表现闻名。代表作：《穿靴子的猫2》、《驯龙高手》。",
    promptZh: "[主体], 梦工厂风格化动画, 图形化边缘光效果, 水彩绘画质感, 大胆饱和色彩, 赛璐璐着色元素, 2D风格的3D渲染, 动态构图, 穿靴子的猫2或功夫熊猫风格, 表现力角色动画, 艺术化边缘处理",
    promptEn: "[subject], DreamWorks stylized animation, graphic rim lighting effects, watercolor painterly textures, bold saturated color palette, cel-shading elements, 2D-inspired 3D rendering, dynamic composition, Puss in Boots The Last Wish or Kung Fu Panda inspired, expressive character animation, artistic edge treatment",
    image: "style-presets/dreamworks-stylized.webp",
  },
  {
    id: "anime-style",
    name: "日本动漫 (Anime Style)",
    nameZh: "日本动漫",
    nameEn: "Anime Style",
    category: "animation",
    intro: "日本动漫的经典视觉风格，以清晰的线条、夸张的表情和强烈的色彩对比著称。适合各种动漫题材。",
    promptZh: "[主体], 日本动漫风格, 清晰精准线条, 大眼睛带高光, 戏剧性高对比光照, 赛璐璐平涂色彩, 鲜艳饱和配色, 锐利清晰阴影, 动态动作姿势, 速度线和运动效果, 情绪化面部表达, 漫画风格构图",
    promptEn: "[subject], Japanese anime style, clean precise line art, large expressive eyes with highlights, dramatic high-contrast lighting, cel-shaded flat colors, vibrant saturated palette, sharp defined shadows, dynamic action poses, speed lines and motion effects, emotional facial expressions, manga-inspired composition",
    image: "style-presets/anime-style.webp",
  },
  {
    id: "stop-motion",
    name: "定格动画 (Stop Motion)",
    nameZh: "定格动画",
    nameEn: "Stop Motion",
    category: "animation",
    intro: "逼真的物理材质和手工质感的定格动画风格，保留着独特的手工艺美感。代表作：莱卡工作室的《魔弦传奇》、阿德曼的《小羊肖恩》。",
    promptZh: "[主体], 定格动画风格, 手工物理质感, 黏土或木偶美学, 真实材质质感(布料、黏土、木头), 实物微缩场景设计, 自然物理光照, 不完美的手工细节, 逐帧动画魅力, 莱卡工作室或阿德曼风格, 触感真实表面",
    promptEn: "[subject], stop motion animation style, handcrafted physical textures, claymation or puppet aesthetic, tangible material quality (fabric, clay, wood), practical miniature set design, natural physical lighting, imperfect artisanal details, frame-by-frame animation charm, Laika Studios or Aardman inspired, tactile realistic surfaces",
    image: "style-presets/stop-motion.webp",
  },
  {
    id: "chinese-theatrical-animation",
    name: "中国剧场动画 (Chinese Theatrical Animation)",
    nameZh: "中国剧场动画",
    nameEn: "Chinese Theatrical Animation",
    category: "animation",
    intro: "现代中国剧场动画的视觉风格，融合中国传统元素与现代CG技术。代表作：《哪吒》、《姜子牙》。",
    promptZh: "[主体], 现代中国剧场动画风格, 中国神话元素, 动态流动能量特效, 浓郁饱和色彩, 传统文化象征, 现代CG渲染, 史诗级场面构图, 风格化角色设计, 哪吒或姜子牙风格, 武侠动作编排, 仙侠氛围",
    promptEn: "[subject], modern Chinese theatrical animation style, Chinese mythological elements, dynamic flowing energy effects, rich saturated color palette, traditional cultural symbolism, modern CG rendering, epic scale composition, stylized character design, Nezha or Jiang Ziya inspired, martial arts action choreography, spiritual atmosphere",
    image: "style-presets/chinese-theatrical-animation.webp",
  },
  {
    id: 'basic-real',
    name: '基础写实 (Basic Realism)',
    nameZh: '基础写实',
    nameEn: 'Basic Realism',
    category: 'genre',
    intro: '最通用的写实底子：自然光、真实皮肤、无滤镜，适合没有强风格要求的现代戏。',
    promptZh: '[主体], 电影级写实摄影, 自然光照明, 真实皮肤质感与毛孔, 低饱和自然色, 无滤镜, 35mm 镜头, 柔和景深, 生活化质感',
    promptEn: '[subject], cinematic realistic photography, natural lighting,真实 skin texture and pores, low-saturation natural palette, no filter, 35mm lens, soft depth of field, everyday texture',
    palette: ["#8a8f98", "#3c4148"],
  },
  {
    id: 'urban-real',
    name: '都市写实 (Urban Realism)',
    nameZh: '都市写实',
    nameEn: 'Urban Realism',
    category: 'genre',
    intro: '城市实景、玻璃与霓虹反射，适合都市生活/职场/现实题材。',
    promptZh: '[主体], 现代都市写实电影风格, 城市自然光与玻璃反射, 冷灰与暖橙对比, 真实皮肤, 生活化街景, 35mm 手持感',
    promptEn: '[subject], modern urban realistic cinematography, city natural light and glass reflections, cool gray and warm amber contrast, realistic skin, everyday street, 35mm handheld',
    palette: ["#5b6b7a", "#d08a4a"],
  },
  {
    id: 'urban-romance',
    name: '都市言情 (Urban Romance)',
    nameZh: '都市言情',
    nameEn: 'Urban Romance',
    category: 'genre',
    intro: '干净明亮的都市偶像剧质感，柔光、浅景深、精致妆发。',
    promptZh: '[主体], 都市偶像剧风格, 干净明亮, 柔光美颜, 低对比, 浅景深, 现代公寓与写字楼, 精致妆发',
    promptEn: '[subject], urban romance drama style, clean and bright, soft beauty lighting, low contrast, shallow depth of field, modern apartment and office, polished hair and makeup',
    palette: ["#f2c9c0", "#b8877a"],
  },
  {
    id: 'costume-xianxia',
    name: '古装仙侠 (Costume Xianxia)',
    nameZh: '古装仙侠',
    nameEn: 'Costume Xianxia',
    category: 'genre',
    intro: '冷月、云雾、青蓝月白，飘逸纱衣与水墨留白。',
    promptZh: '[主体], 古装仙侠电影风格, 冷月与云雾, 青蓝月白, 飘逸纱衣, 水墨留白, 仙气体积光',
    promptEn: '[subject], Chinese xianxia costume style, cold moon and mist, cyan and moon white, flowing gauze, ink-wash negative space, ethereal volumetric light',
    palette: ["#5c7f8a", "#d8e2e6"],
  },
  {
    id: 'republican',
    name: '民国年代 (Republican Era)',
    nameZh: '民国年代',
    nameEn: 'Republican Era',
    category: 'genre',
    intro: '暖黄低饱和、旗袍中山装、老上海街景与胶片颗粒。',
    promptZh: '[主体], 民国年代剧风格, 暖黄低饱和, 旗袍与中山装, 老上海街景, 胶片颗粒, 柔和窗光',
    promptEn: '[subject], Republican-era Chinese drama style, warm yellow low saturation, qipao and Zhongshan suit, old Shanghai street, film grain, soft window light',
    palette: ["#a8753e", "#6e4a2a"],
  },
  {
    id: 'campus',
    name: '青春校园 (Campus Youth)',
    nameZh: '青春校园',
    nameEn: 'Campus Youth',
    category: 'genre',
    intro: '明亮自然光、清新低饱和、校服教室操场，日系空气感。',
    promptZh: '[主体], 青春校园剧风格, 明亮自然光, 清新低饱和, 校服教室操场, 日系空气感, 轻微过曝',
    promptEn: '[subject], campus youth drama style, bright natural light, fresh low saturation, school uniform classroom and playground, Japanese airy feel, slight overexposure',
    palette: ["#a8c8b8", "#f0e7c8"],
  },
  {
    id: 'sweet-romance',
    name: '甜宠 (Sweet Romance)',
    nameZh: '甜宠',
    nameEn: 'Sweet Romance',
    category: 'genre',
    intro: '高明度暖粉调、柔光、近景双人，轻胶片颗粒。',
    promptZh: '[主体], 甜宠剧风格, 高明度暖粉调, 柔光, 近景双人, 干净背景, 轻胶片颗粒',
    promptEn: '[subject], sweet romance drama style, high-key warm pink, soft light, close two-shot, clean background, light film grain',
    palette: ["#f4c2c8", "#e98f9a"],
  },
  {
    id: 'suspense-crime',
    name: '悬疑犯罪 (Suspense Crime)',
    nameZh: '悬疑犯罪',
    nameEn: 'Suspense Crime',
    category: 'genre',
    intro: '冷青灰、硬光大面积阴影、雨夜霓虹，低饱和高对比。',
    promptZh: '[主体], 悬疑犯罪电影风格, 冷青灰, 硬光与大面积阴影, 雨夜霓虹, 低饱和高对比',
    promptEn: '[subject], suspense crime cinematography, cold cyan gray, hard light and large shadows, rainy neon night, low saturation high contrast',
    palette: ["#2c3a42", "#0f1418"],
  },
  {
    id: 'family-life',
    name: '家庭生活 (Family Life)',
    nameZh: '家庭生活',
    nameEn: 'Family Life',
    category: 'genre',
    intro: '自然窗光、暖木色、真实家居，生活化构图。',
    promptZh: '[主体], 家庭生活剧风格, 自然窗光, 暖木色, 真实家居, 低饱和, 生活化构图',
    promptEn: '[subject], family life drama style, natural window light, warm wood tones, real home interior, low saturation, everyday composition',
    palette: ["#c8a882", "#8a6a4a"],
  },
  {
    id: 'workplace',
    name: '职场商战 (Workplace)',
    nameZh: '职场商战',
    nameEn: 'Workplace',
    category: 'genre',
    intro: '冷白办公光、玻璃幕墙、低饱和蓝灰，干净利落。',
    promptZh: '[主体], 职场商战剧风格, 冷白办公光, 玻璃幕墙, 低饱和蓝灰, 干净利落构图',
    promptEn: '[subject], workplace business drama style, cool white office light, glass curtain wall, low saturation blue gray, clean sharp composition',
    palette: ["#7a8a99", "#2f3a45"],
  },
  {
    id: 'war-history',
    name: '战争历史 (War History)',
    nameZh: '战争历史',
    nameEn: 'War History',
    category: 'genre',
    intro: '尘土硝烟、去饱和土黄、硬光、手持纪实感、宽银幕。',
    promptZh: '[主体], 战争历史电影风格, 尘土与硝烟, 去饱和土黄, 硬光, 手持纪实感, 宽银幕',
    promptEn: '[subject], war history cinematography, dust and smoke, desaturated earth yellow, hard light, handheld documentary feel, widescreen',
    palette: ["#8a7050", "#3a3028"],
  },
  {
    id: 'sci-fi-apocalypse',
    name: '科幻末日 (Sci-Fi Apocalypse)',
    nameZh: '科幻末日',
    nameEn: 'Sci-Fi Apocalypse',
    category: 'genre',
    intro: '冷青与铁锈、硬边光、工业废墟、高对比与体积尘雾。',
    promptZh: '[主体], 科幻末日风格, 冷青与铁锈, 硬边光, 工业废墟, 高对比, 体积尘雾',
    promptEn: '[subject], sci-fi apocalypse style, cold cyan and rust, hard edge light, industrial ruins, high contrast, volumetric dust',
    palette: ["#2f4a52", "#8a4a2a"],
  },
  {
    id: 'hongkong-retro',
    name: '港风复古 (Hong Kong Retro)',
    nameZh: '港风复古',
    nameEn: 'Hong Kong Retro',
    category: 'genre',
    intro: '霓虹绿与暖黄、雨夜街巷、胶片颗粒、手持。',
    promptZh: '[主体], 港风复古电影风格, 霓虹绿与暖黄, 雨夜街巷, 胶片颗粒, 手持',
    promptEn: '[subject], Hong Kong retro cinematography, neon green and warm yellow, rainy night alley, film grain, handheld',
    palette: ["#3a6a4a", "#c8a04a"],
  },
  {
    id: 'japanese-fresh',
    name: '日系清新 (Japanese Fresh)',
    nameZh: '日系清新',
    nameEn: 'Japanese Fresh',
    category: 'genre',
    intro: '高调柔光、低对比、青绿米白、空气感浅景深。',
    promptZh: '[主体], 日系清新风格, 高调柔光, 低对比, 青绿米白, 空气感, 浅景深',
    promptEn: '[subject], Japanese fresh style, high-key soft light, low contrast, sage green and cream, airy, shallow depth of field',
    palette: ["#c8d8c0", "#f4efe4"],
  },
  {
    id: 'shaw-brothers',
    name: '邵氏风格 (Shaw Brothers)',
    nameZh: '邵氏风格',
    nameEn: 'Shaw Brothers',
    category: 'genre',
    intro: '1960–70 年代邵氏片场：高饱和胶片、手绘布景、戏剧化硬光，武侠与功夫片的经典质感。',
    promptZh: '[主体], 邵氏电影风格, 1960年代香港片场, 高饱和胶片色彩, 手绘布景, 戏剧化硬光, 武侠与功夫片质感, 明显胶片颗粒与轻微褪色',
    promptEn: '[subject], Shaw Brothers studio style, 1960s Hong Kong soundstage, saturated film colors, painted backdrops, dramatic hard lighting, martial arts film texture, visible film grain and slight fade',
    palette: ["#b03a2e", "#d4a017"],
  },
  {
    id: 'hk-classic',
    name: '经典港片 (Classic Hong Kong Cinema)',
    nameZh: '经典港片',
    nameEn: 'Classic Hong Kong Cinema',
    category: 'genre',
    intro: '80–90 年代香港电影：霓虹夜色、暖黄青绿、手持与慢镜，英雄片/警匪片的胶片质感。',
    promptZh: '[主体], 80至90年代经典港片风格, 霓虹与夜色, 暖黄与青绿, 手持与慢镜, 胶片颗粒, 英雄片与警匪片质感',
    promptEn: '[subject], 1980s-90s classic Hong Kong cinema style, neon night, warm amber and teal, handheld and slow motion, film grain, heroic bloodshed and crime film texture',
    palette: ["#1f6b6b", "#e0a020"],
  },
];

/** 风格 id → 预设 */
export function stylePresetById(id: string | null | undefined): StylePreset | null {
  if (!id) return null;
  return STYLE_PRESETS.find((s) => s.id === id) ?? null;
}

/** 预设 → 提示词里的风格片段（去掉 [主体], 前缀） */
export function stylePresetPrompt(preset: StylePreset): string {
  return preset.promptZh.replace(/^\[主体\]\s*[,，]\s*/, '').trim();
}

/** public 资源 URL（兼容 Vite base） */
export function styleAssetUrl(path: string): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base}${path}`;
}

export function stylePresetImageUrl(preset: StylePreset): string {
  return preset.image ? styleAssetUrl(preset.image) : '';
}

/**
 * 把全剧风格写进一条提示词：
 * - 删掉旧的 4 行风格块（风格/灯光/色彩/质感，来自旧模板或旧下拉）；
 * - 末尾追加一行 `风格：<预设片段>`；
 * - 空提示词不处理（避免只生成风格、没有人设）。
 */
export function applyStylePromptToPrompt(prompt: string, stylePrompt: string): string {
  const body = (prompt ?? '').trim();
  if (!body || !stylePrompt.trim()) return body;
  const cleaned = body
    .replace(/^(风格|灯光|色彩|质感)：.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `${cleaned}\n风格：${stylePrompt.trim()}`;
}
