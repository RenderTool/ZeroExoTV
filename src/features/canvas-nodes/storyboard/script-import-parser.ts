/**
 * script-import-parser — 剧本导入解析器（2026-11-04 重做做剧本导入·纯函数层）
 *
 * 职责：
 * 1) 编码解码：UTF-8 严格解码优先，失败或含替换字符(U+FFFD)时回落 GB18030（GBK 超集）；
 *    空文件/纯空白文件直接抛 ScriptImportEmptyError 拒绝；
 * 2) 格式嗅探：内容嗅探 + 扩展名双判定 → markdown / screenplay / plain 三选一；
 * 3) 解析（规则依据 zerovideoAgent references/script-format.md 的场次/人物/对白铁律）：
 *    - markdown：# → 集，##/### → 场；正文行复用剧本行分类器；
 *    - screenplay（特殊剧本格式）：INT./EXT./内景/外景、【场景 N: …】、第N场 → 场号；
 *      「角色名: 对白」或独立角色行 → 人物+对白；行首（…）→ 括注；CUT TO:/切至/淡入/淡出 → 转场；
 *      无法识别的段落整体保留为动作正文，禁止丢内容；
 *    - plain：按空行与场次标记启发式切分，行级复用同一分类器；
 * 4) 产出预览数据（集数/场次数/角色数/字符数/命中格式/样例行）供导入弹窗展示，确认后才落盘。
 *
 * HTML 序列化 class 与 features/canvas-nodes/script-editor/script-lines.ts 的契约保持一致
 * （script-scene-heading / script-action / script-character / script-dialogue /
 *   script-parenthetical / script-transition），保证结构化编辑器可直接回读。
 */

import { countScriptChars } from '@/shared/utils/script-count.js';

// ---------- 类型 ----------

export type ScriptImportFormat = 'markdown' | 'screenplay' | 'plain';

export type ScriptImportEncoding = 'utf-8' | 'gb18030';

/** 解析出的剧本块（与结构化编辑器行类型一一对应） */
export interface ImportBlock {
  type: 'scene-heading' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition';
  text: string;
}

/** 解析出的单集 */
export interface ParsedImportEpisode {
  /** 解析侧标题（仅供预览展示；落盘「新建一集」时标题由 autoEpisodeTitle 派生） */
  title: string;
  /** 编辑器兼容 HTML（<p class="script-xxx"> 序列） */
  html: string;
  /** 纯文本（块间 \n 连接） */
  text: string;
  /** 本集场次数 */
  sceneCount: number;
  /** 本集识别到的角色名（去重、按出现顺序） */
  characters: string[];
}

/** 解析结果（预览层数据源） */
export interface ParsedScriptImport {
  format: ScriptImportFormat;
  /** 预览展示用中文格式名 */
  formatLabel: string;
  encoding: ScriptImportEncoding;
  episodes: ParsedImportEpisode[];
  stats: {
    episodeCount: number;
    sceneCount: number;
    characterCount: number;
    /** 源文本总字符数（含空白） */
    charCount: number;
  };
  /** 源文本前 6 个非空行（预览样例） */
  sampleLines: string[];
  /** 全部集拼接后的编辑器兼容 HTML（插入/覆盖策略的落盘内容） */
  htmlAll: string;
  /** 全部集拼接后的纯文本 */
  textAll: string;
}

export class ScriptImportEmptyError extends Error {
  constructor() {
    super('文件为空或仅包含空白内容，无法导入');
    this.name = 'ScriptImportEmptyError';
  }
}

// ---------- 编码解码 ----------

/**
 * 智能解码：UTF-8 严格模式优先；抛错或结果含替换字符(U+FFFD)时尝试 GB18030，
 * GB18030 结果替换字符更少才采用，否则回退非严格 UTF-8。
 */
