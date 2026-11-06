/**
 * 公共提示词层下线（2026-11-05）一次性迁移测试（MCP 侧）：
 * - readWorkbench：历史 sharedParams.prompt 非空 → 并入每段 imagePrompt（去重）后删除字段并落盘（version+1）
 * - 空公共提示词 → 不迁移、version 不动
 * - 任何写入（updateWorkbench 链路）前也会先迁移
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths } from "../src/config.js";
import {
  migrateSharedPromptInPlace,
  readWorkbench,
  setShotPrompt,
  type WorkbenchContainer,
} from "../src/store/workbench.js";

let root: string;
const projectId = "proj-shared-prompt-migration";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-mcp-migration-"));
  await fs.mkdir(paths.entitiesDir(projectId, root), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** 造一个带历史公共提示词的旧 workbench.json */
async function seedLegacy(prompt: string, version = 1): Promise<void> {
  const wb: WorkbenchContainer = {
    schemaVersion: 1,
    version,
    updatedAt: "2026-11-04T00:00:00.000Z",
    title: "导演台",
    tracks: [{ id: "track-main", clips: [] }],
    shots: [
      { id: "seg-1", number: 1, description: "段一", duration: 5, status: "pending", clipState: "placeholder", references: [], imagePrompt: "段落甲" },
      { id: "seg-2", number: 2, description: "段二", duration: 5, status: "pending", clipState: "placeholder", references: [], imagePrompt: "" },
      { id: "seg-3", number: 3, description: "段三", duration: 5, status: "pending", clipState: "placeholder", references: [], imagePrompt: "公共锚点\n\n段落乙" },
    ],
    totalDuration: 15,
    sharedParams: { enabled: true, prompt, assets: [], presetId: "h3", params: { cfg: 1.0 } },
  } as WorkbenchContainer;
  await fs.writeFile(paths.workbench(projectId, root), JSON.stringify(wb), "utf8");
}

describe("migrateSharedPromptInPlace（纯函数）", () => {
  it("非空公共提示词并入每段（含空段/已含段去重），字段删除，无关字段不动", () => {
    const wb = {
      version: 5,
      shots: [
        { imagePrompt: "段落甲" },
        { imagePrompt: "" },
        { imagePrompt: "公共锚点\n\n段落乙" },
      ],
      sharedParams: { enabled: true, prompt: " 公共锚点 ", assets: [], presetId: "h3", params: { cfg: 1.5 } },
    } as unknown as WorkbenchContainer;
    expect(migrateSharedPromptInPlace(wb)).toBe(true);
    expect(wb.shots[0].imagePrompt).toBe("公共锚点\n\n段落甲");
    expect(wb.shots[1].imagePrompt).toBe("公共锚点");
    expect(wb.shots[2].imagePrompt).toBe("公共锚点\n\n段落乙");
    expect(wb.shots[2]!.imagePrompt!.split("公共锚点").length - 1).toBe(1); // 无重复
    expect((wb.sharedParams as Record<string, unknown>)).not.toHaveProperty("prompt");
    expect(wb.sharedParams).toMatchObject({ enabled: true, presetId: "h3", params: { cfg: 1.5 } });
  });

  it("prompt 为空/缺失 → 不迁移", () => {
    for (const prompt of ["", "   ", undefined]) {
      const wb = {
        version: 2,
        shots: [{ imagePrompt: "x" }],
        sharedParams: { enabled: true, prompt, assets: [], presetId: "h3" },
      } as unknown as WorkbenchContainer;
      expect(migrateSharedPromptInPlace(wb)).toBe(false);
      expect(wb.shots[0].imagePrompt).toBe("x");
    }
  });
});

describe("readWorkbench / 写入链路的一次性迁移", () => {
  it("readWorkbench：历史公共提示词非空 → 读取即迁移落盘（version+1，幂等只做一次）", async () => {
    await seedLegacy("公共锚点");
    const wb = await readWorkbench(root, projectId);
    expect(wb).not.toBeNull();
    for (const s of wb!.shots) {
      expect(s.imagePrompt).toContain("公共锚点");
      expect(s.imagePrompt!.split("公共锚点").length - 1).toBe(1);
    }
    expect((wb!.sharedParams as Record<string, unknown>)).not.toHaveProperty("prompt");
    expect(wb!.sharedParams).toMatchObject({ enabled: true, presetId: "h3", params: { cfg: 1.0 } });
    expect(wb!.version).toBe(2);
    // 幂等：再读不再迁移、version 不再前进
    const again = await readWorkbench(root, projectId);
    expect(again!.version).toBe(2);
  });

  it("公共提示词为空 → 读取不迁移、version 不动", async () => {
    await seedLegacy("");
    const wb = await readWorkbench(root, projectId);
    expect(wb!.version).toBe(1);
    expect(wb!.shots[0].imagePrompt).toBe("段落甲");
  });

  it("写入链路（setShotPrompt）前同样先迁移：迁移 + 本次 patch 一次落盘", async () => {
    await seedLegacy("公共锚点");
    const res = await setShotPrompt(root, projectId, {
      baseVersion: 1,
      shotId: "seg-2",
      imagePrompt: "段落乙",
    });
    expect(res.after.version).toBe(2);
    // 迁移已把公共锚点并入段1/段3；段2 被本次 patch 覆盖为「段落乙」
    expect(res.after.shots[0].imagePrompt).toBe("公共锚点\n\n段落甲");
    expect(res.after.shots[1].imagePrompt).toBe("段落乙");
    expect(res.after.shots[2].imagePrompt).toBe("公共锚点\n\n段落乙");
    expect((res.after.sharedParams as Record<string, unknown>)).not.toHaveProperty("prompt");
  });
});
