/**
 * canvas-store 单测（Plan#84 / 征集#184，2026-11-06）
 *
 * 锁的是"画布是项目的一等挂载物"这套契约里**最容易被改坏**的几处：
 * 1. 落点 = `projects/<pid>/canvases/<cid>.json`，裸 JSON（MCP 可直读，不分片）；
 * 2. 1 号 = 虚拟挂载：图走 loadProjectGraph/saveProjectGraph（`.lf/graph_data`），文件里只放元数据；
 * 3. 1 号不可删（用户硬要求）；
 * 4. 副本写入带 size+lastModified 乐观锁，外部改过 → 抛冲突且**磁盘保持外部内容**；
 * 5. 列表：1 号恒在首位，脏文件跳过不炸列表；
 * 6. id 校验 = 路径穿越防线。
 *
 * IO 全换内存适配器（mock `@/platform/fs.js`），不依赖真实目录授权。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mem, ConflictErrorMock } = vi.hoisted(() => {
  class ConflictErrorMock extends Error {
    constructor(public readonly path: string, public readonly current: { size: number; lastModified: number }) {
      super(`CONFLICT: ${path} 已被外部修改`);
      this.name = 'ConflictError';
    }
  }
  return {
    mem: {
      files: new Map<string, { text: string; size: number; lastModified: number }>(),
      clock: 1_000,
    },
    ConflictErrorMock,
  };
});

vi.mock('@/platform/fs.js', () => ({
  ConflictError: ConflictErrorMock,
  async ensureDir(): Promise<void> {},
  async writeJson(path: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value, null, 2);
    mem.clock += 10;
    mem.files.set(path, { text, size: text.length, lastModified: mem.clock });
  },
  async readJson<T>(path: string): Promise<T | null> {
    const f = mem.files.get(path);
    if (!f) return null;
    try { return JSON.parse(f.text) as T; } catch { return null; }
  },
  async stat(path: string) {
    const f = mem.files.get(path);
    return f ? { size: f.size, lastModified: f.lastModified } : null;
  },
  async writeJsonIfUnchanged(path: string, value: unknown, expected: { size: number; lastModified: number } | null) {
    const now = mem.files.get(path);
    if (expected && now && (now.size !== expected.size || now.lastModified !== expected.lastModified)) {
      throw new ConflictErrorMock(path, { size: now.size, lastModified: now.lastModified });
    }
    const text = JSON.stringify(value, null, 2);
    mem.clock += 10;
    mem.files.set(path, { text, size: text.length, lastModified: mem.clock });
  },
  async listDir(dir: string) {
    const prefix = `${dir}/`;
    const out: Array<{ name: string; kind: 'file' | 'dir' }> = [];
    for (const key of mem.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (!rest) continue;
      out.push({ name: rest, kind: rest.includes('/') ? 'dir' : 'file' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
  async remove(path: string) { mem.files.delete(path); },
}));

// 1 号虚拟挂载的图存储口：也换成内存（不碰 localforage）
const mainGraph = { current: null as unknown };
vi.mock('@zeroexo/plugin-persistence', () => ({
  loadProjectGraph: async () => (mainGraph.current ? JSON.parse(JSON.stringify(mainGraph.current)) : null),
  saveProjectGraph: async (_pid: string, graph: unknown) => { mainGraph.current = JSON.parse(JSON.stringify(graph)); },
}));

import {
  canvasPath,
  createCanvas,
  deleteCanvas,
  ensureCanvasMounts,
  getCanvas,
  isCanvasConflict,
  listCanvases,
  MAIN_CANVAS_ID,
  saveCanvas,
  type CanvasDocument,
} from './canvas-store.js';

const PID = 'p-canvas';

function emptyGraph() {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} };
}

/** 模拟外部工具（MCP/记事本）直接改盘 */
function externalRewrite(path: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2);
  mem.clock += 500;
  mem.files.set(path, { text, size: text.length, lastModified: mem.clock });
}

beforeEach(() => {
  mem.files.clear();
  mem.clock = 1_000;
  mainGraph.current = null;
});

