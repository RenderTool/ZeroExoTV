/**
 * 统一章节检测器（Plan#75 D4）
 *
 * 同源说明：本文件与 zeroexo_backend/src/common/text/episode-marker-detector.ts
 * 为同一份纯函数实现的双端物理副本（后端 CommonJS 无法跨 workspace 引用前端 ESM 包），
 * 改动必须双端同步。移植自 references/projects/waoowaoo episode-marker-detector.ts，
 * 并补 md 标题模式与锚点行号字段。
 *
 * 核心原则（Plan#75）：切索引 ≠ 拆正文——产物是锚点数组 ChapterAnchor，
 * 不携带正文；正文以 startIndex/endIndex 回原文切片。
 */

export interface ChapterAnchor {
  /** 章节号（检测标记推断；开篇块为 0，长度块为序号） */
  number: number;
  /** 标题（标记行原文截断；开篇块「开篇」；长度块首行截断） */
  title: string;
  /** 起始字符偏移（含标题行） */
  startIndex: number;
  /** 结束字符偏移（不含，下一章起点或文末） */
  endIndex: number;
  /** 起始行号（1-based，Monaco revealLineInCenter 直用） */
  startLine: number;
  /** 结束行号（1-based） */
  endLine: number;
  /** 字数（英文按词、中文按字，waoowaoo countWords 规则） */
  wordCount: number;
}

export type ChapterConfidence = 'high' | 'medium' | 'low';

export interface ChapterDetectResult {
  hasMarkers: boolean;
  markerType: string;
  confidence: ChapterConfidence;
  /** 切分策略：marker=标题标记；length=无标记长度兜底（8-10k） */
  strategy: 'marker' | 'length';
  chapters: ChapterAnchor[];
}

// ============================================================
// 中文数字 → 阿拉伯数字（完整进位：十/百/千 + 零〇两壹贰叁大写）
// ============================================================

const CHINESE_NUMBERS: Record<string, number> = {
  '零': 0, '〇': 0,
  '一': 1, '壹': 1,
  '二': 2, '贰': 2, '两': 2,
  '三': 3, '叁': 3,
  '四': 4, '肆': 4,
  '五': 5, '伍': 5,
  '六': 6, '陆': 6,
  '七': 7, '柒': 7,
  '八': 8, '捌': 8,
  '九': 9, '玖': 9,
  '十': 10, '拾': 10,
  '百': 100, '佰': 100,
  '千': 1000, '仟': 1000,
};

export function chineseToNumber(chinese: string): number {
  if (/^\d+$/.test(chinese)) {
    return parseInt(chinese, 10);
  }
  let result = 0;
  let current = 0;
  for (const char of chinese) {
    const num = CHINESE_NUMBERS[char];
    if (num === undefined) continue;
    if (num >= 10) {
      if (current === 0) current = 1;
      result += current * num;
      current = 0;
    } else {
      current = current * 10 + num;
    }
  }
  return result + current;
}

// ============================================================
// 字数统计（waoowaoo word-count 同款规则，零依赖内嵌）
// ============================================================

export function countWords(text: string): number {
  if (!text) return 0;
  let englishWordCount = 0;
  const textWithoutEnglish = text.replace(/[a-zA-Z0-9]+/g, () => {
    englishWordCount++;
    return '';
  });
  const chineseMatches = textWithoutEnglish.match(/[\u4e00-\u9fa5\u3400-\u4dbf]/g);
  const chineseCount = chineseMatches ? chineseMatches.length : 0;
  return englishWordCount + chineseCount;
}

// ============================================================
// 检测模式（waoowaoo 10 种直译 + md 标题补充）
// ============================================================

interface DetectionPattern {
  regex: RegExp;
  typeKey: string;
  typeName: string;
  extractNumber: (match: RegExpExecArray) => number;
}