export function decodeScriptBuffer(buf: ArrayBuffer): { text: string; encoding: ScriptImportEncoding } {
  const countBad = (s: string): number => (s.match(/�/g) ?? []).length;
  let text: string;
  let encoding: ScriptImportEncoding = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('gb18030').decode(buf);
    encoding = 'gb18030';
  }
  if (encoding === 'utf-8' && text.includes('�')) {
    const gbk = new TextDecoder('gb18030').decode(buf);
    if (countBad(gbk) < countBad(text)) {
      text = gbk;
      encoding = 'gb18030';
    }
  }
  if (!text.trim()) throw new ScriptImportEmptyError();
  return { text, encoding };
}

// ---------- 格式嗅探 ----------

const RE_MD_HEADING = /^#{1,3}\s+\S/;
const RE_SCENE_HEADING_LINE = /^(?:INT\.|EXT\.|内景|外景)/i;
const RE_SCENE_BRACKET = /^【[^【】]*(?:场景|场|景)\s*[0-9一二三四五六七八九十百零]*[^【】]*】$/;
const RE_SCENE_CN_NUMBER = /^第[0-9一二三四五六七八九十百零]+场(?:\s|$|[:：])/;
const RE_DIALOGUE_INLINE = /^([^\s:：]{1,20})\s*[:：]\s*(.+)$/;
const RE_TRANSITION = /^(?:切至|淡入|淡出|CUT TO|FADE IN|FADE OUT)[:：]?$/i;
const RE_PAREN_STANDALONE = /^[（(]([^（）()]{1,40})[）)]$/;

function isSceneHeadingLine(line: string): boolean {
  return RE_SCENE_HEADING_LINE.test(line) || RE_SCENE_BRACKET.test(line) || RE_SCENE_CN_NUMBER.test(line);
}

/**
 * 内容嗅探 + 扩展名双判定。
 * 优先级：内容呈强剧本特征 → screenplay；内容含 md 标题 → markdown；
 * 仅扩展名 .md/.markdown → markdown；其余 → plain。
 */
