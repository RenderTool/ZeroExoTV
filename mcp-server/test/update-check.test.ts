/**
 * MCP 自我更新感知（2026-11-11 用户要求）：
 * 网页写 mcp-required.json，MCP 比对后把「该更新了」放进工具返回，Agent 自己感知。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MCP_REQUIRED_MANIFEST,
  buildUpdateStatus,
  isDistOutdated,
  readRequiredManifest,
  requiredManifestPath,
  resolveRepoRoot,
} from "../src/lib/update-check.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-mcp-update-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeManifest(requiredTools: string[]): Promise<void> {
  const file = requiredManifestPath(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, requiredTools, writtenAt: new Date().toISOString() }), "utf8");
}

describe("mcp-required manifest", () => {
  it("路径固定为 .lf/zeroexo/app_meta/mcp-required.json", () => {
    expect(MCP_REQUIRED_MANIFEST).toBe(".lf/zeroexo/app_meta/mcp-required.json");
    expect(requiredManifestPath(root).replace(/\\/g, "/")).toContain(MCP_REQUIRED_MANIFEST);
  });

  it("没有 manifest → required=null，不误报旧版", async () => {
    expect(await readRequiredManifest(root)).toBeNull();
    const status = await buildUpdateStatus({
      root, tools: ["a"], serverEntry: path.join(root, "repo", "mcp-server", "dist", "index.js"),
      startedAtMs: Date.now(),
    });
    expect(status.required).toBeNull();
    expect(status.missing).toEqual([]);
    expect(status.hint).toBeNull();
  });

  it("缺工具 → missing 精确列出，并给出更新/重启提示（Agent 第一次调用就能感知）", async () => {
    await writeManifest(["list_projects", "plan_continuity_edit", "mcp_update_status"]);
    const status = await buildUpdateStatus({
      root, tools: ["list_projects"], serverEntry: path.join(root, "repo", "mcp-server", "dist", "index.js"),
      startedAtMs: Date.now(),
    });
    expect(status.missing).toEqual(["plan_continuity_edit", "mcp_update_status"]);
    expect(status.hint).toContain("缺少前端要求的 2 个工具");
    expect(status.hint).toContain("update_mcp_server");
  });

  it("工具齐全 + dist 没变 → 不提示；dist 比进程新 → 提示重启", async () => {
    const repo = path.join(root, "repo");
    const dist = path.join(repo, "mcp-server", "dist");
    await fs.mkdir(dist, { recursive: true });
    const entry = path.join(dist, "index.js");
    await fs.writeFile(entry, "// entry", "utf8");
    await writeManifest(["list_projects"]);
    // 进程启动时间晚于文件写入 = 进程加载的是最新 dist
    const started = Date.now() + 5000;
    const ok = await buildUpdateStatus({ root, tools: ["list_projects"], serverEntry: entry, startedAtMs: started });
    expect(ok.missing).toEqual([]);
    expect(ok.distOutdated).toBe(false);
    expect(ok.hint).toBeNull();

    // 进程启动后才重新编译 → distOutdated
    expect(await isDistOutdated(entry, Date.now() - 10_000)).toBe(true);
    const stale = await buildUpdateStatus({ root, tools: ["list_projects"], serverEntry: entry, startedAtMs: Date.now() - 10_000 });
    expect(stale.distOutdated).toBe(true);
    expect(stale.hint).toContain("重启");
  });
});

describe("resolveRepoRoot", () => {
  it("只认 <repo>/mcp-server/dist/index.js", () => {
    const entry = path.join("D:", "repo", "mcp-server", "dist", "index.js");
    expect(resolveRepoRoot(entry)).toBe(path.join("D:", "repo"));
    expect(resolveRepoRoot(path.join("D:", "repo", "mcp-server", "src", "index.ts"))).toBeNull();
    expect(resolveRepoRoot(path.join("D:", "repo", "other", "dist", "index.js"))).toBeNull();
  });
});