describe('1 号主画布（虚拟挂载，不可删）', () => {
  it('ensureCanvasMounts 幂等：首次建元数据，重复调用不覆盖用户改过的标题', async () => {
    const first = await ensureCanvasMounts(PID);
    expect(first.created).toBe(true);
    expect([...mem.files.keys()]).toEqual([canvasPath(PID, MAIN_CANVAS_ID)]);

    const got = await getCanvas(PID, MAIN_CANVAS_ID);
    await saveCanvas(PID, MAIN_CANVAS_ID, { title: '我的主线', graph: emptyGraph() as never }, got!.stamp);
    await ensureCanvasMounts(PID);
    expect((await getCanvas(PID, MAIN_CANVAS_ID))!.doc.title).toBe('我的主线');
  });

  it('1 号的图落在 .lf 主 graph 口（saveCanvas 写 graph，文件里只留元数据）', async () => {
    await ensureCanvasMounts(PID);
    const got = await getCanvas(PID, MAIN_CANVAS_ID);
    await saveCanvas(PID, MAIN_CANVAS_ID, { graph: { ...emptyGraph(), nodes: [{ id: 'a' }] } as never }, got!.stamp);
    expect((mainGraph.current as { nodes: unknown[] }).nodes).toHaveLength(1);
    const onDisk = JSON.parse(mem.files.get(canvasPath(PID, MAIN_CANVAS_ID))!.text) as CanvasDocument;
    expect(onDisk.graph).toBeUndefined();
    expect(onDisk.graphRef).toBe('project');
    expect(onDisk.version).toBe(got!.doc.version + 1);
  });

  it('deleteCanvas(main) 抛错且不删任何东西（用户硬要求：1 号不可删）', async () => {
    await ensureCanvasMounts(PID);
    await expect(deleteCanvas(PID, MAIN_CANVAS_ID)).rejects.toThrow(/不可删除/);
    expect(mem.files.has(canvasPath(PID, MAIN_CANVAS_ID))).toBe(true);
  });
});

describe('副本画布', () => {
  it('createCanvas → projects/<pid>/canvases/<id>.json，裸 JSON 且 graphRef=inline', async () => {
    const doc = await createCanvas(PID, { id: 'scA100', title: '画布副本 1', graph: emptyGraph() as never, coverKey: 'image:x.png' });
    const path = canvasPath(PID, 'scA100');
    expect(path).toBe('projects/p-canvas/canvases/scA100.json');
    const raw = mem.files.get(path)!.text;
    expect(raw).not.toContain('_dataRef');
    expect(JSON.parse(raw)).toMatchObject({ id: 'scA100', kind: 'canvas', projectId: PID, graphRef: 'inline', locked: false, coverKey: 'image:x.png' });
    expect(doc.version).toBe(1);
  });

  it('外部改过后再写 → 抛 ConflictError 且磁盘保持外部内容（禁止静默覆盖）', async () => {
    await createCanvas(PID, { id: 'scB100', title: 'B', graph: emptyGraph() as never });
    const path = canvasPath(PID, 'scB100');
    const read = await getCanvas(PID, 'scB100');
    externalRewrite(path, { ...read!.doc, title: '外部改名' });
    const before = mem.files.get(path)!.text;
    await expect(saveCanvas(PID, 'scB100', { title: 'UI 覆盖' }, read!.stamp)).rejects.toThrow(/CONFLICT/);
    expect(mem.files.get(path)!.text).toBe(before);
    expect(isCanvasConflict(new ConflictErrorMock(path, { size: 1, lastModified: 1 }))).toBe(true);
  });

  it('新建撞名（外部抢先写同名）→ 冲突，不覆盖', async () => {
    externalRewrite(canvasPath(PID, 'scC100'), { kind: 'canvas', id: 'scC100', projectId: PID, title: '外部先建', graph: emptyGraph() });
    await expect(createCanvas(PID, { id: 'scC100', title: 'UI 后建', graph: emptyGraph() as never })).rejects.toThrow(/CONFLICT/);
    expect(JSON.parse(mem.files.get(canvasPath(PID, 'scC100'))!.text).title).toBe('外部先建');
  });

  it('列表：1 号恒在首位，副本带统计；脏文件跳过并 warn，不炸整个列表', async () => {
    await ensureCanvasMounts(PID);
    await createCanvas(PID, { id: 'scOld', title: '旧', graph: emptyGraph() as never });
    await createCanvas(PID, { id: 'scNew', title: '新', graph: { ...emptyGraph(), nodes: [{ id: 'x' }] } as never });
    externalRewrite(canvasPath(PID, 'scBroken'), { hello: 'world' });
    mem.files.set('projects/p-canvas/canvases/notes.txt', { text: 'hi', size: 2, lastModified: 1 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const list = await listCanvases(PID);
    expect(list[0]!.id).toBe(MAIN_CANVAS_ID);
    expect(list.map((c) => c.id)).toEqual([MAIN_CANVAS_ID, 'scNew', 'scOld']);
    expect(list[1]!.nodeCount).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('scBroken'));
    warn.mockRestore();
  });

  it('id 校验挡住路径穿越（../ 一律拒绝，不去拼路径）', async () => {
    for (const bad of ['../../etc/passwd', 'a/b', 'a\\b', 'short', 'main2']) {
      await expect(getCanvas(PID, bad)).rejects.toThrow(/非法/);
    }
  });
});
