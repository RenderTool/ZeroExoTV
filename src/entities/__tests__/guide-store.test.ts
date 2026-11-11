/**
 * 引导本地缓存（2026-11-11 用户要求）：
 * 云端 ComfyUI 不持久化，生成完必须立刻把 gd_*.safetensors 落到本地 media/guides。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, Uint8Array>();

vi.mock('@/platform/fs', () => ({
  stat: async (p: string) => (files.has(p) ? { size: files.get(p)!.byteLength, lastModified: 1 } : null),
  readFileHandle: async (p: string) => {
    const bytes = files.get(p);
    if (!bytes) return null;
    return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer } as unknown as Blob;
  },
  writeFile: async (p: string, data: Blob | string) => {
    if (typeof data === 'string') { files.set(p, new TextEncoder().encode(data)); return; }
    files.set(p, new Uint8Array(await data.arrayBuffer()));
  },
}));

import {
  GUIDE_DIR,
  guidePathFromKey,
  guideStorageKey,
  isGuideStorageKey,
  readCachedGuideBlob,
  writeGuideBlob,
} from '../guide-store.js';

const ID = 'gd_abc12345';

beforeEach(() => files.clear());

describe('guide-store', () => {
  it('键/路径约定：guide:<id>.safetensors → media/guides/<id>.safetensors', () => {
    expect(guideStorageKey(ID)).toBe(`guide:${ID}.safetensors`);
    expect(isGuideStorageKey(`guide:${ID}.safetensors`)).toBe(true);
    expect(isGuideStorageKey('cas:abc.png')).toBe(false);
    expect(guidePathFromKey(`guide:${ID}.safetensors`)).toBe(`${GUIDE_DIR}/${ID}.safetensors`);
    expect(guidePathFromKey('../../secret')).toBeNull();
  });

  it('写入后能读回；同 id 重复写入幂等（复用已有文件）', async () => {
    const blob = { size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as Blob;
    const first = await writeGuideBlob(ID, blob);
    expect(first?.localKey).toBe(`guide:${ID}.safetensors`);
    expect(files.has(`${GUIDE_DIR}/${ID}.safetensors`)).toBe(true);
    const second = await writeGuideBlob(ID, { size: 1, arrayBuffer: async () => new Uint8Array([9]).buffer } as unknown as Blob);
    expect(second?.bytes).toBe(3); // 复用已有，不覆盖
    expect((await readCachedGuideBlob({ id: ID }))?.size).toBe(3);
  });

  it('非法 id 不写；无缓存时读出 null', async () => {
    expect(await writeGuideBlob('../evil', new Blob(['x']))).toBeNull();
    expect(await readCachedGuideBlob({ id: 'gd_missing1' })).toBeNull();
    expect(await readCachedGuideBlob(null)).toBeNull();
  });
});
