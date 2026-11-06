/**
 * slot-containers — 主体库 / 导演台 项目级容器（2026-11-04 硬约束）
 *
 * 约束：默认初始化即挂载一个容器；画布中不得出现任何分镜、出片节点。
 *
 * 语义：项目创建/首次打开时，默认挂载好「一个剧本 + 一个主体库 + 一个导演台」的
 * 项目级实体/容器，用户进去就能编辑；这些容器：
 *  - 只写 projects/<projectId>/entities/*.json（File System Access 数据根）；
 *  - **绝不写 graph、绝不产生画布节点、不占画布空间**；
 *  - 幂等：已存在 → 原样返回，不覆盖用户内容。
 *
 * 后续（编辑界面迁移）：主体库/导演台 页签的编辑器数据从 node.data 迁到这两个容器，
 * 迁移前容器先就位（本模块），页签打开不再依赖画布节点。
 */
import { readJson, writeJson } from '@/platform/fs';
import { preSaveSnapshot, afterWriteSnapshot } from './snapshot-store.js';
import { ensureScript } from './script-store.js';
import type { DirectorAssetRef, DirectorModelTier } from './director-params.js';

export const SLOT_CONTAINER_SCHEMA_VERSION = 1 as const;

/** 主体库容器：分镜/主体数据的实体家（主体库页签的唯一事实源，元素结构 = ProductionItem） */
export interface StoryboardContainer {
  schemaVersion: typeof SLOT_CONTAINER_SCHEMA_VERSION;
  version: number;
  title: string;
  /** 分镜镜头集合（空容器=[]） */
  shots: unknown[];
  /** 主体（角色/场景/道具）集合（空容器=[]；元素结构 = ProductionItem，entities 层不反向依赖 features 类型） */
  entities: unknown[];
  /** 主体树集合（主体详情单树视图持久化；元素结构 = SubjectTree） */
  subjectTree?: unknown[];
  updatedAt: string;
}

/**
 * 导演台公共参数（对齐 MiniMaxH3 Director 节点 shared_params 块）：
 * 公共素材占各类编号 1..K，片段素材从 K+1 续排（槽位由 director-params.assignAssetSlots 单点计算）。
 *
 * 2026-11-05 公共提示词层下线（约定：MCP/LLM 直接把重复内容写进每段提示词）：
 * - `prompt`（公共提示词）字段已从 schema 移除，新写入不再产生；
 * - 历史数据在 ensureWorkbenchContainer 读取时一次性迁移：非空公共提示词并入每段
 *   imagePrompt（已包含则不重复追加），随后删除该字段（见 migrateSharedPromptIntoShots）。
 */
export interface WorkbenchSharedParams {
  /** commonEnabled：false 时公共素材完全不进场（gen_timeline.py L406-410） */
  enabled: boolean;
  /** 公共素材（槽位 1..K） */
  assets: DirectorAssetRef[];
  /** 参数模板档位：h3（素材≤9）/ sd2.5（素材≤50） */
  presetId: DirectorModelTier;
  /** 公共参数值（key 见 director-params.DIRECTOR_PARAM_SCHEMA scope=shared） */
  params: Record<string, unknown>;
}

/** 导演台容器：多轨时间线数据的实体家（空容器=[]） */
export interface WorkbenchContainer {
  schemaVersion: typeof SLOT_CONTAINER_SCHEMA_VERSION;
  version: number;
  title: string;
  /** 多轨轨道集合（空容器=[]） */
  tracks: unknown[];
  shots: unknown[];
  totalDuration: number;
  /** 公共参数（可缺省；缺省 = 未启用公共参数） */
  sharedParams?: WorkbenchSharedParams;
  updatedAt: string;
}

/** 导演台默认片段时长（秒）——2026-11-04 约定：默认片段 5 秒 */
export const DEFAULT_WORKBENCH_SEGMENT_DURATION = 5;

/**
 * 导演台默认片段（2026-11-04 约定：默认导轨含一个片段，提示词与片段 1 对 1）：
 * 初始化即带片段 1（默认 5 秒、占位态、空提示词），提示词区与该片段字段 1 对 1 绑定。
 * 元素结构与 WorkbenchShot 对齐（entities 层不反向依赖 features 类型，按字面量构造）。
 */
function createDefaultWorkbenchSegment(): Record<string, unknown> {
  return {
    id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    number: 1,
    description: '',
    shotType: '',
    duration: DEFAULT_WORKBENCH_SEGMENT_DURATION,
    imagePrompt: '',
    videoPrompt: '',
    status: 'pending',
    clipState: 'placeholder',
    references: [],
    paramValues: {},
  };
}

