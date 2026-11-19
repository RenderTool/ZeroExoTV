/**
 * 本地 HTTP 实体服务（--fs-server，Plan：数据同源）
 *
 * 为什么：浏览器 File System Access 需要用户手动授权目录（OS 级弹窗），自动化与
 * MCP 写入无法共享同一路径。本服务把 dataRoot 直接以 REST 暴露，前端 platform/fs
 * 在探测到本服务在线时全部读写走 HTTP（单一数据源 = 磁盘），离线回退旧授权流程。
 *
 * - 端口：ZEROEXO_FS_PORT（默认 8790），绑定 127.0.0.1（仅本机）
 * - 幂等启动：探测 /health 已在线则直接退出（exit 0），不重复起进程
 * - 路径沙箱：解析后必须仍在 dataRoot 内（拒绝绝对路径与 ..）
 * - 原子写：先写 <file>.tmp-<rand> 再 rename，不留半文件
 * - CORS：允许任意源（本机服务，前端 dev/preview 端口不固定）
 */

import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { dataRoot, setDataRoot } from "./config.js";
import { handleBrokerRequest } from "./broker/http.js";

export function fsServerPort(): number {
  const n = Number(process.env.ZEROEXO_FS_PORT ?? "");
  return Number.isInteger(n) && n > 0 ? n : 8790;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** 页面写进所选目录的一次性探针文件名：服务端靠它的内容反查绝对路径（浏览器不给路径） */
const ROOT_PROBE_FILE = ".zeroexo-root-probe";

/** 相对路径（'/' 分隔）→ dataRoot 内绝对路径；越界抛 403 语义错误 */
function resolveSafe(rel: string): string {
  const root = path.resolve(dataRoot());
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(root, ...clean.split("/").filter(Boolean));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`FORBIDDEN_PATH: ${rel} 越出数据根`);
  }
  return abs;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** 原子写：temp + rename（与 MCP store 层写纪律一致） */
async function atomicWrite(abs: string, buf: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, abs);
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" });
  res.end(buf);
}

/**
 * fs REST 请求处理器（T0 2026-11-09 导出）：
 * `--http` 模式用它把数据服务并入 MCP 同一进程，避免多起一个 fs-server 服务。
 */
