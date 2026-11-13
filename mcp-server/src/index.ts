#!/usr/bin/env node
/**
 * zeroexo-mcp-server 入口。
 * 默认 stdio（本地 Agent spawn）；--http [--port N] 开 StreamableHTTP（远程 Agent，需 Authorization Bearer）。
 * --selfcheck 打印自检信息并退出；--help 打印用法。
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bootstrapToken } from "./auth.js";
import { startFileServer, handleFsRequest, fsServerPort, ensureFsRoot } from "./file-server.js";
import { dataRoot, paths } from "./config.js";
import { TOOL_REGISTRY, TOOL_ACCESS, type Ctx } from "./tools/_register.js";
import { SERVER_INSTRUCTIONS } from "./guides/instructions.js";
import { buildStateOverview } from "./guides/state-overview.js";
import { registerGuidePrompts, registerGuideResources } from "./guides/register.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerScriptTools } from "./tools/script.js";
import { registerSplitTools } from "./tools/split.js";
import { registerSubjectTools } from "./tools/subjects.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerWorkbenchTools } from "./tools/workbench.js";
import { registerStoryboardIngestTools } from "./tools/storyboard-ingest.js";
import { registerPreflightTools } from "./tools/preflight.js";
import { registerContinuityTools } from "./tools/continuity.js";
import { registerUpdateTools } from "./tools/update.js";
import { registerCanvasTools } from "./tools/canvases.js";
import { registerImageJobTools } from "./tools/image-jobs.js";
import { registerPlanTools } from "./tools/plan.js";
import { registerDirectorOpsTools } from "./tools/director-ops.js";
import { registerStyleTools } from "./tools/style.js";
import { registerUpgradeTools } from "./tools/upgrade.js";

/**
 * 连接即概览：把「当前数据状态」拼进 initialize 的 instructions。
 * 新会话一连上就知道有哪些项目、做到哪步、缺什么，不用用户再讲一遍。
 * 5s 缓存 + 3s 超时：数据根异常不阻断连接。
 */
let overviewCache: { at: number; text: string } | null = null;
async function withOverview(): Promise<string> {
  const now = Date.now();
  if (overviewCache && now - overviewCache.at < 5000) {
    return overviewCache.text ? `${SERVER_INSTRUCTIONS}\n\n${overviewCache.text}` : SERVER_INSTRUCTIONS;
  }
  try {
    const text = await Promise.race([
      buildStateOverview(dataRoot()),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 3000)),
    ]);
    overviewCache = { at: now, text };
    return text ? `${SERVER_INSTRUCTIONS}\n\n${text}` : SERVER_INSTRUCTIONS;
  } catch {
    return SERVER_INSTRUCTIONS;
  }
}

async function buildServer(ctx: Ctx): Promise<McpServer> {
  // instructions 内置整套操作规则（零安装路径），细节规格经 guides 资源/prompts 按需取
  const server = new McpServer(
    { name: "zeroexo-mcp-server", version: "0.2.0" },
    { instructions: await withOverview() },
  );
  registerGuideResources(server);
  registerGuidePrompts(server);
  registerProjectTools(server, ctx);
  registerScriptTools(server, ctx);
  registerSplitTools(server, ctx);
  registerSubjectTools(server, ctx);
  registerAssetTools(server, ctx);
  registerWorkbenchTools(server, ctx);
  registerStoryboardIngestTools(server, ctx);
  registerPreflightTools(server, ctx);
  registerContinuityTools(server, ctx);
  registerUpdateTools(server, ctx);
  registerCanvasTools(server, ctx);
  registerImageJobTools(server, ctx);
  registerPlanTools(server, ctx);
  registerDirectorOpsTools(server, ctx);
  registerStyleTools(server, ctx);
  registerUpgradeTools(server, ctx);
  return server;
}

/**
 * 启动印章：把真实绝对路径写进 <dataRoot>/.mcp/server-info.json。
 * 浏览器 File System Access 拿不到目录绝对路径，前端 MCP 设置页靠本文件
 * 生成含真实路径的可复制配置块（stdio command/env、http url）。
 */
async function stampServerInfo(httpPort: number): Promise<void> {
  try {
    const entry = fileURLToPath(import.meta.url);
    // dist/index.js 的修改时间 = 这份代码的编译时间：前端拿它判断「服务跑的是不是最新代码」
    const builtAt = await fs.stat(entry).then((s) => s.mtime.toISOString()).catch(() => null);
    const info = {
      app: "zeroexo-mcp-server",
      version: "0.2.0",
      dataRoot: dataRoot(),
      serverEntry: entry,
      tools: TOOL_REGISTRY.length,
      /** 完整工具名：前端比对自己的必需清单，缺哪个就提示重启（光比数量会被新增/删除抵消） */
      toolNames: TOOL_REGISTRY,
      builtAt,
      pid: process.pid,
      transports: ["stdio", "streamable-http"],
      httpPort,
      stampedAt: new Date().toISOString(),
    };
    const p = path.join(dataRoot(), ".mcp", "server-info.json");
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(info, null, 2), "utf8");
  } catch (err) {
    process.stderr.write(`[zeroexo-mcp-server] stamp failed: ${(err as Error).message}\n`);
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      "zeroexo-mcp-server — 让任意 LLM/Agent 通过 MCP 操作 zeroexo 项目管理数据",
      "",
      "用法:",
      "  node dist/index.js                 stdio 模式（默认，本地 Agent spawn）",
      "  node dist/index.js --http [--port 8787]   StreamableHTTP 模式",
      "  node dist/index.js --fs-server [--port 8790]   本地 HTTP 实体服务（前端免授权读写数据根）",
      "  node dist/index.js --selfcheck     启动自检并退出",
      "",
      "环境变量:",
      "  ZEROEXO_DATA_ROOT      数据根（硬性默认 D:\\Test，用户拍板；目录缺失时 fs-server 启动自动创建）",
      "  ZEROEXO_MCP_TOKEN      stdio 模式 token；首次启动自动 bootstrap 到 .mcp/tokens.json",
      "  ZEROEXO_FRONTEND_URL   前端地址（open_project 拼 URL 用，默认 http://localhost:5173）",
      "",
    ].join("\n"),
  );
}

