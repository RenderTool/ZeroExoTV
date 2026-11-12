import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 全局配置：数据根默认 D:\Test（2026-11-05 用户拍板）。
 * 运行时切换（网页 POST /root）会写入 ~/.zeroexo/data-root.txt：
 * 网页与同进程 MCP 立即生效；IDE 里单独启动的 MCP 进程重启后按该文件生效，
 * 不再被旧的 ZEROEXO_DATA_ROOT 环境变量拽回旧目录（2026-11-12 用户反馈「切换不生效」）。
 */

let rootOverride: string | null = null;

/** 持久化的数据根覆盖文件（跨进程/重启生效） */
export const DATA_ROOT_FILE = path.join(os.homedir(), ".zeroexo", "data-root.txt");

let fileRoot: string | null | undefined;

function persistedRoot(): string | null {
  if (fileRoot !== undefined) return fileRoot;
  try {
    const v = fs.readFileSync(DATA_ROOT_FILE, "utf8").trim();
    fileRoot = v || null;
  } catch {
    fileRoot = null;
  }
  return fileRoot;
}

/** 运行时切换数据根（仅 fs-server 的 /root 接口调用；必须已校验为绝对路径） */
export function setDataRoot(next: string): void {
  rootOverride = next;
  fileRoot = next;
  try {
    fs.mkdirSync(path.dirname(DATA_ROOT_FILE), { recursive: true });
    fs.writeFileSync(DATA_ROOT_FILE, next, "utf8");
  } catch {
    // 写不了用户目录也不影响本进程切换
  }
}

export function dataRoot(): string {
  return rootOverride ?? persistedRoot() ?? process.env.ZEROEXO_DATA_ROOT ?? "D:\\Test";
}

export function frontendBaseUrl(): string {
  return process.env.ZEROEXO_FRONTEND_URL ?? "http://localhost:5173";
}

export const paths = {
  projectsMeta(root = dataRoot()) {
    return path.join(root, ".lf", "zeroexo", "app_meta", "projects.json");
  },
  projectDir(projectId: string, root = dataRoot()) {
    return path.join(root, "projects", projectId);
  },
  entitiesDir(projectId: string, root = dataRoot()) {
    return path.join(this.projectDir(projectId, root), "entities");
  },
  script(projectId: string, root = dataRoot()) {
    return path.join(this.entitiesDir(projectId, root), "script.json");
  },
  storyboard(projectId: string, root = dataRoot()) {
    return path.join(this.entitiesDir(projectId, root), "storyboard.json");
  },
  workbench(projectId: string, root = dataRoot()) {
    return path.join(this.entitiesDir(projectId, root), "workbench.json");
  },
  backupsDir(projectId: string, root = dataRoot()) {
    return path.join(this.entitiesDir(projectId, root), "backups");
  },
  /**
   * 项目内画布副本目录（Spec v2 / 征集#184）：与前端 `entities/canvas-store.ts` 同一形状，
   * 裸 JSON（无 `__lf` 信封），一份画布一个文件。1 号主画布不在这里（见 mainGraphFile）。
   */
  canvasesDir(projectId: string, root = dataRoot()) {
    return path.join(this.projectDir(projectId, root), "canvases");
  },
  canvas(projectId: string, canvasId: string, root = dataRoot()) {
    return path.join(this.canvasesDir(projectId, root), `${canvasId}.json`);
  },
  /**
   * 1 号主画布的图存储位置（localforage 磁盘驱动落点，键名经 encodeURIComponent）：
   * `{__lf:1, value:{version, savedAt, graph}}`。MCP **只读**它（写入会和前端自动保存抢盘）。
   */
  mainGraphFile(projectId: string, root = dataRoot()) {
    const encoded = encodeURIComponent(`zeroexo:graph:${projectId}`);
    return path.join(root, ".lf", "zeroexo", "graph_data", `${encoded}.json`);
  },
  casIndex(root = dataRoot()) {
    return path.join(root, "entities", "cas_index.json");
  },
  casDir(root = dataRoot()) {
    return path.join(root, "media", "cas");
  },
  tokens(root = dataRoot()) {
    return path.join(root, ".mcp", "tokens.json");
  },
  /**
   * 前端广播的「当前打开项目」（画布切项目时写）：Agent 先报出它再问用户是否操作，
   * 不要让用户重复说「帮我操作 XX 项目」。
   */
  currentProject(root = dataRoot()) {
    return path.join(root, ".lf", "zeroexo", "app_meta", "current-project.json");
  },
  auditDir(root = dataRoot()) {
    return path.join(root, ".audit");
  },
};
