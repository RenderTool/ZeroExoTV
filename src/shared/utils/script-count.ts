/**
 * 剧本字数统计·全仓唯一口径（2026-11-04 拍板统一）
 *
 * 背景：此前统计条 / 节点状态栏 / 编辑器底栏 / 剧本卡片 / 导入预览各写一套
 * `.replace(/<[^>]*>/g, '').length`，差异点有三：
 *   1. HTML 实体未解码——用户输入 `&` 序列化为 `&amp;`，被算成 5 字（"对不上"的主因）；
 *   2. 空白处理不一致——统计条保留内部空白、卡片删全部空白、编辑器按行文本求和；
 *   3. 解码集合不一致——卡片漏解 `&quot;`/`&#39;`。
 *
 * 定死口径（可见正文字数）：
 *   去 HTML 标签（标签位记一个换行，避免跨段文字粘连）
 *   → 解码 HTML 实体（&nbsp; &lt; &gt; &quot; &#39; &amp;）
 *   → 连续空白（含换行）折叠为一个空格，首尾空白不计
 *   → 对折叠后的文本取 length（标点计入）。
 * 纯空白 / 空标签（<p></p>）/ 仅 &nbsp; 一律为 0。
 *
 * 不改存储格式：episode.content 仍是编辑器产出的 HTML 序列化字符串，
 * 所有"N 字"显示必须经本模块统计，禁止各处自写 length 口径。
 */

export interface ScriptCountStats {
  /** 可见正文字数（含标点）——统计条/卡片/底栏默认展示这一档 */
  chars: number;
  /** 可见正文字数（不含标点）——辅助档（如 tooltip） */
  charsNoPunct: number;
  /** 中文汉字数（CJK 统一表意文字） */
  cjkChars: number;
  /** 英文/数字按词计 */
  latinWords: number;
  /** 英文按字母计 */
  latinLetters: number;
}

const ZERO: ScriptCountStats = { chars: 0, charsNoPunct: 0, cjkChars: 0, latinWords: 0, latinLetters: 0 };

/**
 * HTML 序列化剧本内容 → 规范化可见文本（保留单换行作为段落分隔）。
 * 也用于卡片摘要、空集判定等"取纯文本"场景，保证与字数统计同源。
 */
export function normalizeScriptText(content: string | null | undefined): string {
  if (!content) return '';
  return content
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 全量统计。content 可为 HTML 序列化串或纯文本（导入预览的源文本）。 */
export function countScript(content: string | null | undefined): ScriptCountStats {
  // 段落换行与其余空白统一折叠为单空格后再计数：换行符本身不算字
  const text = normalizeScriptText(content).replace(/\s+/g, ' ').trim();
  if (!text) return ZERO;
  return {
    chars: text.length,
    charsNoPunct: text.replace(/\p{P}/gu, '').length,
    cjkChars: (text.match(/\p{Script=Han}/gu) ?? []).length,
    latinWords: (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length,
    latinLetters: (text.match(/[A-Za-z]/g) ?? []).length,
  };
}

/** 可见正文字数（含标点）——所有"N 字"显示入口的统一取值。 */
export function countScriptChars(content: string | null | undefined): number {
  return countScript(content).chars;
}