export async function handleFsRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // 任务中转服务（/tasks*）先接管：与数据服务同端口，网页无需第二个地址
  if (await handleBrokerRequest(req, res)) return;
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.searchParams.get("p") ?? "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  /**
   * 目录选择（2026-11-17 用户要求）：用**浏览器自带的目录选择器**（showDirectoryPicker），
   * 也就是线上部署那套资源管理器风格的选择框——它由浏览器弹出，必然在页面之上，不会被压在浏览器背后。
   * 浏览器拿不到绝对路径，所以页面在选中的目录里写一个一次性探针文件，服务端按探针内容反查绝对路径。
   */
  if (url.pathname === "/root/locate") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    let name = "";
    let token = "";
    try {
      const parsed = JSON.parse((await readBody(req)).toString("utf8")) as { name?: string; token?: string };
      name = String(parsed.name ?? "").trim();
      token = String(parsed.token ?? "").trim();
    } catch {
      return sendJson(res, 400, { error: "BAD_JSON", message: "请求体必须是 { name, token }" });
    }
    if (!name || !token) return sendJson(res, 400, { error: "INVALID_PATH", message: "缺少目录名或探针" });

    // 广度优先扫盘符找同名目录，命中后再核对探针内容，避免同名目录误判
    const queue: Array<{ dir: string; depth: number }> = [];
    if (process.platform === "win32") {
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const abs = `${letter}:\\`;
        try {
          await fs.access(abs);
          queue.push({ dir: abs, depth: 0 });
        } catch { /* 该盘不存在 */ }
      }
    }
    const MAX_DEPTH = 3;
    const SKIP = new Set(["windows", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information", "appdata", "node_modules", ".git"]);
    const deadline = Date.now() + 12000;
    let found = "";
    while (queue.length && !found) {
      if (Date.now() > deadline) {
        return sendJson(res, 200, {
          ok: false,
          reason: "TIMEOUT",
          message: "没能在限定时间内定位到该目录（层级可能太深），请把数据目录放在盘符根目录附近再试",
        });
      }
      const { dir, depth } = queue.shift()!;
      let dirents;
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch { continue; }
      for (const entry of dirents) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        if (entry.name.toLowerCase() === name.toLowerCase()) {
          try {
            const probe = await fs.readFile(path.join(full, ROOT_PROBE_FILE), "utf8");
            if (probe.trim() === token) { found = full; break; }
          } catch { /* 该同名目录不是用户选的那个 */ }
        }
        if (depth + 1 < MAX_DEPTH && !SKIP.has(entry.name.toLowerCase())) {
          queue.push({ dir: full, depth: depth + 1 });
        }
      }
    }
    if (!found) {
      return sendJson(res, 200, { ok: false, reason: "NOT_FOUND", message: "没有找到该目录的绝对路径，请把数据目录放在盘符根目录附近再试" });
    }
    return sendJson(res, 200, { ok: true, path: found, rootName: path.basename(found) });
  }

  /** 目录统计：里面已有多少项目/资产，供「迁移还是取消」提示用 */
  if (url.pathname === "/root/stat") {
    if (req.method !== "GET") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    const abs = path.resolve(p.trim());
    if (!p.trim() || !path.isAbsolute(abs)) return sendJson(res, 400, { error: "INVALID_PATH", message: "路径必须是绝对路径" });
    try {
      const st = await fs.stat(abs);
      if (!st.isDirectory()) return sendJson(res, 400, { error: "NOT_DIRECTORY", message: "该路径不是目录" });
    } catch (err) {
      return sendJson(res, 400, { error: "ROOT_UNAVAILABLE", message: (err as Error).message });
    }
    let projects = 0;
    let assets = 0;
    try {
      projects = (await fs.readdir(path.join(abs, "projects"))).length;
      assets = (await fs.readdir(path.join(abs, "assets"))).length;
    } catch { /* 空目录：计数 0 */ }
    return sendJson(res, 200, { ok: true, path: abs, rootName: path.basename(abs), projects, assets });
  }

  /**
   * 一键安装并启动 MCP（2026-11-17 用户要求：全部自动化，不给用户复制粘贴命令）。
   * 装到 <数据根>\.mcp-server\next，绝不进 C 盘；装完直接拉起 http 服务。
   */
  if (url.pathname === "/mcp/install") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    let downloadUrl = "";
    let port = 8787;
    try {
      const parsed = JSON.parse((await readBody(req)).toString("utf8")) as { downloadUrl?: string; port?: number };
      downloadUrl = String(parsed.downloadUrl ?? "");
      if (Number.isInteger(parsed.port) && (parsed.port as number) > 0) port = parsed.port as number;
    } catch {
      return sendJson(res, 400, { error: "BAD_JSON", message: "请求体必须是 { downloadUrl }" });
    }
    if (!/^https?:\/\//i.test(downloadUrl)) {
      return sendJson(res, 400, { error: "INVALID_PATH", message: "downloadUrl 必须是 http(s) 地址" });
    }
    const installDir = path.join(dataRoot(), ".mcp-server", "next");
    const pkgDir = path.join(installDir, "node_modules", "@zeroexo", "mcp-server");
    const tgz = path.join(installDir, "mcp.tgz");
    const serverEntry = path.join(pkgDir, "dist", "index.js");
    try {
      await fs.mkdir(installDir, { recursive: true });
      const res2 = await fetch(downloadUrl);
      if (!res2.ok) throw new Error(`下载 MCP 安装包失败（HTTP ${res2.status}）`);
      await fs.writeFile(tgz, Buffer.from(await res2.arrayBuffer()));
      // Windows 10+ 自带 tar（bsdtar），不额外依赖
      const tar = await new Promise<number>((resolve) => {
        const child = spawn("tar", ["-xzf", tgz, "-C", installDir], { windowsHide: true });
        child.on("exit", (code: number | null) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
      });
      if (tar !== 0) throw new Error("解压 MCP 安装包失败（tar 退出码非 0）");
      const extracted = path.join(installDir, "package");
      const hasExtracted = await fs.stat(extracted).then((s) => s.isDirectory()).catch(() => false);
      if (hasExtracted) {
        await fs.rm(pkgDir, { recursive: true, force: true });
        await fs.mkdir(path.dirname(pkgDir), { recursive: true });
        await fs.rename(extracted, pkgDir);
      }
      await fs.rm(tgz, { force: true });
      const entryExists = await fs.stat(serverEntry).then((s) => s.isFile()).catch(() => false);
      if (!entryExists) throw new Error("安装包缺少 dist/index.js，安装失败");
      // 端口已被旧进程占用就不重复拉起，交给调用方轮询识别
      const inUse = await new Promise<boolean>((resolve) => {
        const probe = http.get(`http://127.0.0.1:${port}/health`, (r) => { r.resume(); resolve(true); });
        probe.on("error", () => resolve(false));
        probe.setTimeout(1500, () => { probe.destroy(); resolve(false); });
      });
      if (!inUse) {
        const child = spawn(process.execPath, [serverEntry, "--http", "--port", String(port)], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          cwd: installDir,
          env: { ...process.env, ZEROEXO_DATA_ROOT: dataRoot() },
        });
        child.unref();
      }
      return sendJson(res, 200, { ok: true, serverEntry, port });
    } catch (err) {
      return sendJson(res, 200, { ok: false, message: (err as Error).message });
    }
  }

  /** 迁移后完整性校验：实体 JSON 必须可解析，否则不切根，避免把损坏数据带进新目录 */
