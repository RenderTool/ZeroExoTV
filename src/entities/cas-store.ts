/**
 * cas-store — 内容寻址存储（CAS）唯一写者（2026-11-04）
 *
 * 目标机制（对齐原平台 findOrCreate({hash}) 语义）：
 *  - 物理文件：media/cas/<sha256>.<ext>，同内容全数据根只存一份；
 *  - 索引：entities/cas_index.json（数据根全局单文件，refs 内带 projectId 以支持跨项目共享），
 *    作为唯一事实源，由本模块单点写入（不写 graph）；
 *  - 资产记录只持 cas 引用（hash + ext）与派生 storageKey（cas:<hash>.<ext>，非独立物理路径）；
 *    读取侧由 disk-driver 将 cas: 键穿透到 media/cas/ 实际文件，渲染层零改动；
 *  - 写操作经进程内全局写锁串行化（风格同 script-store.withWriteLock），
 *    并发同 hash 上传只产生一份物理文件；跨进程（MCP）写入由 writeJsonIfUnchanged 乐观锁兜底；
 *  - releaseCas 两端幂等：索引无条目 / 无该 ref → 静默成功，绝不产生 refCount=0 的幽灵条目。
 *
 * 不变量：索引条目存在 ⇔ 物理文件存在；refCount 恒等于 refs.length；
 *         refCount 到 0 时先写索引（摘条目）再删文件，崩溃残留只会是孤儿文件（可被再扫描收敛），
 *         绝不会出现「索引指向不存在文件」的读断裂。
 */
import { readJson, stat, writeJsonIfUnchanged, writeFileBlob, removeFile } from '@/platform/fs';

export const CAS_SCHEMA_VERSION = 1 as const;

export interface CasRef {
  assetId: string;
  projectId: string;
  kind: string;
}

export interface CasEntry {
  path: string;
  size: number;
  mime: string;
  ext: string;
  refCount: number;
  createdAt: string;
  refs: CasRef[];
}

export interface CasIndex {
  schemaVersion: number;
  entries: Record<string, CasEntry>;
}

/** 索引唯一拼路径处（不导出，全局单文件） */
function casIndexPath(): string {
  return 'entities/cas_index.json';
}

export function casFilePath(hash: string, ext: string): string {
  return `media/cas/${hash}.${ext}`;
}

/** cas 派生键：不是独立物理路径，由 hash+ext 唯一决定，渲染侧经 disk-driver 穿透读取 */
export function casStorageKey(hash: string, ext: string): string {
  return `cas:${hash}.${ext}`;
}

export function isCasStorageKey(key: string | undefined | null): key is string {
  return typeof key === 'string' && key.startsWith('cas:');
}

export function parseCasStorageKey(key: string | undefined | null): { hash: string; ext: string } | null {
  if (!isCasStorageKey(key)) return null;
  const m = /^cas:([0-9a-f]{64})\.([a-z0-9]+)$/.exec(key);
  return m ? { hash: m[1]!, ext: m[2]! } : null;
}

/**
 * 资产 → 磁盘相对路径解析器（渲染/预览用）。
 * 新资产（带 cas 字段）→ media/cas/<hash>.<ext>；
 * 存量资产（无 cas 字段）→ 返回 null，调用方走旧路径兜底（localforage 桶 / mediaRelPath）。
 */
export function resolveAssetMediaPath(asset: { cas?: { hash: string; ext: string } }): string | null {
  if (asset.cas && /^[0-9a-f]{64}$/.test(asset.cas.hash)) return casFilePath(asset.cas.hash, asset.cas.ext);
  return null;
}

/**
 * 引用存活探测（2026-11-04 资产→主体状态关联）：CAS 索引中是否仍有该 hash 的条目。
 * 主体库等 UI 用它判断「引用已失效」（文件被 GC 后给出占位/重新关联提示）。只读、不建不删。
 */
export async function hasCasEntry(hash: string): Promise<boolean> {
  const index = await readCasIndex();
  return !!index.entries[hash];
}

