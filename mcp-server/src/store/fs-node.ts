/**
 * Node 侧底层写通道。写纪律与前端 src/platform/fs.ts 对齐：
 * - writeFile（fs.ts:182-190）：createWritable 全量写 close 提交 → 这里用「临时文件 + rename」原子写；
 * - writeJsonIfUnchanged（fs.ts:214-220）：size+lastModified 乐观锁 → updateUnversionedJson 的 stat 双因子校验；
 * - 版本字段乐观锁 → updateVersionedJson 的 baseVersion 比对。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { McpError } from "../errors.js";

export interface FileStat {
  size: number;
  mtimeMs: number;
}

export async function fileStat(p: string): Promise<FileStat | null> {
  try {
    const s = await fs.stat(p);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

export async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new McpError("IO_ERROR", `读取 JSON 失败: ${p}: ${(err as Error).message}`);
  }
}

export async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = path.join(
    path.dirname(p),
    `.${path.basename(p)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  );
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    await fs.rename(tmp, p);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw new McpError("IO_ERROR", `原子写失败: ${p}: ${(err as Error).message}`);
  }
}

/** 进程内 per-path 互斥锁：串行化同一文件的写操作。 */
const locks = new Map<string, Promise<unknown>>();

export async function withFileLock<T>(p: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(p) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tracked = run.catch(() => undefined);
  locks.set(p, tracked);
  try {
    return await run;
  } finally {
    if (locks.get(p) === tracked) locks.delete(p);
  }
}

export interface VersionedEntity {
  version: number;
  updatedAt: string;
}

export interface UpdateVersionedOptions<T extends VersionedEntity> {
  /** 读后写乐观锁：0 表示仅允许创建；非 0 必须与磁盘 version 相等。 */
  baseVersion: number;
  createIfMissing?: () => Omit<T, "version" | "updatedAt">;
  mutate: (data: T) => void;
  /** true 时只返回 before/after 预览，不落盘。 */
  dryRun?: boolean;
}

export interface UpdateResult<T> {
  before: T | null;
  after: T;
  written: boolean;
}

/**
 * 带版本字段的实体（script/storyboard/workbench）统一更新入口。
 * baseVersion 不匹配 → VERSION_CONFLICT（携带 expected/actual）。
 */
export async function updateVersionedJson<T extends VersionedEntity>(
  p: string,
  opts: UpdateVersionedOptions<T>,
): Promise<UpdateResult<T>> {
  return withFileLock(p, async () => {
    const existing = await readJsonIfExists<T>(p);
    if (!existing) {
      if (opts.baseVersion !== 0) {
        throw new McpError("NOT_FOUND", `实体不存在，baseVersion=0 才能创建: ${p}`, {
          expected: opts.baseVersion,
          actual: null,
        });
      }
      if (!opts.createIfMissing) {
        throw new McpError("NOT_FOUND", `实体不存在且未提供 createIfMissing: ${p}`);
      }
    } else if (existing.version !== opts.baseVersion) {
      throw new McpError(
        "VERSION_CONFLICT",
        `版本冲突：期望 baseVersion=${opts.baseVersion}，实际 version=${existing.version}。请重新读取后再写。`,
        { expected: opts.baseVersion, actual: existing.version },
      );
    }

    const before: T | null = existing ? (JSON.parse(JSON.stringify(existing)) as T) : null;
    const working: T = existing
      ? (JSON.parse(JSON.stringify(existing)) as T)
      : ({ ...opts.createIfMissing!(), version: 0, updatedAt: "" } as T);
    opts.mutate(working);
    working.version = (existing?.version ?? 0) + 1;
    working.updatedAt = new Date().toISOString();

    if (!opts.dryRun) {
      await writeJsonAtomic(p, working);
    }
    return { before, after: working, written: !opts.dryRun };
  });
}

export interface UpdateUnversionedOptions<T> {
  mutate: (data: T | null) => T;
  dryRun?: boolean;
}

/**
 * 无版本字段的文件（projects.json 信封、cas_index.json）统一更新入口。
 * 用 mtime/size 双因子校验对齐前端 writeJsonIfUnchanged 语义。
 */
export async function updateUnversionedJson<T>(
  p: string,
  opts: UpdateUnversionedOptions<T>,
): Promise<UpdateResult<T>> {
  return withFileLock(p, async () => {
    const statBefore = await fileStat(p);
    const existing = await readJsonIfExists<T>(p);
    const after = opts.mutate(existing ? (JSON.parse(JSON.stringify(existing)) as T) : null);
    if (opts.dryRun) {
      return { before: existing, after, written: false };
    }
    const statNow = await fileStat(p);
    const changed =
      (statBefore === null) !== (statNow === null) ||
      (statBefore && statNow && (statBefore.mtimeMs !== statNow.mtimeMs || statBefore.size !== statNow.size));
    if (changed) {
      throw new McpError("VERSION_CONFLICT", `文件在读后被外部修改（mtime/size 变化）：${p}`, {
        expected: statBefore,
        actual: statNow,
      });
    }
    await writeJsonAtomic(p, after);
    return { before: existing, after, written: true };
  });
}