const DETECTION_PATTERNS: DetectionPattern[] = [
  {
    regex: /^第([一二三四五六七八九十百千\d]+)集[：:\s]*(.*)?/gm,
    typeKey: 'episode',
    typeName: '第X集',
    extractNumber: (m) => chineseToNumber(m[1] ?? ''),
  },
  {
    regex: /^第([一二三四五六七八九十百千\d]+)章[：:\s]*(.*)?/gm,
    typeKey: 'chapter',
    typeName: '第X章',
    extractNumber: (m) => chineseToNumber(m[1] ?? ''),
  },
  {
    regex: /^第([一二三四五六七八九十百千\d]+)幕[：:\s]*(.*)?/gm,
    typeKey: 'act',
    typeName: '第X幕',
    extractNumber: (m) => chineseToNumber(m[1] ?? ''),
  },
  {
    regex: /^(\d+)-\d+[【[](.*?)[】\]]/gm,
    typeKey: 'scene',
    typeName: 'X-Y【场景】',
    extractNumber: (m) => parseInt(m[1] ?? '0', 10),
  },
  {
    regex: /^(\d+)[.、：:]\s*(.+)/gm,
    typeKey: 'numbered',
    typeName: '数字编号',
    extractNumber: (m) => parseInt(m[1] ?? '0', 10),
  },
  {
    regex: /^(\d+)\\\.\s*(.+)/gm,
    typeKey: 'numberedEscaped',
    typeName: '数字编号(转义)',
    extractNumber: (m) => parseInt(m[1] ?? '0', 10),
  },
  {
    regex: /(?:^|\n\n)(\d+)([\u4e00-\u9fa5])/gm,
    typeKey: 'numberedDirect',
    typeName: '数字+中文',
    extractNumber: (m) => parseInt(m[1] ?? '0', 10),
  },
  {
    regex: /^Episode\s*(\d+)[：:\s]*(.*)?/gim,
    typeKey: 'episodeEn',
    typeName: 'Episode X',
    extractNumber: (m) => parseInt(m[1] ?? '0', 10),
  },
  {
    regex: /^Chapter\s*(\d+)[：:\s]*(.*)?/gim,
    typeKey: 'chapterEn',
    typeName: 'Chapter X',
    extractNumber: (m) => parseInt(m[1] ?? '0', 10),
  },
  {
    regex: /\*\*(\d+)\*\*/g,
    typeKey: 'boldNumber',
    typeName: '**数字**',
    extractNumber: (m) => parseInt(m[1] ?? '0', 10),
  },
  {
    regex: /^(\d+)\s*$/gm,
    typeKey: 'pureNumber',
    typeName: '纯数字',
    extractNumber: (m) => parseInt(m[1] ?? '0', 10),
  },
  {
    regex: /^#{1,3}\s+(.+)$/gm,
    typeKey: 'mdHeading',
    typeName: 'MD标题',
    extractNumber: () => 0,
  },
];

// ============================================================
// 内部工具
// ============================================================

/** 开篇块并入第一章的最小前缀长度（超过则独立「开篇」块） */
const PREFIX_MERGE_THRESHOLD = 200;
/** 触发标记检测的最短文本 */
const MIN_DETECT_LENGTH = 100;
/** 长度切兜底窗口（Plan#75：8-10k，块边界优先断换行） */
const LENGTH_CHUNK_MIN = 8000;
const LENGTH_CHUNK_MAX = 10000;
const LENGTH_CHUNK_TARGET = 9000;

interface MarkerMatch {
  index: number;
  number: number;
}

function getLineEndAt(content: string, pos: number): number {
  const idx = content.indexOf('\n', pos);
  return idx === -1 ? content.length : idx;
}