// ===== 流式 SHA-256（纯 TS 增量实现：Blob 分块读，不整载入内存；浏览器/Node 行为一致）=====

const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

class Sha256 {
  private readonly h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly buf = new Uint8Array(64);
  private bufLen = 0;
  private totalLen = 0;

  update(data: Uint8Array): void {
    this.totalLen += data.byteLength;
    let off = 0;
    if (this.bufLen > 0) {
      const need = 64 - this.bufLen;
      const take = Math.min(need, data.byteLength);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      off = take;
      if (this.bufLen === 64) {
        this.block(this.buf);
        this.bufLen = 0;
      }
    }
    while (off + 64 <= data.byteLength) {
      this.block(data.subarray(off, off + 64));
      off += 64;
    }
    if (off < data.byteLength) {
      this.buf.set(data.subarray(off), 0);
      this.bufLen = data.byteLength - off;
    }
  }

  private block(chunk: Uint8Array): void {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
      const j = i * 4;
      w[i] = ((chunk[j]! << 24) | (chunk[j + 1]! << 16) | (chunk[j + 2]! << 8) | chunk[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) >>> 0;
      const ch = ((e! & f!) ^ (~e! & g!)) >>> 0;
      const t1 = (hh! + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = (rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) >>> 0;
      const maj = ((a! & b!) ^ (a! & c!) ^ (b! & c!)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d! + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0]! + a!) >>> 0;
    this.h[1] = (this.h[1]! + b!) >>> 0;
    this.h[2] = (this.h[2]! + c!) >>> 0;
    this.h[3] = (this.h[3]! + d!) >>> 0;
    this.h[4] = (this.h[4]! + e!) >>> 0;
    this.h[5] = (this.h[5]! + f!) >>> 0;
    this.h[6] = (this.h[6]! + g!) >>> 0;
    this.h[7] = (this.h[7]! + hh!) >>> 0;
  }

  digest(): Uint8Array {
    const bitLenHi = Math.floor(this.totalLen / 0x20000000);
    const bitLenLo = (this.totalLen << 3) >>> 0;
    this.update(new Uint8Array([0x80]));
    while (this.bufLen !== 56) this.update(new Uint8Array([0]));
    const tail = new Uint8Array(8);
    new DataView(tail.buffer).setUint32(0, bitLenHi >>> 0);
    new DataView(tail.buffer).setUint32(4, bitLenLo);
    // digest 内部的填充不应计入 totalLen，但 update 会累加——此处不再使用 totalLen，安全
    this.update(tail);
    const out = new Uint8Array(32);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) dv.setUint32(i * 4, this.h[i]!);
    return out;
  }

  hex(): string {
    return Array.from(this.digest(), (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** 跨 realm 的字节判定（instanceof Uint8Array 在 jsdom/vm 隔离上下文会误判） */
function isByteArray(data: Uint8Array | Blob): data is Uint8Array {
  return ArrayBuffer.isView(data);
}

/** 流式计算 sha256：Uint8Array 直接算；Blob 按流分块喂入，不整载入内存（无 stream 的环境回退 arrayBuffer） */
export async function sha256Hex(data: Uint8Array | Blob): Promise<string> {
  const h = new Sha256();
  if (isByteArray(data)) {
    h.update(data);
  } else if (typeof data.stream === 'function') {
    const reader = data.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) h.update(value);
    }
  } else if (typeof data.arrayBuffer === 'function') {
    h.update(new Uint8Array(await data.arrayBuffer()));
  } else {
    // 受限环境（如 jsdom 的 Blob 无 stream/arrayBuffer）：FileReader 兜底
    const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.onerror = () => reject(fr.error ?? new Error('[cas-store] FileReader 读取失败'));
      fr.readAsArrayBuffer(data);
    });
    h.update(new Uint8Array(buf));
  }
  return h.hex();
}

// ===== 进程内全局写锁（风格同 script-store.withWriteLock；索引全局单文件 → 全局一把锁）=====

