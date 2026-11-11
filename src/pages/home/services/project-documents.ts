/**
 * 项目 ZIP 的阅读视图生成器（C-05 / S-21）
 *
 * MD 只作阅读视图：HTML 剧本块带 INT./EXT.、分页、segments，主体树带 deriveFrom /
 * mediaHistory / aiStableKey，纯 Markdown 无法无损表达。因此每个 MD 目录都伴生一份
 * 无损 JSON，导入一律以 JSON 为准，MD 仅供人阅读与版本比对。
 */
import type { ScriptEntity } from '@/entities/script-store.js';
import type { StoryboardContainer } from '@/entities/slot-containers.js';
import { migrateSubjectTrees } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';

export interface ExportDocument { path: string; content: string }

const READ_NOTE = '<!-- 阅读用 Markdown；完整结构与无损数据以同目录 JSON 为准 -->';
const STORAGE_KEY_PREFIX = /^(image|video|audio|cas):/;

/**
 * 递归收集实体里的全部 storage key。
 * 主体的 media[].key / coverKey / mediaHistory / workbench 的 mediaKey 字段名各异，
 * 按值前缀扫描比枚举字段名稳，新增字段不会漏。
 */
export function collectStorageKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (STORAGE_KEY_PREFIX.test(value)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStorageKeys(v, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStorageKeys(v, out);
  }
  return out;
}

export function safeDocumentName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || '未命名';
}

function decodeHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** HTML 剧本块 → Markdown 行（角色块与紧随的台词块合成「角色：台词」） */
export function scriptHtmlToMarkdownLines(html: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  let pendingSpeaker = '';
  let matched = false;
  for (const m of html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    matched = true;
    const cls = /class=["']([^"']*)["']/i.exec(m[1] ?? '')?.[1] ?? '';
    const kind = /script-([a-z-]+)/.exec(cls)?.[1] ?? '';
    const text = decodeHtml(m[2] ?? '');
    if (kind === 'page-break') { out.push('', '---', ''); continue; }
    if (kind === 'character') { pendingSpeaker = text; continue; }
    if (kind === 'dialogue') {
      out.push(pendingSpeaker ? `${pendingSpeaker}：${text}` : text);
      pendingSpeaker = '';
      continue;
    }
    if (kind === 'scene-heading') { out.push('', `### ${text}`, ''); continue; }
    if (kind === 'parenthetical') { out.push(`（${text}）`); continue; }
    if (kind === 'transition') { out.push(`转场：${text}`); continue; }
    if (text) out.push(text);
  }
  if (!matched) return html.split(/\r?\n/).map(decodeHtml).filter(Boolean);
  return out;
}

/** 每集一个 MD；文件名带集号，避免同名集覆盖 */
export function scriptEntityToMarkdown(script: ScriptEntity): ExportDocument[] {
  return script.episodes.map((ep) => {
    const head = [READ_NOTE, '', `# ${script.title || '剧本'}`, ''];
    if (script.meta?.logline) head.push(`> ${script.meta.logline}`, '');
    if (script.meta?.tags?.length) head.push(`标签：${script.meta.tags.join('、')}`, '');
    head.push(`## 第${ep.number}集：${ep.title || '未命名'}`, '');
    if (ep.meta?.logline) head.push(`一句话概述：${ep.meta.logline}`);
    if (ep.meta?.tags?.length) head.push(`标签：${ep.meta.tags.join('、')}`);
    if (ep.meta?.publishNote) head.push(`发布建议：${ep.meta.publishNote}`);
    if (ep.meta) head.push('');
    return {
      path: `EP${String(ep.number).padStart(2, '0')}_${safeDocumentName(ep.title || '未命名')}.md`,
      content: [...head, ...scriptHtmlToMarkdownLines(ep.content), ''].join('\n'),
    };
  });
}

interface SubjectLike extends Record<string, unknown> {
  rootId?: string;
  itemId?: string;
  name?: string;
  kind?: string;
  aliases?: string[];
  identityAnchor?: string;
  coverKey?: string;
  states?: Array<Record<string, unknown>>;
}

const STATE_LABELS: Record<string, string> = {
  id: '节点 ID', state: '状态', type: '类型', step: '序号', deriveFrom: '派生自',
  deltaPrompt: '增量提示词', fullPrompt: '完整提示词', recognitionTerms: '识别词',
  media: '媒体', mediaHistory: '媒体历史', textContent: '文本内容', source: '来源',
  aiStableKey: '稳定键', baseRef: '基础引用', usage: '用途', linked: '关联',
  generationPriority: '生成优先级', appearEpisodes: '出场集数',
  templateType: '模板类型', templateReason: '模板理由',
};

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join('；');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function subjectToMarkdown(tree: SubjectLike, entities: unknown[]): string {
  const lines = [READ_NOTE, '', `# ${tree.name || tree.rootId || '未命名主体'}`, ''];
  const basics: Array<[string, unknown]> = [
    ['标识', tree.rootId], ['类型', tree.kind], ['关联条目', tree.itemId],
    ['别名', Array.isArray(tree.aliases) ? tree.aliases.join('、') : undefined],
    ['身份锚点', tree.identityAnchor], ['封面', tree.coverKey],
  ];
  for (const [label, value] of basics) {
    if (value !== undefined && value !== null && value !== '') lines.push(`- ${label}：${formatValue(value)}`);
  }
  lines.push('');

  const item = entities.find((e) => (e as { id?: string } | null)?.id === tree.itemId) as Record<string, unknown> | undefined;
  if (item) {
    lines.push('## 主体条目', '');
    for (const [key, label] of [['name', '名称'], ['kind', '类型'], ['consistency', '一致性'], ['note', '备注'], ['coverKey', '封面'], ['episodeIds', '关联集数'], ['images', '图片']] as const) {
      const value = item[key];
      if (value !== undefined && value !== null && value !== '') lines.push(`- ${label}：${formatValue(value)}`);
    }
    lines.push('');
  }

  for (const [index, state] of (tree.states ?? []).entries()) {
    lines.push(`## 形态 ${index + 1}`, '');
    for (const [key, value] of Object.entries(state)) {
      if (value === undefined || value === null || value === '') continue;
      lines.push(`- ${STATE_LABELS[key] ?? key}：${formatValue(value)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 每个主体一个 MD；主体树先归一化，兼容旧结构 */
export function storyboardToSubjectMarkdown(container: StoryboardContainer): ExportDocument[] {
  const trees = (migrateSubjectTrees(container.subjectTree as never) ?? []) as unknown as SubjectLike[];
  return trees.map((tree, index) => ({
    path: `${String(index + 1).padStart(2, '0')}_${safeDocumentName(tree.name || tree.rootId || '未命名')}.md`,
    content: subjectToMarkdown(tree, container.entities),
  }));
}
