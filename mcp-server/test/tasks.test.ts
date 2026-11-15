/**
 * MCP Task Broker 任务表 + 片段缓存 guide 解析回归（2026-11-15）。
 *
 * 核心验收：重生成第 2 段必须取「第 1 段当前缓存版本」的 guide；切换第 1 段版本后立即生效；
 * 上一段没有 guide 时明确 none（绝不回退插件 LAST_GUIDE）。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  claimTask,
  createTask,
  listTasks,
  readTask,
  releaseTask,
  taskSnapshot,
  updateTask,
  cancelTask,
} from "../src/store/tasks.js";
import type { WorkbenchShot } from "../src/store/workbench.js";
import {
  appendVersion,
  removeVersion,
  resolveGuide,
  selectedVersion,
} from "../src/broker/shot-cache.js";
import { contiguousRuns, imageSize } from "../src/broker/executor.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-tasks-"));
  process.env.ZEROEXO_DATA_ROOT = root;
});

afterAll(async () => {
  delete process.env.ZEROEXO_DATA_ROOT;
  await fs.rm(root, { recursive: true, force: true });
});

function shot(id: string, extra: Partial<WorkbenchShot> = {}): WorkbenchShot {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    description: "",
    shotType: "",
    duration: 5,
    imagePrompt: `提示词 ${id}`,
    videoPrompt: "",
    status: "pending",
    clipState: "placeholder",
    references: [],
    paramValues: {},
    ...extra,
  };
}

describe("任务表：持久化 / 状态机 / 多写者", () => {
  it("提交后落盘，刷新（重新读文件）仍在；终态不可再被取消", async () => {
    const task = await createTask(root, {
      projectId: "p1",
      kind: "director_run",
      request: { kind: "director_run", selectedIds: ["s1", "s2"] },
    });
    expect(task.state).toBe("queued");
    expect(task.segments).toHaveLength(2);
    const reread = await readTask(task.taskId, root);
    expect(reread?.segments.map((s) => s.shotId)).toEqual(["s1", "s2"]);

    const canceled = await cancelTask(task.taskId, root);
    expect(canceled.state).toBe("canceled");
    expect(canceled.segments.every((s) => s.state === "canceled")).toBe(true);

    const again = await cancelTask(task.taskId, root);
    expect(again.state).toBe("canceled");
  });

  it("跨进程只允许一个执行者：lease 有效时第二个认领失败，释放后可再认领", async () => {
    const task = await createTask(root, {
      projectId: "p1",
      kind: "canvas_image",
      request: { kind: "canvas_image", requests: [{ prompt: "猫" }] },
    });
    expect(await claimTask(task.taskId, root)).toBe(true);
    // 同进程身份再次 claim 是续约（允许）；模拟另一进程需替换 lease 文件 owner
    await fs.writeFile(
      path.join(root, ".lf", "zeroexo", "app_meta", "tasks", `${task.taskId}.lease`),
      JSON.stringify({ owner: "other-process", pid: 999999, heartbeatAt: new Date().toISOString() }),
      "utf8",
    );
    expect(await claimTask(task.taskId, root)).toBe(false);
    await fs.writeFile(
      path.join(root, ".lf", "zeroexo", "app_meta", "tasks", `${task.taskId}.lease`),
      JSON.stringify({ owner: "other-process", pid: 999999, heartbeatAt: new Date(Date.now() - 60_000).toISOString() }),
      "utf8",
    );
    expect(await claimTask(task.taskId, root)).toBe(true); // 心跳过期 → 抢占
    await releaseTask(task.taskId, root);
  });

  it("进度推进写回，列表按项目过滤，快照带请求与逐段输出", async () => {
    const task = await createTask(root, {
      projectId: "p2",
      kind: "director_run",
      request: { kind: "director_run", selectedIds: ["s1"] },
    });
    await updateTask(task.taskId, (t) => {
      t.state = "running";
      t.segments[0]!.state = "running";
      t.segments[0]!.guide = { id: "gd_abc12345", source: "cache", sourceShotId: "s0" };
      t.currentSegment = 1;
    }, root);
    const now = await readTask(task.taskId, root);
    expect(now?.currentSegment).toBe(1);
    const list = await listTasks(root, { projectId: "p2" });
    expect(list.map((t) => t.taskId)).toContain(task.taskId);
    const snapshot = taskSnapshot(now!);
    expect(snapshot.request).toEqual({ kind: "director_run", selectedIds: ["s1"] });
    expect((snapshot.segments as Array<{ guide: { source: string } }>)[0]!.guide.source).toBe("cache");
    expect(await listTasks(root, { projectId: "nope" })).toHaveLength(0);
  });
});

describe("片段缓存：第 2 段取第 1 段当前缓存 guide", () => {
  it("默认选中最新版本；上一段无 guide 时返回 none（不回退 LAST_GUIDE）", () => {
    const s1 = shot("s1");
    const s2 = shot("s2");
    const s3 = shot("s3");
    appendVersion(s1, { storageKey: "cas:a.mp4", guide: { id: "gd_first1111", frames: 22 } });
    expect(selectedVersion(s1)?.guide?.id).toBe("gd_first1111");
    expect(resolveGuide([s1, s2, s3], 1)).toMatchObject({ id: "gd_first1111", source: "cache", sourceShotId: "s1" });
    appendVersion(s2, { storageKey: "cas:b.mp4" });
    expect(resolveGuide([s1, s2, s3], 2)).toMatchObject({ id: "", source: "none" });
  });

  it("切换第 1 段缓存版本后，第 2 段的 guide 立即跟着换", () => {
    const s1 = shot("s1");
    const s2 = shot("s2");
    const first = appendVersion(s1, { storageKey: "cas:a.mp4", guide: { id: "gd_first1111" } });
    const second = appendVersion(s1, { storageKey: "cas:a2.mp4", guide: { id: "gd_second222", frames: 39 } });
    expect(selectedVersion(s1)?.id).toBe(second.id);
    expect(resolveGuide([s1, s2], 1)).toMatchObject({ id: "gd_second222", source: "cache" });
    // 人工切回第一版 → guide 跟着回到第一版
    s1.cache!.selectedVersionId = first.id;
    expect(resolveGuide([s1, s2], 1)).toMatchObject({ id: "gd_first1111", source: "cache" });
  });

  it("本段显式引导槽优先于上一段缓存；删除选中版本后切到剩余版本", () => {
    const s1 = shot("s1");
    const s2 = shot("s2", { guide: { id: "gd_slotexplicit" } });
    appendVersion(s1, { storageKey: "cas:a.mp4", guide: { id: "gd_first1111" } });
    expect(resolveGuide([s1, s2], 1)).toMatchObject({ id: "gd_slotexplicit", source: "slot" });

    const v = appendVersion(s1, { storageKey: "cas/latest.mp4", guide: { id: "gd_latest3333" } });
    expect(removeVersion(s1, v.id)).toBe(true);
    expect(selectedVersion(s1)?.guide?.id).toBe("gd_first1111");
    expect(s1.media?.storageKey).toContain("cas");
  });

  it("存量只有 media 的片段视为 legacy 版本，仍能作为下一段 guide", () => {
    const s1 = shot("s1", {
      clipState: "completed",
      status: "done",
      media: { storageKey: "cas:legacy.mp4", guide: { id: "gd_legacy4444" }, source: "generated" },
    });
    const s2 = shot("s2");
    expect(resolveGuide([s1, s2], 1)).toMatchObject({ id: "gd_legacy4444", source: "cache" });
  });
});

describe("批次续接：选 3,4,6,7 只发起始 guide（2 和 5），run 内自动续接", () => {
  it("按时间线相邻切成 [[3,4],[6,7]]，每个 run 的起始段取上一段当前缓存 guide", () => {
    const all = Array.from({ length: 12 }, (_, i) => shot(`s${i + 1}`));
    // 第 2 段、第 5 段已有缓存引导（之前生成过）
    appendVersion(all[1]!, { storageKey: "cas:s2.mp4", guide: { id: "gd_seg2guide" } });
    appendVersion(all[4]!, { storageKey: "cas:s5.mp4", guide: { id: "gd_seg5guide" } });
    const selected = ["s4", "s3", "s7", "s6"]; // 乱序传也按时间线切
    const runs = contiguousRuns(all, selected);
    expect(runs).toEqual([[2, 3], [5, 6]]);

    // 每个 run 只解析第一段的起始 guide：3 吃 2，6 吃 5；4/7 由插件内循环续接
    expect(resolveGuide(all, runs[0]![0]!)).toMatchObject({ id: "gd_seg2guide", source: "cache", sourceShotId: "s2" });
    expect(resolveGuide(all, runs[1]![0]!)).toMatchObject({ id: "gd_seg5guide", source: "cache", sourceShotId: "s5" });
  });

  it("只选孤立段（3 / 6）时各自成一个 run，各自发起始 guide", () => {
    const all = Array.from({ length: 8 }, (_, i) => shot(`s${i + 1}`));
    appendVersion(all[1]!, { storageKey: "cas:s2.mp4", guide: { id: "gd_seg2guide" } });
    appendVersion(all[4]!, { storageKey: "cas:s5.mp4", guide: { id: "gd_seg5guide" } });
    expect(contiguousRuns(all, ["s3", "s6"])).toEqual([[2], [5]]);
    expect(resolveGuide(all, 2)).toMatchObject({ id: "gd_seg2guide" });
    expect(resolveGuide(all, 5)).toMatchObject({ id: "gd_seg5guide" });
  });

  it("起始段之前没有缓存 guide → none（任务准入会拒绝，不允许乱接）", () => {
    const all = Array.from({ length: 8 }, (_, i) => shot(`s${i + 1}`));
    expect(resolveGuide(all, 2)).toMatchObject({ id: "", source: "none" });
  });
});

describe("图片尺寸头解析", () => {
  it("PNG 头部给出真实宽高，非法数据回退 1024", () => {
    const png = Buffer.alloc(33);
    png.write("\x89PNG", 0, "binary");
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });
    expect(imageSize(Buffer.from("not an image"))).toEqual({ width: 1024, height: 1024 });
  });
});
