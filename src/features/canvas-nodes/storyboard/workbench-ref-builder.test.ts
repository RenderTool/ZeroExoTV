/**
 * workbench-ref-builder + detectStaleRefs 纯函数单测（Plan#71 T6/T8）
 *
 * 守护 T6 引用回填（resolveShotMentions / buildRefsFromSource / buildPromptPreview）
 * 与 T8 失效检测矩阵（detectStaleRefs：换代⚠ / 删除🔴 / 改名不失效 / 用户上传不标红）。
 */
import { describe, expect, it, vi } from 'vitest';
// storyboard-utils 顶层 import @zeroexo/plugin-nodes（resolveContentUrl），vitest 无该 alias → mock 掉
vi.mock('@zeroexo/plugin-nodes', () => ({
  resolveContentUrl: vi.fn(async () => ''),
}));
import {
  resolveShotMentions,
  buildRefsFromSource,
  buildPromptPreview,
} from './workbench-ref-builder';
import { detectStaleRefs, extractSubjectMentions, collectSubjectSources } from './storyboard-utils';
import type { SubjectTree } from './subject-tree-types';

/** 构造一棵可直接用于 buildRefsFromSource 的 SubjectTree（宽松字段够用） */
function makeTree(over: Partial<SubjectTree>): SubjectTree {
  return {
    rootId: 'root-laozhang',
    name: '老张',
    kind: 'character',
    aliases: ['张爷'],
    baseState: {
      prompt: '模板',
      templateType: 'character_lineup',
      templateReason: 't',
      referenceImages: [{ key: 'res/base.png', type: 'image' }],
      aiStableKey: 'k',
    },
    states: [
      {
        id: 'st-injured',
        state: '受伤',
        type: 'image',
        deltaPrompt: '',
        fullPrompt: '',
        recognitionTerms: [],
        media: [{ key: 'res/injured.png', type: 'image' }],
        source: 'user',
        baseRef: 'root-laozhang',
      },
    ],
    ...over,
  };
}

describe('T6 resolveShotMentions —— @主体[-状态] 解析', () => {
  it('从 entities mention 与描述文本提取 name/state 并去重', () => {
    const mentions = resolveShotMentions(
      [{ mention: '老张-受伤' }, { mention: '老张' }, '古董店'],
      '只见@老张-受伤，望向@古董店',
    );
    expect(mentions).toContainEqual({ name: '老张', state: '受伤' });
    expect(mentions).toContainEqual({ name: '古董店' });
    // 老张-受伤 与 老张 视为不同条目（基础形态 + 受伤态）
    expect(mentions.filter((m) => m.name === '老张').length).toBe(2);
  });

  it('extractSubjectMentions 兼容 @名字-状态', () => {
    expect(extractSubjectMentions('@小刀-出鞘 飞向@老张')).toEqual([
      { name: '小刀', state: '出鞘' },
      { name: '老张' },
    ]);
  });
});

