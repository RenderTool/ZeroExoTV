import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths } from "../src/config.js";
import { createEpisode, readScript } from "../src/store/script.js";

let root: string;
const projectId = "proj-conflict";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-mcp-conflict-"));
  await fs.mkdir(paths.entitiesDir(projectId, root), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("baseVersion 乐观锁（读后写）", () => {
  it("baseVersion=0 创建剧本，version 从 1 开始", async () => {
    const res = await createEpisode(root, projectId, { baseVersion: 0, content: "第一场" });
    expect(res.written).toBe(true);
    expect(res.after.version).toBe(1);
    expect(res.episode.title).toBe("第1集");
  });

  it("过期 baseVersion → VERSION_CONFLICT（携带 expected/actual）", async () => {
    await createEpisode(root, projectId, { baseVersion: 0 });
    // 第一次正常写入：version 1 → 2
    await createEpisode(root, projectId, { baseVersion: 1 });
    // 用过期的 baseVersion=1 再写 → 冲突
    await expect(
      createEpisode(root, projectId, { baseVersion: 1 }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      details: { expected: 1, actual: 2 },
    });
    // 冲突后磁盘数据未被污染
    const script = await readScript(root, projectId);
    expect(script?.version).toBe(2);
    expect(script?.episodes).toHaveLength(2);
  });

  it("已存在实体上 baseVersion=0 → 冲突而非覆盖", async () => {
    await createEpisode(root, projectId, { baseVersion: 0 });
    await expect(createEpisode(root, projectId, { baseVersion: 0 })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });
});
