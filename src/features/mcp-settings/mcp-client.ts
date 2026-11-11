/**
 * MCP 设置页逻辑层（2026-11-04，MCP M1 配套）
 *
 * 数据事实源（与 mcp-server 共用同一数据根，走 platform/fs 同一套 handle）：
 * - .mcp/tokens.json        token 哈希表（创建/撤销由本页写；服务端每次调用重读，撤销立即生效）
 * - .mcp/server-info.json   mcp-server 启动印章（真实绝对路径；浏览器 File System Access 拿不到绝对路径）
 * - .audit/mcp-<date>.jsonl 调用审计（只读）
 *
 * 所有函数接受可选 FsLike 注入，默认走 @/platform/fs.js —— 单测用内存假实现，不碰 File System Access。
 */

import { listDir, readFile, readJson, writeJson } from '@/platform/fs.js';

// ===== 路径常量 =====
export const MCP_TOKENS_PATH = '.mcp/tokens.json';
export const MCP_SERVER_INFO_PATH = '.mcp/server-info.json';
export const MCP_AUDIT_DIR = '.audit';
/** 可被 runtime-config.js 覆盖（云端自建 MCP 时填完整地址）；默认本机 HTTP */
const runtimeMcpUrl = typeof window !== 'undefined'
  ? (window as unknown as { env?: { MCP_HTTP_URL?: string } }).env?.MCP_HTTP_URL
  : undefined;
export const MCP_HTTP_URL = runtimeMcpUrl || 'http://127.0.0.1:8787/mcp';

// ===== 类型 =====
export interface TokenRecord {
  id: string;
  hash: string;
  prefix: 'zxp' | 'zxs';
  projectIds: string[] | '*';
  bits: string[];
  createdAt: string;
  note?: string;
  revokedAt?: string;
}

export interface TokenFile {
  schemaVersion: 1;
  tokens: TokenRecord[];
}

export interface ServerInfo {
  app: string;
  version: string;
  dataRoot: string;
  serverEntry: string;
  tools: number;
  /** 服务端实际注册的工具名（旧版本没有这个字段） */
  toolNames?: string[];
  /** dist/index.js 的编译时间（旧版本没有这个字段） */
  builtAt?: string | null;
  pid?: number;
  transports: string[];
  httpPort: number;
  stampedAt: string;
}

export interface AuditEntry {
  ts: string;
  tool: string;
  tokenId?: string;
  projectId?: string;
  result: 'ok' | 'error';
  code?: string;
  durationMs: number;
}

/** 可注入的文件系统适配器（生产 = platform/fs；测试 = 内存假实现） */
export interface FsLike {
  readJson<T>(path: string): Promise<T | null>;
  writeJson(path: string, value: unknown): Promise<void>;
  readFile(path: string): Promise<string | null>;
  listDir(path: string): Promise<{ name: string; kind: 'file' | 'dir' }[]>;
}

const defaultFs: FsLike = { readJson, writeJson, readFile, listDir };

// ===== 能力位与工具清单（与 project-rules/docs/mcp-auth-scope-contract.md §3/§4 对齐）=====
export const CAPABILITY_BITS = [
  'project.read', 'project.write',
  'script.read', 'script.write',
  'split.write',
  'subject.read', 'subject.write',
  'asset.read', 'asset.write',
  'workbench.read', 'workbench.write',
] as const;

export interface ToolInfo {
  name: string;
  access: 'read' | 'write';
}

/**
 * 与服务端 `TOOL_REGISTRY` 一一对应（2026-11-09 全量同步：21 → 45）。
 * 新增 MCP 工具必须同时加进这里，否则设置页自检与权限清单会漂移。
 */
export const MCP_TOOLS: ToolInfo[] = [
  { name: 'list_projects', access: 'read' },
  { name: 'get_project', access: 'read' },
  { name: 'get_current_project', access: 'read' },
  { name: 'open_project', access: 'read' },
  { name: 'list_episodes', access: 'read' },
  { name: 'get_script', access: 'read' },
  { name: 'normalize_script', access: 'read' },
  { name: 'list_subjects', access: 'read' },
  { name: 'list_assets', access: 'read' },
  { name: 'read_asset', access: 'read' },
  { name: 'get_workbench', access: 'read' },
  { name: 'ingest_storyboard_images', access: 'read' },
  { name: 'list_canvases', access: 'read' },
  { name: 'get_canvas', access: 'read' },
  { name: 'validate_project', access: 'read' },
  { name: 'list_history', access: 'read' },
  { name: 'get_guide', access: 'read' },
  { name: 'get_job', access: 'read' },
  { name: 'list_jobs', access: 'read' },
  { name: 'verify_output', access: 'read' },
  { name: 'get_param_schema', access: 'read' },
  { name: 'preflight_import', access: 'read' },
  { name: 'create_project', access: 'write' },
  { name: 'update_project_meta', access: 'write' },
  { name: 'set_script_meta', access: 'write' },
  { name: 'create_episode', access: 'write' },
  { name: 'update_episode', access: 'write' },
  { name: 'patch_episode', access: 'write' },
  { name: 'merge_episode', access: 'write' },
  { name: 'set_episode_meta', access: 'write' },
  { name: 'import_script', access: 'write' },
  { name: 'split_script_to_shots', access: 'write' },
  { name: 'plan_continuity_edit', access: 'write' },
  { name: 'upsert_subject', access: 'write' },
  { name: 'set_subject_image', access: 'write' },
  { name: 'link_subject_to_shot', access: 'write' },
  { name: 'upload_asset', access: 'write' },
  { name: 'attach_asset_to_slot', access: 'write' },
  { name: 'import_media_to_cas', access: 'write' },
  { name: 'set_shared_params', access: 'write' },
  { name: 'set_shot_prompt', access: 'write' },
  { name: 'add_segment', access: 'write' },
  { name: 'patch_canvas_nodes', access: 'write' },
  { name: 'scaffold_episode', access: 'write' },
  { name: 'apply_shot_prompts', access: 'write' },
  { name: 'set_segment_duration', access: 'write' },
  { name: 'set_shot_guide', access: 'write' },
  { name: 'run_generation', access: 'write' },
  { name: 'sync_job_results', access: 'write' },
  { name: 'repair_asset_storage_keys', access: 'write' },
];