describe('T6 buildRefsFromSource —— 引用回填（指纹来源）', () => {
  it('主体树状态级引用：取状态图 mediaKey + origin=subject-state', () => {
    const refs = buildRefsFromSource(
      [{ name: '老张', state: '受伤' }],
      { subjectTrees: [makeTree({})] },
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: 'image',
      title: '老张-受伤',
      storageKey: 'res/injured.png',
      origin: {
        kind: 'subject-state',
        rootId: 'root-laozhang',
        nodeId: 'st-injured',
        state: '受伤',
        mediaKey: 'res/injured.png',
      },
    });
  });

  it('无状态 → 基础形态图 origin=subject-base', () => {
    const refs = buildRefsFromSource([{ name: '老张' }], { subjectTrees: [makeTree({})] });
    expect(refs[0]?.origin).toMatchObject({
      kind: 'subject-base',
      rootId: 'root-laozhang',
      mediaKey: 'res/base.png',
    });
  });

  it('状态已建但无图 → icon 占位卡（保留指纹可检测）', () => {
    const tree = makeTree({
      states: [{ id: 'st-young', state: '幼年', type: 'image', deltaPrompt: '', fullPrompt: '', recognitionTerms: [], media: [], source: 'user' as const, baseRef: 'root-laozhang' }],
    });
    const refs = buildRefsFromSource([{ name: '老张', state: '幼年' }], { subjectTrees: [tree] });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.storageKey).toBeUndefined();
    expect(refs[0]?.origin?.kind).toBe('subject-state');
    expect(refs[0]?.origin?.nodeId).toBe('st-young');
  });

  it('别名匹配（老张 的 aliases 命中 张爷）', () => {
    const refs = buildRefsFromSource([{ name: '张爷' }], { subjectTrees: [makeTree({})] });
    expect(refs[0]?.origin?.rootId).toBe('root-laozhang');
  });

  it('StoryboardEntity.referenceImages 兜底', () => {
    const refs = buildRefsFromSource([{ name: '古董店' }], {
      baseEntities: [{ id: 'ent-shop', name: '古董店', referenceImages: [{ storageKey: 'res/shop.png' }] }],
    });
    expect(refs[0]?.origin).toMatchObject({ kind: 'subject-base', rootId: 'ent-shop', mediaKey: 'res/shop.png' });
  });

  it('主体仅在 aiSubjects 有名无图 → 生成 icon 占位引用', () => {
    // 上游分镜行 entities=['男主','江边栈桥']，主体定义在 aiSubjects（无树无图）
    const refs = buildRefsFromSource([{ name: '男主' }, { name: '女主' }], {
      subjectTrees: [],
      baseEntities: [
        { id: 'ai:男主', name: '男主', aliases: [] },
        { id: 'ai:女主', name: '女主', aliases: [] },
      ],
    });
    expect(refs).toHaveLength(2);
    for (const r of refs) {
      expect(r.storageKey).toBeUndefined(); // 无图 → 占位卡（无 storageKey）
      expect(r.origin?.kind).toBe('subject-base');
      expect(r.title).toBeTruthy();
    }
  });

  it('aiSubjects 别名命中（实体 name 不匹配但 aliases 匹配）', () => {
    const refs = buildRefsFromSource([{ name: '茶馆' }], {
      baseEntities: [{ id: 'ai:老茶馆', name: '老茶馆', aliases: ['茶馆'] }],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.origin?.rootId).toBe('ai:老茶馆');
  });

  it('无匹配来源 → 不产生幽灵引用', () => {
    const refs = buildRefsFromSource([{ name: '不存在者' }], { subjectTrees: [makeTree({})] });
    expect(refs).toHaveLength(0);
  });
});

describe('T6 buildPromptPreview —— 提示词预填', () => {
  it('语义描述 + 参考映射行（@图片N 与 refs 顺序一致）', () => {
    const refs = buildRefsFromSource([{ name: '老张', state: '受伤' }], { subjectTrees: [makeTree({})] });
    const text = buildPromptPreview({ description: '老张带伤走出店铺' }, refs);
    expect(text).toContain('老张带伤走出店铺');
    expect(text).toContain('图1=@老张-受伤');
  });

  it('无语义无引用 → 空串', () => {
    expect(buildPromptPreview({}, [])).toBe('');
  });
});