/** startLine 1-based：offset 前的换行数 + 1 */
function countLinesBefore(content: string, offset: number): number {
  let lines = 1;
  for (let i = 0; i < offset; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

function splitByLength(content: string): Array<{ startIndex: number; endIndex: number }> {
  const slices: Array<{ startIndex: number; endIndex: number }> = [];
  const n = content.length;
  let start = 0;
  while (start < n) {
    let end = Math.min(start + LENGTH_CHUNK_TARGET, n);
    if (end < n) {
      const nl = content.lastIndexOf('\n', Math.min(start + LENGTH_CHUNK_MAX, n) - 1);
      if (nl > start + LENGTH_CHUNK_MIN) {
        end = nl + 1;
      }
    }
    slices.push({ startIndex: start, endIndex: end });
    start = end;
  }
  return slices;
}

function buildAnchor(
  content: string,
  number: number,
  title: string,
  startIndex: number,
  endIndex: number,
): ChapterAnchor {
  const block = content.slice(startIndex, endIndex);
  const startLine = countLinesBefore(content, startIndex);
  const endLine = countLinesBefore(content, endIndex - 1) + 1;
  return {
    number,
    title,
    startIndex,
    endIndex,
    startLine,
    endLine,
    wordCount: countWords(block),
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 检测文本章节结构，返回锚点数组（正文不拆，索引制）。
 *
 * 策略：
 * 1. 11 种标记模式全扫，命中 ≥2 且最多者胜（waoowaoo 择优直译）；
 * 2. 无标记回退长度切（8-10k，块边界优先断换行），永不坍缩成单块长文。
 */
export function detectChapters(content: string): ChapterDetectResult {
  const empty: ChapterDetectResult = {
    hasMarkers: false,
    markerType: '',
    confidence: 'low',
    strategy: 'length',
    chapters: [],
  };
  if (!content) return empty;
  if (content.length < MIN_DETECT_LENGTH) {
    // 短文本不做标记检测，单块兜底
    return {
      hasMarkers: false,
      markerType: '',
      confidence: 'low',
      strategy: 'length',
      chapters: [buildAnchor(content, 1, content.slice(0, 30).trim() || '正文', 0, content.length)],
    };
  }

  // ---- 1. 标记模式择优 ----
  let best: MarkerMatch[] = [];
  let bestType = '';
  for (const pattern of DETECTION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    const matches: MarkerMatch[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      const number = pattern.extractNumber(m);
      // X-Y【场景】：同一集只记首次出现
      if (pattern.typeKey === 'scene' && matches.some((x) => x.number === number)) {
        continue;
      }
      matches.push({ index: m.index, number });
    }
    if (matches.length >= 2 && matches.length > best.length) {
      best = matches;
      bestType = pattern.typeName;
    }
  }

  if (best.length >= 2) {
    best.sort((a, b) => a.index - b.index);

    const matchCount = best.length;
    const avgDistance = matchCount > 1
      ? (best[matchCount - 1]!.index - best[0]!.index) / (matchCount - 1)
      : 0;
    const confidence: ChapterConfidence =
      matchCount >= 3 && avgDistance >= 500 && avgDistance <= 8000
        ? 'high'
        : 'medium';

    // ---- 2. 首标记前缀：短并入第一章，长独立「开篇」块 ----
    const first = best[0]!;
    const hasPrefixBlock = first.index > PREFIX_MERGE_THRESHOLD;

    const anchors: ChapterAnchor[] = [];
    if (hasPrefixBlock) {
      anchors.push(
        buildAnchor(content, 0, '开篇', 0, first.index),
      );
    }
    for (let i = 0; i < best.length; i++) {
      const cur = best[i]!;
      const next = i < best.length - 1 ? best[i + 1]! : null;
      const lineEnd = getLineEndAt(content, cur.index);
      const title = content.slice(cur.index, lineEnd).trim().slice(0, 50);
      // 首章并入前缀时起始为 0
      const startIndex = i === 0 && !hasPrefixBlock ? 0 : cur.index;
      const endIndex = next ? next.index : content.length;
      anchors.push(
        buildAnchor(content, cur.number, title, startIndex, endIndex),
      );
    }

    return {
      hasMarkers: true,
      markerType: bestType,
      confidence,
      strategy: 'marker',
      chapters: anchors,
    };
  }

  // ---- 3. 无标记：长度切兜底 ----
  const chunks = splitByLength(content);
  const anchors = chunks.map((c, i) => {
    const lineEnd = getLineEndAt(content, c.startIndex);
    const firstLine = content.slice(c.startIndex, lineEnd).trim();
    const title = (firstLine || `第 ${i + 1} 部分`).slice(0, 30);
    return buildAnchor(content, i + 1, title, c.startIndex, c.endIndex);
  });

  return {
    hasMarkers: false,
    markerType: '',
    confidence: 'low',
    strategy: 'length',
    chapters: anchors,
  };
}

/**
 * 按锚点切出正文块（引用原文切片，供需要 content 的调用方使用）
 */
export function splitByChapters(
  content: string,
  result: ChapterDetectResult,
): Array<{ number: number; title: string; content: string; wordCount: number }> {
  return result.chapters.map((c) => {
    const text = content.slice(c.startIndex, c.endIndex).trim();
    return {
      number: c.number,
      title: c.title || `第 ${c.number} 章`,
      content: text,
      wordCount: c.wordCount,
    };
  });
}
