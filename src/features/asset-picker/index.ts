/**
 * asset-picker feature - 资源选择器
 *
 * 受控模式: 父组件传入 assets 数组 + onInsert + onClose。
 * 容器内部只管理 keyword / kindFilter / page 状态。
 *
 * Phase D2: 扩展 audio 类型支持,接入真实数据(AssetStore)。
 */

/**
 * 资产类型
 * - script 为剧本资产（content 存 episodes JSON，资产库按剧本分组展示）
 * - plan 为制作计划资产（Plan#51，content 存 PlanDoc JSON，页签打开 PlanWorkbench）
 */
export type AssetKind = 'text' | 'image' | 'video' | 'audio' | 'script' | 'plan';

/**
 * 剧本级全局设置（抽屉「剧本」详情页维护）
 * - coverKey：封面图 storageKey（image:xxx，本地图片库）
 * - ratio：影片比例（如 16:9 / 9:16）
 * - style：影片风格
 */
export interface ScriptMeta {
  coverKey?: string;
  ratio?: string;
  style?: string;
}

/**
 * 资产归属范围（资产项目化）：
 * - project：项目私有，仅所属项目（画布）内可编辑
 * - library：公共库，所有项目可引用，仅公共库视图可编辑
 * 存量记录无 scope 字段，读取时惰性迁移（有 projectId → project，否则 library；见 asset-store.migrateAssetScopes）
 */
export type AssetScope = 'project' | 'library';

/**
 * 资产来源标记（2026-11-04 约定）：抽屉「历史」只收 API/生成链路产物。
 * 仅生成链路自动落库（history-autoland）写入 data.origin='generation'；
 * 手动上传/拖入/素材库添加路径一律不写，历史查询以该标记为唯一判据（isGenerationAsset）。
 */
export type AssetOrigin = 'generation';

/**
 * 历史产出来源（2026-11-07 用户指令：抽屉「历史」按来源分 Tab）
 * - canvas：画布节点上调用生成 API 的产物
 * - director：导演台运行片段（分镜）产出的视频
 * 由 history-autoland 落库时写入 data.originSource；存量记录无该字段时
 * 由 history-utils.getHistorySource 按 provider/标题启发式兜底判定。
 */
export type HistorySource = 'canvas' | 'director';

/** 生成产物的自证元数据（随 origin='generation' 一并写入） */
export interface GenerationMeta {
  /** 生成任务 id（provider 返回的 generationId） */
  jobId?: string;
  /** 提供方（如 openai/seedance/kling…） */
  provider?: string;
  /** 模型标识 */
  model?: string;
  /** 生成提示词 */
  prompt?: string;
  /** 视频时长（秒） */
  durationSec?: number;
  /** 帧率/帧数（若 provider 返回） */
  frames?: number;
  /** 产物生成完成时间（ISO） */
  createdAt: string;
}

/**
 * 引导数据（2026-11-07）：本机 H3 生成时同步产出的 guide 帧（safetensors）。
 * - 与视频一起落资产记录（data.guide），导出时可选「视频+引导」；
 * - 发送到导演台时作为独立引导槽（不占 9 张参考图上限）。
 */
export interface GuideMeta {
  /** 插件 guide id（gd_xxx；对应 output/zeroexo/guides/gd_xxx.safetensors） */
  id: string;
  /** 服务端绝对路径（本机插件；下载/查看时换算 /view） */
  path?: string;
  /** 引导帧数 */
  frames?: number;
  /** 内容 sha256（去重/校验） */
  sha256?: string;
}

