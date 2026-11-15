import { describe, expect, it, vi } from 'vitest';

const updateSpy = vi.hoisted(() => vi.fn(async () => undefined));
const readSpy = vi.hoisted(() => vi.fn(async (): Promise<unknown> => ({
  shots: [
    {
      id: 's1',
      references: [
        { id: 'r1', kind: 'image', origin: { kind: 'subject-state', rootId: 'root-1', nodeId: 'st-1' } },
        { id: 'r2', kind: 'image', origin: { kind: 'subject-state', rootId: 'root-1', nodeId: 'st-2' } },
        { id: 'r3', kind: 'image', origin: { kind: 'subject-base', rootId: 'root-1' } },
      ],
    },
  ],
})));

vi.mock('@/entities/slot-containers.js', () => ({
  readWorkbenchContainer: readSpy,
  updateWorkbenchContainer: updateSpy,
}));

describe('removeSubjectReferences', () => {
  it('删除状态只移除该 nodeId 的 subject-state 引用，其它状态/主体基准保留', async () => {
    const { removeSubjectReferences } = await import('./subject-reference-cleanup.js');
    await removeSubjectReferences('p1', 'root-1', 'st-1');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const shots = (updateSpy.mock.calls[0] as unknown as [string, { shots: Array<{ references: Array<{ id: string }> }> }])[1].shots;
    expect(shots[0]!.references.map((r) => r.id)).toEqual(['r2', 'r3']);
  });

  it('删除整个主体移除 root 下全部 subject 引用', async () => {
    updateSpy.mockClear();
    const { removeSubjectReferences } = await import('./subject-reference-cleanup.js');
    await removeSubjectReferences('p1', 'root-1');
    const shots = (updateSpy.mock.calls[0] as unknown as [string, { shots: Array<{ references: Array<{ id: string }> }> }])[1].shots;
    expect(shots[0]!.references.map((r) => r.id)).toEqual([]);
  });

  it('删除一张历史图只移除 mediaKey 匹配的引用', async () => {
    readSpy.mockResolvedValueOnce({
      shots: [{
        id: 's1',
        references: [
          { id: 'r1', kind: 'image', origin: { kind: 'subject-state', rootId: 'root-1', nodeId: 'st-1', mediaKey: 'k1' } },
          { id: 'r2', kind: 'image', origin: { kind: 'subject-state', rootId: 'root-1', nodeId: 'st-1', mediaKey: 'k2' } },
        ],
      }],
    });
    updateSpy.mockClear();
    const { removeSubjectReferences } = await import('./subject-reference-cleanup.js');
    await removeSubjectReferences('p1', 'root-1', 'st-1', 'k1');
    const shots = (updateSpy.mock.calls[0] as unknown as [string, { shots: Array<{ references: Array<{ id: string }> }> }])[1].shots;
    expect(shots[0]!.references.map((r) => r.id)).toEqual(['r2']);
  });
});
