/**
 * workbench-types - 出片工作台节点数据类型
 *
 * 数据直接写入 node.data，随画布 Yjs 同步。
 *
 * 2026-09-01 Plan#61：片态二分重构。
 * - 移除 videos[] / activeVideoIndex / generated（备选语义）
 * - 新增 clipState + media（占位态/完成态）
 * - 裁剪区间由 trimStart/trimEnd 表达
 */

import type { AiMemory } from './storyboard-types';
import type { SubjectTree } from './subject-tree-types';

export type WorkbenchStatus = 'idle' | 'ready' | 'generating' | 'done';
// idle = 未开拍(初始态), ready = 已就绪(上游连入), generating = 生成中, done = 全部完成

/**
 * 片段「引导槽」数据（2026-11-07 用户定稿）：
 * - 独立槽位类型，**不占** 9 张参考图上限；每个片段至多一个，重复发送即替换；
 * - 来源 = 本机 H3 生成产物自带的 guide（safetensors）；运行该段时作为显式引导，
 *   不再回退「上一段生成的引导」（use_prev_guide=false）。
 */
export interface WorkbenchShotGuide {
  /** 插件 guide id（gd_xxx，output/zeroexo/guides/gd_xxx.safetensors） */
  id: string;
  /** 来源视频标题：引导数据不是独立素材，必须与所属片段视频同名 */
  title?: string;
  frames?: number;
  sha256?: string;
  /** 来源视频的媒体键/地址：引导槽用视频首帧做预览，与普通视频槽一致 */
  storageKey?: string;
  url?: string;
  /** 来源资产 id（追溯/去重用） */
  fromAssetId?: string;
  createdAt?: string;
}

export interface WorkbenchShot {
  id: string;
  number: number;
  description: string;
  shotType: string;
  duration: number;
  imagePrompt?: string;
  videoPrompt?: string;
  /** 生成状态（cancelled = 运行被用户取消；interrupted = 上次异常退出残留自愈降级，2026-11-05） */
  status: 'pending' | 'generating' | 'done' | 'failed' | 'cancelled' | 'interrupted';
  /** 首帧/尾帧图片 storageKey */
  firstFrameKey?: string;
  lastFrameKey?: string;
  /** 上游分镜 shot 的 id（用于追溯） */
  sourceShotId?: string;

  // ===== 生产台扩展字段 =====
  /** 负面提示词 */
  negativePrompt?: string;
  /** 质量门评分 */
  quality?: {
    score: number;
    deductions: Array<{ item: number; reason: string }>;
    checkedAt: string;
  };
  /** 组装式引擎元信息 */
  promptAssembly?: {
    form: string;
    anchorSentences: string[];
    motionBudget: { subject: number; camera: number; environment: number };
    aspectRatio: string;
    assembledAt: string;
  };

  // ===== 片态二分（2026-09-01 Plan#61：占位态 / 完成态，消除备选）=====
  /** 片态：placeholder=拖入未调 AI 前准备提示词/素材；completed=API 生成后 / 资产拖入的媒体 */
  clipState: 'placeholder' | 'completed';
  /** 完成态媒体（单一，消除备选语义）。trimStart/trimEnd 表达裁剪区间 */
  media?: {
    storageKey: string;
    /** 素材原始名 */
    title?: string;
    /** 生成所用模型 */
    model?: string;
    /** 源媒体真实时长（秒） */
    sourceDuration?: number;
    /** 裁剪起点（默认 0） */
    trimStart?: number;
    /** 裁剪终点（默认 = sourceDuration） */
    trimEnd?: number;
    aspectRatio?: string;
    /** 输入提示词 */
    prompt?: string;
    /** 来源：generated=本镜生成 / external=外部拖入资产库 */
    source: 'generated' | 'external';
    /** 关联 AiGeneration.id，用于参数溯源 */
    generationId?: string;
    createdAt?: string;
    /** 本段生成产物自带的引导数据（供「视频+引导」导出 / 再次发送到导演台） */
    guide?: WorkbenchShotGuide;
  };
  /**
   * 片段引导槽（独立槽位，不占参考图 9 格）：发送引导数据到此段时写入；
   * 每段至多一个，重复发送 = 替换。
   */
  guide?: WorkbenchShotGuide;
  /** 用户手动改过 */
  manualEdit?: boolean;
  /**
   * 导演台 H3：上下文引导（段间引导）开关。
   * 段 1（序号 1）恒 false 不可开启；其余段缺省 true（segment_continuity.py L210-231）。
   * 实际生效还需公共参数主开关 continuityEnabled=true。
   */
  continuation?: { enabled: boolean };
  /** 圣经引用 */
  bibleRefs?: {
    characters: string[];
    scenes: string[];
    props: string[];
  };
  /** 音频预览 */
  audioPreview?: {
    storageKey: string;
    duration?: number;
    name?: string;
  };

