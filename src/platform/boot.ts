/**
 * 启动装配（必须作为 main.tsx 的第一条 import，早于任何 localforage 实例创建）
 *
 * 2026-11-05 白屏修复（兜底策略）：
 * 1. 驱动顺序显式声明：磁盘（权威，唯一持久层）→ IndexedDB → WebSQL → localStorage → 内存。
 *    localforage 按序自动降级；最后一级（内存）永不失败，界面不再因
 *    「No available storage method found.」白屏。
 * 2. defineDriver 先于任何 localforage 实例 init 执行：期间任何 import 链上的
 *    localforage 操作都可能先 init——驱动必须在此之前注册完毕。
 * 3. bootReady 恒 resolve：启动链每步独立 catch，任何失败只降级、不阻断渲染。
 * 4. 激活驱动可查询（activeStorageKind）：非磁盘驱动时 UI 显示临时存储横幅。
 *
 * 2026-11-05 数据同源修复：vite dev/preview 会自动拉起 8790 fs-server，
 * boot 启动时主动探测并接管（服务端数据根 = 唯一权威）。此前「不自动探测」导致
 * localforage 静默降级到 IndexedDB：assets.json 不落盘、cas: 键读不到 media/cas
 * 真实文件，表现为「导入成功但网格与画布全空白」。探测失败才回退 FSA 目录句柄。
 *
 * 注意：磁盘之后的全部驱动都是**临时存储**（刷新即丢 / 与数据根双轨），
 * 仅用于让界面能开、错误能被看见；权威数据永远只认磁盘数据根。
 */

import localforage from 'localforage';
import { FS_DRIVER, registerFsDriver } from './disk-driver.js';
import { MEMORY_DRIVER, registerMemoryDriver } from './memory-driver.js';
import { isAuthorized, writeRaw, readRaw } from './fs.js';
import { probeHttpFs } from './http-fs.js';

/** 迁移器用的旁路标记：强制不注入磁盘驱动（源实例只用 IndexedDB 读旧数据） */
const FORCE_NO_FS = Symbol.for('zeroexo.forceNoFs');

type CreateInstanceConfig = { name?: string; storeName?: string; driver?: string | string[];[k: string]: unknown };

/**
 * 驱动链：磁盘优先；磁盘 init 失败（目录授权失效）时
 * localforage 自动尝试下一级，内存驱动兜底保证必有可用存储。
 */
export function driverChain(): string[] {
  return [FS_DRIVER, localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE, MEMORY_DRIVER];
}

function withFsFirst(config: CreateInstanceConfig | undefined): CreateInstanceConfig {
  const cfg: CreateInstanceConfig = { ...(config ?? {}) };
  if ((cfg as Record<symbol, unknown>)[FORCE_NO_FS]) {
    delete (cfg as Record<symbol, unknown>)[FORCE_NO_FS];
    return cfg;
  }
  cfg.driver = driverChain();
  return cfg;
}

const originalCreateInstance = localforage.createInstance.bind(localforage) as (c?: CreateInstanceConfig) => typeof localforage;
(localforage as unknown as { createInstance: (c?: CreateInstanceConfig) => typeof localforage }).createInstance = (c?: CreateInstanceConfig) => originalCreateInstance(withFsFirst(c));

// 默认实例自身的顺序也要改（app 层有直接用 localforage.getItem 的地方）
localforage.config({ driver: driverChain() } as { driver: string[] });

const ROOT_MARKER = 'zeroexo-root.json';

async function ensureRootMarker(): Promise<void> {
  if (!(await isAuthorized())) return;
  try {
    const existing = await readRaw(ROOT_MARKER);
    if (!existing) {
      await writeRaw(ROOT_MARKER, JSON.stringify({ app: 'zeroexo-studio', version: 1, createdAt: new Date().toISOString() }, null, 2));
    }
  } catch {
    /* 标记失败不阻断启动 */
  }
}

/**
 * 启动序列（恒 resolve，绝不 reject —— main.tsx 依赖它渲染界面）。
 * 顺序纪律：接管本地数据服务（必须在任何 localforage 实例 init 前）→ 注册驱动 → 补写目录标记。
 */
// 驱动注册必须在模块顶层同步发起：若放在任何 await 之后，import 链上先 init 的
// localforage 实例会因「驱动尚未定义」直接降级并永久粘滞到 IndexedDB。
const memoryDriverReady = registerMemoryDriver().catch((err) => {
  console.warn('[boot] 内存驱动注册失败（兜底缺失，浏览器存储仍可用）:', err);
});
const fsDriverReady = registerFsDriver().catch((err) => {
  console.warn('[boot] 磁盘驱动注册失败，回退浏览器存储链:', err);
});

export const bootReady: Promise<void> = (async () => {
  try {
    const info = await probeHttpFs({ retry: false });
    if (!info) {
      console.warn('[boot] 本地数据服务未在线，改用已授权的本地目录；数据目录未授权时图片无法落盘');
    }
  } catch (err) {
    console.warn('[boot] 本地数据服务探测异常，保持目录授权路径:', err);
  }
  await memoryDriverReady;
  await fsDriverReady;
  try {
    await ensureRootMarker();
  } catch {
    /* 标记失败不阻断启动 */
  }
})();

export type StorageKind = 'disk' | 'browser' | 'memory' | null;

/** 当前默认实例实际激活的存储类型：UI 据此显示临时存储横幅 */
export async function activeStorageKind(): Promise<StorageKind> {
  try {
    await localforage.ready();
    const name = localforage.driver();
    if (name === FS_DRIVER) return 'disk';
    if (name === MEMORY_DRIVER) return 'memory';
    return 'browser';
  } catch {
    return null;
  }
}

/** 供 UI 使用：迁移完成后需要整页刷新让已创建实例重新绑驱动 */
export function reloadWithDisk(): void {
  window.location.reload();
}