export function detectScriptFormat(filename: string, text: string): ScriptImportFormat {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let sceneHits = 0;
  let dialogueHits = 0;
  let mdHeadingHits = 0;
  for (const line of lines) {
    if (isSceneHeadingLine(line)) sceneHits += 1;
    if (RE_DIALOGUE_INLINE.test(line)) dialogueHits += 1;
    if (RE_MD_HEADING.test(line)) mdHeadingHits += 1;
  }
  // 剧本特征：≥2 个场号，或 场号+对白 共现（场号行是剧本最强信号）
  if (sceneHits >= 2 || (sceneHits >= 1 && dialogueHits >= 1)) return 'screenplay';
  if (mdHeadingHits >= 1) return 'markdown';
  const ext = (filename.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return 'plain';
}

// ---------- 行分类器（script-format.md 场次/人物/对白铁律） ----------

/** 中文角色名单独行：2-6 个中日韩字符，可带（…）后缀（如「老张」「老张（旁白）」） */
const RE_CJK_CUE = /^[一-鿿]{2,6}(?:[（(][^（）()]{1,12}[）)])?$/;
/** 好莱坞大写角色行 */
const RE_UPPER_CUE = /^[A-Z][A-Z0-9\s·.'-]{1,24}$/;
/** 动作句终止标点（命中则不是角色行） */
const RE_SENTENCE_END = /[。！？…，、；：,.!?;]$/;

function stripCueSuffix(name: string): string {
  return name.replace(/[（(][^（）()]*[）)]$/, '').trim();
}

/**
 * 把一段连续行（含空行作段落分隔）分类为剧本块。
 * 状态规则（好莱坞格式）：独立角色行之后、空行/场号/转场之前的行都归入对白；
 * 空行只复位状态、不产出块。
 * 铁律：无法识别的行 → action，禁止丢内容。
 */
function classifyLines(lines: string[]): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  let inDialogue = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) {
      inDialogue = false;
      continue;
    }
    // 场号：【场景 N: …】——剥掉场号前缀，保留地点时间主体
    const bracket = line.match(/^【([^【】]*)】$/);
    if (bracket && /^(?:场景|场|景)\s*\d*/.test(bracket[1]!.trim())) {
      const body = bracket[1]!.trim().replace(/^(?:场景|场|景)\s*\d*\s*[:：]?\s*/, '').trim();
      blocks.push({ type: 'scene-heading', text: body || bracket[1]!.trim() });
      inDialogue = false;
      continue;
    }
    // 场号：第N场（整行视为场景标题，如「第一场 老张家 夜」）
    if (RE_SCENE_CN_NUMBER.test(line)) {
      blocks.push({ type: 'scene-heading', text: line });
      inDialogue = false;
      continue;
    }
    // 场号：INT./EXT./内景/外景 前缀行
    if (RE_SCENE_HEADING_LINE.test(line)) {
      blocks.push({ type: 'scene-heading', text: line });
      inDialogue = false;
      continue;
    }
    // 转场
    if (RE_TRANSITION.test(line)) {
      blocks.push({ type: 'transition', text: line.replace(/[:：]$/, '') });
      inDialogue = false;
      continue;
    }
    // 独立括注行：（低声）——script-format.md：括注视为情绪提示
    const paren = line.match(RE_PAREN_STANDALONE);
    if (paren) {
      blocks.push({ type: 'parenthetical', text: `（${paren[1]!.trim()}）` });
      continue; // 括注不改变对白状态：角色行→括注→对白 是标准序列
    }
    // 单行对白：「角色名: 对白」——对白开头（…）拆为独立括注（情绪提示写在对白开头）
    const dlg = line.match(RE_DIALOGUE_INLINE);
    if (dlg) {
      blocks.push({ type: 'character', text: dlg[1]!.trim() });
      const body = dlg[2]!.trim();
      const lead = body.match(/^[（(]([^（）()]{1,40})[）)]\s*/);
      if (lead) {
        blocks.push({ type: 'parenthetical', text: `（${lead[1]!.trim()}）` });
        const rest = body.slice(lead[0].length).trim();
        if (rest) blocks.push({ type: 'dialogue', text: rest });
      } else {
        blocks.push({ type: 'dialogue', text: body });
      }
      inDialogue = false; // 单行对白自包含，不开启后续对白状态
      continue;
    }
    // 独立角色行（中文名/好莱坞大写名）：下一非空行是台词——要求下一行存在且本身不是场号/转场
    const isCue =
      !RE_SENTENCE_END.test(line) &&
      (RE_CJK_CUE.test(line) || (RE_UPPER_CUE.test(line) && line === line.toUpperCase()));
    if (isCue) {
      const next = lines[i + 1]?.trim();
      if (next && !isSceneHeadingLine(next) && !RE_TRANSITION.test(next)) {
        blocks.push({ type: 'character', text: stripCueSuffix(line) });
        inDialogue = true;
        continue;
      }
    }
    // 对白延续：角色行之后、空行复位之前的普通行归入对白
    if (inDialogue) {
      blocks.push({ type: 'dialogue', text: line });
      continue;
    }
    // 兜底：动作正文（无法识别的段落整体保留）
    blocks.push({ type: 'action', text: line });
  }
  return blocks;
}

// ---------- HTML 序列化（class 契约同 script-lines.ts） ----------

