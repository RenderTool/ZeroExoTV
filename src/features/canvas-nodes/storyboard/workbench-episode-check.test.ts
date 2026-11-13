import { describe, expect, it } from 'vitest';
import { buildEpisodeCheck } from './workbench-episode-check.js';
import type { WorkbenchShot } from './workbench-types.js';

function shot(patch: Partial<WorkbenchShot> = {}): WorkbenchShot {
  return {
    id: 'seg-1',
    number: 1,
    description: '段',
    shotType: '',
    duration: 5,
    imagePrompt: '画面',
    videoPrompt: '视频',
    status: 'pending',
    clipState: 'placeholder',
    references: [{ id: 'r1', kind: 'image', storageKey: 'cas:x' } as never],
    paramValues: {},
    ...patch,
  };
}

describe('本集检查（用户语言，不出现工程术语）', () => {
  it('查得出：没画面提示词 / 没视频提示词 / 没参考图 / 时长超范围', () => {
    const res = buildEpisodeCheck([
      shot({ id: 'a', imagePrompt: '' }),
      shot({ id: 'b', videoPrompt: '' }),
      shot({ id: 'c', references: [] }),
      shot({ id: 'd', duration: 20 }),
    ]);
    const byKey = Object.fromEntries(res.issues.map((i) => [i.key, i.count]));
    expect(byKey.image).toBe(1);
    expect(byKey.video).toBe(1);
    expect(byKey.reference).toBe(1);
    expect(byKey.duration).toBe(1);
    expect(res.ready).toBe(false);
    // 用户看到的都是短句，不含英文字段名/错误码
    for (const issue of res.issues) {
      expect(issue.label).not.toMatch(/[A-Z_]{3,}/);
    }
  });

  it('准备齐了就是通过，并给出段数与总时长', () => {
    const res = buildEpisodeCheck([shot({ duration: 6 }), shot({ id: 'b', duration: 7 })]);
    expect(res.ready).toBe(true);
    expect(res.shotCount).toBe(2);
    expect(res.durationSec).toBe(13);
  });
});
