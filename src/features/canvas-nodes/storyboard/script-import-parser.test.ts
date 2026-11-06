/**
 * script-import-parser 单测（2026-11-04）
 * 覆盖：编码双通道（UTF-8 / GBK）、空文件拒绝、格式嗅探（内容+扩展名双判定）、
 * markdown 集/场切分、特殊剧本格式（场号/人物/对白/括注/转场）、
 * 普通文本兜底、无法识别内容零丢失。
 */
import { describe, it, expect } from 'vitest';
import {
  decodeScriptBuffer, detectScriptFormat, parseScriptImport,
  ScriptImportEmptyError,
} from './script-import-parser.js';
import { countScriptChars } from '@/shared/utils/script-count.js';

// ---------- 编码 ----------

describe('编码解码', () => {
  it('UTF-8 字节 → encoding=utf-8，文本正确', () => {
    const buf = new TextEncoder().encode('内景 老张家 - 夜\n老张：狼来了。').buffer as ArrayBuffer;
    const { text, encoding } = decodeScriptBuffer(buf);
    expect(encoding).toBe('utf-8');
    expect(text).toContain('老张家');
  });

  it('GBK 字节（非合法 UTF-8）→ 回落 gb18030，中文不乱码', () => {
    // 「INT. 老张家」的 GBK 字节：老=C0CF 张=D5C5 家=BCD2
    const gbk = new Uint8Array([0x49, 0x4e, 0x54, 0x2e, 0x20, 0xc0, 0xcf, 0xd5, 0xc5, 0xbc, 0xd2]);
    const { text, encoding } = decodeScriptBuffer(gbk.buffer as ArrayBuffer);
    expect(encoding).toBe('gb18030');
    expect(text).toBe('INT. 老张家');
  });

  it('GBK 解码结果可直接参与解析（特殊剧本格式识别不受影响）', () => {
    // 「第一场」GBK：第=B5DA 一=D2BB 场=B3A1
    const gbk = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xb3, 0xa1, 0x0a, 0xc0, 0xcf, 0xd5, 0xc5, 0xa3, 0xba, 0xc0, 0xc7, 0xc0, 0xb4, 0xc1, 0xcb, 0xa1, 0xa3]);
    const decoded = decodeScriptBuffer(gbk.buffer as ArrayBuffer);
    expect(decoded.encoding).toBe('gb18030');
    expect(decoded.text).toBe('第一场\n老张：狼来了。');
    const parsed = parseScriptImport({ filename: 'a.txt', text: decoded.text, encoding: decoded.encoding });
    expect(parsed.stats.sceneCount).toBeGreaterThanOrEqual(1);
  });

  it('空文件（0 字节）拒绝', () => {
    expect(() => decodeScriptBuffer(new ArrayBuffer(0))).toThrow(ScriptImportEmptyError);
  });

  it('纯空白文件拒绝', () => {
    const buf = new TextEncoder().encode('  \n\t \r\n ').buffer as ArrayBuffer;
    expect(() => decodeScriptBuffer(buf)).toThrow(ScriptImportEmptyError);
    expect(() => parseScriptImport({ filename: 'a.md', text: '   \n  ' })).toThrow(ScriptImportEmptyError);
  });
});

// ---------- 格式嗅探 ----------

describe('格式嗅探（内容嗅探 + 扩展名双判定）', () => {
  it('.md 扩展名 + 无标题内容 → markdown', () => {
    expect(detectScriptFormat('剧本.md', '一段没有标题的正文。')).toBe('markdown');
  });

  it('.markdown 扩展名 → markdown', () => {
    expect(detectScriptFormat('剧本.markdown', '正文。')).toBe('markdown');
  });

  it('.txt 含 md 标题 → 内容嗅探判为 markdown', () => {
    expect(detectScriptFormat('剧本.txt', '# 第一集\n正文。')).toBe('markdown');
  });

  it('场号 ≥2 → screenplay（即使扩展名是 .md）', () => {
    const text = 'INT. 老张家 - 夜\n老张坐在灯下。\nEXT. 村口 - 夜\n狼群靠近。';
    expect(detectScriptFormat('剧本.md', text)).toBe('screenplay');
  });

  it('场号 + 对白共现 → screenplay', () => {
    const text = '第一场 老张家\n老张：狼来了。\n猎人：别出声。';
    expect(detectScriptFormat('剧本.txt', text)).toBe('screenplay');
  });

  it('无任何标记的 .txt → plain', () => {
    expect(detectScriptFormat('剧本.txt', '夜很深。\n村子静悄悄的。')).toBe('plain');
  });
});

// ---------- markdown 解析 ----------