const BLOCK_CLASS: Record<ImportBlock['type'], string> = {
  'scene-heading': 'script-scene-heading',
  action: 'script-action',
  character: 'script-character',
  dialogue: 'script-dialogue',
  parenthetical: 'script-parenthetical',
  transition: 'script-transition',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function serializeImportBlocks(blocks: ImportBlock[]): string {
  return blocks.map((b) => `<p class="${BLOCK_CLASS[b.type]}">${escapeHtml(b.text)}</p>`).join('');
}

// ---------- 集构建 ----------

interface EpisodeDraft {
  title: string;
  lines: string[];
  /** markdown 解析时由标题直接生成的块（标题本身也是结构） */
  headBlocks: ImportBlock[];
}

function draftToEpisode(draft: EpisodeDraft): ParsedImportEpisode {
  const blocks = [...draft.headBlocks, ...classifyLines(draft.lines)];
  const characters: string[] = [];
  for (const b of blocks) {
    if (b.type === 'character' && !characters.includes(b.text)) characters.push(b.text);
  }
  return {
    title: draft.title,
    html: serializeImportBlocks(blocks),
    text: blocks.map((b) => b.text).join('\n'),
    sceneCount: blocks.filter((b) => b.type === 'scene-heading').length,
    characters,
  };
}

// ---------- 三种格式的集切分 ----------

const RE_H1 = /^#\s+(.+)$/;
const RE_H23 = /^#{2,3}\s+(.+)$/;

function splitMarkdownEpisodes(text: string): EpisodeDraft[] {
  const drafts: EpisodeDraft[] = [];
  let current: EpisodeDraft | null = null;
  const ensure = (): EpisodeDraft => {
    if (!current) {
      current = { title: '开篇', lines: [], headBlocks: [] };
      drafts.push(current);
    }
    return current;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      // 空行不进标题判定，但要透传给分类器（对白状态复位信号）
      current?.lines.push('');
      continue;
    }
    const h1 = line.match(RE_H1);
    if (h1) {
      // 新的一集：标题行本身作为该集首条场景标题（结构可见、内容不丢）
      current = { title: h1[1]!.trim(), lines: [], headBlocks: [{ type: 'scene-heading', text: h1[1]!.trim() }] };
      drafts.push(current);
      continue;
    }
    const h23 = line.match(RE_H23);
    if (h23) {
      ensure().headBlocks.push({ type: 'scene-heading', text: h23[1]!.trim() });
      continue;
    }
    ensure().lines.push(line);
  }
  return drafts;
}

function splitPlainEpisode(text: string): EpisodeDraft[] {
  // 保留空行：空行是「对白状态复位」与段落分隔的信号，分类器需要它
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  return [{ title: '正文', lines, headBlocks: [] }];
}

// ---------- 入口 ----------

/**
 * 解析导入文本为结构化结果。空内容抛 ScriptImportEmptyError。
 * 不落盘——调用方拿本结果做预览，用户确认后再走 script-import-service 写入。
 */
export function parseScriptImport(input: { filename: string; text: string; encoding?: ScriptImportEncoding }): ParsedScriptImport {
  const { filename, text } = input;
  if (!text.trim()) throw new ScriptImportEmptyError();

  const format = detectScriptFormat(filename, text);
  const formatLabel =
    format === 'markdown' ? 'Markdown 剧本（按标题层级切分集/场）'
    : format === 'screenplay' ? '特殊剧本格式（场号/人物/对白结构）'
    : '普通文本（按空行与场次标记切分）';

  // markdown 按 # 切集；screenplay/plain 都是单集（场在集内，行级分类器处理结构）
  const drafts = format === 'markdown' ? splitMarkdownEpisodes(text) : splitPlainEpisode(text);
  const episodes = drafts.map(draftToEpisode);

  const characterSet = new Set<string>();
  let sceneCount = 0;
  for (const ep of episodes) {
    sceneCount += ep.sceneCount;
    for (const c of ep.characters) characterSet.add(c);
  }

  const sampleLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);

  return {
    format,
    formatLabel,
    encoding: input.encoding ?? 'utf-8',
    episodes,
    stats: {
      episodeCount: episodes.length,
      sceneCount,
      characterCount: characterSet.size,
      // 2026-11-04：预览"字符数"统一 countScriptChars 口径（修前为 text.length 含全部空白，与剧本页统计条对不上）
      charCount: countScriptChars(text),
    },
    sampleLines,
    htmlAll: episodes.map((e) => e.html).join(''),
    textAll: episodes.map((e) => e.text).join('\n'),
  };
}

/**
 * 剧集内容可见字符数——2026-11-04 起统一委托 countScriptChars
 * （去标签 + 解实体 + 折叠空白；修前漏解 &amp;/&lt; 等实体，会把 & 算成 5 字）。
 * 保留导出名以兼容既有调用方（use-episode-manager 等）。
 */
export function scriptContentLength(content: string | null | undefined): number {
  return countScriptChars(content);
}
