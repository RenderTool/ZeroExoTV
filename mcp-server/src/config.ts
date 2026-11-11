import path from "node:path";

/**
 * 全局配置：数据根默认 D:\Test（2026-11-05 用户拍板）。
 * 2026-11-11：支持运行时切换（网页设置里改数据目录 → POST /root），切换立即对
 * 网页（http-fs）与 MCP 工具（同一进程）同时生效；重启后由网页在 boot 时重新应用。
 */

let rootOverride: string | null = null;

/** 运行时切换数据根（仅 fs-server 的 /root 接口调用；必须已校验为绝对路径） */
export function setDataRoot(next: string): void {
  rootOverride = next;
}

export function dataRoot(): string {
  return rootOverride ?? process.env.ZEROEXO_DATA_ROOT ?? "D:\\Test";
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
