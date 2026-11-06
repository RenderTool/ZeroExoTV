import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths } from "../src/config.js";
import { writeJsonAtomic } from "../src/store/fs-node.js";
import {
  assertSafeCanvasId,
  getCanvas,
  listCanvases,
  MAIN_CANVAS_ID,
  patchCanvasNodes,
  type CanvasDocument,
} from "../src/store/canvases.js";

let root: string;
const projectId = "proj-canvases";
const cid = "sc1abcdef";

function copyDoc(over: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    schemaVersion: 1,
    kind: "canvas",
    id: cid,
    projectId,
    title: "画布副本 1",
    order: 1,
    locked: false,
    coverKey: null,
    version: 1,
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
    graphRef: "inline",
    graph: {
      nodes: [
        { id: "n1", type: "image", position: { x: 0, y: 0 }, data: { prompt: "旧提示词", storageKey: "image:abc" } },
        { id: "n2", type: "video", position: { x: 300, y: 0 }, data: { prompt: "" } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, k: 1 },
      metadata: {},
    },
    ...over,
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-mcp-canvases-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("1 号主画布（虚拟挂载，读 .lf 主 graph）", () => {
  it("无 canvases 目录也返回 1 号；写入 .lf 主 graph 后统计与图都能读到", async () => {
    const empty = await listCanvases(root, projectId);
    expect(empty.map((c) => c.id)).toEqual([MAIN_CANVAS_ID]);
    expect(empty[0]!.writable).toBe(false);

    await writeJsonAtomic(paths.mainGraphFile(projectId, root), {
      __lf: 1,
      value: { version: 1, savedAt: Date.now(), graph: { nodes: [{ id: "a" }, { id: "b" }], edges: [{ id: "e1" }] } },
    });
    const list = await listCanvases(root, projectId);
    expect(list[0]!.nodeCount).toBe(2);
    expect(list[0]!.edgeCount).toBe(1);
    const main = await getCanvas(root, projectId, MAIN_CANVAS_ID);
    expect((main!.graph!.nodes as unknown[]).length).toBe(2);
  });

  it("canvases/main.json 存在时以它为准（标题/封面/时间戳来自元数据）", async () => {
    await fs.mkdir(paths.canvasesDir(projectId, root), { recursive: true });
    await writeJsonAtomic(paths.canvas(projectId, MAIN_CANVAS_ID, root), {
      ...copyDoc({ id: MAIN_CANVAS_ID, title: "我的主画布", coverKey: "image:cover.png", locked: true, graphRef: "project" }),
    });
    const list = await listCanvases(root, projectId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: MAIN_CANVAS_ID, title: "我的主画布", coverKey: "image:cover.png", locked: true });
  });

  it("patch 1 号一律拒绝（外部写会和前端自动保存抢盘）", async () => {
    await expect(
      patchCanvasNodes(root, projectId, MAIN_CANVAS_ID, { patches: [{ nodeId: "n1", data: { prompt: "x" } }] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("副本画布读与补丁", () => {
  beforeEach(async () => {
    await fs.mkdir(paths.canvasesDir(projectId, root), { recursive: true });
    await writeJsonAtomic(paths.canvas(projectId, cid, root), copyDoc());
  });

  it("list：1 号恒在首位，副本带统计与 writable", async () => {
    const list = await listCanvases(root, projectId);
    expect(list.map((c) => c.id)).toEqual([MAIN_CANVAS_ID, cid]);
    expect(list[1]).toMatchObject({ nodeCount: 2, writable: true, graphRef: "inline", locked: false });
  });

  it("脏文件与非 .json 被跳过，不阻断列表", async () => {
    await writeJsonAtomic(path.join(paths.canvasesDir(projectId, root), "scbroken.json"), { hello: "world" });
    await fs.writeFile(path.join(paths.canvasesDir(projectId, root), "notes.txt"), "hi", "utf8");
    const warn = console.warn;
    console.warn = () => {};
    const list = await listCanvases(root, projectId);
    console.warn = warn;
    expect(list.map((c) => c.id)).toEqual([MAIN_CANVAS_ID, cid]);
  });

  it("dryRun 只返回预览，磁盘保持原样", async () => {
    const res = await patchCanvasNodes(root, projectId, cid, {
      patches: [{ nodeId: "n1", data: { prompt: "新提示词" } }],
      dryRun: true,
    });
    expect(res.written).toBe(false);
    expect(JSON.stringify(res.after.graph)).toContain("新提示词");
    const onDisk = await getCanvas(root, projectId, cid);
    expect(JSON.stringify(onDisk!.graph)).toContain("旧提示词");
  });

  it("真实写入：data 浅合并保住 storageKey、version+1、updatedAt 刷新", async () => {
    const before = await getCanvas(root, projectId, cid);
    const res = await patchCanvasNodes(root, projectId, cid, {
      patches: [{ nodeId: "n1", data: { prompt: "新提示词" }, title: "首镜" }, { nodeId: "n2", position: { x: 10, y: 20 } }],
    });
    expect(res.written).toBe(true);
    expect(res.after.version).toBe((before!.version ?? 1) + 1);
    expect(res.after.updatedAt).not.toBe(before!.updatedAt);
    const after = await getCanvas(root, projectId, cid);
    const nodes = after!.graph!.nodes as Array<Record<string, unknown>>;
    expect(nodes[0]!.title).toBe("首镜");
    expect((nodes[0]!.data as { prompt: string }).prompt).toBe("新提示词");
    // 关键：浅合并必须保住同级字段（丢了 storageKey 就是图片全裂）
    expect((nodes[0]!.data as { storageKey: string }).storageKey).toBe("image:abc");
    expect(nodes[1]!.position).toEqual({ x: 10, y: 20 });
  });

  it("任一 nodeId 不存在 → 整体不写并回 missingNodeIds", async () => {
    await expect(
      patchCanvasNodes(root, projectId, cid, {
        patches: [{ nodeId: "n1", data: { prompt: "改了" } }, { nodeId: "nope", data: { prompt: "改了" } }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { missingNodeIds: ["nope"] } });
    const after = await getCanvas(root, projectId, cid);
    expect(JSON.stringify(after!.graph)).toContain("旧提示词");
  });

  it("patches 为空 / 画布不存在 各自可判别", async () => {
    await expect(patchCanvasNodes(root, projectId, cid, { patches: [] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(getCanvas(root, projectId, "scnotexist")).resolves.toBeNull();
    await expect(patchCanvasNodes(root, projectId, "scnotexist", { patches: [{ nodeId: "n1" }] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("路径穿越守卫", () => {
  it("非法 id（../、分隔符、过短、非 main/sc 前缀）一律 VALIDATION", () => {
    for (const bad of ["../../etc/passwd", "a/b", "a\\b", "sc", ".sc1hidden", "sc1$.json", "entity"]) {
      expect(() => assertSafeCanvasId(bad)).toThrowError();
    }
    expect(assertSafeCanvasId(cid)).toBe(cid);
    expect(assertSafeCanvasId(MAIN_CANVAS_ID)).toBe(MAIN_CANVAS_ID);
  });

  it("getCanvas 对非法 id 直接抛错，不去拼路径", async () => {
    await expect(getCanvas(root, projectId, "../escape")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
