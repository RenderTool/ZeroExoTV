/**
 * script-normalize — 剧本规范化（2026-11-05 导入模式「转换为标准剧本」·纯函数层）
 *
 * ⚠️ 双侧对齐铁律：本文件与前端 `src/features/canvas-nodes/storyboard/script-normalize.ts`
 * 必须逐字一致（同一份纯函数复制，零依赖）。修改任意一侧后必须同步另一侧，
 * 并跑两边的 script-normalize 测试（fixture 相同，断言输出一致）。
 * 契约文档：project-rules/docs/script-import-contract.md（mode 语义 / 报告字段 / 缺省报错规则）。
 *
 * 把任意格式的剧本文本转换为标准剧本格式：
 *   # <剧名>
 *   ## 第N集：<集标题>
 *   ### 第M场：<场景名> · <内|外> · <日|夜>
 *   <动作行>
 *   角色名：台词
 *   [主体 @名称]
 *
 * 每行识别优先级（先命中先归属）：
 *   1. 剧名：第一个「非结构性」# 标题（结构性 = 集标题/场景行），无则「未命名剧本」；
 *   2. 集标题行：第N集 / EP\d+；以「集」结尾的短标题行作兜底（兜底放在对白之后，
 *      避免「老张：这集好看。」这类对白被误吞）；
 *   3. 场景行：第M场 / S\d+（序号后必须跟分隔符或行尾，避免「第三场雨下了一夜」误判）；
 *   4. 主体行：[主体 @X] 或 @X（统一输出 [主体 @X]）；
 *   5. 对白行：「X：Y」（中英冒号统一规范为全角冒号）；
 *   6. 无结构非空行：归当前场作动作行；无当前场 → discardedSegments（连续行合并为一段）。
 *
 * 场景行元信息：提取已有 内/外/日/夜（含 内景/外景/INT./EXT.、日间/白天/夜晚/夜间/夜里 同义词），
 * 缺则补「内 · 日」并 unknownSceneMeta+1；集/场序号缺时自动重编（有则保留原序号）。
 */

// ---------- 类型 ----------

/** 规范化报告（转换预览数据源） */
export interface NormalizeScriptReport {
  /** 识别到的集数 */
  episodeCount: number;
  /** 识别到的场次数 */
  sceneCount: number;
  /** 对白行数 */
  dialogueCount: number;
  /** 动作行数 */
  actionLineCount: number;
  /** 识别到的主体名（去重，按首次出现顺序） */
  subjects: string[];
  /** 缺 内/外 或 日/夜、按「内 · 日」补默认的场数 */
  unknownSceneMeta: number;
  /** 无法归入任何场的连续段落（每段 = 连续行 \n 合并），不会写入标准剧本 */
  discardedSegments: string[];
}

/** 规范化结果 */
export interface NormalizeScriptResult {
  /** 标准剧本格式文本 */
  normalized: string;
  report: NormalizeScriptReport;
}

// ---------- 常量 ----------

const DEFAULT_TITLE = '未命名剧本';
const DEFAULT_SCENE_NAME = '未命名场景';

/** 中文数字 → 数值（支持到百位，「两」=2） */
const CN_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseCnNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  let section = 0;
  let current = 0;
  for (const ch of s) {
    const d = CN_DIGITS[ch];
    if (d !== undefined) {
      current = d;
      continue;
    }
    if (ch === '十') {
      section += (current || 1) * 10;
      current = 0;
      continue;
    }
    if (ch === '百') {
      section += (current || 1) * 100;
      current = 0;
      continue;
    }
    return null;
  }
  return section + current;
}

// ---------- 行识别 ----------

/** 序号：阿拉伯或中文数字 */
const NUM = '[0-9零一二两三四五六七八九十百]+';
/** 标题/场景序号后的引导分隔符（必须跟分隔符或行尾，防止误吞正文） */
const SEP = '[\\s:：\\-—·、|]';
const RE_MD_HEADING = /^#{1,6}[ \t]*(.+)$/;
const RE_EP_CN = new RegExp(`^第\\s*(${NUM})\\s*集(?=$|${SEP})`);
const RE_EP_EN = /^EP\s*(\d+)(?=$|[\s:：\-—·、|])/i;
const RE_SCENE_CN = new RegExp(`^第\\s*(${NUM})\\s*场(?=$|${SEP})`);
const RE_SCENE_EN = /^S\s*(\d+)(?=$|[\s:：\-—·、|])/i;
const RE_DIALOGUE = /^([^\s:：]{1,20})\s*[:：]\s*(.+)$/;
const RE_SUBJECT_BRACKET = /^\[\s*主体\s*@\s*(.+?)\s*\]$/;
/** 以「集」结尾的兜底标题行排除项：标点或常见虚词（避免误吞「他买了全套邮集」式正文） */
const RE_TITLE_BLOCK = /[，。！？…；：:、,;~「」()（）\[\]【】的了着在是和与我有你他她它]/;

