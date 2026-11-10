/**
 * subject-state-media 单测（2026-11-04 资产→主体状态关联）
 *
 * 断言范围（对应约定的验收项）：
 * 1. 唯一写入函数：画布右键弹层与主体库状态卡两个入口都调用 linkSubjectStateMedia（fs 契约断言）
 * 2. 写入后主体状态字段正确（首槽替换语义、origin 透传、type 随 kind）
 * 3. 替换时旧引用释放（releaseCas）、新引用登记（registerCasRef）、同 key 重挂不重复记账
 * 4. 移除（null）清空媒体并释放引用，返回被移除项供撤销
 * 5. 找不到目标状态 throw（不静默失败）
 * 6. 双向可见查询 findSubjectMediaUsage
 * 7. 视频不可选：use-node-actions 对 video 资产 disabled（fs 契约断言）
 * 8. 新状态默认名带形象名称前缀 / createSubjectNode 默认 appearEpisodes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ===== mock cas-store：只捕获记账调用，parse/is 按真实语义实现 =====
const registerCalls: Array<{ hash: string; ref: Record<string, unknown> }> = [];
const releaseCalls: Array<{ hash: string; ref: Record<string, unknown> }> = [];
vi.mock('@/entities/cas-store.js', () => ({
  isCasStorageKey: (key: string | undefined | null): boolean =>
    typeof key === 'string' && key.startsWith('cas:'),
  parseCasStorageKey: (key: string | undefined | null): { hash: string; ext: string } | null => {
    if (typeof key !== 'string' || !key.startsWith('cas:')) return null;
    const m = key.slice(4).match(/^([0-9a-f]+)\.(\w+)$/);
    return m ? { hash: m[1] as string, ext: m[2] as string } : null;
  },
  registerCasRef: async (hash: string, ref: Record<string, unknown>) => {
    registerCalls.push({ hash, ref });
  },
  releaseCas: async (hash: string, ref: Record<string, unknown>) => {
    releaseCalls.push({ hash, ref });
  },
}));

import {
  deleteSubjectHistoryMedia,
  linkSubjectStateMedia,
  findSubjectMediaUsage,
  releaseSubjectStateMediaRefs,
} from './subject-state-media.js';
import {
  buildDefaultStateName,
  createSubjectNode,
  createSubjectTree,
  stateEpisodeRank,
  sortStatesByEpisodeRelevance,
  treeEpisodeRank,
  sortTreesByEpisodeRelevance,
  type SubjectTree,
  type SubjectTreeNode,
} from './subject-tree-types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function makeTree(): SubjectTree {
  const tr = createSubjectTree('character', '东海龙王');
  const s1 = createSubjectNode('基础', 'image', 'user', tr.rootId, { step: 1 });
  const s2 = createSubjectNode('常态', 'image', 'user', tr.rootId, { step: 2 });
  tr.states = [s1, s2];
  return tr;
}

/** 目标状态（noUncheckedIndexedAccess 下取非空引用） */
function stateOf(tr: SubjectTree, i: number): SubjectTreeNode {
  return tr.states[i] as SubjectTreeNode;
}
function firstTree(trees: SubjectTree[]): SubjectTree {
  return trees[0] as SubjectTree;
}

const CAS_A = 'cas:aaaa1111aaaa1111aaaa1111aaaa1111.png';
const CAS_B = 'cas:bbbb2222bbbb2222bbbb2222bbbb2222.png';
const CAS_MP3 = 'cas:cccc3333cccc3333cccc3333cccc3333.mp3';
const PROJECT = 'proj-1';

beforeEach(() => {
  registerCalls.length = 0;
  releaseCalls.length = 0;
});

