/**
 * MCP 剧本工具：normalize_script 与 import_script mode 语义
 *
 * - normalize_script 存在，输出标准格式，不写入项目；
 * - import_script 的 mode 必填；raw 允许入库并返回「先 normalize_script」建议（非错误）；
 * - standard 直接入库。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bootstrapToken } from "../src/auth.js";
import { registerScriptTools } from "../src/tools/script.js";
import { createEpisode, readScript } from "../src/store/script.js";

const PROJECT_ID = "p-import-mode";
const TOKEN = "zxp_import_mode_test";

let root: string;
let client: Client;
let close: () => Promise<void>;

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-import-mode-test-"));
  process.env.ZEROEXO_DATA_ROOT = root;
  process.env.ZEROEXO_MCP_TOKEN = TOKEN;
  await bootstrapToken(root);

  const server = new McpServer({ name: "import-mode-test", version: "0.0.1" });
  registerScriptTools(server, { getToken: () => TOKEN });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "import-mode-test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  close = async () => { await client.close(); await server.close(); };

  await createEpisode(root, PROJECT_ID, {
    baseVersion: 0,
    title: "第1集",
    content: "<p>旧内容</p>",
  });
});

afterAll(async () => {
  await close();
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.ZEROEXO_DATA_ROOT;
  delete process.env.ZEROEXO_MCP_TOKEN;
});

describe("剧本工具 mode 语义", () => {
  it("工具清单含 normalize_script；import_script 的 mode 必填", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("normalize_script");
    const importTool = tools.find((t) => t.name === "import_script");
    expect(importTool).toBeTruthy();
    const schema = importTool?.inputSchema as { required?: string[] } | undefined;
    expect(schema?.required ?? []).toContain("mode");
  });

  it("normalize_script 输出标准格式，不写项目", async () => {
    const res = await client.callTool({
      name: "normalize_script",
      arguments: { content: "# 雨夜\n## 第1集：来客\n### 第1场：杂货铺 · 内 · 夜\n老张：今天这么晚？" },
    });
    expect(textOf(res)).toContain("## 第1集");
    const script = await readScript(root, PROJECT_ID);
    expect(script?.version).toBe(1);
    expect(script?.episodes[0]?.content).toBe("<p>旧内容</p>");
  });

  it("mode 缺失：仍报错（必填校验）", async () => {
    const res = await client.callTool({
      name: "import_script",
      arguments: {
        projectId: PROJECT_ID,
        baseVersion: 1,
        content: "# 雨夜\n## 第1集：来客",
        strategy: "new_episode",
        confirm: true,
      },
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  it("import_script(mode:raw) 允许入库，返回成功 + normalize_script 建议（非错误）", async () => {
    const res = await client.callTool({
      name: "import_script",
      arguments: {
        projectId: PROJECT_ID,
        baseVersion: 1,
        content: "# 雨夜\n## 第1集：来客",
        mode: "raw",
        strategy: "new_episode",
        confirm: true,
      },
    });
    // 不算失败：不返回 error 语义
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const payload = JSON.parse(textOf(res)) as { written?: boolean; version?: number; hint?: string };
    expect(payload.written).toBe(true);
    expect(payload.version).toBe(2);
    expect(payload.hint ?? "").toContain("normalize_script");
    const script = await readScript(root, PROJECT_ID);
    expect(script?.version).toBe(2);
    expect(script?.episodes[1]?.content).toContain("来客");
  });

  it("import_script(mode:standard) 直接入库", async () => {
    const res = await client.callTool({
      name: "import_script",
      arguments: {
        projectId: PROJECT_ID,
        baseVersion: 2,
        content: "# 雨夜\n## 第1集：来客\n### 第1场：杂货铺 · 内 · 夜\n老张：今天这么晚？",
        mode: "standard",
        strategy: "new_episode",
        confirm: true,
      },
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const payload = JSON.parse(textOf(res)) as { written?: boolean; version?: number };
    expect(payload.written).toBe(true);
    const script = await readScript(root, PROJECT_ID);
    expect(script?.version).toBe(3);
    expect(script?.episodes[2]?.content).toContain("老张");
  });
});