let casWriteLock: Promise<unknown> = Promise.resolve();

function withCasLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = casWriteLock.then(fn, fn);
  casWriteLock = next;
  const cleanup = () => { if (casWriteLock === next) casWriteLock = Promise.resolve(); };
  next.then(cleanup, cleanup);
  return next;
}

const CONFLICT_RETRY = 3;

function emptyIndex(): CasIndex {
  return { schemaVersion: CAS_SCHEMA_VERSION, entries: {} };
}

async function readIndex(): Promise<CasIndex> {
  const raw = await readJson<CasIndex>(casIndexPath());
  if (!raw || typeof raw !== 'object' || typeof raw.entries !== 'object' || raw.entries === null) return emptyIndex();
  return raw;
}

function sameRef(a: CasRef, b: CasRef): boolean {
  return a.assetId === b.assetId && a.projectId === b.projectId && a.kind === b.kind;
}

export interface PutCasInput {
  data: Uint8Array | Blob;
  mime?: string;
  /** 缺省从 mime 推断；非法字符一律剥除 */
  ext?: string;
  ref: CasRef;
  /** 调用方已算好 hash 时可传入以跳过重算（仍要求与内容一致，CAS 语义由调用方担保） */
  hash?: string;
}

export interface PutCasResult {
  hash: string;
  ext: string;
  path: string;
  storageKey: string;
  size: number;
  /** true = 命中已有条目，未重复写字节 */
  deduped: boolean;
}

function sanitizeExt(ext: string): string {
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned || 'bin';
}

function extFromMime(mime: string | undefined): string {
  const sub = (mime?.split('/')[1] ?? '').toLowerCase().split(';')[0]!.trim();
  const table: Record<string, string> = {
    jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', 'svg+xml': 'svg', avif: 'avif',
    mp4: 'mp4', quicktime: 'mov', webm: 'webm', 'x-matroska': 'mkv',
    mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'x-wav': 'wav', aac: 'aac', ogg: 'ogg', opus: 'opus', flac: 'flac', 'mp4a-latm': 'm4a',
  };
  return table[sub] ?? 'bin';
}

/**
 * findOrCreate：同内容只落一份物理文件。
 * 命中 → refCount+1（同 ref 重复调用幂等不加）并复用路径，不写重复字节；
 * 未命中 → 写 media/cas/<hash>.<ext> 并建索引条目。
 * 全程在全局写锁内，并发同 hash 只产生一份文件；外部（MCP）并发改索引由乐观锁重试兜底。
 */
export async function putCas(input: PutCasInput): Promise<PutCasResult> {
  const hash = input.hash ?? (await sha256Hex(input.data));
  const mime = input.mime || 'application/octet-stream';
  const ext = sanitizeExt(input.ext ?? extFromMime(input.mime));
  const bytes = isByteArray(input.data) ? input.data : new Uint8Array(await input.data.arrayBuffer());
  const size = bytes.byteLength;
  return withCasLock(async () => {
    for (let attempt = 0; attempt < CONFLICT_RETRY; attempt++) {
      const index = await readIndex();
      const st = await stat(casIndexPath());
      const existing = index.entries[hash];
      if (existing) {
        // 自愈：索引在而文件被外部删掉 → 用手中字节补回（同 hash 即同内容）
        if (!(await stat(existing.path))) {
          await writeFileBlob(existing.path, bytes, existing.mime);
        }
        if (!existing.refs.some((r) => sameRef(r, input.ref))) {
          existing.refs.push(input.ref);
        }
        existing.refCount = existing.refs.length; // refCount 恒由 refs 派生，杜绝漂移
        try {
          await writeJsonIfUnchanged(casIndexPath(), index, st);
        } catch {
          continue; // 外部并发改索引 → 重读重试
        }
        return {
          hash,
          ext: existing.ext,
          path: existing.path,
          storageKey: casStorageKey(hash, existing.ext),
          size: existing.size,
          deduped: true,
        };
      }
      const path = casFilePath(hash, ext);
      await writeFileBlob(path, bytes, mime);
      const entry: CasEntry = {
        path,
        size,
        mime,
        ext,
        refCount: 1,
        createdAt: new Date().toISOString(),
        refs: [input.ref],
      };
      index.entries[hash] = entry;
      try {
        await writeJsonIfUnchanged(casIndexPath(), index, st);
      } catch {
        continue; // 文件已写（同 hash 同内容，重写幂等），索引冲突重试
      }
      return { hash, ext, path, storageKey: casStorageKey(hash, ext), size, deduped: false };
    }
    throw new Error('[cas-store] 索引写入连续冲突，放弃（外部写入过于频繁）');
  });
}