describe('linkSubjectStateMedia（唯一写入函数语义）', () => {
  it('image 资产写入首槽：type 随 kind、origin 透传、CAS 登记 refCount++', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 1);
    const { trees, replaced } = await linkSubjectStateMedia({
      trees: [tr],
      projectId: PROJECT,
      rootId: tr.rootId,
      stateId: target.id,
      asset: {
        storageKey: CAS_A,
        kind: 'image',
        origin: { type: 'canvas', fromNodeId: 'node-1', label: '画布图1' },
      },
    });
    expect(replaced).toBeNull();
    const node = firstTree(trees).states.find((n) => n.id === target.id) as SubjectTreeNode;
    expect(node.type).toBe('image');
    expect(node.media).toHaveLength(1);
    expect(node.media[0]?.key).toBe(CAS_A);
    expect(node.media[0]?.type).toBe('image');
    expect(node.media[0]?.origin).toEqual({ type: 'canvas', fromNodeId: 'node-1', label: '画布图1' });
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]?.hash).toBe('aaaa1111aaaa1111aaaa1111aaaa1111');
    expect(registerCalls[0]?.ref).toMatchObject({
      assetId: `subject-state:${tr.rootId}/${target.id}`,
      projectId: PROJECT,
      kind: 'image',
    });
  });

  it('audio 资产落到音色参考（type=audio）', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 0);
    const { trees } = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_MP3, kind: 'audio' },
    });
    const node = firstTree(trees).states.find((n) => n.id === target.id) as SubjectTreeNode;
    expect(node.type).toBe('audio');
    expect(node.media[0]?.key).toBe(CAS_MP3);
    expect(registerCalls[0]?.ref).toMatchObject({ kind: 'audio' });
  });

  it('替换：旧引用保留进媒体历史 + 新引用登记，replaced 返回旧值供撤销', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 0);
    const once = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    const { trees, replaced } = await linkSubjectStateMedia({
      trees: once.trees, projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_B, kind: 'image' },
    });
    expect(replaced?.key).toBe(CAS_A);
    expect(replaced?.type).toBe('image');
    const node = firstTree(trees).states.find((n) => n.id === target.id) as SubjectTreeNode;
    expect(node.media).toHaveLength(1);
    expect(node.media[0]?.key).toBe(CAS_B);
    expect(node.mediaHistory?.map((m) => m.key)).toEqual([CAS_A]);
    // 新引用登记；旧引用不释放（历史仍引用）
    expect(registerCalls.map((c) => c.hash)).toEqual([
      'aaaa1111aaaa1111aaaa1111aaaa1111',
      'bbbb2222bbbb2222bbbb2222bbbb2222',
    ]);
    expect(releaseCalls).toHaveLength(0);
  });

  it('封面跟随当前媒体替换：旧封面被替换后自动指向新图', async () => {
    const tr = makeTree();
    tr.coverKey = CAS_A;
    const target = stateOf(tr, 0);
    const once = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    const { trees } = await linkSubjectStateMedia({
      trees: once.trees, projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_B, kind: 'image' },
    });
    expect(firstTree(trees).coverKey).toBe(CAS_B);
  });


  it('同 key 重挂：不重复记账、replaced=null（无内容被替换）', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 0);
    const once = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    const again = await linkSubjectStateMedia({
      trees: once.trees, projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    expect(again.replaced).toBeNull();
    expect(registerCalls).toHaveLength(1); // 不重复 ++
    expect(releaseCalls).toHaveLength(0);  // 不误释放
  });

  it('移除（asset=null）：清空媒体、旧图进历史、replaced 供撤销恢复', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 0);
    const linked = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    const { trees, replaced } = await linkSubjectStateMedia({
      trees: linked.trees, projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: null,
    });
    expect(replaced?.key).toBe(CAS_A);
    const node = firstTree(trees).states.find((n) => n.id === target.id) as SubjectTreeNode;
    expect(node.media).toEqual([]);
    expect(node.mediaHistory?.map((m) => m.key)).toEqual([CAS_A]);
    expect(registerCalls).toHaveLength(1);
    expect(releaseCalls).toHaveLength(0);
  });

  it('撤销恢复：replaced 可原样回写（视频历史引用也能恢复）', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 0);
    const linked = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    const removed = await linkSubjectStateMedia({
      trees: linked.trees, projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: null,
    });
    // 撤销 = 把 replaced 按原 kind 回写（历史 video 引用也能恢复，视频仅在此链路存在）
    const restored = await linkSubjectStateMedia({
      trees: removed.trees, projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: removed.replaced?.key ?? '', kind: 'video', origin: removed.replaced?.origin },
    });
    const node = firstTree(restored.trees).states.find((n) => n.id === target.id) as SubjectTreeNode;
    expect(node.media[0]?.key).toBe(CAS_A);
    expect(node.media[0]?.type).toBe('video');
  });

  it('找不到目标状态 throw，不静默失败', async () => {
    const tr = makeTree();
    await expect(linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: 'nope',
      asset: { storageKey: CAS_A, kind: 'image' },
    })).rejects.toThrow(/target state not found/);
  });

  it('非 CAS key（历史 dataUrl）跳过记账，不产生引用残留', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 0);
    await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: 'data:image/png;base64,xxxx', kind: 'image' },
    });
    expect(registerCalls).toHaveLength(0);
    expect(releaseCalls).toHaveLength(0);
  });

  it('不复制文件：新媒体槽只持 storageKey 引用（键即 CAS 引用，无 dataUrl 拷贝）', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 0);
    const { trees } = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    const node = firstTree(trees).states.find((n) => n.id === target.id) as SubjectTreeNode;
    expect(Object.keys(node.media[0] ?? {})).not.toContain('dataUrl');
    expect(Object.keys(node.media[0] ?? {})).not.toContain('url');
  });
});

