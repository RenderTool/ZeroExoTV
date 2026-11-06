/**
 * B 硬验收（打开即见）：FSA 主存储通道集成测试。
 *
 * 场景 = 生产最终形态：用户在浏览器选择数据根（此处用 mock FileSystemDirectoryHandle
 * 模拟，seed 自真实磁盘 D:\Test 的现有数据），**不依赖 8790 HTTP 服务**，
 * 前端实体层（script-store / slot-containers / fs.readJson）必须能读到 MCP 写入的
 * ZV-005_xszpm 完整数据：剧本（集/场）、主体 17（含状态与图片键）、导演台 35 段。
 *
 * 前提：D:\Test 存在（本机开发数据根）。数据缺失时 skip（CI 无此目录），不算失败。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJson, setRootHandleForTest } from './fs.js';
import { readScript } from '../entities/script-store.js';
import { readStoryboardContainer, readWorkbenchContainer } from '../entities/slot-containers.js';

const REAL_ROOT = 'D:\\Test';
const PID = '1M2q9yea4eR_';

// ===== mock FileSystemDirectoryHandle：从真实磁盘目录树构建（只读） =====

interface MockFile { content: Buffer; lastModified: number; size: number }

function buildFile(abs: string): MockFile {
  const content = readFileSync(abs);
  const st = statSync(abs);
  return { content, lastModified: Math.floor(st.mtimeMs), size: st.size };
}

function buildDir(abs: string): unknown {
  const files = new Map<string, MockFile>();
  const dirs = new Map<string, unknown>();
  for (const name of readdirSync(abs)) {
    const child = path.join(abs, name);
    if (statSync(child).isDirectory()) dirs.set(name, buildDir(child));
    else files.set(name, buildFile(child));
  }
  const mockFile = (m: MockFile) => ({
    size: m.size,
    lastModified: m.lastModified,
    type: 'application/octet-stream',
    text: async () => m.content.toString('utf8'),
    arrayBuffer: async () => m.content.buffer.slice(m.content.byteOffset, m.content.byteOffset + m.content.byteLength),
  });
  const mockHandle = (m: MockFile) => ({ getFile: async () => mockFile(m) });
  return {
    kind: 'directory',
    name: path.basename(abs),
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      if (!dirs.has(name)) {
        if (opts?.create) {
          const created = buildEmptyDir();
          dirs.set(name, created);
          return created;
        }
        throw new Error(`NotFound: ${name}`);
      }
      return dirs.get(name);
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name)) {
        if (opts?.create) {
          const created: MockFile = { content: Buffer.alloc(0), lastModified: 0, size: 0 };
          files.set(name, created);
          return { ...mockHandle(created), createWritable: async () => { throw new Error('测试句柄只读'); } };
        }
        throw new Error(`NotFound: ${name}`);
      }
      const m = files.get(name)!;
      return mockHandle(m);
    },
    async removeEntry(name: string) {
      files.delete(name);
      dirs.delete(name);
    },
    values() {
      const iter = (async function* () {
        for (const [name, d] of dirs) yield { name, kind: 'directory', ...(d as object) };
        for (const [name, f] of files) yield { name, kind: 'file', ...mockFile(f) };
      })();
      return iter;
    },
  };
}

function buildEmptyDir(): unknown {
  return buildDirLite();
}

function buildDirLite(): unknown {
  const files = new Map<string, MockFile>();
  const dirs = new Map<string, unknown>();
  const self: unknown = {
    kind: 'directory',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      if (!dirs.has(name)) {
        if (!opts?.create) throw new Error(`NotFound: ${name}`);
        const created = buildDirLite();
        dirs.set(name, created);
        return created;
      }
      return dirs.get(name);
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!opts?.create) throw new Error(`NotFound: ${name}`);
        const created: MockFile = { content: Buffer.alloc(0), lastModified: 0, size: 0 };
        files.set(name, created);
        return {
          getFile: async () => ({ size: 0, lastModified: 0, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }),
          createWritable: async () => {
            const chunks: Uint8Array[] = [];
            return {
              write: async (d: unknown) => { chunks.push(Buffer.from(d as string)); },
              close: async () => {
                const buf = Buffer.concat(chunks);
                const m: MockFile = { content: buf, lastModified: Date.now(), size: buf.length };
                files.set(name, m);
              },
            };
          },
        };
      }
      const m = files.get(name)!;
      return {
        getFile: async () => ({
          size: m.size, lastModified: m.lastModified,
          text: async () => m.content.toString('utf8'),
          arrayBuffer: async () => m.content.buffer.slice(m.content.byteOffset, m.content.byteOffset + m.content.byteLength),
        }),
      };
    },
    async removeEntry(name: string) { files.delete(name); dirs.delete(name); },
    values() {
      const iter = (async function* () {
        for (const [name, d] of dirs) yield { name, kind: 'directory', ...(d as object) };
        for (const [name, f] of files) yield { name, kind: 'file', size: f.size, lastModified: f.lastModified };
      })();
      return iter;
    },
  };
  return self;
}

const hasData = existsSync(path.join(REAL_ROOT, 'projects', PID, 'entities', 'script.json'));

beforeAll(() => {
  if (!hasData) return;
  setRootHandleForTest(buildDir(REAL_ROOT) as never);
});

afterAll(() => {
  setRootHandleForTest(null);
});

describe.skipIf(!hasData)('FSA 主存储：打开即见 ZV-005_xszpm（不依赖 8790）', () => {
  it('项目列表来自磁盘：projects.json 含 ZV-005_xszpm', async () => {
    const env = await readJson<{ __lf?: number; value?: Array<{ id: string; title: string }> }>('.lf/zeroexo/app_meta/projects.json');
    expect(env).not.toBeNull();
    const hit = (env!.value ?? []).find((p) => p.id === PID);
    expect(hit?.title).toBe('ZV-005_xszpm');
  });

  it('完整剧本：集/场结构可读（script-store → projects/<pid>/entities/script.json）', async () => {
    const script = await readScript(PID);
    expect(script).not.toBeNull();
    expect(script!.episodes.length).toBeGreaterThanOrEqual(1);
    const ep = script!.episodes[0]!;
    expect(ep.content ?? '').not.toBe('');
    expect(ep.title).toBeTruthy();
  });

  it('主体列表：17 个含状态与图片键（storyboard.json entities）', async () => {
    const sb = await readStoryboardContainer(PID);
    expect(sb).not.toBeNull();
    const entities = (sb as unknown as { entities?: Array<Record<string, unknown>> }).entities ?? [];
    expect(entities.length).toBe(17);
    expect(entities.every((e) => typeof e.name === 'string' && e.name.length > 0)).toBe(true);
    const withCover = entities.filter((e) => e.coverKey || (Array.isArray(e.images) && e.images.length > 0));
    expect(withCover.length).toBeGreaterThan(0); // 有主体带图（缩略）
  });

  it('导演台：35 段、总时长 475.5s（workbench.json shots）', async () => {
    const wb = await readWorkbenchContainer(PID);
    expect(wb).not.toBeNull();
    const shots = (wb as unknown as { shots?: Array<Record<string, unknown>> }).shots ?? [];
    expect(shots.length).toBe(35);
    expect((wb as unknown as { totalDuration?: number }).totalDuration).toBe(475.5);
    expect(shots.every((s) => typeof s.videoPrompt === 'string')).toBe(true); // 双轨提示词在位
  });
});