describe('markdown 解析（# 集 / ## ### 场）', () => {
  const md = [
    '# 第一集',
    '## 第一场 老张家',
    '老张坐在灯下补网。',
    '老张：狼又来了。',
    '## 第二场 村口',
    '猎人们聚在槐树下。',
    '# 第二集',
    '### 内景 祠堂',
    '众人议事。',
  ].join('\n');

  it('H1 切集、H2/H3 切场、统计正确', () => {
    const r = parseScriptImport({ filename: 's.md', text: md });
    expect(r.format).toBe('markdown');
    expect(r.stats.episodeCount).toBe(2);
    // 场 = 场景标题块：第一集(H1+2×H2)=3，第二集(H1+1×H3)=2
    expect(r.stats.sceneCount).toBe(5);
    expect(r.stats.characterCount).toBe(1); // 老张
    // 2026-11-04：字符数统一为 countScriptChars 可见字数口径（折叠空白、含标点），不再等于原始 text.length
    expect(r.stats.charCount).toBe(countScriptChars(md));
    expect(r.episodes[0]!.title).toBe('第一集');
    expect(r.episodes[1]!.title).toBe('第二集');
  });

  it('正文行复用剧本行分类器（对白拆分）', () => {
    const r = parseScriptImport({ filename: 's.md', text: md });
    expect(r.episodes[0]!.characters).toContain('老张');
    expect(r.episodes[0]!.html).toContain('script-dialogue');
    expect(r.episodes[0]!.html).toContain('狼又来了。');
  });

  it('H1 之前的内容归入「开篇」集', () => {
    const r = parseScriptImport({ filename: 's.md', text: '引子一段。\n# 第一集\n正文。' });
    expect(r.stats.episodeCount).toBe(2);
    expect(r.episodes[0]!.title).toBe('开篇');
  });

  it('无标题的 .md → 单集', () => {
    const r = parseScriptImport({ filename: 's.md', text: '只有正文，没有标题。' });
    expect(r.stats.episodeCount).toBe(1);
  });

  it('预览样例行为源文本前 6 个非空行', () => {
    const r = parseScriptImport({ filename: 's.md', text: md });
    expect(r.sampleLines).toEqual(['# 第一集', '## 第一场 老张家', '老张坐在灯下补网。', '老张：狼又来了。', '## 第二场 村口', '猎人们聚在槐树下。']);
  });
});

// ---------- 特殊剧本格式解析 ----------

describe('特殊剧本格式解析（场号/人物/对白/括注/转场）', () => {
  const screenplay = [
    'INT. 老张家 - 夜',
    '老张坐在灯下补网，火塘余烬微亮。',
    '老张',
    '（低声）',
    '狼又来了。',
    '猎人：别出声，听动静。',
    'EXT. 村口 - 夜',
    '群狼伏在暗处。',
    'CUT TO:',
  ].join('\n');

  it('识别为 screenplay，场次数=2', () => {
    const r = parseScriptImport({ filename: 's.txt', text: screenplay });
    expect(r.format).toBe('screenplay');
    expect(r.stats.sceneCount).toBe(2);
  });

  it('独立角色行 + 括注 + 对白逐行归属', () => {
    const r = parseScriptImport({ filename: 's.txt', text: screenplay });
    const html = r.episodes[0]!.html;
    expect(html).toContain('<p class="script-character">老张</p>');
    expect(html).toContain('<p class="script-parenthetical">（低声）</p>');
    expect(html).toContain('<p class="script-dialogue">狼又来了。</p>');
    expect(r.stats.characterCount).toBe(2); // 老张、猎人
  });

  it('「角色名: 对白」单行拆分，行首（…）拆为括注', () => {
    const r = parseScriptImport({ filename: 's.txt', text: '第一场\n老张：（低声）狼来了。' });
    const html = r.episodes[0]!.html;
    expect(html).toContain('<p class="script-character">老张</p>');
    expect(html).toContain('<p class="script-parenthetical">（低声）</p>');
    expect(html).toContain('<p class="script-dialogue">狼来了。</p>');
  });

  it('中文场号【场景 N: …】剥前缀保留地点时间', () => {
    const r = parseScriptImport({ filename: 's.txt', text: '【场景 1: 内景 老张家 - 夜】\n老张坐在灯下。\n【场景 2: 外景 村口 - 夜】\n狼群靠近。' });
    expect(r.format).toBe('screenplay');
    expect(r.stats.sceneCount).toBe(2);
    expect(r.episodes[0]!.html).toContain('内景 老张家 - 夜');
  });

  it('「第一场」整行作场景标题', () => {
    const r = parseScriptImport({ filename: 's.txt', text: '第一场 老张家 夜\n老张坐在灯下。' });
    expect(r.episodes[0]!.html).toContain('<p class="script-scene-heading">第一场 老张家 夜</p>');
  });

  it('转场行识别', () => {
    const r = parseScriptImport({ filename: 's.txt', text: screenplay });
    expect(r.episodes[0]!.html).toContain('<p class="script-transition">CUT TO</p>');
  });

  it('无法识别的段落整体保留为动作正文，零丢内容', () => {
    const weird = 'INT. 老张家 - 夜\n{某种未定义标记}\n※ 这是一行谁也没见过的格式 ※';
    const r = parseScriptImport({ filename: 's.txt', text: weird });
    for (const line of weird.split('\n')) {
      expect(r.textAll).toContain(line.trim());
    }
    expect(r.episodes[0]!.html).toContain('<p class="script-action">{某种未定义标记}</p>');
    expect(r.episodes[0]!.html).toContain('<p class="script-action">※ 这是一行谁也没见过的格式 ※</p>');
  });
});

// ---------- 普通文本解析 ----------

describe('普通文本解析（空行与场次标记启发式）', () => {
  it('无标记文本全部保留为动作正文', () => {
    const text = '夜很深。\n\n村子静悄悄的，只有狗吠。\n\n老张睡不着。';
    const r = parseScriptImport({ filename: 's.txt', text });
    expect(r.format).toBe('plain');
    expect(r.stats.episodeCount).toBe(1);
    expect(r.stats.sceneCount).toBe(0);
    for (const line of ['夜很深。', '村子静悄悄的，只有狗吠。', '老张睡不着。']) {
      expect(r.textAll).toContain(line);
    }
  });

  it('普通文本里出现场次标记则按场切分', () => {
    const text = '第一场\n老张出场。\n\n第二场\n猎人出场。';
    const r = parseScriptImport({ filename: 's.txt', text });
    expect(r.stats.sceneCount).toBe(2);
  });
});
