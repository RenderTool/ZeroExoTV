/**
 * 开源库「有计数、无结果」修复验收（2026-11-05）
 *
 * 数据层用真实 queryOpenLib（仅 stub fetch 返回夹具 JSON），验证：
 * ① 分类条数字 = 同一 predicate 过滤结果的长度（不再信 meta.json 静态统计）；
 * ② shisei 式「meta 按 group 聚合、条目 category 是 std/sexy」→ 不再空列表；
 * ③ 「私服」式：条目用 tags class:私服 承载分类 → 能命中且数字一致；
 * ④ 18+ 门控：计数与列表同口径（未确认时不计成人条目，避免 count>0 / 列表 0）；
 * ⑤ 其它筛选项（库、搜索）交叉校验：有计数必有结果。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const META = {
  schemaVersion: 2,
  generatedAt: '2026-11-05',
  source: { repo: 'r', site: 's' },
  ageGate: { defaultHidden: true, note: '' },
  galleries: {
    // meta 静态统计故意写错，证明 UI 不再依赖它
    shisei: {
      id: 'shisei', title: 'CC0 姿势', indexed: true,
      license: { type: 'cc0', commercialUse: true, redistribution: true, note: '' },
      sourceUrl: '', cdnDomains: [], entryCount: 6, localCount: 6, adultCount: 1,
      categories: [
        { id: '坐姿', title: '坐姿', count: 99 },
        { id: '站立', title: '站立', count: 0 },
        { id: '私服', title: '私服', count: 42 },
      ],
    },
    costume: {
      id: 'costume', title: '服装穿搭', indexed: true,
      license: { type: 'restricted', commercialUse: false, redistribution: false, note: '' },
      sourceUrl: '', cdnDomains: [], entryCount: 4, localCount: 4, adultCount: 0,
      categories: [{ id: '私服', title: '私服', count: 42 }],
    },
  },
  totals: { entries: 10, bundled: 10, remote: 0, adult: 1 },
};

function entry(gallery: string, srcId: string, fields: Record<string, unknown>) {
  return {
    id: `openlib:${gallery}:${srcId}`, gallery, srcId, title: `图 ${srcId}`,
    category: '', tags: [], adult: false, storage: 'bundled',
    imageUrl: `/openlib/thumbs/${gallery}/${srcId}.webp`, cdnUrl: `https://cdn/${srcId}.webp`,
    sourceUrl: '', license: { type: 'cc0', commercialUse: true, redistribution: true, note: '' },
    ...fields,
  };
}

const SHISEI = {
  gallery: 'shisei',
  categories: META.galleries.shisei.categories,
  entries: [
    // 3 条坐姿（category=std，group=坐姿）：meta 若按 category 过滤会全空
    entry('shisei', 'P1', { category: 'std', group: '坐姿' }),
    entry('shisei', 'P2', { category: 'std', group: '坐姿' }),
    entry('shisei', 'P3', { category: 'std', group: '坐姿' }),
    // 1 条坐姿但是 18+
    entry('shisei', 'P4', { category: 'std', group: '坐姿', adult: true }),
    // 1 条站立（meta 静态 count=0，实际 1）
    entry('shisei', 'P5', { category: 'upper', group: '站立' }),
    // 私服：分类只存在于 tags class:私服
    entry('shisei', 'P6', { category: 'sexy', group: '性感系', tags: ['class:私服'] }),
  ],
};

const COSTUME = {
  gallery: 'costume',
  categories: META.galleries.costume.categories,
  entries: [
    entry('costume', 'C1', { category: 'private', tags: ['class:私服'] }),
    entry('costume', 'C2', { category: 'private', tags: ['class:私服'] }),
    entry('costume', 'C3', { category: 'private', tags: ['class:私服'] }),
    entry('costume', 'C4', { category: 'spring', group: '春' }),
  ],
};

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const raw = String(url);
    const rel = raw.slice(raw.indexOf('openlib/') + 'openlib/'.length);
    const files: Record<string, unknown> = {
      'meta.json': META,
      'entries-shisei.json': SHISEI,
      'entries-costume.json': COSTUME,
      'entries-portrait.json': null,
      'entries-pose.json': null,
      'entries-pose-depth.json': null,
      'entries-character.json': null,
      'entries-costume-anime.json': null,
    };
    const data = files[rel];
    if (!data) return { ok: false, json: async () => null } as Response;
    return { ok: true, json: async () => data } as Response;
  }));
}

import {
  queryOpenLib,
  __invalidateOpenLibCache,
  getOpenLibMeta,
  type OpenLibGalleryId,
} from './open-library.js';

beforeEach(() => {
  __invalidateOpenLibCache();
  localStorage.clear();
  stubFetch();
});

describe('开源库分类：计数与过滤同源', () => {
  it('shisei 每个分类：count === 过滤结果长度；坐姿按 group 命中（不再全空）', async () => {
    const meta = await getOpenLibMeta();
    const cats = meta!.galleries.shisei.categories ?? [];
    const unchecked: string[] = [];
    for (const c of cats) {
      const page = await queryOpenLib({ gallery: 'shisei', category: c.id, pageSize: 60 });
      const chip = page.categoryCounts?.[c.id] ?? -1;
      expect(chip, `分类 ${c.id} 计数`).toBe(page.total);
      if (chip > 0) expect(page.items.length, `分类 ${c.id} 列表`).toBeGreaterThan(0);
      if (chip === 0) unchecked.push(c.id);
      // 不存在「有计数、无结果」
      expect(chip === 0 && page.total > 0).toBe(false);
    }
    // shisei 的「私服」只有 1 条（来自 tags class:私服），不为 0；也不存在空计数分类
    expect(unchecked).toEqual([]);
    expect((await queryOpenLib({ gallery: 'shisei', category: '私服', pageSize: 60 })).total).toBe(1);
    const zuo = await queryOpenLib({ gallery: 'shisei', category: '坐姿', pageSize: 60 });
    expect(zuo.total).toBe(3); // 3 条非成人；第 4 条 18+ 被门控
    expect(zuo.categoryCounts?.['坐姿']).toBe(3);
  });

  it('私服：tags class:私服 命中，计数 === 列表长度（costume 3 条）', async () => {
    const page = await queryOpenLib({ gallery: 'costume', category: '私服', pageSize: 60 });
    expect(page.total).toBe(3);
    expect(page.categoryCounts?.['私服']).toBe(3);
    expect(page.items).toHaveLength(3);
    // meta 静态统计是 42，证明不再被使用
    expect(page.categoryCounts?.['私服']).not.toBe(42);
  });

  it('点击每个分类依次断言：有计数必有条目（无第二个同类空列表）', async () => {
    for (const gid of ['shisei', 'costume'] as OpenLibGalleryId[]) {
      const cats = (await getOpenLibMeta())!.galleries[gid].categories ?? [];
      for (const c of cats) {
        const one = await queryOpenLib({ gallery: gid, category: c.id, pageSize: 60 });
        const chip = one.categoryCounts?.[c.id] ?? 0;
        if (chip > 0) expect(one.items.length).toBeGreaterThan(0);
      }
    }
  });

  it('年龄门控同口径：确认前计数不含成人，确认后计数/列表一起 +1', async () => {
    const before = await queryOpenLib({ gallery: 'shisei', category: '坐姿', pageSize: 60 });
    expect(before.categoryCounts?.['坐姿']).toBe(3);
    expect(before.adultHidden).toBe(1);

    localStorage.setItem('zeroexo:openlib-age-confirmed', '1');
    const after = await queryOpenLib({ gallery: 'shisei', category: '坐姿', includeAdult: true, pageSize: 60 });
    expect(after.categoryCounts?.['坐姿']).toBe(4);
    expect(after.total).toBe(4);
    expect(after.adultHidden).toBe(0);
  });

  it('其它筛选项交叉校验：库级总数 === 可见条目数；搜索有结果', async () => {
    const shisei = await queryOpenLib({ gallery: 'shisei', pageSize: 60 });
    expect(shisei.total).toBe(5); // 6 条中 1 条 18+
    expect(shisei.adultHidden).toBe(1);
    const costume = await queryOpenLib({ gallery: 'costume', pageSize: 60 });
    expect(costume.total).toBe(4);

    // 搜索：每个库取首个非成人条目标题作为关键词，必须 > 0
    for (const gid of ['shisei', 'costume'] as OpenLibGalleryId[]) {
      const all = await queryOpenLib({ gallery: gid, pageSize: 60 });
      const kw = all.items[0]?.title ?? '';
      const hit = await queryOpenLib({ gallery: gid, keyword: kw, pageSize: 60 });
      expect(hit.total).toBeGreaterThan(0);
    }
  });
});