describe('findSubjectMediaUsage（双向可见）', () => {
  it('按 storageKey 查出 主体X · 状态Y 引用记录', async () => {
    const tr = makeTree();
    const target = stateOf(tr, 1);
    const { trees } = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id,
      asset: { storageKey: CAS_A, kind: 'image', origin: { type: 'canvas', label: '画布图1' } },
    });
    const usage = findSubjectMediaUsage(trees, CAS_A);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      rootId: tr.rootId,
      treeName: '东海龙王',
      stateId: target.id,
      stateName: '常态',
      kind: 'image',
    });
    expect(findSubjectMediaUsage(trees, CAS_B)).toEqual([]);
    expect(findSubjectMediaUsage(trees, '')).toEqual([]);
  });
});

describe('方案 C（2026-11-05）：出现集数「不过滤、只排序 + 标签」', () => {
  const hit = { appearEpisodes: [1, 3] };      // 命中当前集 1
  const other = { appearEpisodes: [2, 4] };    // 标注为其它集
  const generic = { appearEpisodes: [] };      // 未标注 = 通用
  const legacy = {} as { appearEpisodes?: number[] }; // 历史数据无字段 = 通用

  it('本集命中的状态排在未命中之前；未标注视为通用（与命中同组、排前）', () => {
    const sorted = sortStatesByEpisodeRelevance([other, hit, generic, legacy], 1);
    // rank 0 组（hit/generic/legacy 按原顺序）在前，other 排最后
    expect(sorted.map((s) => s.appearEpisodes)).toEqual([[1, 3], [], undefined, [2, 4]]);
  });

  it('排序稳定且不改数据/树结构：入参数组顺序不变，返回新数组', () => {
    const input = [other, hit, generic];
    const snapshot = [...input];
    const sorted = sortStatesByEpisodeRelevance(input, 1);
    expect(input).toEqual(snapshot); // 入参不动
    expect(sorted).not.toBe(input);  // 返回新数组（display-only，存储顺序不变）
    // 同 rank 保持原顺序
    const s2 = sortStatesByEpisodeRelevance([generic, hit], 1);
    expect(s2[0]?.appearEpisodes).toEqual([]);
    expect(s2[1]?.appearEpisodes).toEqual([1, 3]);
  });

  it('取不到当前集上下文（null）→ 一律 rank 0、原样返回（不硬编码第 1 集）', () => {
    expect(stateEpisodeRank(other, null)).toBe(0);
    expect(sortStatesByEpisodeRelevance([other, hit], null)).toEqual([other, hit]);
    expect(treeEpisodeRank([other], null)).toBe(0);
    expect(sortTreesByEpisodeRelevance([{ states: [other] } as never], null)).toEqual([{ states: [other] } as never]);
  });

  it('树级排序：任一状态命中/未标注即排前；全部标注为其它集才排后；无状态 = 通用', () => {
    const trHit = { states: [other, hit] };   // 有一状态命中 → 0
    const trOther = { states: [other, { appearEpisodes: [2] }] }; // 全部其它集 → 1
    const trEmpty = { states: [] };           // 无状态 → 通用 0
    expect(treeEpisodeRank(trHit.states, 1)).toBe(0);
    expect(treeEpisodeRank(trOther.states, 1)).toBe(1);
    expect(treeEpisodeRank(trEmpty.states, 1)).toBe(0);
    expect(treeEpisodeRank(undefined, 1)).toBe(0);
    const sorted = sortTreesByEpisodeRelevance([trOther, trHit, trEmpty], 1);
    expect(sorted[0]).toBe(trHit);   // 命中最前
    expect(sorted[1]).toBe(trEmpty); // 无状态（通用）次之（原顺序）
    expect(sorted[2]).toBe(trOther); // 全部其它集最后
  });

  it('组件接线（fs 契约）：显示排序而非过滤；标签 key 存在；未禁用不隐藏', () => {
    const src = readFileSync(path.resolve(here, 'StoryboardSubjectTree.tsx'), 'utf8');
    // 排序接入（主体列表 + 状态列表），且是 display-only 渲染层排序
    expect(src).toContain('sortTreesByEpisodeRelevance(');
    expect(src).toContain('sortStatesByEpisodeRelevance(norm.states');
    // 不过滤：没有按 appearEpisodes 隐藏/筛掉状态的逻辑
    expect(src).not.toMatch(/states\.filter\([^)]*appearEpisodes/);
    // 标签 key：标注为其它集显示小号次要标签（未标注/命中不加）
    expect(src).toContain("subject.taggedEpisodes");
    // 上下文来源：activeEpisodeNumber 由父级传入（script.activeEpisodeId → 集号），组件内不硬编码
    expect(src).not.toMatch(/activeEpisodeNumber\s*=\s*\d/);
  });

  it('三语 i18n 均有 subject.taggedEpisodes 标签文案', () => {
    for (const f of ['zh', 'en', 'ja']) {
      const o = JSON.parse(readFileSync(path.resolve(here, `../../../i18n/${f}.json`), 'utf8')) as { subject: Record<string, string> };
      expect(typeof o.subject.taggedEpisodes).toBe('string');
      expect(o.subject.taggedEpisodes).toContain('{{list}}');
    }
  });
});

