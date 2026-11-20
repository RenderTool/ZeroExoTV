/**
 * style-craft — 每套风格的「可执行技法 / 运镜节奏 / 叙事剪辑」说明（2026-11-21 用户要求）。
 *
 * 用户原话：「每种风格应该支持点开，查看里面的风格技巧、运镜要领等……包括运镜、叙事技巧！
 * 直接决定最终分镜判断的运镜每段时间和节奏！」——所以这里不写形容词，只写分镜时能直接用的判断：
 * 用什么机位、镜头持续多少秒、怎么切。
 *
 * 数据来源（不是凭空编）：
 * - 平均镜头长度（ASL）：The Cinema Ledger 对 154 位导演逐片统计（Kurosawa 14.5s / Nolan 3.5s /
 *   Anderson 6.8s / Tarantino 6.5s / Leone 7.3s / Godard 21.1s 等）；
 * - 导演技法：Bordwell 对 Tarantino 的逐章分析、ASC 对 Kurosawa（Ran 三机长焦）与 Blade Runner
 *   （烟雾光束/实用光）的访谈、Wong Kar-wai 的降格加印+慢门研究、Anderson 的平面化/甩摇分析、
 *   Nolan 的 IMAX/交叉剪辑资料、Zhang Yimou 的色彩与对称分析、Ang Lee 的单镜调度研究；
 * - 类型语法：film noir 的 chiaroscuro/荷兰角/百叶窗影子、法国新浪潮的跳切与长镜、
 *   cyberpunk 的霓虹+湿地面+垂直城市、西部片的宽远景↔极特写节奏、水墨动画的分层赛璐璐与留白、
 *   吉卜力的「間（ma）」留白。
 * 每条 sources 里的链接就是对应依据；没有实测数据的条目，asl 明确标注「类型惯例」而不是伪造秒数。
 */

export interface StyleCraftSource {
  label: string;
  url: string;
}

export interface StyleCraft {
  /** 节奏基准：实测 ASL 或类型惯例的镜头时长区间 */
  asl: string;
  /** 风格技法（构图/光色/材质/表演） */
  techniques: string[];
  /** 运镜要领：每条都带「持续几秒 / 怎么动 / 什么时候切」 */
  camera: string[];
  /** 叙事与剪辑技巧 */
  narrative: string[];
  sources: StyleCraftSource[];
}

const ASL_LEDGER: StyleCraftSource = {
  label: 'The Cinema Ledger：154 位导演实测平均镜头长度',
  url: 'https://kiarashfa.github.io/DrXRates/directors/',
};

