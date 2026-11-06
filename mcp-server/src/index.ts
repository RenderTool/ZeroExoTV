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
import { startFileServer } from "./file-server.js";
import { dataRoot, paths } from "./config.js";
import { TOOL_REGISTRY, type Ctx } from "./tools/_register.js";
import { SERVER_INSTRUCTIONS } from "./guides/instructions.js";
import { registerGuidePrompts, registerGuideResources } from "./guides/register.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerScriptTools } from "./tools/script.js";
import { registerSplitTools } from "./tools/split.js";
import { registerSubjectTools } from "./tools/subjects.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerWorkbenchTools } from "./tools/workbench.js";
import { registerStoryboardIngestTools } from "./tools/storyboard-ingest.js";
import { registerCanvasTools } from "./tools/canvases.js";

function buildServer(ctx: Ctx): McpServer {
  // instructions 内置整套操作规则（零安装路径），细节规格经 guides 资源/prompts 按需取
  const server = new McpServer(
    { name: "zeroexo-mcp-server", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
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
  registerCanvasTools(server, ctx);
  return server;
}

/**
 * 启动印章：把真实绝对路径写进 <dataRoot>/.mcp/server-info.json。
 * 浏览器 File System Access 拿不到目录绝对路径，前端 MCP 设置页靠本文件
 * 生成含真实路径的可复制配置块（stdio command/env、http url）。
 */
async function stampServerInfo(httpPort: number): Promise<void> {
  try {
    const info = {
      app: "zeroexo-mcp-server",
      version: "0.1.0",
      dataRoot: dataRoot(),
      serverEntry: fileURLToPath(import.meta.url),
      tools: 20,
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
  buildServer(ctx); // 触发注册
  const bootstrapped = await bootstrapToken(dataRoot());
  await stampServerInfo(8787);
  const read = 9;
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
    await stampServerInfo(port);
    // 每个请求独立 server+transport（无会话态），token 取 Authorization Bearer
    let currentToken: string | undefined;
    const httpServer = http.createServer(async (req, res) => {
      if (req.url !== "/mcp") {
        res.writeHead(404).end("not found");
        return;
      }
      const auth = req.headers.authorization;
      currentToken = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
      const server = buildServer({ getToken: () => currentToken });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    httpServer.listen(port, () => {
      process.stderr.write(`[zeroexo-mcp-server] StreamableHTTP listening on http://localhost:${port}/mcp\n`);
    });
    return;
  }

  // stdio：token 来自 env
  await stampServerInfo(8787);
  const ctx: Ctx = { getToken: () => process.env.ZEROEXO_MCP_TOKEN };
  const server = buildServer(ctx);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[zeroexo-mcp-server] stdio ready, tools=${TOOL_REGISTRY.length}, dataRoot=${dataRoot()}\n`);
}

main().catch((err) => {
  process.stderr.write(`[zeroexo-mcp-server] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
