/**
 * 封面取景侧车存储测试(mock localforage 为内存 Map):
 * - 确认路径: setCoverView 写入 → getCoverView 回填 { sourceKey, scale, tx, ty }
 * - 旧封面无视景记录 → null(调用方按居中铺满处理)
 * - 越界/损坏数据容错
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      setItem: async (k: string, v: unknown) => { mem.set(k, v); },
      getItem: async (k: string) => mem.get(k) ?? null,
      removeItem: async (k: string) => { mem.delete(k); },
    }),
  },
}));

// media/fs 在本测试中不被触达,屏蔽其 import 链(window.showDirectoryPicker 等)
vi.mock('./media.js', () => ({
  getMediaBlob: vi.fn(),
  mediaRelPath: vi.fn(),
  newMediaKey: vi.fn(),
  putMedia: vi.fn(),
}));
vi.mock('./fs.js', () => ({ isAuthorized: () => false }));
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zeroexo/plugin-persistence')>()),
  getImageBlob: vi.fn(),
  setImageBlob: vi.fn(),
}));

import { clearCoverView, getCoverView, setCoverView } from './cover.js';

describe('封面取景侧车', () => {
  beforeEach(() => mem.clear());

  it('确认后写入取景记录,再次打开按封面 key 回填(含原图 sourceKey)', async () => {
    const coverKey = 'image:projects/p1/cover.jpg'; // 裁剪结果
    const sourceKey = 'image:p1/原图.png'; // 原图
    await setCoverView(coverKey, { sourceKey, scale: 1.8, tx: 0, ty: -0.12 });

    const got = await getCoverView(coverKey);
    expect(got).toEqual({ sourceKey, scale: 1.8, tx: 0, ty: -0.12 });
  });

  it('旧封面无视景记录 → null(居中铺满,不报错)', async () => {
    expect(await getCoverView('image:projects/p2/legacy.png')).toBeNull();
    expect(await getCoverView(null)).toBeNull();
    expect(await getCoverView(undefined)).toBeNull();
  });

  it('clearCoverView 后读到 null', async () => {
    const key = 'image:projects/p3/cover.jpg';
    await setCoverView(key, { sourceKey: 'image:p3/src.png', scale: 1, tx: 0, ty: 0 });
    await clearCoverView(key);
    expect(await getCoverView(key)).toBeNull();
  });

  it('数据损坏(缺 sourceKey / 非数值取景)容错返回 null', async () => {
    mem.set('image:projects/p4/cover.jpg', { scale: 1.5, tx: 0, ty: 0 });
    expect(await getCoverView('image:projects/p4/cover.jpg')).toBeNull();
    mem.set('image:projects/p5/cover.jpg', { sourceKey: 'image:p5/s.png', scale: 'bad', tx: 0, ty: 0 });
    expect(await getCoverView('image:projects/p5/cover.jpg')).toBeNull();
  });
});
