/**
 * 导演台版本上限回归（2026-11-08 用户指令）
 *
 * 口径：非收藏版本最多 SNAPSHOT_KEEP_COUNT（30）份，写入新版本后立即回收最旧；
 * 用户打星标收藏的版本跳出配额、跳过一切自动回收。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/platform/fs', () => {
  const files = new Map<string, { text: string }>();
  return {
    __files: files,
    readJson: async (p: string) => {
      const f = files.get(p);
      return f ? (JSON.parse(f.text) as unknown) : null;
    },
    writeJson: async (p: string, value: unknown) => { files.set(p, { text: JSON.stringify(value) }); },
    writeJsonIfUnchanged: async (p: string, value: unknown) => { files.set(p, { text: JSON.stringify(value) }); },
    listDir: async (dir: string) => {
      const names = new Set<string>();
      for (const key of files.keys()) {
        const i = key.lastIndexOf('/');
        if (i >= 0 && key.slice(0, i) === dir) names.add(key.slice(i + 1));
      }
      return Array.from(names).sort().map((name) => ({ name, kind: 'file' as const }));
    },
    remove: async (p: string) => { files.delete(p); },
    stat: async (p: string) => {
      const f = files.get(p);
      return f ? { size: f.text.length, lastModified: Date.now() } : null;
    },
  };
});

import { snapshotWorkbenchForRun } from '@/entities/slot-containers.js';
import { listSnapshots, setSnapshotFavorite, SNAPSHOT_KEEP_COUNT } from '@/entities/snapshot-store.js';
import type { ContainersIO, WorkbenchContainer } from '@/entities/slot-containers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fsMod = (await import('@/platform/fs')) as any;
const files = fsMod.__files as Map<string, { text: string }>;

const PID = 'p-version-cap';
const WORKBENCH: WorkbenchContainer = {
  schemaVersion: 1,
  version: 1,
  title: '导演台',
  tracks: [],
  shots: [],
  totalDuration: 0,
  updatedAt: new Date().toISOString(),
};
const io: ContainersIO = {
  readJson: async <T,>(p: string) => (p === `projects/${PID}/entities/workbench.json`
    ? (JSON.parse(JSON.stringify(WORKBENCH)) as T)
    : null),
  writeJson: async () => undefined,
};

beforeEach(() => { files.clear(); });

describe('导演台版本上限（30 + 星标跳过）', () => {
  it('每写一份版本立即回收：非收藏版本恰好 30 份', async () => {
    for (let i = 0; i < SNAPSHOT_KEEP_COUNT + 5; i += 1) {
      await snapshotWorkbenchForRun(PID, i + 1, io);
    }
    expect(await listSnapshots(PID, 'workbench')).toHaveLength(SNAPSHOT_KEEP_COUNT);
  });

  it('星标版本不占配额：收藏最旧一份后再写 35 份，收藏仍在且普通版本保持 30 份', async () => {
    for (let i = 0; i < 5; i += 1) await snapshotWorkbenchForRun(PID, i + 1, io);
    const first = (await listSnapshots(PID, 'workbench'))[0]!;
    await setSnapshotFavorite(PID, 'workbench', first.fileName, true);

    for (let i = 5; i < 40; i += 1) await snapshotWorkbenchForRun(PID, i + 1, io);

    const all = await listSnapshots(PID, 'workbench');
    expect(all.some((s) => s.fileName === first.fileName && s.favorite === true)).toBe(true);
    expect(all.filter((s) => !s.favorite)).toHaveLength(SNAPSHOT_KEEP_COUNT);
  });

  it('接线：导演台写版本后调回收；面板有星标按钮与配额计数', () => {
    const containers = readFileSync(resolve(process.cwd(), 'src/entities/slot-containers.ts'), 'utf8');
    expect(containers).toContain("recycleSnapshots(projectId, 'workbench')");
    const host = readFileSync(resolve(process.cwd(), 'src/features/canvas-tabs/workbench-tab-content.tsx'), 'utf8');
    expect(host).toContain('data-version-favorite');
    expect(host).toContain('data-version-cap');
    expect(host).toContain('setSnapshotFavorite(');
    expect(host).toContain('SNAPSHOT_KEEP_COUNT');
  });
});
