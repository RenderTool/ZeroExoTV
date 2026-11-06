/**
 * 新用户零安装路径（guides）断言：
 * 1. initialize 返回的 instructions 非空且含五阶段流水线规则词（收料/转剧本/提主体/拆分镜/出片前、
 *    逐步确认 gate、未入库不得、等用户、最少需要问、mode/dryRun/禁止）；
 * 2. listPrompts 含 get_started / bootstrap_project，且 bootstrap_project 文本含阶段2/阶段4 停止点；
 * 3. listResources 含 zeroexo://guides/index 与八模块资源；
 * 4. 读 zeroexo://guides/script 资源内容含 import_script 与 mode（含阶段 gate）；
 * 5. index 资源列出全部 8 个模块与 5 个阶段；bootstrap_project prompt 可带剧本原文参数。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "../src/guides/instructions.js";
import { registerGuidePrompts, registerGuideResources } from "../src/guides/register.js";
import { MODULE_KEYS, PIPELINE_STAGES } from "../src/guides/module-specs.js";
import { bootstrapToken } from "../src/auth.js";

let root: string;
let client: Client;
let cleanupServer: () => Promise<void>;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-guides-test-"));
  process.env.ZEROEXO_DATA_ROOT = root;
  const token = "zxp_guides_test";
  process.env.ZEROEXO_MCP_TOKEN = token;
  await bootstrapToken(root);

  // 与 src/index.ts buildServer 同构的 guides 装配（instructions + resources + prompts）
  const server = new McpServer(
    { name: "guides-test-server", version: "0.0.1" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerGuideResources(server);
  registerGuidePrompts(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "guides-test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  cleanupServer = async () => { await client.close(); await server.close(); };
});

afterAll(async () => {
  await cleanupServer();
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.ZEROEXO_DATA_ROOT;
  delete process.env.ZEROEXO_MCP_TOKEN;
});

describe("initialize instructions（五阶段流水线零安装规则）", () => {
  it("非空且包含关键规则词：项目/剧本/mode/dryRun/禁止/阶段指示", () => {
    const instructions = client.getInstructions();
    expect(instructions).toBeTruthy();
    for (const kw of ["项目", "剧本", "mode", "dryRun", "禁止", "阶段1", "流水线"]) {
      expect(instructions).toContain(kw);
    }
  });

  it("含数据同源说明与五阶段流水线（收料/转剧本/提主体/拆分镜/出片前）", () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("同一");
    expect(instructions).toContain("ZEROEXO_DATA_ROOT");
    for (const stage of PIPELINE_STAGES) {
      expect(instructions).toContain(`阶段${stage.stage}`);
    }
    for (const kw of ["收料", "转剧本", "提主体", "拆分镜", "出片前"]) {
      expect(instructions).toContain(kw);
    }
  });

  it("每阶段 gate 明确：未入库不得 / 等用户 / 最少需要问", () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("未入库不得");
    expect(instructions).toContain("等用户");
    expect(instructions).toContain("未过 gate 不得进下一步");
    expect(instructions).toContain("最少需要问");
    expect(instructions).toContain("可以拆");
    expect(instructions).toContain("禁止提交任何真实 GPU 生成任务");
  });
});

describe("prompts", () => {
  it("listPrompts 包含 get_started / bootstrap_project", async () => {
    const res = await client.listPrompts();
    const names = res.prompts.map((p) => p.name);
    expect(names).toContain("get_started");
    expect(names).toContain("bootstrap_project");
  });

  it("get_prompt bootstrap_project 返回五阶段模板，含阶段2/阶段4 停止点，可附剧本原文参数", async () => {
    const res = await client.getPrompt({ name: "bootstrap_project" });
    expect(res.messages.length).toBeGreaterThan(0);
    const text = JSON.stringify(res.messages);
    // 五阶段骨架
    for (const kw of ["阶段1", "阶段2", "阶段3", "阶段4", "阶段5"]) {
      expect(text).toContain(kw);
    }
    expect(text).toContain("create_project");
    expect(text).toContain("upsert_subject");
    // 阶段2 停止点：等用户确认开始导入
    expect(text).toContain("停：等用户确认「开始导入」");
    // 阶段4 停止点：等用户确认可以拆
    expect(text).toContain("停：等用户确认「可以拆」");

    const withScript = await client.getPrompt({
      name: "bootstrap_project",
      arguments: { script_content: "# 秀才住破庙\n第一集 夜宿" },
    });
    expect(JSON.stringify(withScript.messages)).toContain("秀才住破庙");
  });

  it("get_prompt get_started 含五阶段与最少需要问的问题清单", async () => {
    const res = await client.getPrompt({ name: "get_started" });
    const text = JSON.stringify(res.messages);
    expect(text).toContain("项目名");
    expect(text).toContain("mode");
    expect(text).toContain("阶段1");
    expect(text).toContain("每阶段停下等用户确认");
    expect(text).toContain("最少需要问");
  });
});

describe("resources", () => {
  it("listResources 包含 zeroexo://guides/index 与八模块资源", async () => {
    const res = await client.listResources();
    const uris = res.resources.map((r) => r.uri);
    expect(uris).toContain("zeroexo://guides/index");
    for (const key of MODULE_KEYS) {
      expect(uris).toContain(`zeroexo://guides/${key}`);
    }
    expect(MODULE_KEYS.length).toBe(8);
  });

  it("读 zeroexo://guides/script 资源内容含 import_script 与 mode（含阶段 gate）", async () => {
    const res = await client.readResource({ uri: "zeroexo://guides/script" });
    const text = res.contents.map((c) => ("text" in c ? c.text : "")).join("");
    expect(text).toContain("import_script");
    expect(text).toContain("mode");
    expect(text).toContain("normalize_script");
    expect(text).toContain("阶段2");
    expect(text).toContain("未入库不得");
    expect(text).toContain("脚本规范化属于 MCP 流程");
    expect(text).toContain("软件只做校验");
    // 软门槛：优先规范化，raw 也允许入库
    expect(text).toContain("优先 normalize_script");
    expect(text).toContain("raw");
  });

  it("读 index 资源列出全部 8 个模块与 5 个阶段", async () => {
    const res = await client.readResource({ uri: "zeroexo://guides/index" });
    const text = res.contents.map((c) => ("text" in c ? c.text : "")).join("");
    const parsed = JSON.parse(text) as {
      moduleCount: number;
      stages: Array<{ stage: number; name: string }>;
      modules: Array<{ key: string; stage: number }>;
    };
    expect(parsed.moduleCount).toBe(8);
    expect(parsed.stages.length).toBe(5);
    expect(parsed.stages.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5]);
    const keys = parsed.modules.map((m) => m.key);
    for (const key of MODULE_KEYS) {
      expect(keys).toContain(key);
    }
    expect(parsed.modules.every((m) => m.stage >= 1 && m.stage <= 5)).toBe(true);
  });
});