/** M2 预留槽位（契约 §4 #22-23 + get_asset_binary / remove_asset_ref）：页面置灰展示 */
export const MCP_RESERVED_TOOLS: ToolInfo[] = [
  { name: 'export_director_pack', access: 'read' },
  { name: 'get_asset_binary', access: 'read' },
  { name: 'remove_asset_ref', access: 'write' },
];

/**
 * 网页端「自动感知 MCP 更新」：拿服务端写的 server-info.toolNames 比对前端必需清单。
 * 返回缺失的工具名；空数组 = 已是最新（或服务还没写 server-info，无法判断）。
 * 用途：IDE/后台进程还在跑旧 dist 时，网页立刻提示「重启 MCP 服务」，不用用户自己去猜。
 */
export function mcpServerMissingTools(info: ServerInfo | null | undefined): string[] {
  if (!info) return [];
  if (!Array.isArray(info.toolNames)) return ['(旧版服务，未上报工具清单)'];
  const names = info.toolNames;
  return MCP_TOOLS.map((t) => t.name).filter((n) => !names.includes(n));
}

// ===== token =====

function randomBase62(len: number): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % 62]).join('');
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadTokens(fs: FsLike = defaultFs): Promise<TokenRecord[]> {
  const file = await fs.readJson<TokenFile>(MCP_TOKENS_PATH);
  return file?.tokens ?? [];
}

export interface CreateTokenInput {
  prefix: 'zxp' | 'zxs';
  projectIds: string[] | '*';
  bits: string[];
  note?: string;
}

/**
 * 创建 token：原文仅本函数返回值出现一次（页面展示后即丢），磁盘只存 SHA-256。
 */
export async function createToken(
  input: CreateTokenInput,
  fs: FsLike = defaultFs,
): Promise<{ record: TokenRecord; raw: string }> {
  const raw = `${input.prefix}_${randomBase62(48)}`;
  const record: TokenRecord = {
    id: `tok-${randomBase62(12)}`,
    hash: await sha256Hex(raw),
    prefix: input.prefix,
    projectIds: input.projectIds,
    bits: input.bits,
    createdAt: new Date().toISOString(),
    note: input.note,
  };
  const tokens = await loadTokens(fs);
  tokens.push(record);
  await fs.writeJson(MCP_TOKENS_PATH, { schemaVersion: 1, tokens } satisfies TokenFile);
  return { record, raw };
}

/** 撤销：软删除（写 revokedAt）。服务端 authorize 每次调用重读 tokens.json → 立即失效。 */
export async function revokeToken(id: string, fs: FsLike = defaultFs): Promise<void> {
  const tokens = await loadTokens(fs);
  const rec = tokens.find((t) => t.id === id);
  if (!rec) throw new Error(`token 不存在: ${id}`);
  if (!rec.revokedAt) rec.revokedAt = new Date().toISOString();
  await fs.writeJson(MCP_TOKENS_PATH, { schemaVersion: 1, tokens } satisfies TokenFile);
}

// ===== server-info 印章 =====

export async function loadServerInfo(fs: FsLike = defaultFs): Promise<ServerInfo | null> {
  return fs.readJson<ServerInfo>(MCP_SERVER_INFO_PATH);
}

// ===== 审计 =====

export interface AuditQuery {
  tool?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditResult {
  entries: AuditEntry[];
  total: number;
  /** tokenId → 最近一次调用时间（全量扫描得出，供 token 列表「最近使用」列） */
  lastUsedByToken: Record<string, string>;
}

export async function loadAudit(query: AuditQuery = {}, fs: FsLike = defaultFs): Promise<AuditResult> {
  const { tool, projectId, limit = 20, offset = 0 } = query;
  const dirEntries = await fs.listDir(MCP_AUDIT_DIR);
  const files = dirEntries
    .filter((e) => e.kind === 'file' && /^mcp-\d{4}-\d{2}-\d{2}\.jsonl$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse(); // 日期新→旧

  const all: AuditEntry[] = [];
  for (const name of files) {
    const raw = await fs.readFile(`${MCP_AUDIT_DIR}/${name}`);
    if (!raw) continue;
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        all.push(JSON.parse(s) as AuditEntry);
      } catch {
        /* 跳过坏行 */
      }
    }
  }
  all.sort((a, b) => b.ts.localeCompare(a.ts));

