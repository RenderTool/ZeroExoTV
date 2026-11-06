/**
 * 容器写串行锁回归测试（2026-11-06）
 *
 * 起因：用户反馈「主体类型依然不能修改」——点「改类型」后徽标闪一下就变回去。
 * 根因不在 UI（事件冒泡那轮已修），而在存储层：
 * updateStoryboardContainer 是无锁的 read-merge-write，而改类型一次连发两笔写
 * （subjectTree + entities）。两笔都在对方落盘前读到同一份旧内容，后完成的那笔
 * 用旧 subjectTree 覆盖回去 → 改动被静默吞掉，写回的容器再把本地状态拉回旧值。
 *
 * 这里的 IO 用「读 1 跳 / 写 3 跳 + JSON 深拷贝」还原真实磁盘语义
 * （真实链路的快照钩子只会把窗口拉得更宽），所以旧实现必然失败、串行后必然通过。
 */
import { describe, expect, it } from 'vitest';
import {
  readStoryboardContainer,
  updateStoryboardContainer,
  updateWorkbenchContainer,
  type ContainersIO,
  type StoryboardContainer,
  type WorkbenchContainer,
} from './slot-containers.js';

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** 深拷贝读写 + 可配延迟的假磁盘（读永远看不到未完成的写，等同真实文件语义） */
function makeFs(seed: Record<string, unknown>): { io: ContainersIO; files: Map<string, unknown> } {
  const files = new Map<string, unknown>(Object.entries(seed));
  const io: ContainersIO = {
    readJson: async <T,>(path: string) => {
      await sleep(1);
      const raw = files.get(path);
      return raw === undefined ? null : (JSON.parse(JSON.stringify(raw)) as T);
    },
    writeJson: async (path: string, value: unknown) => {
      await sleep(3);
      files.set(path, JSON.parse(JSON.stringify(value)));
    },
  };
  return { io, files };
}

function seedStoryboard(entities: unknown[], subjectTree: unknown[]): StoryboardContainer {
  return {
    schemaVersion: 1, version: 1, title: '主体库', shots: [],
    entities, subjectTree, updatedAt: new Date().toISOString(),
  };
}

const PID = 'p-lock';
const PATH = `projects/${PID}/entities/storyboard.json`;

describe('主体库容器并发写不互相覆盖', () => {
  it('同一 tick 连发 subjectTree + entities 两笔（= 改类型）：两处新值都保住', async () => {
    const { io } = makeFs({
      [PATH]: seedStoryboard(
        [{ id: 'item-1', name: '东海龙王', kind: 'character' }],
        [{ rootId: 'subj-1', name: '东海龙王', kind: 'character', states: [], baseState: {} }],
      ),
    });

    // 复刻 changeKind 的两连发：先整棵 subjectTree 替换，再回写条目 kind
    const p1 = updateStoryboardContainer(PID, {
      subjectTree: [{ rootId: 'subj-1', name: '东海龙王', kind: 'scene', states: [], baseState: {} }],
    }, io);
    const p2 = updateStoryboardContainer(PID, {
      entities: [{ id: 'item-1', name: '东海龙王', kind: 'scene' }],
    }, io);
    await Promise.all([p1, p2]);

    const final = await readStoryboardContainer(PID, io);
    expect((final?.subjectTree as Array<{ kind: string }>)[0]?.kind).toBe('scene');
    expect((final?.entities as Array<{ kind: string }>)[0]?.kind).toBe('scene');
  });

  it('函数式 patch 基于刚读到的最新容器计算：并发追加不丢条目', async () => {
    const { io } = makeFs({ [PATH]: seedStoryboard([], []) });

    const p1 = updateStoryboardContainer(PID, (c) => ({
      entities: [...(c.entities as unknown[]), { id: 'a' }],
    }), io);
    const p2 = updateStoryboardContainer(PID, (c) => ({
      entities: [...(c.entities as unknown[]), { id: 'b' }],
    }), io);
    await Promise.all([p1, p2]);

    const final = await readStoryboardContainer(PID, io);
    expect((final?.entities as Array<{ id: string }>).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('串行后版本号连续递增（每笔写各 +1，不出现同版本覆盖）', async () => {
    const { io } = makeFs({ [PATH]: seedStoryboard([], []) });
    await Promise.all([
      updateStoryboardContainer(PID, { title: 'A' }, io),
      updateStoryboardContainer(PID, { title: 'B' }, io),
    ]);
    const final = await readStoryboardContainer(PID, io);
    expect(final?.version).toBe(3); // seed 1 → 两笔各 +1
    expect(final?.title).toBe('B');  // 后发起的按发起顺序排在后面
  });

  it('一笔写失败不堵死队列（后续写照常落盘）', async () => {
    const { io } = makeFs({ [PATH]: seedStoryboard([], []) });
    let first = true;
    const flaky: ContainersIO = {
      readJson: io.readJson,
      writeJson: async (path, value) => {
        if (first) { first = false; throw new Error('EIO'); }
        return io.writeJson(path, value);
      },
    };

    await expect(updateStoryboardContainer(PID, { title: 'X' }, flaky)).rejects.toThrow('EIO');
    // 同一项目的下一笔写走正常 IO：队列没有被失败的那笔卡住
    const ok = await updateStoryboardContainer(PID, { title: 'Y' }, io);
    expect(ok.title).toBe('Y');
    expect((await readStoryboardContainer(PID, io))?.title).toBe('Y');
  });

  it('导演台容器同样串行：tracks + shots 两笔都保住', async () => {
    const wbPath = `projects/${PID}/entities/workbench.json`;
    const seed: WorkbenchContainer = {
      schemaVersion: 1, version: 1, title: '导演台',
      tracks: [{ id: 'track-main' }], shots: [{ id: 'seg-1' }], totalDuration: 5,
      updatedAt: new Date().toISOString(),
    };
    const { io } = makeFs({ [wbPath]: seed });

    await Promise.all([
      updateWorkbenchContainer(PID, { tracks: [{ id: 'track-main' }, { id: 'track-2' }] }, io),
      updateWorkbenchContainer(PID, { shots: [{ id: 'seg-1' }, { id: 'seg-2' }] }, io),
    ]);

    const raw = await io.readJson<WorkbenchContainer>(wbPath);
    expect(raw?.tracks).toHaveLength(2);
    expect(raw?.shots).toHaveLength(2);
  });
});