describe('新状态默认名与 appearEpisodes 契约', () => {
  it('buildDefaultStateName 带形象名称前缀；形象名空退回本体', () => {
    expect(buildDefaultStateName('东海龙王', 2, (n) => `状态${n}`)).toBe('东海龙王 · 状态2');
    expect(buildDefaultStateName('  ', 3, (n) => `State ${n}`)).toBe('State 3');
  });

  it('createSubjectNode 默认 appearEpisodes=[]（状态级存储，未设置=全部剧集）', () => {
    const n = createSubjectNode('x', 'image', 'user', 'r1');
    expect(n.appearEpisodes).toEqual([]);
  });
});

describe('releaseSubjectStateMediaRefs（删除状态/树防孤儿）', () => {
  it('按 stateId 释放该状态全部 CAS 引用；其他状态不受影响', async () => {
    const tr = makeTree();
    const s0 = stateOf(tr, 0);
    const s1 = stateOf(tr, 1);
    const linked = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: s0.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    registerCalls.length = 0;
    await releaseSubjectStateMediaRefs({ trees: linked.trees, projectId: PROJECT, rootId: tr.rootId, stateId: s0.id });
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0]?.ref.assetId).toBe(`subject-state:${tr.rootId}/${s0.id}`);
    expect(releaseCalls[0]?.ref).toMatchObject({ projectId: PROJECT, kind: 'image' });
    // s1 无媒体 → 不产生释放
    expect(releaseCalls.filter((c) => c.ref.assetId === `subject-state:${tr.rootId}/${s1.id}`)).toHaveLength(0);
  });

  it('缺省 stateId 释放整树（删主体场景）；无 projectId 时跳过（无记账可释）', async () => {
    const tr = makeTree();
    const s0 = stateOf(tr, 0);
    const s1 = stateOf(tr, 1);
    const linked = await linkSubjectStateMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: s0.id,
      asset: { storageKey: CAS_A, kind: 'image' },
    });
    const linked2 = await linkSubjectStateMedia({
      trees: linked.trees, projectId: PROJECT, rootId: tr.rootId, stateId: s1.id,
      asset: { storageKey: CAS_MP3, kind: 'audio' },
    });
    releaseCalls.length = 0;
    await releaseSubjectStateMediaRefs({ trees: linked2.trees, projectId: PROJECT, rootId: tr.rootId });
    expect(releaseCalls).toHaveLength(2);
    expect(releaseCalls.map((c) => c.hash).sort()).toEqual([
      'aaaa1111aaaa1111aaaa1111aaaa1111',
      'cccc3333cccc3333cccc3333cccc3333',
    ].sort());
    await releaseSubjectStateMediaRefs({ trees: linked2.trees, projectId: undefined });
    // 无 projectId 不再产生新释放调用（前面 2 次不变）
    expect(releaseCalls).toHaveLength(2);
  });
});

