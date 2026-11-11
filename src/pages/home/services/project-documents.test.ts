/** 项目包阅读视图回归（C-05）：剧本 HTML→MD、主体→MD、CAS 键收集 */
import { describe, expect, it } from 'vitest';
import {
  collectStorageKeys,
  scriptEntityToMarkdown,
  scriptHtmlToMarkdownLines,
  storyboardToSubjectMarkdown,
} from './project-documents.js';
import type { ScriptEntity } from '@/entities/script-store.js';
import type { StoryboardContainer } from '@/entities/slot-containers.js';

const script: ScriptEntity = {
  schemaVersion: 1,
  version: 3,
  title: '测试剧',
  activeEpisodeId: 'ep1',
  episodes: [{
    id: 'ep1', number: 2, title: '第二集/重逢', status: 'active',
    content: [
      '<p class="script-scene-heading">INT. 客厅 - 日</p>',
      '<p class="script-action">他走进来。</p>',
      '<p class="script-character">小明</p>',
      '<p class="script-dialogue">你好 &amp; 再见</p>',
      '<p class="script-parenthetical">轻声</p>',
      '<p class="script-transition">切至</p>',
      '<p class="script-page-break"></p>',
    ].join(''),
    meta: { logline: '重逢', tags: ['都市'], publishNote: '建议周末发' },
  }],
  meta: { logline: '本剧概述', tags: ['群像'] },
  sourceInfo: { origin: 'created', createdBy: 'editor-page' },
  updatedAt: '2026-11-11T00:00:00.000Z',
};

describe('剧本 HTML → Markdown', () => {
  it('块类型映射、实体解码、角色+台词合成、分页', () => {
    const lines = scriptHtmlToMarkdownLines(script.episodes[0]!.content);
    expect(lines).toContain('### INT. 客厅 - 日');
    expect(lines).toContain('他走进来。');
    expect(lines).toContain('小明：你好 & 再见');
    expect(lines).toContain('（轻声）');
    expect(lines).toContain('转场：切至');
    expect(lines).toContain('---');
  });

  it('每集一个 MD，文件名安全化，带剧名/集号/元信息与阅读声明', () => {
    const docs = scriptEntityToMarkdown(script);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.path).toBe('EP02_第二集_重逢.md');
    expect(docs[0]!.content).toContain('# 测试剧');
    expect(docs[0]!.content).toContain('## 第2集：第二集/重逢');
    expect(docs[0]!.content).toContain('本剧概述');
    expect(docs[0]!.content).toContain('发布建议：建议周末发');
    expect(docs[0]!.content).toContain('阅读用 Markdown');
  });

  it('纯文本剧本按行保留', () => {
    expect(scriptHtmlToMarkdownLines('第一行\n第二行')).toEqual(['第一行', '第二行']);
  });
});

describe('主体 → Markdown', () => {
  const container = {
    schemaVersion: 1,
    version: 1,
    title: '主体库',
    shots: [],
    entities: [{ id: 'item-1', name: '阿青', kind: '角色', coverKey: 'cas:cover.png' }],
    subjectTree: [{
      rootId: 'root-1', itemId: 'item-1', name: '阿青/主角', kind: '角色',
      aliases: ['小青'], identityAnchor: '绿发',
      states: [{
        id: '__base__', state: '基础形态', fullPrompt: '绿发少女',
        media: [{ key: 'cas:aaa.png', type: 'image' }],
      }],
    }],
    updatedAt: '2026-11-11T00:00:00.000Z',
  } as unknown as StoryboardContainer;

  it('每主体一个 MD，含条目信息、状态字段与媒体键', () => {
    const docs = storyboardToSubjectMarkdown(container);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.path).toBe('01_阿青_主角.md');
    const body = docs[0]!.content;
    expect(body).toContain('# 阿青/主角');
    expect(body).toContain('身份锚点：绿发');
    expect(body).toContain('## 主体条目');
    expect(body).toContain('名称：阿青');
    expect(body).toContain('完整提示词：绿发少女');
    expect(body).toContain('cas:aaa.png');
  });
});

describe('collectStorageKeys（主体图/产出 CAS 不在 graph 里）', () => {
  it('按值前缀递归收集，字段名不同也能抓到', () => {
    const keys = collectStorageKeys({
      media: [{ key: 'cas:aaa.png' }],
      coverKey: 'image:cover',
      nested: { deep: [{ mediaKey: 'video:clip.mp4', other: 'cas:bbb.jpg' }] },
      noise: '普通文本',
    });
    expect([...keys].sort()).toEqual(['cas:aaa.png', 'cas:bbb.jpg', 'image:cover', 'video:clip.mp4']);
  });
});
