/**
 * MCP 自我更新感知（2026-11-11 用户要求）
 *
 * 目标：旧版 MCP 连到网页时，**Agent 工具自己先知道**，而不是客户去问「MCP 更新了吗」。
 * 做法：
 * - 网页启动时把「前端要求的工具清单」写到 <数据根>/.lf/zeroexo/app_meta/mcp-required.json；
 * - MCP 每次工具返回都带上 _mcpOutdated（缺工具 / 仓库落后 / 代码比进程新），Agent 第一次调用就能看到；
 * - 提供 mcp_update_status（体检）与 update_mcp_server（用户确认后 git 快进 + 重新编译 dist），
 *   编译完提示「重启 MCP 服务生效」——stdio 进程无法在不重启的情况下换掉已加载的模块。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MCP_REQUIRED_MANIFEST = ".lf/zeroexo/app_meta/mcp-required.json";

export interface RequiredManifest {
  schemaVersion?: number;
  appVersion?: string;
  mcpVersion?: string;
  requiredTools?: string[];
  writtenAt?: string;
}

export interface UpdateStatus {
  /** 进程自带的工具名（TOOL_REGISTRY） */
  tools: string[];
  /** 前端要求的工具名（manifest）；没有 manifest = null */
  required: string[] | null;
  /** 前端要求但本进程没有的工具（旧版的核心信号） */
  missing: string[];
  /** 本机运行的 MCP 版本（dist 同目录 package.json） */
  localVersion: string | null;
  /** 网页要求的 MCP 版本（manifest / version.json） */
  requiredVersion: string | null;
  /** 版本不一致 = 该更新 MCP */
  versionOutdated: boolean;
  /** 运行中的 dist 比磁盘源码旧？ */
  distOutdated: boolean;
  /** 仓库落后上游的提交数（读不到 git 时为 null） */
  gitBehind: number | null;
  repoRoot: string | null;
  serverEntry: string;
  builtAt: string | null;
  hint: string | null;
}

/** 数据根下的 manifest 路径 */
export function requiredManifestPath(root: string): string {
  return path.join(root, ...MCP_REQUIRED_MANIFEST.split("/"));
}

export async function readRequiredManifest(root: string): Promise<RequiredManifest | null> {
  try {
    const raw = await fs.readFile(requiredManifestPath(root), "utf8");
    const parsed = JSON.parse(raw) as RequiredManifest;
    return parsed && Array.isArray(parsed.requiredTools) ? parsed : null;
  } catch {
    return null;
  }
}

/** dist/index.js → mcp-server → 仓库根 */
export function resolveRepoRoot(serverEntry: string): string | null {
  try {
    const distDir = path.dirname(serverEntry);
    const pkgDir = path.dirname(distDir);
    if (path.basename(distDir) !== "dist") return null;
    if (path.basename(pkgDir) !== "mcp-server") return null;
    return path.dirname(pkgDir);
  } catch {
    return null;
  }
}

