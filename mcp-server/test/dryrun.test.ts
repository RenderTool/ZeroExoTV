import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths } from "../src/config.js";
import { createEpisode, importScript, readScript } from "../src/store/script.js";
import { guardDryRunConfirm } from "../src/tools/_register.js";

let root: string;
const projectId = "proj-dryrun";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-mcp-dryrun-"));
  await fs.mkdir(paths.entitiesDir(projectId, root), { recursive: true });
  await createEpisode(root, projectId, { baseVersion: 0, content: "原始内容" });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("dryRun 预览与 confirm 纪律", () => {
  it("dryRun:true 返回 after 预览但磁盘不变", async () => {
    const res = await importScript(root, projectId, {
      baseVersion: 1,
      content: "<p>新剧本第二集内容</p>",
      strategy: "new_episode",
      dryRun: true,
    });
    expect(res.written).toBe(false);
    expect(res.after.episodes).toHaveLength(2); // 预览里有 2 集
    const onDisk = await readScript(root, projectId);
    expect(onDisk?.version).toBe(1); // 磁盘仍是 version 1
    expect(onDisk?.episodes).toHaveLength(1);
  });

  it("confirm 真实写入且 version+1", async () => {
    const res = await importScript(root, projectId, {
      baseVersion: 1,
      content: "<p>第二集</p>",
      strategy: "new_episode",
    });
    expect(res.written).toBe(true);
    const onDisk = await readScript(root, projectId);
    expect(onDisk?.version).toBe(2);
    expect(onDisk?.episodes).toHaveLength(2);
    expect(onDisk?.episodes[1].title).toBe("第2集");
  });

  it("overwrite 前自动备份到 entities/backups/", async () => {
    const res = await importScript(root, projectId, {
      baseVersion: 1,
      content: "<p>全量覆盖</p>",
      strategy: "overwrite",
    });
    expect(res.written).toBe(true);
    expect(res.backupPath).toBeTruthy();
    const backup = JSON.parse(await fs.readFile(res.backupPath!, "utf8"));
    expect(backup.episodes[0].content).toBe("原始内容"); // 备份里是覆盖前的内容
    const onDisk = await readScript(root, projectId);
    expect(onDisk?.episodes[0].content).toBe("<p>全量覆盖</p>");
  });

  it("dryRun 与 confirm 互斥 / 批量写必须显式二选一", () => {
    expect(() => guardDryRunConfirm({ dryRun: true, confirm: true })).toThrowError(
      expect.objectContaining({ code: "VALIDATION" }),
    );
    expect(() => guardDryRunConfirm({}, { requireOne: true })).toThrowError(
      expect.objectContaining({ code: "CONFIRM_REQUIRED" }),
    );
  });
});
