/**
 * mcp-client 逻辑层单测（2026-11-04）
 *
 * 覆盖（对应验收 ②③④⑤的纯逻辑部分）：
 * 1. token 创建：原文仅返回一次，磁盘只存 SHA-256 哈希；撤销写入 revokedAt
 * 2. 审计：跨日期 jsonl 合并、按工具/项目过滤、limit/offset、lastUsedByToken
 * 3. 配置块：buildStdioConfig 含真实数据根与入口绝对路径
 * 4. 自检失败 → ok:false 且带 reason
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  MCP_AUDIT_DIR,
  MCP_TOOLS,
  MCP_SERVER_INFO_PATH,
  MCP_TOKENS_PATH,
  buildStdioConfig,
  createToken,
  ensureIdeToken,
  loadAudit,
  loadTokens,
  mcpServerMissingTools,
  revokeToken,
  runSelfcheck,
  type FsLike,
  type TokenFile,
} from './mcp-client.js';

/** 内存假 fs（path → 文本内容） */
function makeFs(initial: Record<string, string> = {}): FsLike & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    async readJson<T>(path: string) {
      const raw = files.get(path);
      if (raw === undefined) return null;
      return JSON.parse(raw) as T;
    },
    async writeJson(path: string, value: unknown) {
      files.set(path, JSON.stringify(value));
    },
    async readFile(path: string) {
      return files.get(path) ?? null;
    },
    async listDir(path: string) {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const names = new Set<string>();
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (!rest.includes('/')) names.add(rest);
      }
      return [...names].sort().map((name) => ({ name, kind: 'file' as const }));
    },
  };
}