async function statMs(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** 磁盘上的 dist 是否比进程启动时加载的入口新（有人重新编译过但没重启） */
export async function isDistOutdated(serverEntry: string, startedAtMs: number): Promise<boolean> {
  const mtime = await statMs(serverEntry);
  return mtime !== null && mtime > startedAtMs + 1500;
}

/** 仓库落后上游多少提交（只读本地 git 状态，不联网） */
export async function gitBehindCount(repoRoot: string | null): Promise<number | null> {
  if (!repoRoot) return null;
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, "rev-list", "--count", "HEAD..@{u}"], {
      timeout: 5000,
    });
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function buildUpdateStatus(input: {
  root: string;
  tools: string[];
  serverEntry: string;
  startedAtMs: number;
}): Promise<UpdateStatus> {
  const manifest = await readRequiredManifest(input.root);
  const required = manifest?.requiredTools ?? null;
  const missing = required ? required.filter((t) => !input.tools.includes(t)) : [];
  const repoRoot = resolveRepoRoot(input.serverEntry);
  const [distOutdated, gitBehind, entryMtime] = await Promise.all([
    isDistOutdated(input.serverEntry, input.startedAtMs),
    gitBehindCount(repoRoot),
    statMs(input.serverEntry),
  ]);
  const builtAt = entryMtime !== null ? new Date(entryMtime).toISOString() : null;
  // 版本对照（2026-11-11）：本机 dist 同目录 package.json vs 网页 manifest 要求版本
  const localVersion = await fs
    .readFile(path.join(path.dirname(input.serverEntry), "..", "package.json"), "utf8")
    .then((raw) => (JSON.parse(raw) as { version?: string }).version ?? null)
    .catch(() => null);
  const requiredVersion = manifest?.mcpVersion ?? null;
  const versionOutdated = Boolean(requiredVersion && localVersion && requiredVersion !== localVersion);

  let hint: string | null = null;
  if (missing.length > 0) {
    hint = `MCP 服务是旧版：缺少前端要求的 ${missing.length} 个工具（${missing.slice(0, 5).join("、")}）。`
      + "先调 mcp_update_status 说明情况，征得用户同意后调 update_mcp_server（userConfirmed:true），再重启 MCP 服务。";
  } else if (versionOutdated) {
    hint = `MCP 版本落后：本机 v${localVersion}，网页要求 v${requiredVersion}。请更新 MCP 安装包并重启服务。`;
  } else if (distOutdated) {
    hint = "磁盘上的 MCP 代码已经重新编译，但当前进程还是旧的：重启 MCP 服务即可生效。";
  } else if ((gitBehind ?? 0) > 0) {
    hint = `仓库落后上游 ${gitBehind} 个提交：可调 update_mcp_server 更新（需要用户确认），更新后重启 MCP 服务。`;
  }
  return {
    tools: input.tools,
    required,
    missing,
    localVersion,
    requiredVersion,
    versionOutdated,
    distOutdated,
    gitBehind,
    repoRoot,
    serverEntry: input.serverEntry,
    builtAt,
    hint,
  };
}

export interface UpdateResult {
  updated: boolean;
  restartRequired: boolean;
  behind: number | null;
  pulled: boolean;
  built: boolean;
  message: string;
}

/**
 * 更新 MCP 自身：git fetch → 工作区干净才快进 → 重新编译 dist。
 * stdio 进程无法热替换已加载模块，所以永远返回 restartRequired: true。
 */
export async function updateMcpServer(repoRoot: string | null, serverEntry: string): Promise<UpdateResult> {
  if (!repoRoot) {
    return {
      updated: false, restartRequired: false, behind: null, pulled: false, built: false,
      message: "定位不到仓库根目录（serverEntry 不是 <repo>/mcp-server/dist/index.js）",
    };
  }
  const run = async (cmd: string, args: string[], timeout = 120_000): Promise<string> => {
    const { stdout } = await execFileAsync(cmd, args, { cwd: repoRoot, timeout });
    return stdout;
  };
  try {
    const dirty = (await run("git", ["-C", repoRoot, "status", "--porcelain"])).trim();
    if (dirty) {
      return {
        updated: false, restartRequired: false, behind: null, pulled: false, built: false,
        message: "仓库有未提交的本地改动，已停止自动更新（避免覆盖用户修改）：请先提交/暂存，或手动 git pull",
      };
    }
    await run("git", ["-C", repoRoot, "fetch", "--quiet"]);
    const behindRaw = (await run("git", ["-C", repoRoot, "rev-list", "--count", "HEAD..@{u}"])).trim();
    const behind = Number(behindRaw);
    let pulled = false;
    if (behind > 0) {
      await run("git", ["-C", repoRoot, "merge", "--ff-only", "@{u}"]);
      pulled = true;
    }
    // 重新编译 MCP（用仓内依赖，不联网安装；cwd=仓库根，-p 指向 mcp-server/tsconfig.json）
    const pkgDir = path.dirname(path.dirname(serverEntry));
    await run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", path.join(pkgDir, "tsconfig.json")], 180_000);
    return {
      updated: pulled || behind > 0,
      restartRequired: true,
      behind: Number.isFinite(behind) ? behind : null,
      pulled,
      built: true,
      message: pulled
        ? `已快进 ${behind} 个提交并重新编译，重启 MCP 服务后生效`
        : "代码已是最新，已重新编译；如仍提示旧版，重启 MCP 服务",
    };
  } catch (err) {
    return {
      updated: false, restartRequired: false, behind: null, pulled: false, built: false,
      message: `自动更新失败：${err instanceof Error ? err.message : String(err)}。请手动 git pull && 重新编译 mcp-server`,
    };
  }
}

/** 进程启动时间（供 dist 新旧判断） */
export function serverEntryPath(): string {
  return fileURLToPath(import.meta.url);
}
