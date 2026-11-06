import { describe, expect, it } from 'vitest';
import {
  chineseToNumber,
  countWords,
  detectChapters,
  splitByChapters,
} from './episode-marker-detector';

describe('chineseToNumber 完整进位', () => {
  it('基础数字', () => {
    expect(chineseToNumber('一')).toBe(1);
    expect(chineseToNumber('九')).toBe(9);
    expect(chineseToNumber('十')).toBe(10);
  });

  it('十位组合', () => {
    expect(chineseToNumber('二十')).toBe(20);
    expect(chineseToNumber('二十三')).toBe(23);
    expect(chineseToNumber('九十九')).toBe(99);
  });

  it('百位/千位进位', () => {
    expect(chineseToNumber('一百二十三')).toBe(123);
    expect(chineseToNumber('二百零五')).toBe(205);
    expect(chineseToNumber('一千二百三十四')).toBe(1234);
    expect(chineseToNumber('一千零一')).toBe(1001);
  });

  it('无「一」前缀单位开头（十/百/千直接开头）', () => {
    expect(chineseToNumber('十五')).toBe(15);
    expect(chineseToNumber('百二十三')).toBe(123);
  });

  it('大写与两', () => {
    expect(chineseToNumber('壹佰贰拾叁')).toBe(123);
    expect(chineseToNumber('两千')).toBe(2000);
    expect(chineseToNumber('〇')).toBe(0);
  });

  it('纯阿拉伯数字直通', () => {
    expect(chineseToNumber('42')).toBe(42);
  });
});

describe('countWords（waoowaoo 规则）', () => {
  it('英文按词、中文按字', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('你好世界')).toBe(4);
    expect(countWords('第3章 hello 你好')).toBe(6);
  });
});

describe('detectChapters 标记择优', () => {
  it('第一百二十三章 正确切号', () => {
    const text = [
      '第一章 开始',
      '内容a'.repeat(40),
      '第二章 发展',
      '内容b'.repeat(40),
      '第一百二十三章 结局',
      '内容c'.repeat(40),
    ].join('\n\n');
    const rst = detectChapters(text);
    expect(rst.hasMarkers).toBe(true);
    expect(rst.strategy).toBe('marker');
    expect(rst.markerType).toBe('第X章');
    expect(rst.chapters).toHaveLength(3);
    expect(rst.chapters[2]!.number).toBe(123);
    expect(rst.chapters[2]!.startLine).toBe(9);
  });

  it('阿拉伯数字编号 1. 标题', () => {
    const text = Array.from({ length: 5 }, (_, i) => `${i + 1}. 第${i + 1}节标题\n${'x'.repeat(200)}`).join('\n\n');
    const rst = detectChapters(text);
    expect(rst.hasMarkers).toBe(true);
    expect(rst.markerType).toBe('数字编号');
    expect(rst.chapters).toHaveLength(5);
    expect(rst.chapters[3]!.number).toBe(4);
  });

  it('英文 Chapter', () => {
    const text = Array.from({ length: 3 }, (_, i) => `Chapter ${i + 1}: Title\n${'y'.repeat(200)}`).join('\n\n');
    const rst = detectChapters(text);
    expect(rst.hasMarkers).toBe(true);
    expect(rst.markerType).toBe('Chapter X');
    expect(rst.chapters.map((c) => c.number)).toEqual([1, 2, 3]);
  });

  it('纯数字单独一行', () => {
    const text = Array.from({ length: 4 }, (_, i) => `${i + 1}\n${'z'.repeat(200)}`).join('\n\n');
    const rst = detectChapters(text);
    expect(rst.hasMarkers).toBe(true);
    expect(rst.chapters.map((c) => c.number)).toEqual([1, 2, 3, 4]);
  });

  it('短前缀并入第一章（不产生「开篇」块）', () => {
    const text = `序言\n${'p'.repeat(150)}\n\n第一章 起点\n${'c'.repeat(200)}\n\n第二章 终点\n${'d'.repeat(200)}`;
    const rst = detectChapters(text);
    expect(rst.chapters).toHaveLength(2);
    expect(rst.chapters[0]!.startIndex).toBe(0);
    expect(rst.chapters[0]!.number).toBe(1);
  });

  it('长前缀独立「开篇」块（number=0）', () => {
    const text = `楔子\n${'p'.repeat(300)}\n\n第一章 起点\n${'c'.repeat(200)}\n\n第二章 终点\n${'d'.repeat(200)}`;
    const rst = detectChapters(text);
    expect(rst.chapters).toHaveLength(3);
    expect(rst.chapters[0]!.number).toBe(0);
    expect(rst.chapters[0]!.title).toBe('开篇');
    expect(rst.chapters[1]!.number).toBe(1);
  });

  it('X-Y【场景】同集去重', () => {
    const text = [
      '1-1【教室】',
      '内容a'.repeat(40),
      '1-2【操场】',
      '内容b'.repeat(40),
      '2-1【走廊】',
      '内容c'.repeat(40),
    ].join('\n\n');
    const rst = detectChapters(text);
    expect(rst.hasMarkers).toBe(true);
    expect(rst.chapters.map((c) => c.number)).toEqual([1, 2]);
  });
});