describe('token 创建与撤销（验收③）', () => {
  it('创建：原文只在返回值出现一次，磁盘只存哈希不存原文', async () => {
    const fs = makeFs();
    const { record, raw } = await createToken({ prefix: 'zxp', projectIds: '*', bits: ['project.read'] }, fs);
    expect(raw.startsWith('zxp_')).toBe(true);
    expect(raw).toHaveLength(4 + 48);
    const onDisk = JSON.parse(fs.files.get(MCP_TOKENS_PATH)!) as TokenFile;
    expect(onDisk.tokens).toHaveLength(1);
    expect(onDisk.tokens[0]!.id).toBe(record.id);
    expect(JSON.stringify(onDisk)).not.toContain(raw); // 磁盘无原文
    expect(onDisk.tokens[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('撤销：写 revokedAt，loadTokens 读回已撤销态（服务端每次调用重读 → 立即失效）', async () => {
    const fs = makeFs();
    const { record } = await createToken({ prefix: 'zxp', projectIds: ['p1'], bits: ['script.read'] }, fs);
    await revokeToken(record.id, fs);
    const tokens = await loadTokens(fs);
    expect(tokens[0]!.revokedAt).toBeTruthy();
    // 重复撤销幂等
    await revokeToken(record.id, fs);
    expect((await loadTokens(fs))[0]!.revokedAt).toBe(tokens[0]!.revokedAt);
  });
});

describe('审计读取与过滤（验收④）', () => {
  const day1 = [
    { ts: '2026-11-03T10:00:00Z', tool: 'list_projects', tokenId: 'tok-a', result: 'ok', durationMs: 3 },
    { ts: '2026-11-03T11:00:00Z', tool: 'import_script', tokenId: 'tok-a', projectId: 'p1', result: 'error', code: 'VERSION_CONFLICT', durationMs: 5 },
  ];
  const day2 = [
    { ts: '2026-11-04T09:00:00Z', tool: 'import_script', tokenId: 'tok-b', projectId: 'p2', result: 'ok', durationMs: 8 },
    'bad line{{{',
  ];

  function fsWithAudit(): ReturnType<typeof makeFs> {
    return makeFs({
      [`${MCP_AUDIT_DIR}/mcp-2026-11-03.jsonl`]: day1.map((l) => JSON.stringify(l)).join('\n'),
      [`${MCP_AUDIT_DIR}/mcp-2026-11-04.jsonl`]: day2.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'),
    });
  }

  it('跨日期合并、坏行跳过、按 ts 倒序、total 正确', async () => {
    const res = await loadAudit({}, fsWithAudit());
    expect(res.total).toBe(3);
    expect(res.entries.map((e) => e.ts)).toEqual([
      '2026-11-04T09:00:00Z',
      '2026-11-03T11:00:00Z',
      '2026-11-03T10:00:00Z',
    ]);
  });

  it('按工具名 + projectId 过滤', async () => {
    const fs = fsWithAudit();
    expect((await loadAudit({ tool: 'import_script' }, fs)).total).toBe(2);
    expect((await loadAudit({ projectId: 'p1' }, fs)).total).toBe(1);
    expect((await loadAudit({ tool: 'import_script', projectId: 'p2' }, fs)).total).toBe(1);
    expect((await loadAudit({ tool: 'import_script', projectId: 'p1' }, fs)).entries[0]!.code).toBe('VERSION_CONFLICT');
  });

  it('limit/offset 分页 + lastUsedByToken 取每 token 最近一条', async () => {
    const fs = fsWithAudit();
    const page1 = await loadAudit({ limit: 2, offset: 0 }, fs);
    const page2 = await loadAudit({ limit: 2, offset: 2 }, fs);
    expect(page1.entries).toHaveLength(2);
    expect(page2.entries).toHaveLength(1);
    expect(page1.lastUsedByToken).toEqual({ 'tok-b': '2026-11-04T09:00:00Z', 'tok-a': '2026-11-03T11:00:00Z' });
  });

  it('无审计目录 → 空结果不报错', async () => {
    const res = await loadAudit({}, makeFs());
    expect(res).toEqual({ entries: [], total: 0, lastUsedByToken: {} });
  });
});

describe('配置块（验收②）', () => {
  it('stdio 配置块含真实数据根、入口路径与注入的 token，复制即可用', () => {
    const text = buildStdioConfig(
      {
        serverEntry: 'D:\\AICode\\zeroexo\\zeroexo-comfyui\\mcp-server\\dist\\index.js',
        dataRoot: 'D:\\Test',
      },
      'zxp_injected_raw',
    );
    const cfg = JSON.parse(text);
    expect(cfg.mcpServers.zeroexo.command).toBe('node');
    expect(cfg.mcpServers.zeroexo.args[0]).toContain('mcp-server');
    expect(cfg.mcpServers.zeroexo.env.ZEROEXO_DATA_ROOT).toBe('D:\\Test');
    expect(cfg.mcpServers.zeroexo.env.ZEROEXO_MCP_TOKEN).toBe('zxp_injected_raw');
  });
});

describe('IDE 一键配置 token（ensureIdeToken）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无 token 时自动创建全权限 token，原文缓存进 localStorage、磁盘只存哈希', async () => {
    const fs = makeFs();
    const raw = await ensureIdeToken(fs);
    expect(raw.startsWith('zxp_')).toBe(true);
    expect(localStorage.getItem('zeroexo.mcp.ideTokenRaw')).toBe(raw);
    const onDisk = JSON.parse(fs.files.get(MCP_TOKENS_PATH)!) as TokenFile;
    expect(onDisk.tokens).toHaveLength(1);
    expect(onDisk.tokens[0]!.projectIds).toBe('*');
    expect(onDisk.tokens[0]!.bits).toHaveLength(11); // 全部能力位
    expect(JSON.stringify(onDisk)).not.toContain(raw); // 磁盘无原文
  });

  it('缓存的原文仍对应未撤销 token → 直接复用，不再新建', async () => {
    const fs = makeFs();
    const first = await ensureIdeToken(fs);
    const second = await ensureIdeToken(fs);
    expect(second).toBe(first);
    const onDisk = JSON.parse(fs.files.get(MCP_TOKENS_PATH)!) as TokenFile;
    expect(onDisk.tokens).toHaveLength(1);
  });

  it('缓存的原文对应 token 已撤销 → 重新创建', async () => {
    const fs = makeFs();
    const first = await ensureIdeToken(fs);
    const onDisk = JSON.parse(fs.files.get(MCP_TOKENS_PATH)!) as TokenFile;
    await revokeToken(onDisk.tokens[0]!.id, fs);
    const second = await ensureIdeToken(fs);
    expect(second).not.toBe(first);
  });
});

describe('服务端更新感知（mcpServerMissingTools）', () => {
  it('没有 server-info 或没有工具清单 → 视为无法判断，不误报缺全部工具', () => {
    expect(mcpServerMissingTools(null)).toEqual([]);
    expect(mcpServerMissingTools({ toolNames: undefined } as never)).toEqual([]);
    expect(mcpServerMissingTools({ toolNames: [] } as never)).toEqual([]);
  });

  it('清单齐全 → 不报旧版', () => {
    const info = { toolNames: MCP_TOOLS.map((t) => t.name) } as never;
    expect(mcpServerMissingTools(info)).toEqual([]);
  });

  it('缺 preflight_import → 明确报出缺哪个（只比数量会被增删抵消）', () => {
    const names = MCP_TOOLS.map((t) => t.name).filter((n) => n !== 'preflight_import');
    expect(mcpServerMissingTools({ toolNames: names } as never)).toEqual(['preflight_import']);
  });
});

describe('自检（验收⑤）', () => {  it('正常：返回工具数/传输/数据根/审计文件数/token 数', async () => {
    const fs = makeFs({
      [MCP_SERVER_INFO_PATH]: JSON.stringify({ dataRoot: 'D:\\Test', serverEntry: 'D:\\x\\dist\\index.js' }),
      [`${MCP_AUDIT_DIR}/mcp-2026-11-04.jsonl`]: '',
    });
    const { raw } = await createToken({ prefix: 'zxp', projectIds: '*', bits: ['project.read'] }, fs);
    void raw;
    const report = await runSelfcheck(fs);
    expect(report.ok).toBe(true);
    // 2026-11-09：不再硬编码 21/9/12，跟前端工具清单同源（新增 MCP 工具不会让自检说谎）
    expect(report.tools).toBe(MCP_TOOLS.length);
    expect(report.readTools).toBe(MCP_TOOLS.filter((t) => t.access === 'read').length);
    expect(report.writeTools).toBe(MCP_TOOLS.filter((t) => t.access === 'write').length);
    expect(report.dataRoot).toBe('D:\\Test');
    expect(report.auditFiles).toBe(1);
    expect(report.tokenCount).toBe(1);
  });

  it('失败：fs 抛错 → ok:false 且带 reason', async () => {
    const fs = makeFs();
    fs.listDir = async () => {
      throw new Error('数据目录未授权：No available storage method found');
    };
    const report = await runSelfcheck(fs);
    expect(report.ok).toBe(false);
    expect(report.reason).toContain('数据目录未授权');
  });
});