  const lastUsedByToken: Record<string, string> = {};
  for (const e of all) {
    if (e.tokenId && !lastUsedByToken[e.tokenId]) lastUsedByToken[e.tokenId] = e.ts; // all 已按 ts 倒序
  }

  const filtered = all.filter(
    (e) => (!tool || e.tool === tool) && (!projectId || e.projectId === projectId),
  );
  return { entries: filtered.slice(offset, offset + limit), total: filtered.length, lastUsedByToken };
}

// ===== 状态探测 =====

/**
 * HTTP 探测：POST 一个最小 JSON-RPC，任何 HTTP 响应（含 4xx）都说明端口上有服务；
 * 网络层拒绝（fetch reject / 超时）= 未启动。绝不假装已连接。
 */
export async function probeHttp(
  url: string = MCP_HTTP_URL,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

// ===== 配置块 =====

/** stdio 配置块：command/args/env 全部用 server-info 里的真实绝对路径；token 由 ensureIdeToken 自动注入，复制即可用。 */
export function buildStdioConfig(info: Pick<ServerInfo, 'serverEntry' | 'dataRoot'>, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        zeroexo: {
          command: 'node',
          args: [info.serverEntry],
          env: {
            ZEROEXO_DATA_ROOT: info.dataRoot,
            ZEROEXO_MCP_TOKEN: token,
          },
        },
      },
    },
    null,
    2,
  );
}

export function buildHttpConfig(url: string = MCP_HTTP_URL, token = '<粘贴你的 zxp_ token>'): string {
  return JSON.stringify(
    {
      mcpServers: {
        zeroexo: {
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

// ===== IDE 一键配置 token =====

const IDE_TOKEN_STORAGE_KEY = 'zeroexo.mcp.ideTokenRaw';

/**
 * 拿一个「复制即可用」的全权限 token（面板首屏自动调用，用户无需手动新建）：
 * - 浏览器缓存的原文仍对应未撤销 token → 直接复用（原文只在创建时可见，localStorage 缓存一份让二次打开仍能一键复制）；
 * - 否则自动创建全权限 token：磁盘 tokens.json 仍只存 SHA-256 哈希，原文仅缓存在浏览器本地。
 */
export async function ensureIdeToken(fs: FsLike = defaultFs): Promise<string> {
  const tokens = await loadTokens(fs);
  const cached = localStorage.getItem(IDE_TOKEN_STORAGE_KEY);
  if (cached) {
    const hash = await sha256Hex(cached);
    if (tokens.some((t) => t.hash === hash && !t.revokedAt)) return cached;
  }
  const { raw } = await createToken(
    { prefix: 'zxp', projectIds: '*', bits: [...CAPABILITY_BITS], note: 'IDE 一键配置(自动生成)' },
    fs,
  );
  localStorage.setItem(IDE_TOKEN_STORAGE_KEY, raw);
  return raw;
}

/** stdio/http 启动命令（未启动时展示） */
export function buildStartCommands(info: ServerInfo | null): { stdio: string; http: string } {
  const entry = info?.serverEntry ?? 'mcp-server/dist/index.js';
  return { stdio: `node "${entry}"`, http: `node "${entry}" --http --port ${info?.httpPort ?? 8787}` };
}

// ===== 自检（页面等价能力：与 mcp-server --selfcheck 读同一批事实源）=====

export interface SelfcheckReport {
  ok: boolean;
  reason?: string;
  tools?: number;
  readTools?: number;
  writeTools?: number;
  transport?: string;
  dataRoot?: string | null;
  serverEntry?: string | null;
  auditFiles?: number;
  tokenCount?: number;
}

export async function runSelfcheck(fs: FsLike = defaultFs): Promise<SelfcheckReport> {
  try {
    const [info, tokens, auditDir] = await Promise.all([
      loadServerInfo(fs),
      loadTokens(fs),
      fs.listDir(MCP_AUDIT_DIR),
    ]);
    return {
      ok: true,
      tools: MCP_TOOLS.length,
      readTools: MCP_TOOLS.filter((t) => t.access === 'read').length,
      writeTools: MCP_TOOLS.filter((t) => t.access === 'write').length,
      transport: 'stdio（默认）+ StreamableHTTP（--http）',
      dataRoot: info?.dataRoot ?? null,
      serverEntry: info?.serverEntry ?? null,
      auditFiles: auditDir.filter((e) => e.kind === 'file' && e.name.endsWith('.jsonl')).length,
      tokenCount: tokens.filter((t) => !t.revokedAt).length,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
