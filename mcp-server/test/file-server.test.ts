/**
 * file-server（--fs-server 本地 HTTP 实体服务）行为断言：
 * 1. 启动时幂等创建 zeroexo-root.json（前端首次 GET 拿 200，不静默 404）；
 * 2. /file 404 返回带 message 的可读 JSON body；
 * 3. 路径沙箱：..、绝对盘符、反斜杠注入一律拦下或归一，正常子路径往返成功。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFileServer } from "../src/file-server.js";

let root: string;
let server: import("node:http").Server;
let base: string;

beforeAll(async () => {
  // 故意用一个**不存在的**目录路径：启动自愈必须把它建出来并落 zeroexo-root.json
  root = path.join(os.tmpdir(), `zeroexo-fs-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const port = 20000 + Math.floor(Math.random() * 20000);
  process.env.ZEROEXO_DATA_ROOT = root;
  process.env.ZEROEXO_FS_PORT = String(port);
  server = await startFileServer();
  // 启动后：数据根目录已自动创建
  const stat = await fs.stat(root);
  expect(stat.isDirectory()).toBe(true);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.ZEROEXO_DATA_ROOT;
  delete process.env.ZEROEXO_FS_PORT;
});

async function get(p: string): Promise<Response> {
  return fetch(`${base}/file?p=${encodeURIComponent(p)}`);
}

describe("root 标记幂等创建", () => {
  it("启动后数据根存在 zeroexo-root.json，且 GET 返回 200", async () => {
    const marker = path.join(root, "zeroexo-root.json");
    await fs.stat(marker); // 不存在则此断言抛错
    const res = await get("zeroexo-root.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { app: string };
    expect(body.app).toBe("zeroexo-studio");
  });

  it("标记内容稳定：重复读到的 JSON 与首次落盘内容一致", async () => {
    const disk = JSON.parse(await fs.readFile(path.join(root, "zeroexo-root.json"), "utf8")) as { app: string; createdAt: string };
    const res = await get("zeroexo-root.json");
    const served = (await res.json()) as { app: string; createdAt: string };
    expect(served).toEqual(disk); // 服务端原样返回，未被覆盖或改写
    expect(disk.app).toBe("zeroexo-studio");
  });
});

describe("/file 404 语义", () => {
  it("不存在的文件返回 404 + 可读 JSON body", async () => {
    const res = await get("no-such/missing.json");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message?: string };
    expect(body.error).toBe("NOT_FOUND");
    expect(typeof body.message).toBe("string");
    expect(body.message!.length).toBeGreaterThan(0);
  });
});

describe("路径沙箱与归一", () => {
  it("PUT+GET 正常子路径往返（含中文与子目录）", async () => {
    const rel = "projects/项目A/meta.json";
    const put = await fetch(`${base}/file?p=${encodeURIComponent(rel)}`, {
      method: "PUT",
      body: JSON.stringify({ id: "a" }),
    });
    expect(put.status).toBe(200);
    const res = await get(rel);
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ id: "a" });
  });

  it(".. 越出数据根 → 403 FORBIDDEN", async () => {
    const res = await get("../../Windows/win.ini");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("FORBIDDEN");
  });

  it("绝对盘符路径：盘符段被归一吃掉，路径困在数据根内（不逃逸）", async () => {
    // Windows path.resolve(root, 'C:', ...) 会丢弃盘符段，'C:/Windows/win.ini'
    // 被归一为 <root>/Windows/win.ini —— 不会逃出数据根，文件不存在即 404。
    // 断言双重性质：不 500、不返回数据根外内容（root 下 stat 佐证）。
    const res = await get("C:/Windows/win.ini");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; path: string };
    expect(body.error).toBe("NOT_FOUND");
    const escaped = await fs.stat(path.join(root, "Windows", "win.ini")).then(() => true, () => false);
    expect(escaped).toBe(false); // 数据根外不可能有 Windows/win.ini；根内也没被写过
  });

  it("反斜杠注入（%5C）被归一为分隔符，仍困在数据根内", async () => {
    // "a\\..\\..\\x" 反斜杠归一后等价于 "a/../../x" → 越界 403
    const evil = await get("a\\..\\..\\x.txt");
    expect(evil.status).toBe(403);
    // 正常反斜杠写法归一后可读写
    const ok = await fetch(`${base}/file?p=${encodeURIComponent("dirA\\file.txt")}`, {
      method: "PUT",
      body: "hello",
    });
    expect(ok.status).toBe(200);
    const back = await get("dirA/file.txt");
    expect(back.status).toBe(200);
    expect(await back.text()).toBe("hello");
  });
});

describe("mkdir / statmany", () => {
  it("POST /mkdir 创建目录；GET /statmany 返回 stat", async () => {
    const mk = await fetch(`${base}/mkdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "entities/ep-01" }),
    });
    expect(mk.status).toBe(200);
    const put = await fetch(`${base}/file?p=${encodeURIComponent("entities/ep-01/script.json")}`, {
      method: "PUT",
      body: "{}",
    });
    expect(put.status).toBe(200);
    const res = await fetch(`${base}/statmany?p=${encodeURIComponent("entities/ep-01")}`);
    const body = (await res.json()) as { stats: { path: string; size: number }[] };
    expect(body.stats.map((s) => s.path)).toContain("entities/ep-01/script.json");
  });
});