function stripMd(line: string): string {
  return line.replace(/^#{1,6}[ \t]*/, '').trim();
}

/** 剥掉序号后的引导分隔符（「：老张家」→「老张家」） */
function stripLeadingSep(s: string): string {
  return s.replace(new RegExp(`^${SEP}+`), '').trim();
}

/** 集标题行匹配：第N集 / EP\d+ */
function matchEpisode(line: string): { num: number | null; title: string } | null {
  const cn = line.match(RE_EP_CN);
  if (cn) return { num: parseCnNumber(cn[1]!), title: stripLeadingSep(line.slice(cn[0].length)) };
  const en = line.match(RE_EP_EN);
  if (en) return { num: Number(en[1]!), title: stripLeadingSep(line.slice(en[0].length)) };
  return null;
}

/** 以「集」结尾的短标题行（序号缺 → 自动重编；标题 = 整行） */
function matchEpisodeSuffix(line: string): { num: null; title: string } | null {
  if (line.length > 6 || !line.endsWith('集') || RE_TITLE_BLOCK.test(line)) return null;
  return { num: null, title: line };
}

/** 场景行匹配：第M场 / S\d+ */
function matchScene(line: string): { num: number | null; rest: string } | null {
  const cn = line.match(RE_SCENE_CN);
  if (cn) return { num: parseCnNumber(cn[1]!), rest: stripLeadingSep(line.slice(cn[0].length)) };
  const en = line.match(RE_SCENE_EN);
  if (en) return { num: Number(en[1]!), rest: stripLeadingSep(line.slice(en[0].length)) };
  return null;
}

/** 主体行匹配：[主体 @X] 或 @X → 主体名 */
function matchSubject(line: string): string | null {
  const br = line.match(RE_SUBJECT_BRACKET);
  if (br) return br[1]!.trim();
  if (line.startsWith('@') && line.length > 1) return line.slice(1).trim();
  return null;
}

/** 场景元信息提取：按分隔符切词，识别 内/外/日/夜 同义词；缺则补默认并记 filled */
function extractSceneMeta(rest: string): { name: string; int: '内' | '外'; day: boolean; filled: boolean } {
  const tokens = rest.split(/[·•|｜/\\:：,，、~～\-—–\s]+/).filter(Boolean);
  let int: '内' | '外' | null = null;
  let day: boolean | null = null;
  const names: string[] = [];
  for (const t of tokens) {
    const u = t.toUpperCase();
    if (int === null && (t === '内' || t === '内景' || u === 'INT' || u === 'INT.')) {
      int = '内';
      continue;
    }
    if (int === null && (t === '外' || t === '外景' || u === 'EXT' || u === 'EXT.')) {
      int = '外';
      continue;
    }
    if (day === null && (t === '日' || t === '日间' || t === '白天')) {
      day = true;
      continue;
    }
    if (day === null && (t === '夜' || t === '夜间' || t === '夜晚' || t === '夜里')) {
      day = false;
      continue;
    }
    names.push(t);
  }
  return {
    name: names.join(' ') || DEFAULT_SCENE_NAME,
    int: int ?? '内',
    day: day ?? true,
    filled: int === null || day === null,
  };
}

// ---------- 规范化主流程 ----------

interface SceneDraft {
  num: number;
  name: string;
  int: '内' | '外';
  day: boolean;
  content: string[];
}

interface EpisodeDraft {
  num: number;
  title: string;
  scenes: SceneDraft[];
  /** 本集内最近一次用过的场序号（缺号自动重编的基线） */
  lastSceneNum: number;
}

/**
 * 剧本文本 → 标准剧本格式 + 报告。纯函数、不落盘：
 * 导入弹窗选中「转换为标准剧本」时即时计算做预览，用户确认后才随导入落盘。
 */
export function normalizeScript(text: string): NormalizeScriptResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const subjects: string[] = [];
  const discardedSegments: string[] = [];
  const episodes: EpisodeDraft[] = [];
  let title = '';
  let curEp: EpisodeDraft | null = null;
  let curScene: SceneDraft | null = null;
  let lastEpNum = 0;
  let discardBuf: string[] = [];
  let dialogueCount = 0;
  let actionLineCount = 0;
  let unknownSceneMeta = 0;

  const flushDiscard = (): void => {
    if (discardBuf.length > 0) {
      discardedSegments.push(discardBuf.join('\n'));
      discardBuf = [];
    }
  };

  const openEpisode = (num: number, epTitle: string): void => {
    flushDiscard();
    curEp = { num, title: epTitle, scenes: [], lastSceneNum: 0 };
    episodes.push(curEp);
    curScene = null;
  };

  for (const rawLine of lines) {
    const stripped = stripMd(rawLine);
    if (!stripped) continue; // 纯 # 标记行

    // 1) 剧名：第一个非结构性 # 标题（结构性标题按集/场行往下走）
    if (!title && RE_MD_HEADING.test(rawLine)) {
      const headText = stripMd(rawLine);
      if (headText && !matchEpisode(headText) && !matchScene(headText)) {
        title = headText;
        continue;
      }
    }

    // 2) 集标题行（第N集 / EP\d+）→ 序号缺时自动重编
    const ep = matchEpisode(stripped);
    if (ep) {
      lastEpNum = ep.num ?? lastEpNum + 1;
      openEpisode(lastEpNum, ep.title);
      continue;
    }

    // 3) 场景行（第M场 / S\d+）→ 提取内外/日夜，缺补「内 · 日」；无集时自动开一集
    const sc = matchScene(stripped);
    if (sc) {
      flushDiscard();
      if (!curEp) {
        lastEpNum += 1;
        curEp = { num: lastEpNum, title: '', scenes: [], lastSceneNum: 0 };
        episodes.push(curEp);
      }
      curEp.lastSceneNum = sc.num ?? curEp.lastSceneNum + 1;
      const meta = extractSceneMeta(sc.rest);
      if (meta.filled) unknownSceneMeta += 1;
      curScene = { num: curEp.lastSceneNum, name: meta.name, int: meta.int, day: meta.day, content: [] };
      curEp.scenes.push(curScene);
      continue;
    }

    // 4) 主体行（[主体 @X] / @X）→ 统一输出 [主体 @X]；无当前场归丢弃段
    const subj = matchSubject(stripped);
    if (subj) {
      if (!subjects.includes(subj)) subjects.push(subj);
      if (curScene) curScene.content.push(`[主体 @${subj}]`);
      else discardBuf.push(stripped);
      continue;
    }

    // 5) 对白行（「X：Y」中英冒号 → 全角）→ 无当前场归丢弃段
    const dlg = stripped.match(RE_DIALOGUE);
    if (dlg) {
      if (curScene) {
        curScene.content.push(`${dlg[1]!.trim()}：${dlg[2]!.trim()}`);
        dialogueCount += 1;
      } else {
        discardBuf.push(stripped);
      }
      continue;
    }

    // 6) 以「集」结尾的短标题行（兜底集识别；放对白后避免误吞「X：…集」）
    const epSuffix = matchEpisodeSuffix(stripped);
    if (epSuffix) {
      lastEpNum += 1;
      openEpisode(lastEpNum, epSuffix.title);
      continue;
    }

    // 7) 无结构非空行：有当前场 → 动作行；无 → 丢弃段（连续行合并）
    if (curScene) {
      curScene.content.push(stripped);
      actionLineCount += 1;
    } else {
      discardBuf.push(stripped);
    }
  }
  flushDiscard();

  // ---------- 输出组装（标准格式逐字对齐） ----------
  const out: string[] = [`# ${title || DEFAULT_TITLE}`];
  for (const ep of episodes) {
    out.push(`## 第${ep.num}集${ep.title ? `：${ep.title}` : ''}`);
    for (const scn of ep.scenes) {
      out.push(`### 第${scn.num}场：${scn.name} · ${scn.int} · ${scn.day ? '日' : '夜'}`);
      out.push(...scn.content);
    }
  }

  return {
    normalized: out.join('\n'),
    report: {
      episodeCount: episodes.length,
      sceneCount: episodes.reduce((n, e) => n + e.scenes.length, 0),
      dialogueCount,
      actionLineCount,
      subjects,
      unknownSceneMeta,
      discardedSegments,
    },
  };
}