describe('T8 detectStaleRefs —— 失效规则矩阵', () => {
  const subjects = [
    {
      rootId: 'root-laozhang',
      name: '老张',
      baseState: { referenceImages: [{ key: 'res/base-v2.png' }] },
      states: [
        { id: 'st-injured', state: '受伤', media: [{ key: 'res/injured-v2.png' }] },
      ],
    },
  ];

  it('基础形态图换代（mediaKey 不在最新 baseState）→ warn', () => {
    const results = detectStaleRefs({
      subjects,
      refs: [{ id: 'r1', origin: { kind: 'subject-base', rootId: 'root-laozhang', mediaKey: 'res/base-old.png' } }],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ refId: 'r1', level: 'warn' });
  });

  it('状态图换代 → warn；状态/树已删 → broken', () => {
    const results = detectStaleRefs({
      subjects,
      refs: [
        { id: 'r2', origin: { kind: 'subject-state', rootId: 'root-laozhang', nodeId: 'st-injured', mediaKey: 'res/injured-old.png' } },
        { id: 'r3', origin: { kind: 'subject-state', rootId: 'root-laozhang', nodeId: 'st-ghost' } },
        { id: 'r4', origin: { kind: 'subject-base', rootId: 'root-gone' } },
      ],
    });
    const byId = Object.fromEntries(results.map((r) => [r.refId, r.level]));
    expect(byId.r2).toBe('warn');
    expect(byId.r3).toBe('broken');
    expect(byId.r4).toBe('broken');
  });

  it('引用最新图（指纹一致）→ 不标红；user-upload / 无 origin → 永不标红', () => {
    const results = detectStaleRefs({
      subjects,
      refs: [
        { id: 'ok1', origin: { kind: 'subject-base', rootId: 'root-laozhang', mediaKey: 'res/base-v2.png' } },
        { id: 'ok2', origin: { kind: 'subject-state', rootId: 'root-laozhang', nodeId: 'st-injured', mediaKey: 'res/injured-v2.png' } },
        { id: 'up1', origin: { kind: 'user-upload' } },
        { id: 'no-origin' } as never,
      ],
    });
    expect(results).toHaveLength(0);
  });

  it('改名/别名/kind 变化不触发失效（以 rootId 关联）', () => {
    const results = detectStaleRefs({
      subjects: [{ ...subjects[0]!, name: '老张头', rootId: 'root-laozhang' }],
      refs: [{ id: 'ok3', origin: { kind: 'subject-base', rootId: 'root-laozhang', mediaKey: 'res/base-v2.png' } }],
    });
    expect(results).toHaveLength(0);
  });
});

describe('T4 collectSubjectSources —— subjectTree 并入（Spec §5.4 数据源）', () => {
  it('树 root → source（含 states），优先级高于同名的 entities/aiSubjects', () => {
    const tree: SubjectTree = {
      rootId: 'root-laozhang',
      name: '老张',
      kind: 'character',
      aliases: ['张爷'],
      baseState: { prompt: 'p', templateType: 'character_lineup', templateReason: 't', referenceImages: [{ key: 'k', type: 'image' }], aiStableKey: 'a' },
      states: [
        { id: 'st-injured', state: '受伤', type: 'image', deltaPrompt: '', fullPrompt: '', recognitionTerms: [], media: [{ key: 'm', type: 'image' }], source: 'user', baseRef: 'root-laozhang' },
      ],
    };
    const sources = collectSubjectSources([], undefined, undefined, [tree]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ name: '老张', id: 'root-laozhang', aliases: ['张爷'] });
    expect(sources[0]?.states).toEqual([{ id: 'st-injured', name: '受伤' }]);
  });

  it('只读 chip 的「状态被删」判定：树删掉受伤 → source.states 不含受伤', () => {
    const tree: SubjectTree = {
      rootId: 'root-laozhang',
      name: '老张',
      kind: 'character',
      aliases: [],
      baseState: { prompt: 'p', templateType: 'character_lineup', templateReason: 't', referenceImages: [{ key: 'k', type: 'image' }], aiStableKey: 'a' },
      states: [],
    };
    const sources = collectSubjectSources([], undefined, undefined, [tree]);
    expect(sources[0]?.states).toEqual([]);
  });

  it('同名 entity 被树覆盖（树优先），避免老 entities 的旧 states 干扰失效判定', () => {
    const tree: SubjectTree = {
      rootId: 'root-laozhang',
      name: '老张',
      kind: 'character',
      aliases: [],
      baseState: { prompt: 'p', templateType: 'character_lineup', templateReason: 't', referenceImages: [{ key: 'k', type: 'image' }], aiStableKey: 'a' },
      states: [{ id: 'st-injured', state: '受伤', type: 'image', deltaPrompt: '', fullPrompt: '', recognitionTerms: [], media: [{ key: 'm', type: 'image' }], source: 'user', baseRef: 'root-laozhang' }],
    };
    const oldEntity = { id: 'old-entity', name: '老张', kind: 'character' as const, description: '', states: [{ id: 'st-old', name: '已删状态', description: '', prompt: '', shots: [] }] };
    const sources = collectSubjectSources([oldEntity], undefined, undefined, [tree]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.id).toBe('root-laozhang');
    expect(sources[0]?.states).toEqual([{ id: 'st-injured', name: '受伤' }]);
  });
});
