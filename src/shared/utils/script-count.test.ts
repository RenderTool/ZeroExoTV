/**
 * script-count 统一字数口径单测（2026-11-04）
 * 覆盖：空内容、空标签、仅 &nbsp;、HTML 实体、中英混排、标点两档、超长段落、多段折叠。
 */
import { describe, expect, it } from 'vitest';
import { countScript, countScriptChars, normalizeScriptText } from './script-count';

describe('countScript 空内容/假数字防护', () => {
  it.each([
    ['空串', ''],
    ['undefined', undefined],
    ['null', null],
    ['空段落标签', '<p></p>'],
    ['带 class 的空标签（真实存储样例）', '<p class="script-action"></p>'],
    ['仅 &nbsp;', '<p>&nbsp;</p>'],
    ['多个 &nbsp;', '<p>&nbsp;&nbsp;&nbsp;</p>'],
    ['仅空白', '<p>   </p>'],
    ['仅换行', '<p>\n\n</p>'],
  ])('%s → 0 字', (_label, content) => {
    expect(countScriptChars(content)).toBe(0);
    expect(countScript(content)).toEqual({
      chars: 0, charsNoPunct: 0, cjkChars: 0, latinWords: 0, latinLetters: 0,
    });
  });
});

describe('countScript HTML 实体解码', () => {
  it('&amp; 只算 1 字（修前统计条算 5 字）', () => {
    expect(countScriptChars('<p>a &amp; b</p>')).toBe('a & b'.length);
  });
  it('&quot; / &#39; / &lt; / &gt; 均解码为 1 字', () => {
    expect(countScriptChars('<p>&quot;走&quot;</p>')).toBe(3);
    expect(countScriptChars('<p>it&#39;s</p>')).toBe(4);
    expect(countScriptChars('<p>1 &lt; 2 &gt; 0</p>')).toBe(9);
  });
});

describe('countScript 中英混排与两档口径', () => {
  it('中英混排：你好 world', () => {
    const s = countScript('<p>你好 world</p>');
    expect(s.chars).toBe(8);        // 你好(2) + 空格(1) + world(5)
    expect(s.charsNoPunct).toBe(8); // 无标点
    expect(s.cjkChars).toBe(2);
    expect(s.latinWords).toBe(1);
    expect(s.latinLetters).toBe(5);
  });
  it('含标点/不含标点两档', () => {
    const s = countScript('<p>你好，世界。</p>');
    expect(s.chars).toBe(6);        // 你好，世界。
    expect(s.charsNoPunct).toBe(4); // 你好世界
  });
});

describe('countScript 段落与空白折叠', () => {
  it('跨段文字不粘连，段间折为单空格', () => {
    expect(normalizeScriptText('<p>你好</p><p>世界</p>')).toBe('你好\n世界');
    expect(countScriptChars('<p>你好</p><p>世界</p>')).toBe(5); // "你好 世界"
  });
  it('连续空白折叠为一个并计入 1，首尾空白不计', () => {
    expect(countScriptChars('<p>  甲   乙  </p>')).toBe(3); // "甲 乙"
  });
  it('纯文本（导入预览源文本）同样适用', () => {
    expect(countScriptChars('第一集\n\n夜。客栈外。')).toBe('第一集 夜。客栈外。'.length);
  });
});

describe('countScript 超长段落', () => {
  it('1000 字长段落计数正确', () => {
    const long = '字'.repeat(1000);
    expect(countScriptChars(`<p>${long}</p>`)).toBe(1000);
    expect(countScript(`<p>${long}</p>`).cjkChars).toBe(1000);
  });
});
