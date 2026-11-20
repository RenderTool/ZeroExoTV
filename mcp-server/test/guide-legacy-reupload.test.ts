/**
 * 历史引导默认重传（2026-11-20 用户要求）。
 *
 * 锁两件事：
 * 1) 版本记录没有 sha256 时，提交前必须把本地 media/guides 那份重传覆盖云端（不能只信云端同名文件）；
 * 2) 重传成功后 sha 写进 guide-sha 台账，第二次提交按 sha 校验、云端一致就不再上传（400MB 不能每次都传）。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureComfyGuide } from "../src/broker/comfy.js";

let root: string;
const guideId = "gd_testlegacy01";

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-guide-legacy-"));
  process.env.ZEROEXO_DATA_ROOT = root;
  await fs.mkdir(path.join(root, "media", "guides"), { recursive: true });
  await fs.writeFile(path.join(root, "media", "guides", `${guideId}.safetensors`), Buffer.from("legacy-guide-content"));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.ZEROEXO_DATA_ROOT;
});

afterEach(() => vi.unstubAllGlobals());

describe("ensureComfyGuide 历史引导", () => {
  it("无 sha → 强制重传并记台账；有台账 sha 且云端匹配 → 不再上传", async () => {
    const posts: string[] = [];
    let cloudHasGuide = false;
    let cloudSha = "";
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if ((init?.method ?? "GET") === "GET") {
        expect(href).toContain(`/zeroexo/v1/guides/${guideId}`);
        if (!cloudHasGuide) {
          return new Response(JSON.stringify({ ok: true, exists: false }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ exists: true, sha256: cloudSha }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      posts.push(href);
      const buf = Buffer.from((init?.body as Uint8Array) ?? []);
      const crypto = await import("node:crypto");
      cloudSha = crypto.createHash("sha256").update(buf).digest("hex");
      cloudHasGuide = true;
      return new Response(JSON.stringify({ ok: true, sha256: cloudSha }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    // 第一次：版本记录没有 sha → 必须重传（即使云端「存在」也不认）
    cloudHasGuide = true;
    const oldSha = "0".repeat(64);
    cloudSha = oldSha;
    expect(await ensureComfyGuide("https://comfy.test", guideId, undefined)).toBe(true);
    expect(posts.length).toBe(1);

    const ledger = JSON.parse(await fs.readFile(path.join(root, ".lf", "zeroexo", "app_meta", "guide-sha.json"), "utf8")) as
      { guides: Record<string, { sha256: string }> };
    expect(ledger.guides[guideId]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(ledger.guides[guideId]!.sha256).not.toBe(oldSha);

    // 第二次：台账已有 sha，云端命中匹配 → 不上传
    expect(await ensureComfyGuide("https://comfy.test", guideId, undefined)).toBe(true);
    expect(posts.length).toBe(1);
  });
});
