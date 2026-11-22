#!/usr/bin/env node
/**
 * zeroexo-mcp-server 入口。
 * 默认 stdio（本地 Agent spawn）；--http [--port N] 开 StreamableHTTP（远程 Agent，需 Authorization Bearer）。
 * --selfcheck 打印自检信息并退出；--help 打印用法。
 */

import http from "node:http";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bootstrapToken } from "./auth.js";
import { ensureFsRoot } from "./file-server.js";
import { handleBrokerRequest } from "./broker/http.js";
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
import { registerTaskTools } from "./tools/tasks.js";
import { registerPlanTools } from "./tools/plan.js";
import { registerDirectorOpsTools } from "./tools/director-ops.js";
import { registerStyleTools } from "./tools/style.js";
import { registerUpgradeTools } from "./tools/upgrade.js";
import { registerComfyuiTools } from "./tools/comfyui.js";
import { registerProgressTools } from "./tools/progress.js";
import { registerProjectLogTools } from "./tools/project-log.js";
import { registerReviewTools } from "./tools/review.js";
import { registerBriefTools } from "./tools/brief.js";
import { registerReleaseTools } from "./tools/release.js";
import { registerDataRootTools } from "./tools/data-root.js";
import { startBroker } from "./broker/executor.js";
import { startClaimWorker } from "./broker/claim-worker.js";

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
    { name: "zeroexo-mcp-server", version: await packageVersion() },
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
  registerTaskTools(server, ctx);
  registerPlanTools(server, ctx);
  registerDirectorOpsTools(server, ctx);
  registerStyleTools(server, ctx);
  registerUpgradeTools(server, ctx);
  registerComfyuiTools(server, ctx);
  registerProgressTools(server, ctx);
  registerProjectLogTools(server, ctx);
  registerReviewTools(server, ctx);
  registerBriefTools(server, ctx);
  registerReleaseTools(server, ctx);
  registerDataRootTools(server, ctx);
  return server;
}

/**
 * 启动印章：把真实绝对路径写进 <dataRoot>/.mcp/server-info.json。
 * 浏览器 File System Access 拿不到目录绝对路径，前端 MCP 设置页靠本文件
 * 生成含真实路径的可复制配置块（stdio command/env、http url）。
 */
/**
 * MCP 自身版本：必须读 package.json（安装包与仓库都能取到），不能写死。
 * 之前写死 "0.2.0" 导致网页「本地 MCP 版本」永远显示旧版，用户以为没更新。
 */