/** 默认单轨镜像（track-main 含片段 1 的 clip 引用；结构与 WorkbenchTrack 对齐，按字面量构造） */
function createDefaultWorkbenchTrack(segmentId: string): Record<string, unknown> {
  return {
    id: 'track-main',
    name: '主轨',
    sourceChain: { origin: 'workbench-container' },
    status: 'active',
    order: 0,
    clips: [
      {
        ref: { sourceShotId: segmentId, kind: 'shot' },
        timeline: { startMs: 0, durationMs: DEFAULT_WORKBENCH_SEGMENT_DURATION * 1000 },
      },
    ],
  };
}

/** 唯一拼路径处（不导出，组件无权自行定位容器文件） */
function containerPath(projectId: string, kind: 'storyboard' | 'workbench'): string {
  return `projects/${projectId}/entities/${kind}.json`;
}

/** IO 注入点：测试传内存适配器；生产默认走 platform fs（File System Access 数据根） */
export interface ContainersIO {
  readJson: <T>(path: string) => Promise<T | null>;
  writeJson: (path: string, value: unknown) => Promise<unknown>;
}

const defaultIO: ContainersIO = { readJson, writeJson };

// ===== 公共提示词 → 每段提示词 一次性迁移（2026-11-05 公共提示词层下线） =====

/**
 * 纯函数迁移（不落盘，调用方负责写回）：
 * - sharedParams.prompt 为空/缺失 → 原样返回 null（无迁移）；
 * - 非空 → 并入每段 imagePrompt（已包含该内容则不重复追加；空段直接置为公共提示词），
 *   随后从 sharedParams 中删除 prompt 字段（迁移后清空）；
 * - 除各段 imagePrompt 与 sharedParams.prompt 外不改任何字段。
 */
export function migrateSharedPromptIntoShots<T extends WorkbenchContainer>(container: T): T | null {
  const shared = container.sharedParams as (WorkbenchSharedParams & { prompt?: string }) | undefined;
  const raw = shared?.prompt;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const merged = raw.trim();
  const shots = container.shots.map((s) => {
    const shot = s as { imagePrompt?: string };
    const cur = (shot.imagePrompt ?? '').trim();
    if (cur.includes(merged)) return s; // 已包含 → 不重复追加
    const nextPrompt = cur ? `${merged}\n\n${cur}` : merged;
    return { ...shot, imagePrompt: nextPrompt };
  });
  const restShared: Record<string, unknown> = { ...shared! };
  delete restShared.prompt;
  return { ...container, shots, sharedParams: restShared as unknown as WorkbenchSharedParams };
}

// 快照钩子（2026-11-04 统一快照库：导演台实体只落库无 UI 恢复入口，防误触）。
// 仅生产默认 IO 生效：注入内存适配器的测试无 platform fs 权限，跳过快照避免误伤。
function snapshotHooksEnabled(io: ContainersIO): boolean {
  return io === defaultIO;
}

export async function readStoryboardContainer(
  projectId: string,
  io: ContainersIO = defaultIO,
): Promise<StoryboardContainer | null> {
  const raw = await io.readJson<StoryboardContainer>(containerPath(projectId, 'storyboard'));
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.shots)) return null;
  return raw;
}

export async function readWorkbenchContainer(
  projectId: string,
  io: ContainersIO = defaultIO,
): Promise<WorkbenchContainer | null> {
  const raw = await io.readJson<WorkbenchContainer>(containerPath(projectId, 'workbench'));
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) return null;
  return raw;
}

/**
 * 统计素材在当前项目导演台容器里的被引用次数（2026-11-05 约定：
 * 就地删除公共资产时，撤销浮层里带「有 N 处引用已失效」提示——只提示、不阻断）。
 * 计数范围：公共素材池 + 各片段 references 中 id 命中 assetIds 的条目。
 * 读不到容器（项目未初始化导演台）时返回 0。
 */
export async function countWorkbenchReferences(
  projectId: string,
  assetIds: string[],
  io: ContainersIO = defaultIO,
): Promise<number> {
  if (assetIds.length === 0) return 0;
  const idSet = new Set(assetIds);
  const container = await readWorkbenchContainer(projectId, io);
  if (!container) return 0;
  let count = 0;
  for (const ref of container.sharedParams?.assets ?? []) {
    if (ref && typeof ref === 'object' && 'id' in ref && idSet.has((ref as { id: string }).id)) count++;
  }
  for (const shot of container.shots) {
    const refs = (shot as { references?: Array<{ id?: string }> })?.references ?? [];
    for (const ref of refs) {
      if (ref?.id && idSet.has(ref.id)) count++;
    }
  }
  return count;
}