export interface Asset {
  id: string;
  title: string;
  kind: AssetKind;
  /** 归属范围：项目私有 / 公共库（缺省视为 library，读取时惰性迁移写回） */
  scope?: AssetScope;
  /** 所属项目（画布）ID：仅 scope='project' 时有值 */
  projectId?: string;
  /** 缩略图 URL(图片用 dataUrl,视频取首帧,音频留空) */
  coverUrl?: string;
  tags?: string[];
  /** 创建时间(ISO 字符串,用于排序) */
  createdAt: string;
  /** 字节数(图片/视频/音频,文本为 0) */
  bytes: number;
  /** MIME 类型(如 image/png、video/mp4、audio/mpeg) */
  mimeType?: string;
  /** 星标收藏 */
  favorite?: boolean;
  data:
    | { kind: 'text'; content: string }
    | {
        kind: 'script';
        content: string;
        storageKey?: string;
        /** 画布强关联：所属画布 id（本地版一个画布对应一个剧本，抽屉「剧本」分组按此过滤） */
        canvasId?: string;
        /** 剧本级全局设置（封面 / 影片比例 / 影片风格） */
        meta?: ScriptMeta;
      }
    /**
     * Plan#51：制作计划（content 存 PlanDoc JSON）
     * 注：下方媒体字段对 plan 无业务含义，仅为兼容既有代码对 Asset['data'] 联合类型的
     * 统一访问（storageKey/dataUrl/…）；plan 分支这些字段恒为空。
     */
    | {
        kind: 'plan';
        content: string;
        /** 画布强关联：所属画布 id（每画布一份，TopBar「计划」入口创建/打开） */
        canvasId?: string;
        /** Plan 版本历史快照（本地存储） */
        history?: Array<{
          id: string;
          label?: string;
          timestamp: string;
          updatedBy: 'ai' | 'user';
          snapshot: unknown;
        }>;
        storageKey?: string;
        dataUrl?: string;
        url?: string;
        width?: number;
        height?: number;
        durationMs?: number;
      }
    | { kind: 'image'; dataUrl: string; storageKey?: string; width?: number; height?: number; originNodeId?: string; origin?: AssetOrigin; originSource?: HistorySource; generation?: GenerationMeta }
    | { kind: 'video'; url: string; storageKey?: string; width?: number; height?: number; durationMs?: number; originNodeId?: string; origin?: AssetOrigin; originSource?: HistorySource; generation?: GenerationMeta; guide?: GuideMeta }
    | { kind: 'audio'; url: string; storageKey?: string; durationMs?: number };
  /** 所属文件夹 ID(资产库/测试模块合并后,素材可归入文件夹) */
  folderId?: string | null;
  /** 云端 ID(同步后设置,本地创建时为 undefined) */
  cloudId?: string;
  /** 云端版本号(用于冲突检测) */
  version?: number;
  /** 最后同步时间(ISO 字符串,null 表示从未同步) */
  lastSyncedAt?: string | null;
  /**
   * CAS 内容寻址引用（2026-11-04）：新资产只持 hash+ext，
   * 物理文件恒为 media/cas/<hash>.<ext>（由 entities/cas-store 按 refCount 管理生命周期）；
   * 存量资产无此字段 → 读取走旧 storageKey 路径兜底（见 resolveAssetMediaPath）。
   */
  cas?: { hash: string; ext: string };
}

export type InsertAssetPayload =
  | { kind: 'text'; content: string; title: string }
  | { kind: 'image'; dataUrl: string; title: string; storageKey?: string; width?: number; height?: number }
  | { kind: 'video'; url: string; title: string; storageKey?: string; coverUrl?: string; width?: number; height?: number; durationMs?: number }
  | { kind: 'audio'; url: string; title: string; storageKey?: string; durationMs?: number };

export interface AssetPickerProps {
  open: boolean;
  assets: Asset[];
  onInsert: (payload: InsertAssetPayload) => void;
  onClose: () => void;
  /** 批量删除素材回调(传入选中素材 id 数组) */
  onDelete?: (ids: string[]) => void;
}

export { AssetPicker } from './components/asset-picker.js';
export { useAssets } from './use-assets.js';
export {
  listAssets,
  addAsset,
  updateAsset,
  removeAsset,
  clearAllAssets,
  upsertAsset,
  markAssetSynced,
  migrateAssetScopes,
  canWriteAsset,
  filterAssetsByScope,
  filterAssetsStrictScope,
  countAssetsByScope,
  resolveUploadScope,
  isLibraryAllowedKind,
  assertLibraryKind,
  LIBRARY_ALLOWED_KINDS,
} from './asset-store.js';
export type { CreateAssetInput, UpdateAssetInput, AssetScopeCounts } from './asset-store.js';
export { downloadAsset } from './services/download-asset.js';