export interface ReleaseCasResult {
  /** 本次是否真实摘掉了一个 ref */
  released: boolean;
  /** refCount 到 0：物理文件与索引条目均已移除 */
  removed: boolean;
}

/**
 * 仅注册引用、不写字节（2026-11-04 抽屉「历史 → 加入资产库」链路）：
 * 同 hash 的物理文件已存在时，为新的资产记录补挂一条 ref（refCount+1），
 * 实现「入资产库不复制第二份」；同 ref 重复调用幂等不加。
 */
export async function registerCasRef(hash: string, ref: CasRef): Promise<void> {
  return withCasLock(async () => {
    for (let attempt = 0; attempt < CONFLICT_RETRY; attempt++) {
      const index = await readIndex();
      const st = await stat(casIndexPath());
      const entry = index.entries[hash];
      if (!entry) throw new Error(`[cas-store] registerCasRef: 索引无条目 ${hash}`);
      if (!(await stat(entry.path))) throw new Error(`[cas-store] registerCasRef: 物理文件缺失 ${entry.path}`);
      if (!entry.refs.some((r) => sameRef(r, ref))) {
        entry.refs.push(ref);
        entry.refCount = entry.refs.length; // refCount 恒由 refs 派生
        try {
          await writeJsonIfUnchanged(casIndexPath(), index, st);
        } catch {
          continue; // 外部并发改索引 → 重读重试
        }
      }
      return;
    }
    throw new Error('[cas-store] 索引写入连续冲突，放弃（外部写入过于频繁）');
  });
}

/**
 * 删除资产时释放引用：refCount-1；到 0 先摘索引条目再删物理文件。
 * 两端幂等：条目不存在 / 该 ref 不存在 → 静默成功（重复删除不报错）。
 */
export async function releaseCas(hash: string, ref: { assetId: string; projectId?: string }): Promise<ReleaseCasResult> {
  return withCasLock(async () => {
    for (let attempt = 0; attempt < CONFLICT_RETRY; attempt++) {
      const index = await readIndex();
      const entry = index.entries[hash];
      if (!entry) return { released: false, removed: false }; // 幂等：条目已不在
      const before = entry.refs.length;
      entry.refs = entry.refs.filter(
        (r) => !(r.assetId === ref.assetId && (ref.projectId === undefined || r.projectId === ref.projectId)),
      );
      entry.refCount = entry.refs.length;
      if (entry.refs.length === before && before > 0) {
        return { released: false, removed: false }; // 幂等：该 ref 已摘过，索引无需回写
      }
      const st = await stat(casIndexPath());
      if (entry.refs.length === 0) {
        delete index.entries[hash];
        try {
          await writeJsonIfUnchanged(casIndexPath(), index, st);
        } catch {
          continue;
        }
        await removeFile(entry.path); // 先索引后文件：崩溃只留孤儿文件，不留断链索引
        return { released: true, removed: true };
      }
      try {
        await writeJsonIfUnchanged(casIndexPath(), index, st);
      } catch {
        continue;
      }
      return { released: true, removed: false };
    }
    throw new Error('[cas-store] 索引写入连续冲突，放弃（外部写入过于频繁）');
  });
}

/** 读索引（迁移脚本/测试/诊断用；组件不应直读） */
export async function readCasIndex(): Promise<CasIndex> {
  return readIndex();
}