async function selfcheck(): Promise<void> {
  const ctx: Ctx = { getToken: () => process.env.ZEROEXO_MCP_TOKEN };
  await buildServer(ctx); // 触发注册
  const bootstrapped = await bootstrapToken(dataRoot());
  await stampServerInfo(8787);
  const read = TOOL_REGISTRY.filter((n) => TOOL_ACCESS[n] === "read").length;
  const write = TOOL_REGISTRY.length - read;
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        tools: TOOL_REGISTRY.length,
        readTools: read,
        writeTools: write,
        toolNames: TOOL_REGISTRY,
        transport: "stdio(default) | --http StreamableHTTP",
        writeChannel: `${dataRoot()}/projects/<id>/entities/*.json（与前端 File System Access 同一批文件；per-path 锁 + baseVersion 乐观锁 + temp+rename 原子写）`,
        auditPath: `${paths.auditDir()}\\mcp-<date>.jsonl`,
        tokenStore: paths.tokens(),
        tokenBootstrapped: bootstrapped !== null,
      },
      null,
      2,
    ) + "\n",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) return printHelp();
  if (argv.includes("--selfcheck")) return selfcheck();

  await bootstrapToken(dataRoot());

  if (argv.includes("--fs-server")) {
    // 本地 HTTP 实体服务：把数据根暴露给前端（免 File System Access 授权）。
    // 端口优先取 --port，其次 ZEROEXO_FS_PORT，默认 8790。
    const portIdx = argv.indexOf("--port");
    if (portIdx >= 0) process.env.ZEROEXO_FS_PORT = argv[portIdx + 1];
    await startFileServer();
    return; // server 事件循环保活
  }

  if (argv.includes("--http")) {
    const portIdx = argv.indexOf("--port");
    const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
    // 先注册工具再盖印章：否则 server-info 会写 tools:0/toolNames:[]，网页误报「缺 52 个工具」
    await buildServer({ getToken: () => process.env.ZEROEXO_MCP_TOKEN });
    await stampServerInfo(port);
    // 有会话态：initialize 建立 session，后续请求按 mcp-session-id 复用同一 server。
    const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();
    const readBody = async (req: http.IncomingMessage): Promise<string> => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    };
    const httpServer = http.createServer(async (req, res) => {
      if (req.url !== "/mcp") {
        res.writeHead(404).end("not found");
        return;
      }
      const auth = req.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
      const sessionId = req.headers["mcp-session-id"];
      const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
      if (existing) {
        await existing.transport.handleRequest(req, res);
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(400).end("Bad Request: No valid session ID provided");
        return;
      }
      const bodyText = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        res.writeHead(400).end("Bad Request: Invalid JSON");
        return;
      }
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      const isInit = messages.some((m) => (m as { method?: string })?.method === "initialize");
      if (!isInit) {
        res.writeHead(400).end("Bad Request: Server not initialized");
        return;
      }
      const server = await buildServer({ getToken: () => token });
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // 资产上传走 base64（真实定妆图 4-6MB），SDK 默认 4MiB 会让 upload_asset 直接 413
        maxRequestBodySize: Number(process.env.ZEROEXO_MCP_MAX_BODY ?? 64 * 1024 * 1024),
        onsessioninitialized: (sid: string) => {
          sessions.set(sid, { server, transport });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    });
    httpServer.listen(port, () => {
      process.stderr.write(`[zeroexo-mcp-server] StreamableHTTP listening on http://localhost:${port}/mcp\n`);
    });

    // T0（2026-11-09）：fs REST 并入 MCP 同一进程 —— 服务数保持 3（MCP / 网页 / ComfyUI）。
    // Vite 插件探测 8790 /health 在线后会跳过 spawn，不再多起一个 fs-server 子进程。
    const fsPort = fsServerPort();
    const fsAlready = await fetch(`http://127.0.0.1:${fsPort}/health`).then((r) => r.ok, () => false);
    if (fsAlready) {
      process.stderr.write(`[zeroexo-mcp-server] fs REST ${fsPort} 已在线，跳过（不重复监听）\n`);
    } else {
      try {
        await ensureFsRoot();
        const fsHttp = http.createServer((req, res) => { void handleFsRequest(req, res); });
        await new Promise<void>((resolve, reject) => {
          fsHttp.once("error", reject);
          fsHttp.listen(fsPort, "127.0.0.1", resolve);
        });
        process.stderr.write(`[zeroexo-mcp-server] fs REST listening on http://127.0.0.1:${fsPort} (same process)\n`);
      } catch (err) {
        process.stderr.write(`[zeroexo-mcp-server][warn] fs REST ${fsPort} 启动失败（不阻断 MCP）: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
    return;
  }

  // stdio：token 来自 env
  await stampServerInfo(8787);
  const ctx: Ctx = { getToken: () => process.env.ZEROEXO_MCP_TOKEN };
  const server = await buildServer(ctx);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[zeroexo-mcp-server] stdio ready, tools=${TOOL_REGISTRY.length}, dataRoot=${dataRoot()}\n`);
}

main().catch((err) => {
  process.stderr.write(`[zeroexo-mcp-server] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