  // ===== 参考素材（2026-08-31：出片模式受控数据，存镜头级 node.data，随 Yjs 云同步）=====
  /** 参考素材列表（首帧/尾帧/参考图/参考视频/参考音频/参考文本），生成时作为 referenceKeys 传后端 */
  references?: WorkbenchShotReference[];


  // ===== 生成配置（2026-08-31：与底部生成参数栏双向同步） =====
  /** 当前镜头选用的模型值（"channelId::model" 编码），由 NodeGenerateDock 写入 */
  model?: string;
  /** 契约参数值（模板驱动，存 duration/resolution/ratio 等）。
   * `duration` 与顶层 `duration` 互为镜像：参数面板改 → 轨道 clip 变长；拖动 clip → 参数面板同步。
   */
  paramValues?: Record<string, unknown>;

  // ===== 提示词 Diff / 迭代系统（Plan#58 T1） =====
  /** 提示词版本历史 */
  promptHistory?: PromptHistoryEntry[];

  // ===== P4 §8.5: 待修改标记（rework）=====

  /** 待修改标记：溯源联动后标记需要修改的镜头，时间轴橙标展示 */
  rework?: {
    /** 标记状态：flagged=已标记待改 / reworking=正在修改中 / done=已修改完成 */
    status: 'flagged' | 'reworking' | 'done';
    /** 修改原因说明 */
    reason?: string;
    /** 修改范围：shot=单镜 / segment=连续段 / episode=整集 */
    scope?: 'shot' | 'segment' | 'episode';
    /** 标记来源：user=用户提交 / agent=Agent 自动判定 */
    source: 'user' | 'agent';
  };
}

/** 独立素材池条目 */
export interface WorkbenchMediaAsset {
  id: string;
  /** 云存储 key */
  storageKey: string;
  title?: string;
  model?: string;
  duration?: number;
  /** 来源镜头 id（仅追溯，不参与强关联） */
  fromShotId?: string;
  createdAt: string;
}

// ===== 提示词 Diff / 迭代系统（Plan#58 T1） =====
/** 提示词历史版本条目 */
export interface PromptHistoryEntry {
  version: number;
  timestamp: string;
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt?: string;
  paramValues?: Record<string, unknown>;
  qualityScore?: number;
  label?: 'failed' | 'acceptable' | 'excellent';
  thumbnailUrl?: string;
}

/** 出片镜头参考素材（存 node.data → Yjs 云同步，协作可见） */
export interface WorkbenchShotReference {
  /** 本地唯一 id（`ref-${timestamp}-${rand}`） */
  id: string;
  kind: 'image' | 'video' | 'audio' | 'text';
  title?: string;
  /** 云存储 key（优先） */
  storageKey?: string;
  /** 预览 url（图片 dataUrl / 直链兜底） */
  url?: string;
  width?: number;
  height?: number;
  /** 首尾帧模式槽位（仅 kind=image 时） */
  slot?: 'first' | 'last';
  /** 导演台槽位号 pin（2026-11-04：移除中间槽位后其余槽位保持原号，不重排） */
  slotNo?: number;
  /** Plan#71 T8：来源指纹快照（失效检测依据；用户上传素材可缺省=永不过期） */
  origin?: SubjectRefFingerprint | null;
  /** Plan#71 T8：失效标记（检测后写回，UI 据此标红；只标不自动改） */
  stale?: { level: 'warn' | 'broken'; reason: string } | null;
}

/** 引用来源指纹（Spec §2.3/§3） */
export interface SubjectRefFingerprint {
  kind: 'subject-base' | 'subject-state' | 'color-card' | 'user-upload';
  rootId?: string;
  nodeId?: string;
  /** 状态名（展示/提示用） */
  state?: string;
  /** 来源图 storageKey（快照） */
  mediaKey?: string;
  /** 来源图更新时间戳（快照） */
  updatedAt?: string;
}

// ===== Plan#74 Phase E：出片导入制多轨（§8.6 方案轨）=====