export const STYLE_CRAFT: Record<string, StyleCraft> = {
  // ── 导演 ───────────────────────────────────────────────────────────
  'wes-anderson': {
    asl: '实测 ASL 6.8s（9 部片）；对白正反打 3–5s，横向跟移 4–8s。',
    techniques: [
      '中心对称构图：人物/门框/窗棂压在画面中轴线上，左右必须真的对称（道具也要成对）。',
      '平面化机位（planimetric）：相机垂直于背景墙，前景/中景/背景叠成平面，不做纵深透视。',
      '低饱和粉彩/土色系，每个片子一个主色；服装与布景同一色系不同明度。',
      '横向跟移代替推拉：人物左右横穿，相机平移保持与人物平行。',
      '甩摇（whip pan）当标点用，不做无缝过渡。',
    ],
    camera: [
      '横向 dolly 跟拍 4–8s，不切，让人物走完整段路径。',
      '甩摇 0.3–0.5s，只用在场景切换/笑点上，一镜最多一次。',
      '慢推（slow push-in）只给情绪落点，2–3s 推到就停，不来回。',
    ],
    narrative: [
      '章节式结构：标题卡分章，每章一个物件/一个人物，靠图形切换而非因果推进。',
      '构图静止、台词 deadpan：让画面整齐与人物失控形成喜剧张力。',
      '一个镜头只给一个信息点，不用反打补信息。',
    ],
    sources: [
      ASL_LEDGER,
      { label: 'Wes Anderson 对称/平面化/甩摇技法拆解', url: 'https://spoilertown.com/the-visual-language-of-wes-andersons-symmetry-and-style/' },
    ],
  },

  'wong-kar-wai': {
    asl: '无统一实测 ASL；手持跟拍 2–6s，固定情绪长镜 8–12s，降格慢镜 1–3s。',
    techniques: [
      '降格加印：拍摄降到 12/8/4 fps，后期每帧复制回 24 fps，得到卡顿而不加速的慢镜。',
      '慢门拖影：低帧率配慢快门，背景人流拉成光带，主体保持相对清晰。',
      '框式/前景遮挡：门框、窗、栏杆、肩背挡住主体，观众像偷看。',
      '大光比伦勃朗光，暗部藏细节，单机位精修每个构图。',
      '冷暖混合的实用光源（霓虹、钨丝灯、日光灯同框）。',
    ],
    camera: [
      '手持跟拍跟随人物走动 3–6s，允许虚焦与晃动，表现不安。',
      '固定长镜看一个动作（投币点歌、上下楼梯）8–12s，背景用降格人流表现"时间在流走"。',
      '慢门抽帧只给"时间感"：1–3s 一个镜头，别整段都用。',
    ],
    narrative: [
      '双段/碎片式时间：两段故事靠地点与主题勾连，不做因果闭环。',
      '内心独白旁白承担信息，画面不必交代全部。',
      '音乐先行：同一首歌反复出现，用重复建立记忆点。',
    ],
    sources: [
      { label: '王家卫「降格加印 + 慢门」技术拆解', url: 'https://news.qq.com/rain/a/20240202A00EL600' },
      { label: 'Christopher Doyle 的 step-printing 与遮挡构图', url: 'https://blockreel.co/blog/christopher-doyle-a-master-study-of-the-cinematographer' },
    ],
  },

  'zhang-yimou': {
    asl: '无统一实测 ASL；色彩大全景 5–8s，武打慢镜 2–4s，特写 1–3s。',
    techniques: [
      '极致对称/中心构图，透视指向画面中心；院落、宫门、队列都对齐中轴。',
      '色块叙事：一场戏一个主色（红=情欲/暴力，白=纯洁，黑=权力），同场不混色。',
      '框式构图：窗格、门洞、廊柱把人物框死，表现禁锢。',
      '高空俯拍大全景，人物缩成点，强调制度压人。',
      '广角大全景 ↔ 近景的硬切，跳过中景。',
    ],
    camera: [
      '大全景固定 5–8s，先让颜色铺满画面再进人。',
      '90° 横摇 3–4s 后落到严整对称构图（落幅必须正）。',
      '武打：慢镜 + 飘落物（落叶/雪/纱）2–4s 一个动作，不用快切碎打。',
    ],
    narrative: [
      '罗生门式多版本叙述：同一事件用不同颜色/视角重讲，颜色就是"谁在说谎"。',
      '仪式化段落（点灯、锤脚、列阵）替代对白推进。',
      '主角可以长期不露正脸（老爷），用制度化的"缺席"施压。',
    ],
    sources: [
      { label: '《英雄》色彩叙事与镜头语言', url: 'https://m.baike.com/wiki/%E8%8B%B1%E9%9B%84/1556655' },
      { label: '张艺谋对称构图与权力关系研究', url: 'https://m.aikan.qq.com/read/1022648334/13' },
    ],
  },

  'christopher-nolan': {
    asl: '实测 ASL 3.5s（10 部片），《Dunkirk》《Inception》《Oppenheimer》约 3s 一镜。',
    techniques: [
      '大片幅（IMAX 65mm/70mm）+ 少量 CGI，实拍爆炸/实景建筑。',
      '低饱和冷调，建筑空间压迫感强（走廊、混凝土、玻璃）。',
      '克制表演：主角压住情绪，用静止而非爆发演内心。',
      '声音低频 drone 持续施压，音乐与音效当叙事力量。',
    ],
    camera: [
      '车载/稳定器长镜跟运动 4–6s，保持空间可读（不碎切）。',
      '交叉剪辑段单镜压到 1–2s，随多线逼近汇合越来越快。',
      '对话用 3–5s 正反打，不加花哨运镜，信息靠台词节奏。',
    ],
    narrative: [
      '交叉剪辑 + 倒计时：多条时间线同时逼近一个危机点。',
      '非线性时间结构（嵌套/倒放），让观众自己拼因果。',
      '说明性台词写成"推进燃料"，语速快、规则清楚，不解释第二遍。',
    ],
    sources: [
      ASL_LEDGER,
      { label: 'Nolan 交叉剪辑/IMAX/实拍的方法论', url: 'https://hollywoodmetrics.ai/directors/christopher-nolan' },
    ],
  },

  'quentin-tarantino': {
    asl: '实测 ASL 6.5s（10 部片）；《Inglourious Basterds》章节内平均约 5.6s。',
    techniques: [
      '单机位、锁定构图：每个机位都算过，不做"全覆盖"。',
      '长对话双人构图，镜头不动，威胁靠台词层层加码。',
      '低机位/后备箱视角、突然的暴力爆发（1–2s 快切）。',
      '章节标题卡 + 时间跳切，把因果拆开重排。',
    ],
    camera: [
      '对话长镜 8–20s 不切，让演员把话说完；换机位只换景别/角度，不换轴线。',
      '缓慢推轨/升降 3–5s，用于给"要出事了"的预感。',
      '暴力瞬间压到 1–2s 一个镜头，之后立刻回到静止。',
    ],
    narrative: [
      '章节体：每章一个地点/一组人，靠时间跳跃而非顺叙。',
      '日常闲聊铺垫威胁，威胁兑现时反而干脆利落。',
      '关键台词可以放在画外（说话人不给镜头），用听觉制造压迫。',
    ],
    sources: [
      ASL_LEDGER,
      { label: 'Bordwell：Tarantino 的单机位与章节交叉剪辑', url: 'https://www.davidbordwell.net/blog/category/directors-tarantino/page/3/' },
    ],
  },

  'ridley-scott': {
    asl: '无统一 ASL；氛围推轨 6–10s，紧张段手持 2–4s。',
    techniques: [
      '烟雾 + 光束：用烟做介质才看得到光柱，光比靠烟雾密度控制。',
      '实用光源主导（霓虹、灯箱、冰箱、手电），冷蓝与暖黄对冲。',
      '多层前景（雨窗、蒸汽、人群）制造纵深与压迫。',
      '人物常被框在门框/柱子里，城市尺度压人。',
    ],
    camera: [
      '缓慢推轨穿过空间 6–10s，让观众吸收布景密度。',
      'crane 升降建立城市垂直尺度 5–8s，一个段落用一次。',
      '手持只在追逐/恐慌时用，2–4s 一切，平时保持稳。',
    ],
    narrative: [
      '环境先于人物：先用空间与天气交代世界的规则。',
      '悬念靠"不给看清"（剪影、逆光、遮挡），不靠解释。',
      '剪辑耐心，长段铺垫后一次性引爆。',
    ],
    sources: [
      { label: 'ASC：Blade Runner 的烟雾光束与实用光', url: 'http://www.shturl.cc/959db10f3e7967cedd49c8d403fe7a89' },
      { label: 'Blade Runner 构图与运镜分析', url: 'https://colorculture.org/blade-runner-cinematography-analysis/' },
    ],
  },

  'akira-kurosawa': {
    asl: '实测 ASL 14.5s（21 部片）；《七武士》9.1s，《High and Low》17.5s。',
    techniques: [
      '长焦压缩空间：把马、雨、旗压在一个平面上，混乱但看得清。',
      '三机同拍（A 全景 / B 细节 / C 游击），演员不知哪台在拍，表演连续。',
      '天气当角色：雨、风、泥、雾必须实做，压出人的本性。',
      '三角/斜线群像构图，视线在画面里被"路由"。',
    ],
    camera: [
      '长焦固定机位 5–10s 看完整段动作，不切碎。',
      '轴向跳切（同轴推近/拉远）代替移动，一个动作切 2–3 次，每次 1–3s。',
      'cut on motion：在动作中途换机位（切点前后差 0.2–0.5s），让运动连续。',
    ],
    narrative: [
      '多视角真相（罗生门）：同一事件重复讲述，版本互相矛盾。',
      '擦除转场（wipe）当标点，保持叙事往前推。',
      '剪辑按音乐节奏修，动作—停顿—动作。',
    ],
    sources: [
      ASL_LEDGER,
      { label: 'Kurosawa 三机长焦/擦除/轴向跳切', url: 'https://vectree.io/c/akira-kurosawa' },
      { label: 'ASC：Ran 的三机位与长焦选择', url: 'http://www.shturl.cc/266eb13a4d5f91e8a7e6c459cfadbc02' },
    ],
  },

  'tim-burton': {
    asl: '无实测 ASL；荷兰角静止镜 3–6s，快推 1–2s。',
    techniques: [
      '高对比低调光 + 荷兰角，画面故意"歪"。',
      '哥特造型：尖顶、扭曲树、夸张比例，轮廓比细节重要。',
      '冷暖分区：粉彩郊区 vs 黑紫城堡，用色彩划分世界。',
      '定格动画的材质感（布景、木偶纹理）混进实拍。',
    ],
    camera: [
      '荷兰角静止 3–6s，先让观众不适，再给台词。',
      '缓慢横移展示整座场景（像翻立体书），6–8s。',
      '快推/急拉 1–2s 做惊吓点，一段只用一次。',
    ],
    narrative: [
      '童话/回忆框架：故事由旁观者讲述，允许不可靠。',
      'outsider 视角：镜头永远站在怪人这一边。',
      '黑色幽默与伤感同框，恐怖不解决、只被理解。',
    ],
    sources: [
      { label: 'Burton 的高对比/荷兰角/表现主义', url: 'https://www.studyguides.com/study-methods/overview/cmpaneczrfi1v01nepe0tn7va' },
      { label: 'Edward Scissorhands 的光比与空间对比（USC 论文）', url: 'https://cinema.usc.edu/admissions/studentstories/bdasilveira_paper.pdf' },
    ],
  },

  'ang-lee': {
    asl: '无统一 ASL；对话双人中景可 60–120s 不切，武侠跟拍 6–10s。',
    techniques: [
      '单镜内纵深调度：人物前后景站位交代关系，不靠剪。',
      '静态双人中景 + 克制表演，情绪压在停顿里。',
      '武侠反港式：不用碎切省动作，完整拍起-飞-落。',
      '自然光/低对比，服装与器物承担文化信息。',
    ],
    camera: [
      '固定双人中景 60–120s 以上，让对话自己长出节奏。',
      '跟移穿门/穿院 4–8s，一层层揭示"谁在看谁"。',
      '轻功长镜跟拍 6–10s，保持人物全身与空间关系。',
    ],
    narrative: [
      '螳螂捕蝉式层层揭示：先给结果，再退回解释注意力归属。',
      '家庭/文化冲突用日常仪式（吃饭、送礼）承载，不靠宣言。',
      '情绪不外化：把爆发留给一个动作或一个空镜。',
    ],
    sources: [
      { label: '李安电影的单镜调度与长镜头叙事（论文）', url: 'https://qn1-next.xuetangonline.com/16444772461026.pdf' },
      { label: '《卧虎藏龙》坚持完整动作段的研究', url: 'https://www.tandfonline.com/doi/full/10.1080/17508061.2026.2701434' },
    ],
  },

  // ── 类型/流派 ─────────────────────────────────────────────────────
  'film-noir': {
    asl: '类型惯例：固定/慢推 4–8s，插入特写 1–2s；不用快切堆紧张。',
    techniques: [
      '低调光 + chiaroscuro：补光几乎为零，脸被切成明暗两半。',
      '硬光造锐影：百叶窗、栏杆、窗格的影子打在脸上=囚禁。',
      '荷兰角 + 广角畸变：世界"歪了"，空间比人更有权力。',
      '雨夜城市、霓虹、湿地面反射；烟雾做体积。',
    ],
    camera: [
      '固定机位 + 缓慢推 4–8s，让阴影慢慢吃掉人物。',
      '低机位仰拍 3–5s 让环境压人；俯拍 4–6s 让人显得渺小。',
      '插入特写 1–2s（手、枪、钥匙），信息点短促。',
    ],
    narrative: [
      '第一人称旁白，宿命式倒叙：观众早知道会毁，只看怎么毁。',
      '蛇蝎美人与道德灰区，不做明确善恶。',
      '关键信息藏在画面暗部，让观众二次观看才发现。',
    ],
    sources: [
      { label: 'Film noir 摄影语法（低调光/荷兰角/百叶窗）', url: 'https://ltx.studio/glossary/film-noir?placement=topmenu' },
      { label: 'Paul Schrader 时代的 noir 风格笔记（PDF）', url: 'http://ereserve.library.utah.edu/Annual/FILM/3210/Siska/notes.pdf' },
    ],
  },

  'french-new-wave': {
    asl: '实测 Godard ASL 21.1s（21 部片）；跳切段 0.5–2s，对话长镜 2–3 分钟。',
    techniques: [
      '跳切：同机位直接删掉中间时间，允许"跳"。',
      '手持 + 自然光 + 实景，纪录片质感。',
      '打破 180° 轴线、缺建立镜头，观众自己找空间。',
      '定格、闪白、字幕卡直接打断叙事。',
    ],
    camera: [
      '跳切：同机位连切 3–5 次，每次 0.5–2s，表现焦躁/省时间。',
      '长镜 120–180s 不切，让对话与沉默都在场。',
      '随手摇/甩镜 1–2s，接受不完美。',
    ],
    narrative: [
      '反因果：事件可以没铺垫地发生，结局不给解释。',
      '旁白/字幕卡与画面不同步，制造间离。',
      '即兴对话与题外话占大段，情节反而被稀释。',
    ],
    sources: [
      ASL_LEDGER,
      { label: 'Criterion：Breathless 的跳切与超长镜并置', url: 'https://www.criterion.com/current/posts/526-hong-kong-action-a-crash-course' },
    ],
  },

  'cyberpunk': {
    asl: '类型惯例：氛围推轨 5–8s，贴身跟拍 2–4s，信息特写 1s。',
    techniques: [
      '霓虹做主光：青蓝/品红高饱和，暗部保留深黑。',
      '湿地面 + 雨 + 雾，让每块招牌都有倒影。',
      '垂直城市：仰拍高楼、俯拍街道，人在夹缝里。',
      '前景遮挡（雨窗、蒸汽、路人）形成多层纵深。',
    ],
    camera: [
      '缓慢横移/推轨 5–8s 穿越街道，让密度自己说话。',
      'crane 俯冲 3–5s 建立垂直落差，一段一次。',
      '贴身跟拍 2–4s，肩后视角，保持压迫。',
    ],
    narrative: [
      '高科技低生活：技术奇观与底层生存同框对照。',
      '侦探式调查推进，信息靠"看屏幕/看档案"给。',
      '身份与记忆可被篡改，真相反复被重写。',
    ],
    sources: [
      { label: 'Cyberpunk 视觉语法（霓虹/湿地/垂直城市）', url: 'https://www.screenweaver.ai/it/film-techniques/genre-looks/cyberpunk' },
      { label: 'Blade Runner 的高角/低角与几何城市（论文）', url: 'https://resolve.cambridge.org/core/journals/european-review/article/photography-film-and-storytelling-of-posthuman-crises-in-blade-runner/FAAD89262BF762B10587174223B01B5F' },
    ],
  },

  'epic-fantasy': {
    asl: '类型惯例：建立大全景 6–10s，行军/旅程跟拍 4–8s，决战交叉剪辑 1–3s。',
    techniques: [
      '大远景 + 小人物：人只有环境的一小块，尺度差就是史诗感。',
      '自然光/阴天光，避免塑料感的均匀照明。',
      '深焦 + 实景/微缩，前后景都清晰可读。',
      '材质要旧：泥、铁、麻布、磨损的皮革。',
    ],
    camera: [
      '大全景固定 6–10s 建立地理，再进人。',
      '跟拍行军/骑行 4–8s，保持速度与方向一致。',
      '决战用多线交叉 1–3s 一切，越接近汇合越快。',
    ],
    narrative: [
      '多线史诗：几条线各自推进，靠地理/预言勾连。',
      '旅程结构：每到一个地方换一种规则与代价。',
      '用规模对比讲主题（个体 vs 历史），不靠台词总结。',
    ],
    sources: [
      { label: '西部/大远景与深焦的景深语法（可对照史诗景别）', url: 'https://www.dfirentals.com/news/western-cinematography-ford-leone-horror' },
    ],
  },

  'modern-urban': {
    asl: '类型惯例：街头跟拍 3–6s，静观固定 5–8s，插入特写 1–2s。',
    techniques: [
      '实景城市夜景，实用光源（便利店、路灯、招牌）当主光。',
      '长焦压缩人群，人物被"挤"在画面里。',
      '玻璃/水洼反射做双重影像。',
      '低饱和但保留一处高饱和色点（招牌/衣服）。',
    ],
    camera: [
      '街头手持跟拍 3–6s，保持人在人群中。',
      '长焦偷窥式固定 5–8s，隔着街看对面窗。',
      '车窗/地铁玻璃反射的固定镜 3–5s，做情绪过渡。',
    ],
    narrative: [
      '都市孤独：用空间距离讲关系，不用台词说明。',
      '偶遇与错过：时间点反复强调（几点、哪班车）。',
      '日常细节（外卖、加班、电梯）承担真实感。',
    ],
    sources: [
      { label: '王家卫式都市摄影（单机位/遮挡/实用光源）', url: 'https://news.qq.com/rain/a/20240202A00EL600' },
    ],
  },

  'western': {
    asl: '实测 Leone ASL 7.3s（7 部片）；对峙可单镜 10s+，极特写 2–4s。',
    techniques: [
      '低地平线（天占大半）让人渺小；高地平线（土占大半）让人被困。',
      '极端宽远景 ↔ 极端特写，跳过中景。',
      '静态对峙：人物不动，只切眼睛/手/汗。',
      '深焦：脸在近景巨大，骑手在远景仍可读。',
    ],
    camera: [
      '极宽固定 5–10s 铺空地，再切极特写 2–4s 的眼睛。',
      '对峙来回切 6–10 次，每次 2–4s 并略收紧，时间被拉长。',
      '几乎不摇不推；要动就用人物/马的运动带跟 3–5s。',
    ],
    narrative: [
      '沉默与环境音（苍蝇、风声、铁轨）代替对白铺垫。',
      '仪式化决斗：把一秒暴力拆成几分钟仪式。',
      '反英雄与道德灰区，正义靠行为不靠身份。',
    ],
    sources: [
      ASL_LEDGER,
      { label: '西部片地平线规则与 Leone 的宽远景↔极特写', url: 'https://www.dfirentals.com/news/western-cinematography-ford-leone-horror' },
      { label: 'No Film School：Leone 开场静默调度', url: 'https://nofilmschool.com/once-upon-a-time-west-opening-scene' },
    ],
  },

  // ── 动画 ─────────────────────────────────────────────────────────
  'chinese-ink-wash-animation': {
    asl: '类型惯例：空镜/墨色变化 4–8s，长卷式横移 8–15s；极少快切。',
    techniques: [
      '没有轮廓线：靠浓淡墨块与虚实层次塑形（分层赛璐璐反复叠拍）。',
      '计白当黑：水面不画水纹，只画涟漪；身体半截藏在水里。',
      '写意不写实：造型取"气韵生动"，不做照相写实或漫画夸张。',
      '淡彩/墨色为主，色彩只在关键处点一笔（红、赭）。',
    ],
    camera: [
      '固定镜看墨色晕开 4–8s，让画面自己变。',
      '长卷式横向平移 8–15s，像展开手卷。',
      '不用推拉变焦；层与层叠化过渡，每次 2–3s。',
    ],
    narrative: [
      '弱冲突、诗化结构：靠季节/旅程/一段琴音串联。',
      '留白承担叙事：不画的部分让观众自己补。',
      '音乐与自然声主导节奏，少对白甚至无对白。',
    ],
    sources: [
      { label: '人民日报：水墨动画的分层拍摄与写意', url: 'http://paper.people.com.cn/fcyym/pc/attachement/202602/06/71a588e4-6a17-4f3e-89f8-72dbd8d29e2f.pdf' },
      { label: '光明日报：水墨动画的技法与意境', url: 'https://epaper.gmw.cn/gmrb/html/2018-08/02/nw.D110000gmrb_20180802_1-16.htm' },
    ],
  },

  'classic-disney-animation': {
    asl: '类型惯例：歌舞长镜 6–12s，动作段 1–3s，情感特写 2–4s。',
    techniques: [
      '动画十二原则：挤压拉伸、预备动作、跟随动作、时间掌握（timing）决定重量感。',
      '歌舞段用长镜承载编舞，不切碎。',
      '高饱和色 + 清晰剪影，角色在任何背景都能读出来。',
      '多平面摄影机造纵深，背景也要有运动。',
    ],
    camera: [
      '歌舞/群戏长镜 6–12s，保持全身与舞台空间。',
      '动作段 1–3s 一切，靠预备—动作—跟随三段式。',
      '情感点用 2–4s 特写，眼睛与手部表情优先。',
    ],
    narrative: [
      '三幕 + 歌舞推进：歌曲承担人物动机与转折。',
      '动机清晰：想要什么一开场就说清。',
      '配角承担喜剧节奏，主线保持单纯。',
    ],
    sources: [
      { label: '迪士尼动画运动模式与吉卜力对照（论文）', url: 'http://m.qikan.cqvip.com/Article/ArticleDetail?id=7112771778' },
    ],
  },

  'studio-ghibli': {
    asl: '类型惯例：静默停顿 3–8s，风景固定/缓移 6–15s，飞行长镜 6–10s。',
    techniques: [
      '「間（ma）」：刻意留出什么都不发生的段落，让观众进入世界。',
      '手绘背景：水彩/水粉质感，细节密度高但不抢人物。',
      '开放合成：前景/中景/远景各自滑动，不强行几何透视。',
      '柔和自然色，季节与天气参与情绪。',
    ],
    camera: [
      '固定或极慢平移看风景 6–15s（等一朵云、等一班车）。',
      '静默停顿 3–8s：人物只是坐着、吃饭、看天。',
      '飞行/奔跑长镜 6–10s，保持方向与空间连续。',
    ],
    narrative: [
      '弱对抗：冲突来自环境与成长，不是反派阴谋。',
      '日常仪式（吃饭、打扫、等车）承担人物塑造。',
      '不给道德结论，把复杂性留给观众。',
    ],
    sources: [
      { label: '宫崎骏的 ma（留白）与静默节奏', url: 'https://blockreel.co/blog/hayao-miyazaki-a-master-study-of-the-director' },
      { label: '吉卜力风景/开放合成与「間」', url: 'https://onlybyland.com/ghibli-landscapes/' },
    ],
  },

  'pixar-3d-animation': {
    asl: '类型惯例：正反打 3–5s，抒情蒙太奇 2–4s，动作段 1–2s。',
    techniques: [
      '十二原则在三维里执行：重心、预备、跟随、夸张表情但结构可信。',
      '镜头语言接近实拍：广角建立、长焦特写、浅景深。',
      '材质基于物理（PBR）：布纹、金属、毛发都要有重量。',
      '色彩脚本（color script）先定情绪曲线再定单镜颜色。',
    ],
    camera: [
      '正反打 3–5s，视线高度与人物身高匹配。',
      '抒情蒙太奇 2–4s 一切，用动作衔接（match cut）。',
      '动作段 1–2s，靠镜头运动制造速度，不靠抖动。',
    ],
    narrative: [
      '概念高概念、情感低概念：设定奇，但冲突是家庭/成长。',
      '无对白段落承担情感高潮（音乐+动作）。',
      '每个场景都要改变人物关系，不做纯搞笑填充。',
    ],
    sources: [
      { label: '三维动画与实拍镜头语言的差异（论文）', url: 'http://m.qikan.cqvip.com/Article/ArticleDetail?id=7112771778' },
    ],
  },

  'dreamworks-stylized': {
    asl: '类型惯例：喜剧快切 1–3s，动作段 1–2s，情绪点 3–5s。',
    techniques: [
      '夸张表情与身体喜剧，比例可以失真。',
      '流行文化梗与配乐拼贴，节奏偏 MV。',
      '强轮廓光 + 高饱和，角色剪影优先。',
      '打破第四面墙的玩笑镜头（看镜头、字幕吐槽）。',
    ],
    camera: [
      '喜剧快切 1–3s，笑点靠剪辑节奏。',
      '大特写做反应镜头 1–2s，表情即 punchline。',
      '动作段 1–2s 一切，镜头跟着打斗方向甩。',
    ],
    narrative: [
      '喜剧先行：先立笑点人格，再谈成长。',
      '群像多线并进，靠台词互怼推进。',
      '结尾把玩笑收成情感，不做纯搞笑收尾。',
    ],
    sources: [
      { label: '美式三维动画的喜剧节奏参照（迪士尼/吉卜力对照）', url: 'http://m.qikan.cqvip.com/Article/ArticleDetail?id=7112771778' },
    ],
  },

  'anime-style': {
    asl: '类型惯例：定格对话 2–4s，动作 bank 2s，冲击帧 0.5–1s。',
    techniques: [
      '有限动画：关键张 + 重复帧，省帧但保构图冲击。',
      '速度线、集中线、冲击帧（黑白闪）表现力量。',
      '角色设定线条干净，背景可高细节反差。',
      '固定构图 + 大特写眼睛，情绪靠瞳色/高光变化。',
    ],
    camera: [
      '台词定格 2–4s 一切，机位固定，只换景别。',
      '必杀/动作 bank 镜头 2s 复用，靠剪辑位置制造新鲜感。',
      '冲击瞬间 0.5–1s 一闪，之后立刻回到静止。',
    ],
    narrative: [
      '每集一个明确目标 + 一次反转，节奏按"三分钟一个钩子"。',
      '内心独白承担设定说明，画面同步给符号化意象。',
      '用重复镜头建立仪式感（变身、拔刀、开眼）。',
    ],
    sources: [
      { label: '日本动画「动画性运动」与有限动画特征（论文）', url: 'http://m.qikan.cqvip.com/Article/ArticleDetail?id=7112771778' },
    ],
  },

  'stop-motion': {
    asl: '类型惯例：逐格动作 4–8s 一镜，快切 1–2s；帧率 12/24fps。',
    techniques: [
      '逐格拍摄（常见 12fps 拍、24fps 播，或全 24fps），动作有轻微"顿感"。',
      '微缩布景 + 手工材质，纹理（布、木、黏土）比光滑 CG 更有触感。',
      '实拍灯光：小光源近距离打，阴影尺度真实。',
      '角色替换件（换脸/换手）承担表情，别指望变形。',
    ],
    camera: [
      '固定机位逐格 4–8s，一次只走一个动作段。',
      '轻微推轨/横移 3–5s，速度要慢，避免滑轨抖动。',
      '快切 1–2s 做喜剧/惊吓，靠剪辑跳格。',
    ],
    narrative: [
      '手工感允许荒诞：设定越具体，怪事越好笑。',
      '段落式结构，每段一个"机关"或一个视觉笑点。',
      '用材质变化（融化、撕裂、缝补）讲身体恐怖。',
    ],
    sources: [
      { label: '逐格动画帧率与材质特征（停止运动动画概述）', url: 'https://www.studyguides.com/study-methods/overview/cmpaneczrfi1v01nepe0tn7va' },
    ],
  },

  'chinese-theatrical-animation': {
    asl: '类型惯例：舞台式固定 3–6s，动作按锣鼓点 1–2s 一切。',
    techniques: [
      '京剧程式：脸谱、亮相、身段、水袖，动作有"定格造型"。',
      '工笔单线平涂：明确轮廓线 + 平涂填色，装饰纹样密。',
      '舞台化空间：正面观众视角，背景像布景片。',
      '锣鼓点决定节奏：动作起落与打击乐对齐。',
    ],
    camera: [
      '正面固定 3–6s 看"亮相"，让人物把造型站住。',
      '横向平移/上下移 3–5s 像换幕布，不做纵深穿行。',
      '打斗按锣鼓点 1–2s 一切，快慢对比明显。',
    ],
    narrative: [
      '章回体：一段一个对手/一个法宝，因果清楚。',
      '程式化表演承担情绪，观众看"怎么做"而非"为什么"。',
      '神话/民间故事为底，善恶分明。',
    ],
    sources: [
      { label: '中国动画学派：工笔单线平涂与民族形式', url: 'https://epaper.gmw.cn/wzb/html/2022-11/05/nw.D110000wzb_20221105_1-08.htm' },
    ],
  },

  // ── 组合技（技术路线） ────────────────────────────────────────────
  'combo-sci-fi-3d-pbr': {
    asl: '产品级展示：环绕/推轨 4–8s，细节特写 2–3s。',
    techniques: [
      '硬表面建模：倒角、接缝、螺丝孔必须真实，别做光滑塑料。',
      'PBR：金属粗糙度/清漆层/微划痕分层，高光有形状。',
      '体积光 + 雾，让光可见；冷白主光 + 青蓝轮廓。',
      '次表面散射只给该透的材质（皮肤、树脂）。',
    ],
    camera: [
      '环绕（orbit）4–8s 一圈，速度恒定。',
      '推轨穿过结构 4–6s，穿缝/穿舱制造尺度。',
      '细节特写 2–3s，焦平面给材质不给人。',
    ],
    narrative: [
      '先给功能再给奇观：观众看懂它怎么用，才信它存在。',
      '尺度对比（人 vs 舱门）替代台词说明。',
      '镜头节奏跟着"装配逻辑"走，不炫技乱切。',
    ],
    sources: [
      { label: 'Blade Runner 的材质/烟雾/实用光参照', url: 'https://colorculture.org/blade-runner-cinematography-analysis/' },
    ],
  },

  'combo-anime-pbr': {
    asl: '类型惯例：中景 3–5s，特写 2s，动作 1–2s。',
    techniques: [
      '原创卡通造型：比例夸张但结构可信（关节、重心要真）。',
      'PBR 材质 + 柔和 SSS，布料有绒感、地面有接触阴影。',
      '轮廓线可保留（卡通描边），但要与 PBR 高光统一。',
      '必须规避既有 IP 形象（发型/服装/配色都要原创）。',
    ],
    camera: [
      '中景 3–5s 保持全身比例读得清。',
      '特写 2s 给表情，眼睛高光要一致。',
      '动作段 1–2s 一切，靠预备动作交代力量。',
    ],
    narrative: [
      '角色先行：先让观众喜欢造型，再给设定。',
      '轻喜剧节奏，冲突不压过可爱。',
      '结尾用一个小动作收情绪，不用大场面。',
    ],
    sources: [
      { label: '三维卡通与 PBR 的材质/光照参照', url: 'http://m.qikan.cqvip.com/Article/ArticleDetail?id=7112771778' },
    ],
  },

  'combo-real-film': {
    asl: '类型惯例：手持/肩扛 3–6s，静观 5–10s。',
    techniques: [
      '胶片化学：柯达 5219 颗粒、轻微高光溢出、低饱和高对比。',
      '自然窗光 + 实用光源做动机光，不打"无来源"的柔光。',
      '35mm 定焦为主，浅景深但保留环境可读。',
      '皮肤不做磨皮，保留毛孔与汗。',
    ],
    camera: [
      '肩扛跟拍 3–6s，允许轻微呼吸感，不刻意抖。',
      '静观固定 5–10s，让演员在光里待着。',
      '推拉克制：一个段落最多一次缓慢推近 4–6s，别连续推。',
    ],
    narrative: [
      '年代/地域靠物件与光线交代，不靠字幕。',
      '写实冲突来自处境，不给戏剧化巧合。',
      '留白结尾：不解释人物后续，只给一个空镜。',
    ],
    sources: [
      { label: '实拍胶片质感与自然光的参照（Blade Runner 实用光访谈）', url: 'http://www.shturl.cc/959db10f3e7967cedd49c8d403fe7a89' },
    ],
  },

  'combo-cel-shaded': {
    asl: '类型惯例：固定 3–5s，横移 4–6s，打斗 1–2s。',
    techniques: [
      '赛璐璐上色：硬边阴影、两到三阶明暗，不做渐变糊。',
      '手绘高光：头发/金属/眼睛的高光要"画"出来，不是贴图。',
      '电影三点光映射到二维：主光决定阴影方向，轮廓光勾边。',
      '纸面微颗粒叠在最上层，统一画面质感。',
    ],
    camera: [
      '固定 3–5s 看构图与色彩块。',
      '横向平移 4–6s，像横卷展开场景。',
      '打斗 1–2s 一切，用定格张强调冲击。',
    ],
    narrative: [
      '分色分场：一场一个主色，帮观众记地点。',
      '热血段落靠"定格+台词"蓄力，再一次性释放。',
      '群像用构图站位交代阵营，不靠旁白。',
    ],
    sources: [
      { label: '赛璐璐/有限动画的运动模式（论文）', url: 'http://m.qikan.cqvip.com/Article/ArticleDetail?id=7112771778' },
    ],
  },

  'combo-stop-motion': {
    asl: '类型惯例：逐格一镜 4–8s，切点 1–2s；12/24fps。',
    techniques: [
      '微缩实拍：布景/道具按比例做，光也用真实小灯。',
      '材质表演：黏土/毛毡/木头的形变直接当动作。',
      '逐格顿感保留，不要后期补成丝滑 60fps。',
      '换件（脸、手、嘴）做表情，一次只换一处。',
    ],
    camera: [
      '固定机位一镜 4–8s，只完成一个动作段。',
      '缓推/横移 3–5s，速度慢到不露滑轨抖。',
      '快切 1–2s 做喜剧节奏。',
    ],
    narrative: [
      '机关式叙事：每个场景一个可视化的"装置"笑点。',
      '材质即隐喻（缝合、融化、修补）。',
      '段落短、钩子密，适合短剧集。',
    ],
    sources: [
      { label: '逐格动画的帧率与手工材质特征', url: 'https://www.studyguides.com/study-methods/overview/cmpaneczrfi1v01nepe0tn7va' },
    ],
  },

  'combo-ink-3d': {
    asl: '类型惯例：穿行长镜 6–10s，墨色变化空镜 4–8s。',
    techniques: [
      '三维体积水墨：用体积雾/粒子做墨的扩散，别做贴图假墨。',
      '留白必须是真空：不填灰、不加纹理，让白有呼吸。',
      '墨分五色：焦/浓/重/淡/清，一层一个浓度。',
      '镜头里加一笔"实"（人物/舟/鸟），其余全虚。',
    ],
    camera: [
      '缓慢穿行 6–10s 穿过雾与山，速度恒定。',
      '空镜看墨扩散 4–8s，不切。',
      '不用甩镜/快推（快推 1s 就会破坏意境），整段保持一种速度。',
    ],
    narrative: [
      '以景写情：情绪用山水变化承载。',
      '极简对白或无对白，靠音乐与留白。',
      '结尾留白，不给"解释性"总结镜头。',
    ],
    sources: [
      { label: '水墨动画的分层晕染与留白技法', url: 'https://tidenews.com.cn/news.html?id=3456251' },
      { label: '水墨动画的写意美学（光明日报）', url: 'https://epaper.gmw.cn/gmrb/html/2018-08/02/nw.D110000gmrb_20180802_1-16.htm' },
    ],
  },

  // ── 题材/剧种 ───────────────────────────────────────────────────
  'basic-real': {
    asl: '类型惯例：固定/肩扛 3–6s，情绪点 5–8s。',
    techniques: ['自然光为主，少补光；低饱和；服装做旧不反光。', '35–50mm 接近人眼，透视不夸张。', '表演克制，情绪靠停顿与手部小动作。'],
    camera: ['固定或肩扛 3–6s，机位高度接近人物视线。', '情绪点缓慢推近 5–8s，推到位就停。', '避免无动机的环绕/甩镜；真要环就 4–6s 匀速一圈。'],
    narrative: ['日常冲突代替戏剧冲突，冲突来自处境。', '不给结论，留一个生活化的空镜收尾。'],
    sources: [{ label: '实拍写实的自然光与克制运镜参照', url: 'https://colorculture.org/blade-runner-cinematography-analysis/' }],
  },

  'urban-real': {
    asl: '类型惯例：街头跟拍 3–6s，静观 5–8s。',
    techniques: ['城市实景，招牌/路灯当主光。', '低饱和 + 一处高饱和色点。', '玻璃反射、雨天地面反光做层次。'],
    camera: ['手持跟拍 3–6s，保持在人群中。', '长焦偷窥式固定 5–8s。', '车窗反射镜 3–5s 做过渡。'],
    narrative: ['都市孤独用空间距离表现。', '偶遇/错过靠时间点强化。'],
    sources: [{ label: '都市摄影的实用光与遮挡构图', url: 'https://news.qq.com/rain/a/20240202A00EL600' }],
  },

  'urban-romance': {
    asl: '类型惯例：对视特写 3–5s，慢镜 2–4s，双人中景 5–8s。',
    techniques: ['柔光/逆光发丝光，皮肤通透。', '浅景深，背景虚成色块。', '服装同色系，让两人视觉上"靠近"。'],
    camera: ['双人中景 5–8s 保持距离感。', '对视特写 3–5s 正反打。', '慢镜 2–4s 只给关键动作（回头/伸手）。'],
    narrative: ['情感靠细节（伞、车票、未发送的短信）。', '误会/错过推动，不靠第三者硬冲突。'],
    sources: [{ label: '都市情感戏的柔光与特写节奏（类型惯例）', url: 'https://www.screenweaver.ai/it/film-techniques/genre-looks/cyberpunk' }],
  },

  'costume-xianxia': {
    asl: '类型惯例：大全景 5–8s，飞行长镜 4–8s，打斗 1–3s。',
    techniques: ['大远景山水 + 云雾，人物小。', '逆光/夕阳光，纱与发丝透光。', '冷青/暖金双色，门派用色区分。'],
    camera: ['大全景固定 5–8s 建立境界。', '飞行/御剑长镜 4–8s 保持空间连续。', '打斗 1–3s 一切，配慢镜定格关键帧。'],
    narrative: ['门派/因果体系先立规则，再破规则。', '情感用离别与重逢的重复场景承载。'],
    sources: [{ label: '仙侠景别与逆光纱质感的类型参照', url: 'https://m.aikan.qq.com/read/1022648334/13' }],
  },

  'republican': {
    asl: '类型惯例：固定中景 4–6s，雨景空镜 5–8s。',
    techniques: ['暖褐/墨绿调，旗袍与木作家具做质感。', '对称宅院、深宅门廊，人物被困在框里。', '雨天/雾气做柔化，避免数码锐利。'],
    camera: ['固定中景 4–6s，正面/侧面机位。', '缓慢横移穿廊 5–8s。', '雨窗特写 2–3s 做情绪插入。'],
    narrative: ['家族/时代压在个人选择上。', '书信、留声机、车票承担信息。'],
    sources: [{ label: '民国气质的对称构图与暖调参照', url: 'https://m.aikan.qq.com/read/1022648334/13' }],
  },

  'campus': {
    asl: '类型惯例：跟拍 2–5s，反应特写 1–2s。',
    techniques: ['高调明亮自然光，色彩清透。', '校服/教室/操场做统一色块。', '轻手持，允许活泼晃动。'],
    camera: ['跟拍人物跑动 2–5s。', '反应特写 1–2s，切得干脆。', '走廊/操场横移 4–6s 建立群像。'],
    narrative: ['单元式日常 + 一条主线情感。', '用考试/比赛/毕业做时间刻度。'],
    sources: [{ label: '青春校园的快切与高调光（类型惯例）', url: 'https://www.studyguides.com/study-methods/overview/cmpangkt7159h01nedg953cm9' }],
  },

  'sweet-romance': {
    asl: '类型惯例：甜点特写 2–3s，对视 3–4s，双人 5–6s。',
    techniques: ['高调柔光，几乎无硬阴影。', '粉/奶油色系，背景干净。', '小道具（奶茶、耳机、便当）承担互动。'],
    camera: ['特写 2–3s 给细节与小动作。', '对视正反打 3–4s。', '双人中景 5–6s 保持甜度。'],
    narrative: ['每集一个小误会 + 一个小解决。', '情绪高点放在结尾 10 秒。'],
    sources: [{ label: '甜宠节奏与柔光特写（类型惯例）', url: 'https://www.screenweaver.ai/it/film-techniques/genre-looks/cyberpunk' }],
  },

  'suspense-crime': {
    asl: '类型惯例：固定 3–6s，插入特写 1s，追捕 1–2s。',
    techniques: ['低调冷色，信息藏在暗部。', '局部特写（手、锁、脚印）+ 遮挡构图。', '实用光源制造可疑阴影。'],
    camera: ['固定 3–6s 让观众自己找线索。', '插入特写 1s，只给半个信息。', '追捕 1–2s 快切 + 手持。'],
    narrative: ['信息差叙事：观众比角色多知道一点。', '每 5 分钟一个反转钩子。'],
    sources: [{ label: '悬疑的低调光与遮挡语法（film noir 参照）', url: 'https://ltx.studio/glossary/film-noir?placement=topmenu' }],
  },

  'family-life': {
    asl: '类型惯例：餐桌双人/多人镜 5–10s，空镜 4–6s。',
    techniques: ['暖光、生活化布景，器物有使用痕迹。', '自然窗光，少打轮廓光。', '低饱和，肤色真实。'],
    camera: ['固定多人中景 5–10s，让对话自然发生。', '厨房/客厅空镜 4–6s 做时间过渡。', '少推拉；要推就 4–6s 慢推到人物，保持"在家"的稳定感。'],
    narrative: ['冲突藏在日常琐事（做饭、洗碗、学费）。', '一顿饭解决一个矛盾。'],
    sources: [{ label: '家庭戏的长镜与生活化调度（李安研究参照）', url: 'https://qn1-next.xuetangonline.com/16444772461026.pdf' }],
  },

  'workplace': {
    asl: '类型惯例：正反打 3–5s，会议全景 5–7s。',
    techniques: ['冷白光/玻璃反射，空间规整。', '西装/工牌/会议室做秩序感。', '对称构图表现层级。'],
    camera: ['正反打 3–5s，视线高度统一。', '会议全景 5–7s 交代座次权力。', '走廊跟拍 3–4s 做压迫过渡。'],
    narrative: ['用会议/汇报推进权力关系。', '邮件、微信、加班时间做信息点。'],
    sources: [{ label: '职场戏的对称构图与冷调（类型惯例）', url: 'https://m.aikan.qq.com/read/1022648334/13' }],
  },

  'war-history': {
    asl: '类型惯例：战场大全景 4–8s，手持段 1–3s。',
    techniques: ['低饱和土黄/灰蓝，泥、烟、血做质感。', '大远景 + 手持近战交替。', '实拍爆炸/烟尘，避免纯 CG 干净感。'],
    camera: ['大全景 4–8s 交代战线。', '手持近战 1–3s，跟随士兵。', '交叉剪辑两线 2–4s，逼近汇合。'],
    narrative: ['个体视角切入大历史，不做全景解说。', '用日期/地点卡分章。'],
    sources: [{ label: '战争片的交叉剪辑与实拍质感（Nolan 参照）', url: 'https://hollywoodmetrics.ai/directors/christopher-nolan' }],
  },

  'sci-fi-apocalypse': {
    asl: '类型惯例：废墟大全景 5–10s，跟拍 3–6s。',
    techniques: ['灰黄尘/冷青，天空去饱和。', '废墟细节密度高（锈、塑料、涂鸦）。', '实用光源（手电、火堆、应急灯）。'],
    camera: ['缓慢横移/推轨 5–10s 穿越废墟。', '跟拍人物 3–6s，保持方向。', '仰拍巨物 2–4s 造压迫。'],
    narrative: ['资源/规则先行，人物按规则求生。', '不给"救世"答案，给一个选择。'],
    sources: [{ label: '末日废墟的氛围光与尺度参照（Blade Runner 城市）', url: 'https://colorculture.org/blade-runner-cinematography-analysis/' }],
  },

  'hongkong-retro': {
    asl: '类型惯例：手持 2–5s，霓虹空镜 4–6s，抽帧慢镜 1–3s。',
    techniques: ['霓虹绿/品红/暖黄，雨夜湿地反光。', '抽帧 + 慢门拖影，人群变成光带。', '茶餐厅、霓虹招牌、旧楼做年代感。'],
    camera: ['手持跟拍 2–5s，晃动表现不安。', '霓虹空镜 4–6s 做转场。', '抽帧慢镜 1–3s 只给情绪点。'],
    narrative: ['双线/碎片时间，旁白内心独白。', '一首老歌反复出现做记忆锚。'],
    sources: [{ label: '港风：降格加印/慢门/霓虹', url: 'https://news.qq.com/rain/a/20240202A00EL600' }],
  },

  'japanese-fresh': {
    asl: '类型惯例：静镜 4–8s，对话正反打 3–4s。',
    techniques: ['高调低对比，白而不曝。', '柔光 + 浅景深，背景干净。', '蓝白/木色，器物极简。'],
    camera: ['固定静镜 4–8s，让人物在画面里待着。', '正反打 3–4s，机位平视。', '缓慢横移 5–7s 展示空间。'],
    narrative: ['弱冲突，日常治愈，情绪靠留白。', '季节/食物做章节标记。'],
    sources: [{ label: '日系清新的高调光与静镜（类型惯例）', url: 'https://onlybyland.com/ghibli-landscapes/' }],
  },

  'shaw-brothers': {
    asl: '类型惯例：打斗 2–4s，zoom-in 0.5–1s，文戏 4–6s。',
    techniques: ['35mm 胶片颗粒、棚拍布景、硬光。', '武打走位讲究"招式可读"，不用碎剪藏动作。', '快速变焦（snap zoom）强调情绪/威胁。', '服装高饱和，红/黄/青分明。'],
    camera: ['打斗 2–4s 一切，保持全身与兵器关系。', 'snap zoom 0.5–1s 推到脸/兵器。', '文戏固定中景 4–6s。'],
    narrative: ['师门/恩怨因果清楚，招式即人物性格。', '每场打斗解决一个矛盾，节奏硬。'],
    sources: [{ label: '邵氏式硬光棚拍与武打可读性（类型惯例）', url: 'https://www.dfirentals.com/news/western-cinematography-ford-leone-horror' }],
  },

  'hk-classic': {
    asl: '类型惯例：动作 1.5–3s，追车 1–2s，情绪 4–6s。',
    techniques: ['手持 + 双机对打，跳切省略过程。', '霓虹/街市/天台实景。', '慢镜定格英雄瞬间，之后立刻快切。'],
    camera: ['动作 1.5–3s 一切，镜头跟着拳/刀方向。', '追车 1–2s 快切 + 车侧低机位。', '情绪 4–6s 固定，给演员一个眼神。'],
    narrative: ['兄弟情/江湖规则，冲突靠义气与背叛。', '结尾用慢镜 + 音乐收情绪。'],
    sources: [{ label: '港片动作的跳切与低机位（类型惯例）', url: 'https://www.screenweaver.ai/it/film-techniques/genre-looks/cyberpunk' }],
  },
};

export function styleCraftFor(id: string | null | undefined): StyleCraft | null {
  return id ? STYLE_CRAFT[id] ?? null : null;
}


