/**
 * cas-store 单测：内容寻址存储契约验证（2026-11-04）
 * (a) 同字节两次上传 → 物理文件数=1、refCount=2；
 * (b) 并发 3 次同字节上传 → 仍只有 1 份物理文件（refCount=3）；
 * (c) 删除其中一个引用 → refCount=1、文件仍在；
 * (d) 删到 0 → 文件与索引条目消失；
 * (e) 重复删除幂等（不报错、不产生幽灵条目）；
 * (f) 存量无 cas 字段资产 → 解析器回退旧路径，不受影响；
 * 另含 sha256 标准向量、同 ref 重复 put 幂等、cas: 键映射。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/platform/fs', () => {
  const texts = new Map<string, { text: string; lastModified: number }>();
  const blobs = new Map<string, { data: Uint8Array; mime: string; lastModified: number }>();
  let tick = 0;
  return {
    __texts: texts,
    __blobs: blobs,
    readJson: async (p: string) => {
      const f = texts.get(p);
      return f ? (JSON.parse(f.text) as unknown) : null;
    },
    stat: async (p: string) => {
      const t = texts.get(p);
      if (t) return { size: t.text.length, lastModified: t.lastModified };
      const b = blobs.get(p);
      if (b) return { size: b.data.byteLength, lastModified: b.lastModified };
      return null;
    },
    writeJsonIfUnchanged: async (p: string, value: unknown, expected: { size: number; lastModified: number } | null) => {
      const cur = texts.get(p);
      if (expected && cur && (cur.text.length !== expected.size || cur.lastModified !== expected.lastModified)) {
        throw new Error('ConflictError: file changed externally');
      }
      texts.set(p, { text: JSON.stringify(value, null, 2), lastModified: ++tick });
    },
    writeFileBlob: async (p: string, data: Uint8Array, mime = 'application/octet-stream') => {
      blobs.set(p, { data: new Uint8Array(data), mime, lastModified: ++tick });
    },
    readFileHandle: async (p: string) => {
      const b = blobs.get(p);
      return b ? new Blob([b.data.slice().buffer], { type: b.mime }) : null;
    },
    removeFile: async (p: string) => {
      texts.delete(p);
      blobs.delete(p);
    },
  };
});

import {
  putCas,
  releaseCas,
  readCasIndex,
  sha256Hex,
  casFilePath,
  casStorageKey,
  isCasStorageKey,
  parseCasStorageKey,
  resolveAssetMediaPath,
} from '@/entities/cas-store.js';
import { mediaRelPath } from '@/platform/media.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fsMock = (await import('@/platform/fs') as any);
const texts = fsMock.__texts as Map<string, { text: string; lastModified: number }>;
const blobs = fsMock.__blobs as Map<string, { data: Uint8Array; mime: string; lastModified: number }>;

const enc = new TextEncoder();
const BYTES = enc.encode('hello cas world — 同内容字节');
const REF_A1 = { assetId: 'asset-1', projectId: 'proj-1', kind: 'image' };
const REF_A2 = { assetId: 'asset-2', projectId: 'proj-1', kind: 'image' };
const REF_A3 = { assetId: 'asset-3', projectId: 'proj-2', kind: 'image' };

function casBlobCount(): number {
  return Array.from(blobs.keys()).filter((k) => k.startsWith('media/cas/')).length;
}

describe('sha256Hex 流式哈希', () => {
  it('标准向量：空输入与 "abc"', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(enc.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('Blob 流式分块与一次性 Uint8Array 结果一致', async () => {
    const direct = await sha256Hex(BYTES);
    const viaBlob = await sha256Hex(new Blob([BYTES]));
    expect(viaBlob).toBe(direct);
  });
});

describe('cas-store 上传去重（findOrCreate）', () => {
  beforeEach(() => {
    texts.clear();
    blobs.clear();
  });

  it('(a) 同字节两次上传：物理文件数=1、refCount=2，第二次复用路径不重复写字节', async () => {
    const r1 = await putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 });
    const r2 = await putCas({ data: BYTES, mime: 'image/png', ref: REF_A2 });

    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(true);
    expect(r2.storageKey).toBe(r1.storageKey);
    expect(r2.path).toBe(r1.path);
    expect(casBlobCount()).toBe(1);

    const index = await readCasIndex();
    const entry = index.entries[r1.hash]!;
    expect(entry.refCount).toBe(2);
    expect(entry.refs).toHaveLength(2);
    expect(entry.path).toBe(`media/cas/${r1.hash}.png`);
    expect(entry.mime).toBe('image/png');
    expect(entry.size).toBe(BYTES.byteLength);
    // 字节确实只写了一份且内容一致（跨 realm Uint8Array 需转数组比较）
    expect(Array.from(blobs.get(entry.path)!.data)).toEqual(Array.from(BYTES));
  });

  it('(b) 并发 3 次同字节上传：仍只有 1 份物理文件，refCount=3', async () => {
    const [r1, r2, r3] = await Promise.all([
      putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 }),
      putCas({ data: BYTES, mime: 'image/png', ref: REF_A2 }),
      putCas({ data: BYTES, mime: 'image/png', ref: REF_A3 }),
    ]);
    expect(casBlobCount()).toBe(1);
    expect([r1, r2, r3].filter((r) => !r.deduped)).toHaveLength(1); // 恰好一个创建者
    expect(new Set([r1.storageKey, r2.storageKey, r3.storageKey]).size).toBe(1);

    const entry = (await readCasIndex()).entries[r1.hash]!;
    expect(entry.refCount).toBe(3);
    expect(entry.refs.map((r) => r.assetId).sort()).toEqual(['asset-1', 'asset-2', 'asset-3']);
  });

  it('同 ref 重复 put 幂等：refCount 不膨胀', async () => {
    const r1 = await putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 });
    await putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 });
    await putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 });
    const entry = (await readCasIndex()).entries[r1.hash]!;
    expect(entry.refCount).toBe(1);
    expect(casBlobCount()).toBe(1);
  });
});

describe('cas-store 删除与引用计数', () => {
  beforeEach(() => {
    texts.clear();
    blobs.clear();
  });

  it('(c) 删除其中一个引用：refCount=1、文件仍在', async () => {
    const r1 = await putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 });
    await putCas({ data: BYTES, mime: 'image/png', ref: REF_A2 });

    const rel = await releaseCas(r1.hash, { assetId: REF_A1.assetId, projectId: REF_A1.projectId });
    expect(rel).toEqual({ released: true, removed: false });

    const entry = (await readCasIndex()).entries[r1.hash]!;
    expect(entry.refCount).toBe(1);
    expect(entry.refs[0]!.assetId).toBe('asset-2');
    expect(casBlobCount()).toBe(1); // 文件仍在
  });

  it('(d) 删到 0：物理文件与索引条目一并消失', async () => {
    const r1 = await putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 });
    await putCas({ data: BYTES, mime: 'image/png', ref: REF_A2 });
    await releaseCas(r1.hash, { assetId: REF_A1.assetId, projectId: REF_A1.projectId });
    const last = await releaseCas(r1.hash, { assetId: REF_A2.assetId, projectId: REF_A2.projectId });

    expect(last).toEqual({ released: true, removed: true });
    expect(casBlobCount()).toBe(0);
    const index = await readCasIndex();
    expect(index.entries[r1.hash]).toBeUndefined();
    expect(Object.keys(index.entries)).toHaveLength(0); // 无幽灵条目
  });

  it('(e) 重复删除幂等：不报错、不影响其他引用', async () => {
    const r1 = await putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 });
    await putCas({ data: BYTES, mime: 'image/png', ref: REF_A2 });

    await releaseCas(r1.hash, { assetId: REF_A1.assetId, projectId: REF_A1.projectId });
    const again = await releaseCas(r1.hash, { assetId: REF_A1.assetId, projectId: REF_A1.projectId });
    expect(again).toEqual({ released: false, removed: false });
    // 索引未被多余回写破坏：asset-2 的引用仍在
    expect((await readCasIndex()).entries[r1.hash]!.refCount).toBe(1);
    expect(casBlobCount()).toBe(1);

    // 从不存在的 hash 上删除也静默成功
    const ghost = await releaseCas('0'.repeat(64), { assetId: 'nobody' });
    expect(ghost).toEqual({ released: false, removed: false });
  });

  it('不同内容互不干扰：两个 hash 各一份文件，删一个不影响另一个', async () => {
    const OTHER = enc.encode('完全不同的内容');
    const r1 = await putCas({ data: BYTES, mime: 'image/png', ref: REF_A1 });
    const r2 = await putCas({ data: OTHER, mime: 'video/mp4', ref: { assetId: 'asset-9', projectId: 'proj-1', kind: 'video' } });
    expect(casBlobCount()).toBe(2);
    expect(r2.storageKey).toContain('.mp4');

    await releaseCas(r1.hash, { assetId: REF_A1.assetId, projectId: REF_A1.projectId });
    expect(casBlobCount()).toBe(1);
    expect((await readCasIndex()).entries[r2.hash]).toBeDefined();
  });
});

describe('(f) 存量资产兼容与键映射', () => {
  it('无 cas 字段的存量资产：解析器回退 null（调用方走旧 storageKey 路径兜底）', () => {
    // 存量记录形态：只有 data.storageKey = 'image:<nanoid>'，无 cas 字段
    expect(resolveAssetMediaPath({})).toBeNull();
    expect(isCasStorageKey('image:JH-LHbRS5W2pWUmwto5_X')).toBe(false);
    expect(parseCasStorageKey('image:JH-LHbRS5W2pWUmwto5_X')).toBeNull();
    // 旧式盘符键映射不受新增 cas 分支影响
    expect(mediaRelPath('image:assets/ZV-001/images/p_a1b2c3.png')).toBe('assets/ZV-001/images/p_a1b2c3.png');
  });

  it('cas 键映射与往返解析', () => {
    const hash = 'a'.repeat(64);
    expect(casFilePath(hash, 'png')).toBe(`media/cas/${hash}.png`);
    expect(casStorageKey(hash, 'png')).toBe(`cas:${hash}.png`);
    expect(parseCasStorageKey(`cas:${hash}.png`)).toEqual({ hash, ext: 'png' });
    expect(mediaRelPath(`cas:${hash}.png`)).toBe(`media/cas/${hash}.png`);
    expect(resolveAssetMediaPath({ cas: { hash, ext: 'png' } })).toBe(`media/cas/${hash}.png`);
    // 畸形键一律拒绝
    expect(parseCasStorageKey('cas:../etc/passwd')).toBeNull();
    expect(mediaRelPath('cas:not-a-hash.png')).toBeNull();
  });
});