/** 轨道上的片段 = 实例引用（源本体留在分镜节点，轨上只存引用 + 时间轴摆位 + 本轨实例覆盖） */
export interface WorkbenchClipRef {
  /** 来源指纹：sourceShotId=上游分镜镜号；kind=shot(分镜来源)/media(本地补拍/拖入)；sourceKey=引用校验键 */
  ref: { sourceShotId: string; kind: 'shot' | 'media'; sourceKey?: string };
  /** 时间轴摆位（毫秒） */
  timeline: { startMs: number; durationMs: number };
  /** 实例覆盖：本轨对该源的局部改动（不写回源分镜） */
  instanceData?: Partial<WorkbenchShot>;
}

/** 一条轨道 = 一条完整出片方案（多分镜连入 = 多轨；LLM 改版 = 候选轨，不替换原方案） */
export interface WorkbenchTrack {
  id: string;
  name: string;
  /** 来源链：origin = 分镜节点 id */
  sourceChain: { origin: string; label?: string };
  /** active=生效 / candidate=候选（改版对比）/ discarded=废弃 */
  status: 'active' | 'candidate' | 'discarded';
  /** 纵向层叠顺序（上优先 + 空档回填裁决用） */
  order: number;
  clips: WorkbenchClipRef[];
  /** Plan#74 E2：建轨时上游分镜 shots 的内容指纹（重连差异追溯依据） */
  contentFingerprint?: string;
}

export interface WorkbenchNodeData {
  status: WorkbenchStatus;
  shots: WorkbenchShot[];
  /** Plan#74 Phase E：多轨方案轨（§8.6）——导入制建轨，源本体留分镜节点，轨上只存引用+摆位（与 shots 并存过渡，E3 渲染接管后收敛） */
  tracks?: WorkbenchTrack[];
  /** 总时长(秒) */
  totalDuration: number;
  /** 已完成的镜头数 */
  completedCount: number;
  /** 上游分镜节点 id */
  sourceStoryboardId?: string;
  /** 上游统筹节点 id */
  sourceProductionManagerId?: string;
  /** 被本地删除的上游分镜 sourceShotId（resync 合并时跳过，避免删除复活，2026-08-31） */
  deletedSourceShotIds?: string[];
  /** 独立素材池（2026-08-31）：生成/导入的媒体素材独立留存，不强绑某段，删除片段不删素材 */
  mediaAssets?: WorkbenchMediaAsset[];
  /** 上游分镜主体资产（圣经） */
  entities?: Array<{
    id: string;
    name: string;
    kind: string;
    description: string;
    anchorSentence?: string;
    anchorLocked?: boolean;
    /** 主体状态细分（@主体-状态 匹配用，2026-08-31） */
    states?: Array<{ id: string; name: string; note?: string }>;
    referenceImages?: Array<{ storageKey: string; prompt?: string; isPrimary?: boolean }>;
  }>;

  /** 节点级 AI 记忆字典（Plan#55 C1）：Agent 任务收尾时间线，随 Yjs 同步 */
  aiMemory?: AiMemory;

  /** Plan#71 T8：上游分镜主体树快照（引用失效检测权威源；resync 时随 sourceStoryboardId 写入）。
   * 与 references[].origin 指纹比对：主体图换代/状态删除/树删除 → detectStaleRefs 标红。 */
  subjectTrees?: SubjectTree[];

  /** 当前选择的剧本片段摘要（Plan#57 A3：Agent 输入区用） */
  scriptSummary?: string;

  /** 分镜生成报告（Plan#57：全量改造，LLM 推理过程+质量报告+缺失项+改进建议，Markdown 格式） */
  report?: {
    /** 报告 ID（唯一标识，用于历史追踪） */
    id: string;
    /** 报告标题 */
    title: string;
    /** 完整 Markdown 内容（前端「报告」Tab 直接展示） */
    markdownContent: string;
    /** 生成时间 */
    createdAt: string;
    /** 关联的剧本片段摘要 */
    scriptSummary: string;
    /** 关联的圣经引用摘要 */
    bibleSummary: string;
    /** 质量报告摘要 */
    qualitySummary: {
      averageScore: number;
      passedCount: number;
      totalCount: number;
    };
    /** 缺失项分析 */
    missingItems: Array<{
      category: string;
      item: string;
      impact: string;
      suggestion: string;
    }>;
    /** 改进建议 */
    improvements: Array<{
      priority: 'high' | 'medium' | 'low';
      area: string;
      suggestion: string;
    }>;
  };
}

/** 分割镜头操作参数 */
export interface SplitShotParams {
  /** 待分割镜头 id */
  shotId: string;
  /** 分割时间点（秒），从镜头起始算起 */
  splitTime: number;
}

/** 合并镜头操作参数 */
export interface MergeShotsParams {
  /** 前一个镜头 id */
  firstShotId: string;
  /** 后一个镜头 id */
  secondShotId: string;
}