/**
 * 同一容器文件的「读-改-写」必须串行（2026-11-06 修复「主体类型改了又变回去」）。
 *
 * 为什么必须排队：update*Container 是无锁 read-merge-write，而一次界面操作常连发两笔写
 * （改类型 = subjectTree 一笔 + entities 一笔；改名同理）。两笔都在对方落盘前读到同一份旧
 * 内容，后完成的那一笔就用旧字段覆盖了新字段——磁盘改动被静默吞掉，写回结果再把本地状态
 * 拉回旧值，用户看到「徽标闪一下又变回去」。快照钩子（preSaveSnapshot）在读与写之间还要跑
 * 多步异步，覆盖窗口更宽。
 *
 * 语义：按容器路径排队，前一笔结束（无论成败）才开下一笔；调用方仍能拿到自己那一笔的 rejection。
 */
const writeQueues = new Map<string, Promise<void>>();

function withWriteLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(path) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  writeQueues.set(path, tail);
  // 队列排空即释放，避免长期持有已完成 Promise（键数 = 项目数 × 容器数）
  void tail.then(() => {
    if (writeQueues.get(path) === tail) writeQueues.delete(path);
  });
  return run;
}

/** 幂等挂载主体库容器：存在 → 原样；不存在 → 建空容器。绝不写 graph。 */
export async function ensureStoryboardContainer(
  projectId: string,
  io: ContainersIO = defaultIO,
): Promise<{ container: StoryboardContainer; created: boolean }> {
  const existing = await readStoryboardContainer(projectId, io);
  if (existing) return { container: existing, created: false };
  const container: StoryboardContainer = {
    schemaVersion: SLOT_CONTAINER_SCHEMA_VERSION,
    version: 1,
    title: '主体库',
    shots: [],
    entities: [],
    updatedAt: new Date().toISOString(),
  };
  await io.writeJson(containerPath(projectId, 'storyboard'), container);
  return { container, created: true };
}

/**
 * 幂等挂载导演台容器（2026-11-04 约定：进入项目即存在片段 1，默认 5 秒）。绝不写 graph。
 * - 不存在 → 建容器并自带片段 1（5 秒、序号 1、占位态空提示词）+ 单轨镜像；
 * - 已存在且 ≥1 片段 → 原样返回（重复进入/重复初始化绝不新增第二个片段，已有片段时长不动）；
 * - 已存在但 0 片段（历史空容器）→ 自愈补回片段 1 + 单轨镜像（created=false，version+1）。
 * - 公共提示词一次性迁移（2026-11-05）：历史 sharedParams.prompt 非空 → 并入每段 imagePrompt
 *   后删除该字段并落盘（version+1，走快照钩子），并写一条迁移日志；幂等，只做一次。
 * 读取/渲染路径也应一律调本函数（而不是 readWorkbenchContainer），保证存量项目进入即补/即迁移。
 */
