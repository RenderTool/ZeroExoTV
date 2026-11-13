import { describe, expect, it } from 'vitest';
import { groupSceneEntities, sceneGroupKey } from '../src/lib/scene-groups.js';

describe('场景主体归并（一个地点一个主体）', () => {
  it('云顶大厦的宴会厅/办公室/保安部归到同一个地点键', () => {
    expect(sceneGroupKey('云顶大厦宴会厅')).toBe('云顶大厦');
    expect(sceneGroupKey('云顶大厦28层总裁办公室')).toBe('云顶大厦');
    expect(sceneGroupKey('云顶大厦保安部')).toBe('云顶大厦');
    expect(sceneGroupKey('京郊三号区铁门外-夜')).toBe('京郊三号区铁门外');
  });

  it('只返回 ≥2 个主体的组，并选出 target', () => {
    const groups = groupSceneEntities([
      { id: 's1', name: '云顶大厦宴会厅', kind: 'scene' },
      { id: 's2', name: '云顶大厦28层总裁办公室', kind: 'scene' },
      { id: 's3', name: '云顶大厦保安部', kind: 'scene' },
      { id: 's4', name: '医院走廊', kind: 'scene' },
      { id: 'c1', name: '云顶大厦', kind: 'character' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('云顶大厦');
    expect(groups[0]!.sources.map((x) => x.id)).toEqual(['s2', 's3']);
  });
});
