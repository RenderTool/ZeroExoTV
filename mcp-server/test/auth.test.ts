import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorize, hashToken } from "../src/auth.js";
import { paths } from "../src/config.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-mcp-auth-"));
  await fs.mkdir(path.dirname(paths.tokens(root)), { recursive: true });
  const tokens = [
    {
      id: "tok-a",
      hash: hashToken("zxp_scoped"),
      prefix: "zxp",
      projectIds: ["proj-A"],
      bits: ["project.read", "script.read"],
      createdAt: new Date().toISOString(),
    },
  ];
  await fs.writeFile(paths.tokens(root), JSON.stringify({ schemaVersion: 1, tokens }), "utf8");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("authorize（契约 §2 校验顺序）", () => {
  it("无效 token → AUTH_INVALID", async () => {
    await expect(authorize(root, "zxp_wrong", ["project.read"])).rejects.toMatchObject({
      code: "AUTH_INVALID",
    });
  });

  it("能力位不足 → AUTH_FORBIDDEN", async () => {
    await expect(authorize(root, "zxp_scoped", ["script.write"], "proj-A")).rejects.toMatchObject({
      code: "AUTH_FORBIDDEN",
    });
  });

  it("跨项目越权 → AUTH_PROJECT_DENIED", async () => {
    await expect(authorize(root, "zxp_scoped", ["project.read"], "proj-B")).rejects.toMatchObject({
      code: "AUTH_PROJECT_DENIED",
      details: { projectId: "proj-B", allowed: ["proj-A"] },
    });
  });

  it("作用域内调用通过", async () => {
    const rec = await authorize(root, "zxp_scoped", ["project.read"], "proj-A");
    expect(rec.id).toBe("tok-a");
  });

  it("已撤销 token → AUTH_INVALID（撤销立即生效，每次调用重读 tokens.json）", async () => {
    const file = JSON.parse(await fs.readFile(paths.tokens(root), "utf8"));
    file.tokens[0].revokedAt = new Date().toISOString();
    await fs.writeFile(paths.tokens(root), JSON.stringify(file), "utf8");
    await expect(authorize(root, "zxp_scoped", ["project.read"], "proj-A")).rejects.toMatchObject({
      code: "AUTH_INVALID",
    });
  });
});