async function validateMigratedProjectJson(root: string): Promise<void> {
  const meta = path.join(root, ".lf", "zeroexo", "app_meta", "projects.json");
  try {
    const raw = await fs.readFile(meta, "utf8");
    JSON.parse(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`迁移校验失败：${path.relative(root, meta)} 不是合法 JSON（${(err as Error).message}）`);
    }
  }
  const projectsDir = path.join(root, "projects");
  const entries = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const name of ["script.json", "storyboard.json", "workbench.json"]) {
      const file = path.join(projectsDir, entry.name, "entities", name);
      try {
        const raw = await fs.readFile(file, "utf8");
        JSON.parse(raw);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error(`迁移校验失败：${path.relative(root, file)} 不是合法 JSON（${(err as Error).message}）`);
        }
      }
    }
  }
}

/**
   * 迁移数据根：把旧根的目录内容复制到新根（已存在的文件不覆盖），复制完再切根。
   * 只搬本项目约定的数据目录，不搬整个磁盘上的其它东西。
   */
  if (url.pathname === "/root/migrate") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    let from = "";
    let to = "";
    try {
      const parsed = JSON.parse((await readBody(req)).toString("utf8")) as { from?: string; to?: string };
      from = String(parsed.from ?? "").trim();
      to = String(parsed.to ?? "").trim();
    } catch {
      return sendJson(res, 400, { error: "BAD_JSON", message: "请求体必须是 { from, to }" });
    }
    if (!path.isAbsolute(from) || !path.isAbsolute(to)) {
      return sendJson(res, 400, { error: "INVALID_PATH", message: "from / to 都必须是绝对路径" });
    }
    const src = path.resolve(from);
    const dst = path.resolve(to);
    if (src === dst) return sendJson(res, 400, { error: "SAME_PATH", message: "新旧目录相同，无需迁移" });
    try {
      await fs.access(src);
      await fs.mkdir(dst, { recursive: true });
    } catch (err) {
      return sendJson(res, 400, { error: "ROOT_UNAVAILABLE", message: (err as Error).message });
    }
    const copy = async (abs: string): Promise<void> => {
      // force=false：新目录已有同名文件时保留新目录的副本，不覆盖用户在用的数据
      await fs.cp(abs, path.join(dst, path.relative(src, abs)), { recursive: true, force: false, errorOnExist: false });
    };
    let copied = 0;
    try {
      for (const name of ["projects", "assets", "media", "entities", ".lf"]) {
        const abs = path.join(src, name);
        try {
          await fs.access(abs);
        } catch { continue; }
        await copy(abs);
        copied += 1;
      }
    } catch (err) {
      return sendJson(res, 500, { error: "MIGRATE_FAILED", message: (err as Error).message });
    }
    try {
      await validateMigratedProjectJson(dst);
    } catch (err) {
      return sendJson(res, 500, { error: "MIGRATE_VALIDATION_FAILED", message: (err as Error).message });
    }
    setDataRoot(dst);
    return sendJson(res, 200, { ok: true, dataRoot: dst, rootName: path.basename(dst), copied });
  }

  if (url.pathname === "/root") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    // 运行时切换数据根（2026-11-11 用户要求：在网页里换目录要真的生效）
    // 只接受绝对路径；目录不存在则创建；立即对网页(http-fs)与 MCP 工具同时生效。
    const raw = (await readBody(req)).toString("utf8");
    let next = "";
    try {
      const parsed = JSON.parse(raw) as { path?: string };
      next = String(parsed.path ?? "").trim();
    } catch {
      return sendJson(res, 400, { error: "BAD_JSON", message: "请求体必须是 { path: '绝对路径' }" });
    }
    if (!next || !path.isAbsolute(next)) {
      return sendJson(res, 400, { error: "INVALID_PATH", message: "必须填绝对路径（例如 D:\\ZeroExo 或 /Users/you/ZeroExo）" });
    }
    const abs = path.resolve(next);
    try {
      await fs.mkdir(abs, { recursive: true });
      const st = await fs.stat(abs);
      if (!st.isDirectory()) return sendJson(res, 400, { error: "NOT_DIRECTORY", message: "该路径不是目录" });
    } catch (err) {
      return sendJson(res, 400, { error: "ROOT_UNAVAILABLE", message: (err as Error).message });
    }
    setDataRoot(abs);
    return sendJson(res, 200, { ok: true, dataRoot: abs, rootName: path.basename(abs) });
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "zeroexo-fs",
      dataRoot: path.resolve(dataRoot()),
      rootName: path.basename(path.resolve(dataRoot())),
    });
    return;
  }

  try {
    switch (url.pathname) {
      case "/file": {
        const abs = resolveSafe(p);
        if (req.method === "GET") {
          const stat = await fs.stat(abs).catch(() => null);
          if (!stat?.isFile()) {
            return sendJson(res, 404, {
              error: "NOT_FOUND",
              path: p,
              message: "文件不存在（数据根可能未初始化；zeroexo-root.json 由服务启动时幂等创建）",
            });
          }
          const mime = MIME_BY_EXT[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
          res.writeHead(200, { ...CORS_HEADERS, "Content-Type": mime, "Content-Length": stat.size });
          const buf = await fs.readFile(abs);
          res.end(buf);
          return;
        }
        if (req.method === "PUT") {
          await atomicWrite(abs, await readBody(req));
          return sendJson(res, 200, { ok: true, path: p });
        }
        if (req.method === "DELETE") {
          await fs.rm(abs, { force: true, recursive: true }).catch(() => undefined);
          return sendJson(res, 200, { ok: true, path: p });
        }
        return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
      }

      case "/stat": {
        const abs = resolveSafe(p);
        const st = await fs.stat(abs).catch(() => null);
        if (!st?.isFile()) return sendJson(res, 404, { error: "NOT_FOUND", path: p });
        return sendJson(res, 200, { size: st.size, lastModified: st.mtimeMs });
      }

      case "/list": {
        const abs = resolveSafe(p);
        const dirents = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
        const entries = dirents
          .map((d) => ({ name: d.name, kind: d.isDirectory() ? "dir" : "file" }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return sendJson(res, 200, { entries });
      }

      case "/walk": {
        const root = path.resolve(dataRoot());
        const files: string[] = [];
        const walk = async (rel: string, depth: number): Promise<void> => {
          if (depth <= 0) return;
          const abs = resolveSafe(rel);
          const dirents = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
          for (const d of dirents) {
            const child = rel ? `${rel}/${d.name}` : d.name;
            if (d.isDirectory()) await walk(child, depth - 1);
            else files.push(child);
          }
        };
        await walk(p, 6);
        void root;
        return sendJson(res, 200, { files });
      }

      case "/statmany": {
        const abs = resolveSafe(p);
        const dirents = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
        const stats: { path: string; size: number; lastModified: number }[] = [];
        for (const d of dirents) {
          if (!d.isFile()) continue;
          const st = await fs.stat(path.join(abs, d.name)).catch(() => null);
          if (st) stats.push({ path: `${p}/${d.name}`, size: st.size, lastModified: st.mtimeMs });
        }
        return sendJson(res, 200, { stats });
      }

      case "/mkdir": {
        if (req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as { path?: string };
        if (!body.path) return sendJson(res, 400, { error: "BAD_REQUEST", message: "缺少 path" });
        await fs.mkdir(resolveSafe(body.path), { recursive: true });
        return sendJson(res, 200, { ok: true, path: body.path });
      }

      default:
        return sendJson(res, 404, { error: "NOT_FOUND", endpoint: url.pathname });
    }
  } catch (err) {
    const message = (err as Error).message;
    const status = message.startsWith("FORBIDDEN_PATH") ? 403 : 500;
    return sendJson(res, status, { error: status === 403 ? "FORBIDDEN" : "IO_ERROR", message });
  }
}

/** 启动自愈：数据根目录缺失时自动创建（mkdir recursive 幂等），不做任何提示打扰用户 */
async function ensureDataRoot(): Promise<void> {
  await fs.mkdir(path.resolve(dataRoot()), { recursive: true });
}

/** 启动印章：数据根缺失 zeroexo-root.json 时幂等创建（前端首次 GET 必须拿到 200，不静默 404） */
async function ensureRootMarker(): Promise<void> {
  const marker = path.join(path.resolve(dataRoot()), "zeroexo-root.json");
  const exists = await fs.stat(marker).then((s) => s.isFile(), () => false);
  if (!exists) {
    await atomicWrite(marker, Buffer.from(
      JSON.stringify({ app: "zeroexo-studio", version: 1, createdAt: new Date().toISOString() }, null, 2) + "\n",
    ));
    process.stderr.write(`[zeroexo-fs] 已创建数据根标记 zeroexo-root.json\n`);
  }
}

/** T0：`--http` 同进程复用时只做数据根自愈，不 listen、不 exit。 */
export async function ensureFsRoot(): Promise<void> {
  try {
    await ensureDataRoot();
    await ensureRootMarker();
  } catch (err) {
    process.stderr.write(`[zeroexo-fs] 数据根自愈失败（不阻断监听）: ${(err as Error).message}\n`);
  }
}

/** 幂等启动：已在线直接退出；否则监听并返回 server（供测试持有）。 */
export async function startFileServer(): Promise<http.Server> {
  const port = fsServerPort();

  const already = await fetch(`http://127.0.0.1:${port}/health`).then(
    (r) => r.ok,
    () => false,
  );
  if (already) {
    process.stderr.write(`[zeroexo-fs] 端口 ${port} 已有实例在线，幂等退出\n`);
    process.exit(0);
  }

  await ensureFsRoot();

  const server = http.createServer((req, res) => {
    void handleFsRequest(req, res);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  process.stderr.write(
    `[zeroexo-fs] listening on http://127.0.0.1:${port} (dataRoot=${path.resolve(dataRoot())})\n`,
  );
  return server;
}