describe('detectChapters 长度切兜底（不坍缩）', () => {
  it('无标记长文切多块，边界断换行', () => {
    const para = `${'无标记长文本内容。'.repeat(120)}\n\n`;
    const text = para.repeat(60);
    const rst = detectChapters(text);
    expect(rst.hasMarkers).toBe(false);
    expect(rst.strategy).toBe('length');
    expect(rst.chapters.length).toBeGreaterThan(1);
    // 锚点连续覆盖全文
    expect(rst.chapters[0]!.startIndex).toBe(0);
    expect(rst.chapters[rst.chapters.length - 1]!.endIndex).toBe(text.length);
    for (let i = 1; i < rst.chapters.length; i++) {
      expect(rst.chapters[i]!.startIndex).toBe(rst.chapters[i - 1]!.endIndex);
    }
  });

  it('短文本单块兜底', () => {
    const rst = detectChapters('很短的文本');
    expect(rst.chapters).toHaveLength(1);
    expect(rst.chapters[0]!.number).toBe(1);
  });

  it('空文本零块', () => {
    const rst = detectChapters('');
    expect(rst.chapters).toHaveLength(0);
  });
});

describe('锚点完整性（正文不拆，索引制）', () => {
  it('marker 锚点连续无缝覆盖全文', () => {
    const text = [
      '第一章 甲',
      'c'.repeat(300),
      '第二章 乙',
      'd'.repeat(300),
    ].join('\n\n');
    const rst = detectChapters(text);
    const anchors = rst.chapters;
    expect(anchors[0]!.startIndex).toBe(0);
    expect(anchors[anchors.length - 1]!.endIndex).toBe(text.length);
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i]!.startIndex).toBe(anchors[i - 1]!.endIndex);
    }
  });

  it('startLine/endLine 单调递增且与换行计数一致', () => {
    const text = [
      '第一章 甲',
      'c'.repeat(50),
      '',
      '第二章 乙',
      'd'.repeat(50),
    ].join('\n');
    const rst = detectChapters(text);
    expect(rst.chapters[0]!.startLine).toBe(1);
    expect(rst.chapters[1]!.startLine).toBe(4);
    expect(rst.chapters[1]!.endLine).toBe(rst.chapters[0]!.endLine + 2);
  });

  it('splitByChapters 可回切正文', () => {
    const text = [
      '第一章 甲',
      '甲'.repeat(300),
      '第二章 乙',
      '乙'.repeat(300),
    ].join('\n\n');
    const rst = detectChapters(text);
    const blocks = splitByChapters(text, rst);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.content).toContain('甲');
    expect(blocks[1]!.content).toContain('乙');
  });
});