describe('来源面板 @ 形态契约（fs 断言，2026-11-05 约定；2026-11-07 统一到共享面板）', () => {
  const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8');
  const panelSrc = () => read('subject-media-source-panel.tsx');
  const sharedSrc = () => read('../../../shared/components/asset-pick-panel.tsx');

  it('页签 = 画布 / 资产（项目+公共）/ 手动上传（共享面板同一实现，不另做一套）', () => {
    const src = panelSrc();
    const tabs = src.match(/const TABS: AssetPickTab\[\] = \[([^\]]+)\]/)?.[1] ?? '';
    expect(tabs.replace(/\s/g, '')).toBe("'canvas','asset','upload'");
    // 面板只注入数据与回调，UI 全部来自共享实现
    expect(src).toContain("from '@/shared/components/asset-pick-panel.js'");
    expect(src).toContain('<AssetPickPanel');
  });

  it('手动上传不污染全局库：面板不调用 addAsset/createAsset（只 uploadAsset 落 CAS）', () => {
    const src = panelSrc();
    expect(src).toContain("from '@/features/asset-picker/services/upload-asset.js'");
    expect(src).not.toMatch(/addAsset|createAsset/);
  });

  it('@ 面板形态要素：分区 tab + 搜索框 + Esc 关闭 + popover data 标识', () => {
    const shared = sharedSrc();
    expect(shared).toContain('data-asset-pick-panel');
    expect(shared).toContain('data-asset-pick-tab');
    expect(shared).toContain('data-asset-panel-search');
    expect(shared).toMatch(/Escape/);
    expect(shared).not.toMatch(/from 'antd'[^]*Modal/); // 不用 Modal 皮肤
  });

  it('可见关闭按钮（2026-11-05 修复）：常驻 header、aria-label、点击不写入、Esc 仍可用', () => {
    const shared = sharedSrc();
    const src = panelSrc();
    // 共享面板：常驻 × 按钮，带可访问性 label
    expect(shared).toContain('data-asset-pick-close');
    expect(shared).toMatch(/aria-label=\{t\('assetPick\.close'/);
    // 关闭按钮与页签同一行（页签下所有分区都在）
    expect(shared.indexOf('data-asset-pick-close')).toBeGreaterThan(shared.indexOf('data-asset-pick-tab'));
    // 三条退出路径（× / Esc / 点外部）在主体面板收口 closeWithFocus —— 只聚焦+onClose，不调 onPick（不写入）
    const closeBody = src.slice(src.indexOf('closeWithFocus = useCallback'), src.indexOf('doPick = useCallback'));
    expect(closeBody).toContain('anchorEl?.focus?.()');
    expect(closeBody).toContain('onClose()');
    expect(closeBody).not.toContain('onPick');
    expect(src).toMatch(/e\.key === 'Escape'/); // Esc 快捷键仍可用
    expect(src).toMatch(/panelRef\.current\?\.contains\(target\)/); // 点外部关闭
  });

  it('占位卡/已有媒体点击都打开来源面板（空卡与替换同一入口）', () => {
    const src = read('StoryboardSubjectTree.tsx');
    // 空占位卡
    expect(src).toMatch(/Paperclip/);
    expect(src).toMatch(/onOpenSourcePanel\(tree\.rootId, node\.id, e\.currentTarget\)/);
    // 不再存在「T 文本」占位分支与类型徽标
    expect(src).not.toContain('IconTiny');
    expect(src).not.toContain('mediaText');
    // 插入状态行不再有上边线
    expect(src).not.toMatch(/padding: '0 10px 8px', borderTop/);
    // 集数下拉触发按钮加宽（minWidth ≥ 200）
    expect(src).toMatch(/minWidth: 2\d0/);
  });
});

describe('deleteSubjectHistoryMedia（永久删除历史图 + 封面回退）', () => {
  function treeWithHistory(opts: { media: 'image' | 'none'; cover?: string } = { media: 'image' }): SubjectTree {
    const tr = makeTree();
    const s = stateOf(tr, 0);
    tr.states = [{
      ...s,
      media: opts.media === 'image' ? [{ key: CAS_B, type: 'image' as const }] : [],
      mediaHistory: [{ key: CAS_A, type: 'image' as const }, { key: CAS_MP3, type: 'audio' as const }],
    }];
    if (opts.cover) tr.coverKey = opts.cover;
    return tr;
  }

  it('移除条目 + 释放 CAS 引用（不是只从数组抹掉）', async () => {
    const tr = treeWithHistory();
    const target = stateOf(tr, 0);
    const { trees } = await deleteSubjectHistoryMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id, key: CAS_A,
    });
    const node = firstTree(trees).states[0] as SubjectTreeNode;
    expect(node.mediaHistory?.map((m) => m.key)).toEqual([CAS_MP3]);
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0]?.hash).toBe('aaaa1111aaaa1111aaaa1111aaaa1111');
    expect(releaseCalls[0]?.ref).toMatchObject({
      assetId: `subject-state:${tr.rootId}/${target.id}`,
      projectId: PROJECT,
      kind: 'image',
    });
  });

  it('删的正好是封面 → 封面回退到当前槽位图片', async () => {
    const tr = treeWithHistory({ media: 'image', cover: CAS_A });
    const target = stateOf(tr, 0);
    const { trees } = await deleteSubjectHistoryMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id, key: CAS_A,
    });
    expect(firstTree(trees).coverKey).toBe(CAS_B);
  });

  it('删的正好是封面且没有可用图片 → 封面置空（不残留已删 key）', async () => {
    const tr = treeWithHistory({ media: 'none', cover: CAS_A });
    const target = stateOf(tr, 0);
    const { trees } = await deleteSubjectHistoryMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id, key: CAS_A,
    });
    expect(firstTree(trees).coverKey).toBeNull();
  });

  it('删的不是封面 → 封面不动；重复删同一 key 幂等且不重复释放', async () => {
    const tr = treeWithHistory({ media: 'none', cover: CAS_B });
    const target = stateOf(tr, 0);
    const once = await deleteSubjectHistoryMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: target.id, key: CAS_A,
    });
    expect(firstTree(once.trees).coverKey).toBe(CAS_B);
    expect(releaseCalls).toHaveLength(1);
    const twice = await deleteSubjectHistoryMedia({
      trees: once.trees, projectId: PROJECT, rootId: tr.rootId, stateId: target.id, key: CAS_A,
    });
    expect(firstTree(twice.trees).states[0]?.mediaHistory?.map((m) => m.key)).toEqual([CAS_MP3]);
    expect(releaseCalls).toHaveLength(1);
  });

  it('目标状态不存在 → throw（不静默失败）', async () => {
    const tr = treeWithHistory();
    await expect(deleteSubjectHistoryMedia({
      trees: [tr], projectId: PROJECT, rootId: tr.rootId, stateId: 'nope', key: CAS_A,
    })).rejects.toThrow(/target state not found/);
  });
});

describe('两入口复用唯一写入函数（fs 契约断言）', () => {
  const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8');

  it('画布右键弹层（subject-link-dialog）走 linkSubjectStateMedia', () => {
    const src = read('subject-link-dialog.tsx');
    expect(src).toContain('linkSubjectStateMedia');
    expect(src).toContain("from './subject-state-media'");
  });

  it('主体库状态卡（StoryboardSubjectTree）走 linkSubjectStateMedia', () => {
    const src = read('StoryboardSubjectTree.tsx');
    expect(src).toContain('linkSubjectStateMedia');
  });

  it('use-node-actions：video 资产「发送到主体」disabled（视频不可选）', () => {
    const src = read(
      path.join('../../../pages/editor/editor-canvas/use-editor-interactions/use-node-actions.ts'),
    );
    // 2026-11-10：发送入口统一成「发送」二级菜单，主体项 key 变为 send-to-subject
    expect(src).toContain("key: 'send-to-subject'");
    expect(src).toMatch(/disabled:\s*subjectDisabled/);
    expect(src).toContain("nodeType === 'video'");
  });
});