export async function ensureWorkbenchContainer(
  projectId: string,
  io: ContainersIO = defaultIO,
): Promise<{ container: WorkbenchContainer; created: boolean }> {
  let existing = await readWorkbenchContainer(projectId, io);
  if (existing) {
    const migrated = migrateSharedPromptIntoShots(existing);
    if (migrated) {
      const next: WorkbenchContainer = {
        ...migrated,
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      };
      if (snapshotHooksEnabled(io)) await preSaveSnapshot(projectId, 'workbench', existing, next);
      await io.writeJson(containerPath(projectId, 'workbench'), next);
      if (snapshotHooksEnabled(io)) await afterWriteSnapshot(projectId, 'workbench', next);
      // 迁移日志（一次性，不静默丢弃历史公共提示词内容）
      console.info(
        `[workbench-migration] project=${projectId} 公共提示词已并入 ${migrated.shots.length} 段 imagePrompt（version ${existing.version} → ${next.version}），sharedParams.prompt 已清空`,
      );
      existing = next;
    }
  }
  if (existing && existing.shots.length > 0) return { container: existing, created: false };
  if (existing) {
    const seg = createDefaultWorkbenchSegment();
    const healed: WorkbenchContainer = {
      ...existing,
      shots: [seg],
      tracks: [createDefaultWorkbenchTrack(String(seg.id))],
      totalDuration: DEFAULT_WORKBENCH_SEGMENT_DURATION,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (snapshotHooksEnabled(io)) await preSaveSnapshot(projectId, 'workbench', existing, healed);
    await io.writeJson(containerPath(projectId, 'workbench'), healed);
    if (snapshotHooksEnabled(io)) await afterWriteSnapshot(projectId, 'workbench', healed);
    return { container: healed, created: false };
  }
  const seg = createDefaultWorkbenchSegment();
  const container: WorkbenchContainer = {
    schemaVersion: SLOT_CONTAINER_SCHEMA_VERSION,
    version: 1,
    title: '导演台',
    tracks: [createDefaultWorkbenchTrack(String(seg.id))],
    shots: [seg],
    totalDuration: DEFAULT_WORKBENCH_SEGMENT_DURATION,
    updatedAt: new Date().toISOString(),
  };
  await io.writeJson(containerPath(projectId, 'workbench'), container);
  return { container, created: true };
}

/** 主体库容器补丁（数组字段整体替换） */
export type StoryboardContainerPatch = Partial<Pick<StoryboardContainer, 'title' | 'shots' | 'entities' | 'subjectTree'>>;
/**
 * 读盘后才计算的补丁（2026-11-06）：入参是刚读到的最新容器。
 * 调用方若直接传渲染期快照出来的数组，排队期间的他人改动会被自己覆盖掉；
 * 需要「基于最新内容改一格」时用这一形（见 useStoryboardSubjectData 的 entities 写回）。
 */
export type StoryboardContainerPatchFn = (current: StoryboardContainer) => StoryboardContainerPatch;

/**
 * 主体库容器写 API（2026-11-04 主体库页签落地）：读取-合并-写回，版本 +1 乐观递增。
 * 容器缺失时先自愈挂载（ensure）再应用 patch。只写 entities/*.json，绝不写 graph。
 * 同路径的并发调用按发起顺序串行（见 withWriteLock），互不覆盖。
 */
export async function updateStoryboardContainer(
  projectId: string,
  patch: StoryboardContainerPatch | StoryboardContainerPatchFn,
  io: ContainersIO = defaultIO,
): Promise<StoryboardContainer> {
  const path = containerPath(projectId, 'storyboard');
  return withWriteLock(path, async () => {
    const { container } = await ensureStoryboardContainer(projectId, io);
    const resolved = typeof patch === 'function' ? patch(container) : patch;
    const next: StoryboardContainer = {
      ...container,
      ...resolved,
      version: container.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (snapshotHooksEnabled(io)) await preSaveSnapshot(projectId, 'storyboard', container, next);
    await io.writeJson(path, next);
    if (snapshotHooksEnabled(io)) await afterWriteSnapshot(projectId, 'storyboard', next);
    return next;
  });
}

/** 导演台容器补丁（数组/标量字段整体替换） */
export type WorkbenchContainerPatch = Partial<Pick<WorkbenchContainer, 'title' | 'tracks' | 'shots' | 'totalDuration' | 'sharedParams'>>;
/** 读盘后才计算的补丁，语义同 StoryboardContainerPatchFn */
export type WorkbenchContainerPatchFn = (current: WorkbenchContainer) => WorkbenchContainerPatch;

/**
 * 导演台容器写 API：同 updateStoryboardContainer 语义（版本 +1，自愈挂载，绝不写 graph）。
 * 导轨/片段/sharedParams 的多笔并发写同样按路径串行，互不覆盖。
 */
export async function updateWorkbenchContainer(
  projectId: string,
  patch: WorkbenchContainerPatch | WorkbenchContainerPatchFn,
  io: ContainersIO = defaultIO,
): Promise<WorkbenchContainer> {
  const path = containerPath(projectId, 'workbench');
  return withWriteLock(path, async () => {
    const { container } = await ensureWorkbenchContainer(projectId, io);
    const resolved = typeof patch === 'function' ? patch(container) : patch;
    const next: WorkbenchContainer = {
      ...container,
      ...resolved,
      version: container.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (snapshotHooksEnabled(io)) await preSaveSnapshot(projectId, 'workbench', container, next);
    await io.writeJson(path, next);
    if (snapshotHooksEnabled(io)) await afterWriteSnapshot(projectId, 'workbench', next);
    return next;
  });
}

export interface ProjectMountsResult {
  script: { created: boolean };
  storyboard: { created: boolean };
  workbench: { created: boolean };
}

/**
 * 项目级默认挂载：一个剧本实体 + 一个主体库容器 + 一个导演台容器。
 * 项目创建/首次打开时调用（editor-page 进入项目 effect）。
 * 铁律：只写 entities/*.json，绝不写 graph、绝不创建画布节点。
 */
export async function ensureProjectMounts(
  projectId: string,
  io: ContainersIO = defaultIO,
): Promise<ProjectMountsResult> {
  const script = await ensureScript(projectId);
  const storyboard = await ensureStoryboardContainer(projectId, io);
  const workbench = await ensureWorkbenchContainer(projectId, io);
  return {
    script: { created: script.created },
    storyboard: { created: storyboard.created },
    workbench: { created: workbench.created },
  };
}