async function packageVersion(): Promise<string> {
  try {
    const entry = fileURLToPath(import.meta.url);
    const pkgPath = path.join(path.dirname(path.dirname(entry)), "package.json");
    const parsed = JSON.parse(await fs.readFile(pkgPath, "utf8")) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function stampServerInfo(httpPort: number): Promise<void> {
  try {
    const entry = fileURLToPath(import.meta.url);
    // dist/index.js 的修改时间 = 这份代码的编译时间：前端拿它判断「服务跑的是不是最新代码」
    const builtAt = await fs.stat(entry).then((s) => s.mtime.toISOString()).catch(() => null);
    const version = await packageVersion();
    const info = {
      app: "zeroexo-mcp-server",
      version,
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
      "  node dist/index.js --http [--port 8787]   StreamableHTTP 模式（同时提供 /mcp 与任务接口 /tasks）",
      "  node dist/index.js --selfcheck     启动自检并退出",
      "",
      "环境变量:",
      "  ZEROEXO_DATA_ROOT      数据根（硬性默认 D:\\Test，用户拍板；目录缺失时启动自动创建）",
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

/**
 * 自动清理遗留的本地文件服务（2026-11-22 用户要求"更新 MCP 后自动移除冗余服务"）。
 *
 * 旧版本会额外起一个 `--fs-server` 进程占 8790，用户在界面上完全看不到它。
 * 新版不再提供该模式；若升级后旧进程还在跑，这里做一次一次性清理：
 * 先确认 8790 的 /health 确实是 zeroexo-fs，再核对进程命令行含 `--fs-server`，
 * 两重校验通过才 taskkill —— 避免误杀别的程序。失败只打日志，不阻断启动。
 */
async function reapLegacyFsServer(): Promise<void> {
  if (process.platform !== "win32") return;
  const port = Number(process.env.ZEROEXO_FS_PORT ?? 8790);
  const probe = await fetch(`http://127.0.0.1:${port}/health`).then(
    async (r) => (r.ok ? (await r.json().catch(() => null)) as { service?: string } | null : null),
    () => null,
  );
  if (probe?.service !== "zeroexo-fs") return;
  try {
    // 用绝对路径：由 IDE/宿主 spawn 时 PATH 可能不含 System32，直接写 netstat 会 ENOENT
    const sys32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    const netstat = execFileSync(path.join(sys32, "netstat.exe"), ["-ano"], { encoding: "utf8" });
    const line = netstat
      .split(/\r?\n/)
      .find((l) => l.includes(`:${port}`) && /LISTENING/i.test(l));
    const pid = line?.trim().split(/\s+/).pop();
    if (!pid || !/^\d+$/.test(pid)) return;
    const cmdline = execFileSync(
      path.join(sys32, "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
      { encoding: "utf8" },
    );
    if (!cmdline.includes("--fs-server")) return;
    execFileSync(path.join(sys32, "taskkill.exe"), ["/PID", pid, "/F"]);
    process.stderr.write(`[zeroexo-mcp] 已移除遗留文件服务 pid=${pid}（端口 ${port}），该服务已不再需要\n`);
  } catch (err) {
    process.stderr.write(`[zeroexo-mcp] 清理遗留文件服务失败（不影响使用）: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) return printHelp();
  if (argv.includes("--selfcheck")) return selfcheck();

  await bootstrapToken(dataRoot());

  // 2026-11-22 用户拍板：移除 `--fs-server`（8790 本地文件服务）。
  // 网页读写本地文件只认浏览器目录授权；任务接口 /tasks 已并入 --http 端口。
  // 老用户升级后即便仍在跑旧进程，新版本也不再提供该模式，端口自然不再被占用。
  if (argv.includes("--fs-server")) {
    process.stderr.write(
      "[zeroexo-mcp-server] --fs-server 已移除：网页改为浏览器目录授权，任务接口请用 --http（默认 8787）\n",
    );
    process.exit(2);
  }

  if (argv.includes("--http")) {
    // 升级即清理：后台执行，不阻塞监听
    void reapLegacyFsServer();
    const portIdx = argv.indexOf("--port");
    const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
    // 先注册工具再盖印章：否则 server-info 会写 tools:0/toolNames:[]，网页误报「缺 52 个工具」
    await buildServer({ getToken: () => process.env.ZEROEXO_MCP_TOKEN });
    await stampServerInfo(port);
    startBroker();
    startClaimWorker();
    // 有会话态：initialize 建立 session，后续请求按 mcp-session-id 复用同一 server。
    const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();
    const readBody = async (req: http.IncomingMessage): Promise<string> => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    };
    const httpServer = http.createServer(async (req, res) => {
      // 任务中转（/tasks*）挂在本进程端口：网页只连 MCP 一个地址，不再有独立的文件服务
      if (await handleBrokerRequest(req, res)) return;
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

    // 数据根自愈：原来在这里额外监听 8790 的 fs REST，已撤除——
    // 文件读写归浏览器授权，任务接口 /tasks 挂在本端口（见上面 handleBrokerRequest）。
    try {
      await ensureFsRoot();
    } catch (err) {
      process.stderr.write(`[zeroexo-mcp-server][warn] 数据根初始化失败（不阻断 MCP）: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    return;
  }

  // stdio：token 来自 env
  await stampServerInfo(8787);
  const ctx: Ctx = { getToken: () => process.env.ZEROEXO_MCP_TOKEN };
  const server = await buildServer(ctx);
  await server.connect(new StdioServerTransport());
  // stdio 只开 IDE、没开网页时也要把已提交的作业归档进 CAS（认领台账是唯一事实源）。
  startBroker();
  startClaimWorker();
  process.stderr.write(`[zeroexo-mcp-server] stdio ready, tools=${TOOL_REGISTRY.length}, dataRoot=${dataRoot()}\n`);
}

main().catch((err) => {
  process.stderr.write(`[zeroexo-mcp-server] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
