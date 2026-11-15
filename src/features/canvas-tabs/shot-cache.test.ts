/**
 * 片段缓存（前端）回归：合并 MCP 版本、切换当前缓存、删除版本。
 *
 * 验收对应：切换第 2 段的缓存版本后，第 3 段重生成使用新 guide —— 前提是版本里的 guide
 * 必须原样留在 shot.cache.versions 里，不能被 media 投影或本地落盘覆盖掉。
 */
import { describe, expect, it } from 'vitest';
import type { WorkbenchShot, WorkbenchShotVersion } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import {
  deleteShotVersion,
  mergeShotVersion,
  selectedShotVersion,
  selectShotVersion,
  shotVersions,
} from './shot-cache.js';

/** 版本字面量（status 默认 done，测试只关心 id/storageKey/guide） */
const version = (v: Omit<WorkbenchShotVersion, 'status'>): WorkbenchShotVersion => ({ status: 'done', ...v });

function shot(extra: Partial<WorkbenchShot> = {}): WorkbenchShot {
  return {
    id: 's1',
    number: 1,
    description: '',
    shotType: '',
    duration: 5,
    imagePrompt: '提示词',
    videoPrompt: '',
    status: 'pending',
    clipState: 'placeholder',
    references: [],
    paramValues: {},
    ...extra,
  };
}

describe('片段缓存版本', () => {
  it('合并 MCP 版本后自动成为当前缓存，media 是它的投影', () => {
    const s = shot();
    const patch = mergeShotVersion(s, version({
      id: 'ver_1',
      storageKey: 'cas:video1.mp4',
      previewKey: 'image:assets/p/tasks/t1-preview-0.webp',
      guide: { id: 'gd_aaa1111', frames: 22 },
      prompt: '第一版提示词',
      createdAt: '2026-11-15T01:00:00.000Z',
    }));
    const next = { ...s, ...patch } as WorkbenchShot;
    expect(next.cache?.selectedVersionId).toBe('ver_1');
    expect(next.media?.storageKey).toBe('cas:video1.mp4');
    expect(next.media?.guide?.id).toBe('gd_aaa1111');
    expect(next.firstFrameKey).toContain('preview-0');
    expect(next.status).toBe('done');
    expect(next.clipState).toBe('completed');
  });

  it('同一版本重复合并幂等（刷新/多开重复回调不产生重复版本）', () => {
    const s = shot();
    const version1 = version({
      id: 'ver_1', storageKey: 'cas:video1.mp4', guide: { id: 'gd_aaa1111' },
      prompt: 'p', createdAt: '2026-11-15T01:00:00.000Z',
    });
    const once = { ...s, ...mergeShotVersion(s, version1) } as WorkbenchShot;
    const twice = { ...once, ...mergeShotVersion(once, version1) } as WorkbenchShot;
    expect(shotVersions(twice)).toHaveLength(1);
  });

  it('切换当前缓存 → media/guide 跟着换；删除当前版本 → 回退到剩余最新版本', () => {
    let s = shot();
    const v1 = version({ id: 'ver_1', storageKey: 'cas:v1.mp4', guide: { id: 'gd_aaa1111' }, prompt: 'p1', createdAt: '2026-11-15T01:00:00.000Z' });
    const v2 = version({ id: 'ver_2', storageKey: 'cas:v2.mp4', guide: { id: 'gd_bbb2222' }, prompt: 'p2', createdAt: '2026-11-15T02:00:00.000Z' });
    s = { ...s, ...mergeShotVersion(s, v1) } as WorkbenchShot;
    s = { ...s, ...mergeShotVersion(s, v2) } as WorkbenchShot;
    expect(selectedShotVersion(s)?.id).toBe('ver_2');

    const back = selectShotVersion(s, 'ver_1');
    expect(back).not.toBeNull();
    const s2 = { ...s, ...back } as WorkbenchShot;
    expect(selectedShotVersion(s2)?.guide?.id).toBe('gd_aaa1111');
    expect(s2.media?.storageKey).toBe('cas:v1.mp4');

    const del = deleteShotVersion(s2, 'ver_1');
    const s3 = { ...s2, ...del } as WorkbenchShot;
    expect(selectedShotVersion(s3)?.id).toBe('ver_2');
    expect(s3.media?.storageKey).toBe('cas:v2.mp4');

    const del2 = deleteShotVersion(s3, 'ver_2');
    const s4 = { ...s3, ...del2 } as WorkbenchShot;
    expect(shotVersions(s4)).toHaveLength(0);
    expect(s4.media).toBeUndefined();
    expect(s4.status).toBe('pending');
    expect(s4.clipState).toBe('placeholder');
  });

  it('存量只有 media 的片段也能读出版本（legacy），合并新版本时并入 versions', () => {
    const s = shot({
      status: 'done',
      clipState: 'completed',
      media: { storageKey: 'cas:old.mp4', guide: { id: 'gd_legacy4444' }, source: 'generated', createdAt: '2026-11-01T00:00:00.000Z' },
    });
    expect(shotVersions(s)).toHaveLength(1);
    const merged = { ...s, ...mergeShotVersion(s, version({ id: 'ver_new', storageKey: 'cas:new.mp4', guide: { id: 'gd_new5555' }, prompt: 'p', createdAt: '2026-11-15T03:00:00.000Z' })) } as WorkbenchShot;
    expect(shotVersions(merged)).toHaveLength(2);
    expect(merged.cache?.versions.some((v) => v.id === 'ver-legacy-s1')).toBe(true);
  });
});
