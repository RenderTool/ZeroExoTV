/**
 * 剧本导入契约断言（project-rules/docs/script-import-contract.md）：
 * 1. normalizeScript 纯函数：fixture → normalized + report 全字段；
 * 2. import_script 缺 mode 直接报错（禁止静默默认）；
 * 3. normalize_script 不落库（调用后数据根剧本无变化）；
 * 4. standard 落库 = 规范化文本；raw 落库 = 原样。
 *
 * fixture 与前端 script-normalize.test.ts 逐字相同（双侧对齐铁律）。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerScriptTools } from "../src/tools/script.js";
import { readScript } from "../src/store/script.js";
import { createProject } from "../src/store/projects.js";
import { bootstrapToken } from "../src/auth.js";

/** 契约 fixture（与前端测试逐字一致，禁止单侧修改） */
export const CONTRACT_FIXTURE = [
  "# 秀才住破庙",
  "引子，一个落魄书生的故事。",
  "",
  "第一集 夜宿",
  "第1场 莱州官道 夜",
  "张秀才：天黑了，何处安身？",
  "（低声）他裹紧行囊。",
  "寒风卷起尘土。",
  "[主体 @张秀才]",
  "",
].join("\n");

/** 契约期望输出（与前端测试逐字一致） */
export const CONTRACT_EXPECTED = [
  "# 秀才住破庙",
  "## 第1集：夜宿",
  "### 第1场：莱州官道 · 内 · 夜",
  "张秀才：天黑了，何处安身？",
  "（低声）他裹紧行囊。",
  "寒风卷起尘土。",
  "[主体 @张秀才]",
].join("\n");

let root: string;
let pid: string;
let client: Client;
let cleanupServer: () => Promise<void>;

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {}; // 错误响应可能非 JSON（如 SDK 层报错），走 raw 断言
  }
  return { isError: res.isError === true, ok: !res.isError, raw: text, ...parsed };
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-script-test-"));
  process.env.ZEROEXO_DATA_ROOT = root;
  const token = "zxp_contract_test";
  process.env.ZEROEXO_MCP_TOKEN = token;
  await bootstrapToken(root); // 落 tokens.json（全 bits + projectIds:*，从 env 读明文）

  pid = (await createProject(root, { title: "契约测试项目" })).id;

  const server = new McpServer({ name: "test-server", version: "0.0.1" });
  // _register.ts 的 Ctx 接口是 { getToken(): string | undefined }，defTool 内部自行 authorize
  const ctx = { getToken: () => token };
  registerScriptTools(server, ctx as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  cleanupServer = async () => { await client.close(); await server.close(); };
});

afterAll(async () => {
  await cleanupServer();
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.ZEROEXO_DATA_ROOT;
  delete process.env.ZEROEXO_MCP_TOKEN;
});

describe("normalize_script 纯函数 + 工具", () => {
  it("fixture → 期望输出逐字一致（与前端测试共用 fixture）", async () => {
    const res = await call("normalize_script", { content: CONTRACT_FIXTURE });
    expect(res.isError).toBe(false);
    expect((res as { normalized: string }).normalized).toBe(CONTRACT_EXPECTED);
    const report = (res as { report: Record<string, unknown> }).report;
    expect(report.episodeCount).toBe(1);
    expect(report.sceneCount).toBe(1);
    expect(report.dialogueCount).toBe(1);
    expect(report.actionLineCount).toBe(2);
    expect(report.subjects).toEqual(["张秀才"]);
    expect(report.unknownSceneMeta).toBe(1);
    expect(report.discardedSegments).toEqual(["引子，一个落魄书生的故事。"]);
  });

  it("不落库：调用 normalize_script 后剧本实体无变化", async () => {
    const before = await readScript(root, pid).catch(() => null);
    await call("normalize_script", { content: CONTRACT_FIXTURE });
    const after = await readScript(root, pid).catch(() => null);
    expect(after).toEqual(before); // 未创建/未改动
  });

  it("空内容报错", async () => {
    const res = await call("normalize_script", { content: "" });
    expect(res.isError).toBe(true);
  });
});

describe("import_script mode 契约", () => {
  it("缺 mode 直接报错（禁止静默默认）", async () => {
    const res = await call("import_script", {
      projectId: pid, baseVersion: 0, content: CONTRACT_FIXTURE, strategy: "new_episode", confirm: true,
    });
    expect(res.isError).toBe(true);
    const msg = JSON.stringify(res);
    expect(msg).toContain("mode");
  });

  it("standard：落库内容 = 规范化文本（与 normalize_script 同一函数）", async () => {
    const res = await call("import_script", {
      projectId: pid, baseVersion: 0, content: CONTRACT_EXPECTED,
      mode: "standard", strategy: "new_episode", title: "规范化集", confirm: true,
    });
    expect(res.isError, `standard 落库失败: ${res.raw}`).toBe(false);
    const script = await readScript(root, pid);
    expect(script.episodes.length).toBe(1);
    const stored = script.episodes[0].content ?? "";
    // HTML 入库（script content 为编辑器 HTML），剥离标签后应含规范化文本的关键行；
    // 集名不是正文块（2026-11-05 契约）：标题进 Episode.title，正文从第一场开始
    const plain = stored.replace(/<[^>]+>/g, "\n");
    expect(plain).not.toContain("第1集：夜宿");
    // 显式 title 优先（调用方传了「规范化集」）
    expect(script.episodes[0].title).toBe("规范化集");
    // 场次标题入库转成编辑器 HTML 块（INT. 地点 - 时间）
    expect(plain).toContain("莱州官道");
    expect(plain).toContain("INT.");
    expect(plain).not.toContain("引子，一个落魄书生的故事。"); // 规范化稿里已丢弃
  });

  it("raw：原样入库（丢弃段也在）", async () => {
    // 契约：standard 导入后 version 已 +1，raw 必须重新读取后再写（乐观锁生效）
    const cur = await readScript(root, pid);
    const res = await call("import_script", {
      projectId: pid, baseVersion: cur!.version, content: CONTRACT_FIXTURE,
      mode: "raw", strategy: "new_episode", title: "原样集", confirm: true,
    });
    expect(res.isError, `raw 落库失败: ${res.raw}`).toBe(false);
    const script = await readScript(root, pid);
    const stored = (script.episodes[1] ?? script.episodes[0]).content ?? "";
    const plain = stored.replace(/<[^>]+>/g, "\n");
    expect(plain).toContain("引子，一个落魄书生的故事。"); // raw 保留
  });
});
