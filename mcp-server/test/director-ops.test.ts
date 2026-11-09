/**
 * 2026-11-09 新增 MCP 工具回归（SPEC project-rules/specs/mcp-e2e-guide/spec.md §6）。
 *
 * 覆盖：批量时长、引导槽、参数契约、作业参数派生与引导优先级、产物回写闭环、
 * 历史读取、T0 的 fs handler 同进程复用。
 * 全部经 MCP InMemoryTransport 的 tools/call 调用，不直连 ComfyUI（fetch 被 stub）。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bootstrapToken } from "../src/auth.js";
import { createProject } from "../src/store/projects.js";
import { handleFsRequest } from "../src/file-server.js";
import { registerWorkbenchTools } from "../src/tools/workbench.js";
import { registerDirectorOpsTools } from "../src/tools/director-ops.js";

let root: string;
let projectId: string;
let client: Client;
let closeAll: () => Promise<void>;

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown> & { isError?: boolean }> {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.type === "text" ? res.content[0].text : "{}";
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text as string); } catch { parsed = {}; }
  return { isError: res.isError === true, ...parsed };
}

async function version(): Promise<number> {
  const wb = await call("get_workbench", { projectId });
  return (wb.version as number) ?? 0;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-director-ops-"));
  process.env.ZEROEXO_DATA_ROOT = root;
  const token = "zxp_director_ops_test";
  process.env.ZEROEXO_MCP_TOKEN = token;
  await bootstrapToken(root);
  projectId = (await createProject(root, { title: "导演台工具测试" })).id;

  const server = new McpServer({ name: "test-server", version: "0.0.1" });
  const ctx = { getToken: () => token };
  registerWorkbenchTools(server, ctx as never);
  registerDirectorOpsTools(server, ctx as never);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(ct);
  closeAll = async () => { await client.close(); await server.close(); };
});

afterAll(async () => {
  await closeAll();
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.ZEROEXO_DATA_ROOT;
  delete process.env.ZEROEXO_MCP_TOKEN;
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("批量时长与参数契约", () => {
  it("set_segment_duration：一次调用改全部片段、version 只 +1、dryRun 不落盘", async () => {
    let v = await version();
    for (let i = 0; i < 3; i += 1) {
      const r = await call("add_segment", { projectId, baseVersion: v, description: `片段 ${i}`, duration: 5 });
      v = r.version as number;
    }
    const before = await call("get_workbench", { projectId });
    const total = (before.shots as unknown[]).length;

    const dry = await call("set_segment_duration", { projectId, baseVersion: v, all: true, duration: 9, dryRun: true });
    expect(dry.written).toBe(false);
    expect((await call("get_workbench", { projectId })).version).toBe(v);

    const res = await call("set_segment_duration", { projectId, baseVersion: v, all: true, duration: 4, confirm: true });
    expect(res.version).toBe(v + 1);
    expect((res.changed as unknown[]).length).toBe(total);
    expect((res.totalDuration as number)).toBe(4 * total);
    const after = await call("get_workbench", { projectId });
    expect((after.shots as Array<{ duration: number }>).every((s) => s.duration === 4)).toBe(true);
  });

  it("get_param_schema：真名 steps/scaleFactor/refImageSize，禁造键被列出", async () => {
    const s = await call("get_param_schema", {});
    const shared = s.shared as Record<string, { default?: unknown; options?: string[]; min?: number }>;
    expect(shared.steps?.default).toBe(25);
    expect(shared.scaleFactor?.min).toBe(0.1);
    expect(shared.refImageSize?.options).toContain("match");
    expect(s.forbiddenKeys).toContain("resolution");
    expect(s.forbiddenKeys).toContain("imageMatch");
  });

  it("set_shot_guide：写/移除引导槽不动 references，非法 id 被拒", async () => {
    const wb = await call("get_workbench", { projectId });
    const shot = (wb.shots as Array<{ id: string; references: unknown[] }>)[0]!;

    const bad = await call("set_shot_guide", {
      projectId, baseVersion: wb.version, shotId: shot.id, guide: { id: "../evil" },
    });
    expect(bad.isError).toBe(true);

    const set = await call("set_shot_guide", {
      projectId, baseVersion: wb.version, shotId: shot.id,
      guide: { id: "gd_abc12345", frames: 22, title: "来自历史" },
    });
    expect((set.guide as { id: string }).id).toBe("gd_abc12345");
    expect(set.references).toBe(shot.references.length);

    const removed = await call("set_shot_guide", {
      projectId, baseVersion: await version(), shotId: shot.id, guide: null,
    });
    expect(removed.guide).toBe(null);
  });
});

describe("作业提交与引导优先级（fetch stub）", () => {
  it("run_generation：派生 86×64 / 107 帧 / steps=3；重跑单段取上一段 media.guide", async () => {
    const videoPath = path.join(root, "fake.mp4");
    const guidePath = path.join(root, "gd_prev1234.safetensors");
    await fs.writeFile(videoPath, "fake");
    await fs.writeFile(guidePath, "fake");

    let submitted = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/zeroexo/v1/jobs")) {
        submitted += 1;
        return { ok: true, text: async () => JSON.stringify({ jobId: `job-${submitted}`, state: "queued" }) };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true, jobId: "job-1", state: "success",
          outputs: [{ kind: "video", path: videoPath }],
          guide: { id: "gd_prev1234", path: guidePath, frames: 22, sha256: "sha" },
          guideSource: "none", guideInPath: "",
        }),
      };
    }));

    let v = await version();
    const sp = await call("set_shared_params", {
      projectId, baseVersion: v, presetId: "h3",
      params: { steps: 3, scaleFactor: 0.1, refImageSize: "match", continuityOverlapFrames: 22, continuityEnabled: true },
    });
    v = sp.version as number;

    const wb0 = await call("get_workbench", { projectId });
    const shots = wb0.shots as Array<{ id: string }>;
    const first = shots[0]!.id;
    const second = shots[1]!.id;

    // 回写第 1 段产物 guide（等价网页 onSegmentDone + autoLand）
    const sync = await call("sync_job_results", {
      projectId, baseVersion: v, confirm: true,
      jobs: [{ jobId: "job-1", shotId: first }],
    });
    expect(sync.historyWritten).toBe(1);
    const wb1 = await call("get_workbench", { projectId });
    const media = (wb1.shots as Array<{ id: string; media?: { guide?: { id?: string } } }>).find((s) => s.id === first)?.media;
    expect(media?.guide?.id).toBe("gd_prev1234");

    // 只重跑第 2 段：必须拿到第 1 段的 guide 作为显式 guide_id
    const run = await call("run_generation", {
      projectId, episode: "1", confirm: true, selectedIds: [second],
    });
    expect(run.width).toBe(86);
    expect(run.height).toBe(64); // 钳到插件 min=64
    const jobs = run.jobs as Array<{ params: Record<string, unknown>; shotId: string }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.params.frames).toBe(107); // 4s → 17k+5 吸附
    expect(jobs[0]!.params.steps).toBe(3);
    expect(jobs[0]!.params.guide_frames).toBe(22);
    expect(jobs[0]!.params.guide_id).toBe("gd_prev1234");
    expect(jobs[0]!.params.use_prev_guide).toBe(false);

    // 显式槽优先于上一段产物
    const v2 = await version();
    await call("set_shot_guide", {
      projectId, baseVersion: v2, shotId: second,
      guide: { id: "gd_explicit99", frames: 22 },
    });
    const run2 = await call("run_generation", {
      projectId, episode: "1", confirm: true, selectedIds: [second],
    });
    const jobs2 = run2.jobs as Array<{ params: Record<string, unknown> }>;
    expect(jobs2[0]!.params.guide_id).toBe("gd_explicit99");
    expect(jobs2[0]!.params.use_prev_guide).toBe(false);
  });

  it("list_history：只读带 guide 的导演台产物", async () => {
    const all = await call("list_history", { projectId, source: "all" });
    expect((all.items as unknown[]).length).toBeGreaterThan(0);
    const director = await call("list_history", { projectId, source: "director", withGuideOnly: true });
    expect((director.items as Array<{ guide?: { id?: string } }>).every((a) => !!a.guide?.id)).toBe(true);
    const canvas = await call("list_history", { projectId, source: "canvas" });
    expect(canvas.total).toBe(0);
  });
});

describe("T0：fs REST handler 可挂到同进程的独立 http.Server", () => {
  it("/health 返回 200 且 service=zeroexo-fs", async () => {
    const srv = http.createServer((req, res) => { void handleFsRequest(req, res); });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    try {
      const port = (srv.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe("zeroexo-fs");
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});

describe("CAS 落库与存量修复（2026-11-09：storageKey 不能是磁盘绝对路径）", () => {
  const assetsFile = (): string =>
    path.join(root, ".lf", "zeroexo", "app_state", "zeroexo%3Aassets.json");
  const readAssets = async (): Promise<{ value: Array<Record<string, unknown>> }> =>
    JSON.parse(await fs.readFile(assetsFile(), "utf8")) as { value: Array<Record<string, unknown>> };

  it("sync_job_results 把视频写进 CAS，历史记录与 workbench.media 都用 cas: key", async () => {
    const videoPath = path.join(root, "e2e-clip.mp4");
    const guidePath = path.join(root, "gd_castest.safetensors");
    await fs.writeFile(videoPath, "fake-mp4-bytes");
    await fs.writeFile(guidePath, "fake-guide");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true, jobId: "job-cas", state: "success",
        outputs: [{ kind: "video", path: videoPath }],
        guide: { id: "gd_castest", path: guidePath, frames: 22 },
        guideSource: "none", guideInPath: "",
      }),
    })));

    const wb = await call("get_workbench", { projectId });
    const shotId = (wb.shots as Array<{ id: string }>)[0]!.id;
    const res = await call("sync_job_results", {
      projectId, baseVersion: wb.version, confirm: true,
      jobs: [{ jobId: "job-cas", shotId }],
    });
    expect(res.historyWritten).toBe(1);

    const env = await readAssets();
    const rec = env.value.find((a) => {
      const d = a.data as { storageKey?: string } | undefined;
      return typeof d?.storageKey === "string" && d.storageKey.startsWith("cas:");
    });
    expect(rec).toBeTruthy();
    const casKey = (rec!.data as { storageKey: string }).storageKey;
    const casFile = path.join(root, "media", "cas", casKey.slice(4));
    expect((await fs.stat(casFile)).isFile()).toBe(true);

    const wb2 = await call("get_workbench", { projectId });
    const shot = (wb2.shots as Array<{ id: string; media?: { storageKey?: string } }>).find((s) => s.id === shotId);
    expect(shot?.media?.storageKey).toMatch(/^cas:/);
  });

  it("repair_asset_storage_keys：绝对路径 → cas:，二次调用幂等", async () => {
    const videoPath = path.join(root, "legacy-clip.mp4");
    await fs.writeFile(videoPath, "legacy-bytes");
    const file = assetsFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const env = await readAssets();
    env.value.push({
      id: "legacy-abs", title: "旧产物", kind: "video", mimeType: "video/mp4", projectId,
      scope: "project", favorite: false, folderId: null, tags: [], bytes: 12,
      createdAt: new Date().toISOString(),
      data: { kind: "video", url: "", storageKey: videoPath, origin: "generation", originSource: "director" },
    });
    await fs.writeFile(file, JSON.stringify(env, null, 2), "utf8");

    const r1 = await call("repair_asset_storage_keys", {});
    expect(r1.repaired).toBeGreaterThanOrEqual(1);
    const after = await readAssets();
    const rec = after.value.find((a) => a.id === "legacy-abs")!;
    expect((rec.data as { storageKey: string }).storageKey).toMatch(/^cas:/);

    const r2 = await call("repair_asset_storage_keys", {});
    expect(r2.repaired).toBe(0);
  });
});
