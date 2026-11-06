/**
 * 剧创节点模块图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * 胶囊工具图标属交互语义，必须走模块级 icons.ts Map，禁止在扩展文件里散落内联 lucide。
 * fullscreen=Maximize（剧本/分镜/出片/剧管全屏编辑统一入口）
 */
import { Maximize, FileUp, BookOpen, Aperture, RotateCcw, Film, AlertTriangle, X, Check, Sparkles, ListVideo, Layers, SquarePlay, Palette, Play } from 'lucide-react';

/** 剧创节点胶囊工具图标映射 */
export const CANVAS_NODE_ICONS = {
  /** 色卡（调色盘；色卡节点编辑胶囊/创建菜单统一图标，Plan#65） */
  palette: Palette,
  /** 全屏编辑（剧本/分镜/出片/剧管胶囊统一图标） */
  fullscreen: Maximize,
  /** 导入剧本 */
  import: FileUp,
  /** Agent 入口（导入小说/生成分镜 合并后的下拉按钮，Plan#56 C1） */
  agent: Sparkles,
  /** 全屏翻阅 */
  read: BookOpen,
  /** 生成分镜 */
  generateStoryboard: Aperture,
  /** 重新生成（分镜/出片） */
  regenerate: RotateCcw,
  /** 生成当前选中集 */
  generateSelectedEpisode: ListVideo,
  /** 生成全部集 */
  generateAllEpisodes: Layers,
  /**
   * 播放全部（整轨序列：总时长 = 各片段之和）
   * 与下方 playClip 必须强区分（2026-09-02 验收：整段=方框内播放 SquarePlay / 选中=列表 ListVideo）
   */
  playAll: SquarePlay,
  /** 播放选中片段（仅当前选中的那一段） */
  playClip: ListVideo,
  /** 2026-11-05 导演台卡片缩略框：中央播放键 / 无产物占位三角（同一语义） */
  clipPlay: Play,
  // ===== 生产台内容区图标（2026-08-31 铁律：一律 lucide 走本 Map，禁止 emoji 字符） =====
  /** 视频空位占位（暂无视频/暂无生成产物） */
  videoEmpty: Film,
  /** 失败告警（生成失败覆盖层） */
  warning: AlertTriangle,
  /** 关闭/失败标记（替代 ✕ / ✗ 字符） */
  close: X,
  /** 成功/完成标记（替代 ✓ 字符） */
  check: Check,
} as const;
