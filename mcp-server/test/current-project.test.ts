/**
 * get_current_project 的数据层：前端广播优先，没有广播才退回「最近修改」。
 * 返回里的 source 决定 Agent 怎么开口（open = 你正开着；recent = 只是最近改过，要确认）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { paths } from "../src/config.js";
import { readCurrentProject } from "../src/store/current-project.js";

let root: string;

async function writeProjects(value: Array<{ id: string; title: string; updatedAt: string }>): Promise<void> {
  const file = paths.projectsMeta(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      __lf: 1,
      value: value.map((v) => ({ ...v, createdAt: v.updatedAt, tags: [], nodeCount: 0, version: 1 })),
    }),
    "utf8",
  );
}

async function writeBroadcast(projectId: string | null): Promise<void> {
  const file = paths.currentProject(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ schemaVersion: 1, projectId, openedAt: "2026-11-10T09:00:00.000Z" }),
    "utf8",
  );
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-current-project-"));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("readCurrentProject", () => {
  it("没有广播也没有项目 → null", async () => {
    await writeProjects([]);
    expect(await readCurrentProject(root)).toBeNull();
  });

  it("没有广播 → 退回最近修改的项目，source=recent", async () => {
    await writeProjects([
      { id: "p-old", title: "老项目", updatedAt: "2026-11-01T00:00:00.000Z" },
      { id: "p-new", title: "新项目", updatedAt: "2026-11-09T00:00:00.000Z" },
    ]);
    const cur = await readCurrentProject(root);
    expect(cur?.projectId).toBe("p-new");
    expect(cur?.source).toBe("recent");
  });

  it("有广播 → 当前打开的项目，source=open 并带 title/openedAt", async () => {
    await writeBroadcast("p-old");
    const cur = await readCurrentProject(root);
    expect(cur).toMatchObject({ projectId: "p-old", title: "老项目", source: "open" });
    expect(cur?.openedAt).toBe("2026-11-10T09:00:00.000Z");
  });

  it("广播的项目已被删除 → 仍报 open，title 留空（不静默换成别的项目）", async () => {
    await writeBroadcast("p-gone");
    const cur = await readCurrentProject(root);
    expect(cur).toMatchObject({ projectId: "p-gone", title: "", source: "open" });
  });

  it("广播 projectId=null（用户在列表页）→ 退回最近修改", async () => {
    await writeBroadcast(null);
    const cur = await readCurrentProject(root);
    expect(cur?.source).toBe("recent");
    expect(cur?.projectId).toBe("p-new");
  });
});
