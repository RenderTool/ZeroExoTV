/**
 * StoryboardSubjectTree - 分镜「主体树」大纲式编辑器（Plan#71 T3，2026-09-03 重构）
 *
 * 布局约定（2026-09-03 大幅简化）：
 * - 大纲式纯纵向：root 简单卡(第 0 行) → 基础形态卡(step1) → 状态卡(step2..N) 逐行排列
 * - 状态卡统一一套展示：图片/视频 → 缩略预览；音频 → 音频图标可播放；文本 → 文本图标；
 *   右侧只有一个「完整提示词」输入框（不再拆分 delta/识别语）
 * - 新增/插入状态统一一个「＋」按钮：不预选媒体类型，创建后用户上传素材自动识别类型
 * - 不再做「关联上一图」的 derive UI：生成时由 LLM 自行决定参考哪个 step 的图，用户无需操作
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp, Dropdown } from 'antd';
import {
  Plus, Film, Image as ImageIcon, AudioLines, Trash2,
  Upload as UploadIcon, Sparkles, Copy, Check, ChevronDown, RefreshCw, Paperclip,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { useAuth } from '@/features/auth/auth-store.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { usePreviewImage } from '@zeroexo/plugin-nodes';
import { hasCasEntry, isCasStorageKey, parseCasStorageKey } from '@/entities/cas-store.js';
import { displayEpisodeTitle } from '@/entities/script-store.js';
import {
  type ProductionItemKind,
} from '../production-manager/production-manager-types';
import {
  type SubjectTree, type SubjectTreeNode, type SubjectNodeMedia, type SubjectNodeMediaRef,
  type SubjectBaseState, type ColorCardSwatch,
  type SubjectTemplateType,
  buildDefaultStateName,
  createSubjectNode,
  normalizeSubjectTree,
  nextStateStep,
  sortStatesByEpisodeRelevance,
  sortTreesByEpisodeRelevance,
} from './subject-tree-types';
import {
  linkSubjectStateMedia,
  releaseSubjectStateMediaRefs,
  type SubjectStateMediaAsset,
} from './subject-state-media';
import { SubjectMediaSourcePanel } from './subject-media-source-panel';

// ===== 设计 token =====
const CARD_RADIUS = 10;
/** 主体树媒体预览尺寸（2026-09-03 修复：56px 小方块看不清 → 放大为主体大图） */
const MEDIA_SIZE = 168;

export interface StoryboardSubjectTreeProps {
  trees: SubjectTree[];
  theme: ThemeConfig;
  activeKind?: 'all' | ProductionItemKind;
  colorCard?: { palette: ColorCardSwatch[] } | null;
  onChange: (trees: SubjectTree[]) => void;
  onAddSubject: (kind: ProductionItemKind) => void;
  /** 删除整个主体（根卡）。主体是分镜生成时 AI 自动识别创建的**产物**，
   *  产物不等于只读——用户必须能删（征集 #154，推翻 Plan#71 「根节点禁删」设计）。
   *  不传则不渲染删除入口。 */
  onDeleteRoot?: (rootId: string) => void;
  /** 禁用内部滚动（由父级 panZoom 接管视口） */
  disableScroll?: boolean;
  /** 剧集列表（2026-11-04「出现集数」多选：新增集自动出现；来源 script-store readScript） */
  episodes?: Array<{ number: number; title?: string }>;
  /** 当前剧集编号（方案 C 2026-11-05：script.activeEpisodeId → 集号；null = 取不到上下文退回原顺序，绝不硬编码） */
  activeEpisodeNumber?: number | null;
  /** 当前项目 id（2026-11-04：CAS 引用记账 + 来源面板「从画布/本项目资产」过滤） */
  projectId?: string;
}

// 2026-09-04 征集 #155：主体树内部一律单色（neutral）——删除按 kind 上色的 KIND_COLOR 与
// 按模板类型上色的 TEMPLATE_TYPE_LABEL（四色彩虹徽标），分类信息靠文字表达就够了。
const KIND_META: Record<ProductionItemKind, { labelKey: string }> = {
  character: { labelKey: 'entity.character' },
  scene: { labelKey: 'entity.scene' },
  prop: { labelKey: 'entity.prop' },
};

function clampCopy(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

/** 复制钮（绿勾反馈） */
function CopyButton({ text, t, muted }: { text: string; t: (k: string) => string; muted: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={t('common.copy')}
      onClick={(e) => {
        e.stopPropagation();
        if (!text) return;
        clampCopy(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        display: 'inline-flex', padding: 2, border: 'none', background: 'transparent',
        color: copied ? '#4ade80' : muted, cursor: text ? 'pointer' : 'not-allowed', flexShrink: 0,
        opacity: text ? 1 : 0.35,
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function MediaThumb({ mediaKey, dark, type, size = MEDIA_SIZE }: { mediaKey?: string; dark: boolean; type: 'image' | 'video'; size?: number }): React.ReactElement {
  const fallback = mediaKey ? (getResourceUrl(mediaKey, 'preview') ?? '') : '';
  const hydrated = usePreviewImage(mediaKey ?? '', fallback);
  const Icon = type === 'video' ? Film : ImageIcon;
  const boxStyle = { width: size, height: size, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)', background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' };
  if (!hydrated) {
    return (
      <div style={boxStyle}>
        <Icon size={size > 96 ? 28 : 16} />
      </div>
    );
  }
  return <img src={hydrated} alt="" draggable={false} style={{ width: size, height: size, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />;
}

/** 引用存活探测（2026-11-04 断链诚实）：CAS 键在索引中已被 GC → false，主体侧显示「引用已失效」占位。
 *  非 CAS 键（历史本地存储）无法低成本探测，默认存活（usePreviewImage 失败自会退图标占位）。 */
function useCasAlive(storageKey?: string): boolean {
  const [alive, setAlive] = useState(true);
  useEffect(() => {
    if (!storageKey || !isCasStorageKey(storageKey)) { setAlive(true); return; }
    let cancelled = false;
    void (async () => {
      try {
        const parsed = parseCasStorageKey(storageKey);
        if (!parsed) { if (!cancelled) setAlive(true); return; }
        const ok = await hasCasEntry(parsed.hash);
        if (!cancelled) setAlive(ok);
      } catch { /* 探测失败按存活处理 */ }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);
  return alive;
}

/**
 * 「出现集数」多选下拉（2026-11-04 约定，替换原「仅作引导」帮助文案位置）。
 * - 存储层：状态级 SubjectTreeNode.appearEpisodes（不同状态可出现在不同集；与 UI 位置一致）
 * - 收起时显示已选摘要（如 `1, 2`）；未选显示「全部」
 * - 悬空编号（剧集已删）：仅过滤显示，数据保留不静默清除；用户下次编辑时自然写出新选择
 * - 新增集自动出现在列表（episodes 来自 script-store 实时读取）
 */
function EpisodeMultiSelect({
  node, tree, episodes, t, onUpdateNode,
}: {
  node: SubjectTreeNode;
  tree: SubjectTree;
  episodes?: Array<{ number: number; title?: string }>;
  t: ReturnType<typeof useTranslation>['t'];
  onUpdateNode: (rootId: string, nodeId: string, patch: Partial<SubjectTreeNode>) => void;
}): React.ReactElement {
  const validNumbers = useMemo(() => (episodes ?? []).map((e) => e.number), [episodes]);
  const selected = useMemo(
    () => (node.appearEpisodes ?? []).filter((n) => validNumbers.includes(n)).sort((a, b) => a - b),
    [node.appearEpisodes, validNumbers],
  );
  const summary = selected.length > 0 ? selected.join(', ') : t('subject.appearEpisodesAll', '全部');
  const items = useMemo(() => {
    const list = (episodes ?? []).slice().sort((a, b) => a.number - b.number)
      .map((ep) => ({ key: String(ep.number), label: displayEpisodeTitle(ep.title, ep.number) }));
    if (list.length === 0) return [{ key: '__none__', label: t('subject.appearEpisodesEmpty', '暂无剧集'), disabled: true }];
    return list;
  }, [episodes, t]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9, fontWeight: 600, flexShrink: 0 }}>{t('subject.appearEpisodes', '出现集数')}</span>
      <Dropdown
        trigger={['click']}
        menu={{
          multiple: true,
          selectable: true,
          items,
          selectedKeys: selected.map(String),
          onClick: ({ key }) => {
            if (key === '__none__') return;
            const n = Number(key);
            const next = selected.includes(n)
              ? selected.filter((x) => x !== n)
              : [...selected, n].sort((a, b) => a - b);
            onUpdateNode(tree.rootId, node.id, { appearEpisodes: next });
          },
        }}
      >
        <button
          type="button"
          title={t('subject.appearEpisodesHint', '勾选该状态出现的集数；未选 = 全部剧集')}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, minWidth: 220, maxWidth: '100%', border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', cursor: 'pointer', borderRadius: 6, padding: '2px 8px', fontSize: 9, color: 'inherit', fontFamily: 'inherit', textAlign: 'left' }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
          <ChevronDown size={9} style={{ flexShrink: 0 }} />
        </button>
      </Dropdown>
    </div>
  );
}

/** 基础形态占位卡（step 1，术语随 kind） */
function BaseStateCard({
  tree, theme, t, onUpdateBaseState, onUploadBaseImage, onDeleteBaseMedia,
}: {
  tree: SubjectTree;
  theme: ThemeConfig;
  t: ReturnType<typeof useTranslation>['t'];
  onUpdateBaseState: (rootId: string, patch: Partial<SubjectBaseState>) => void;
  onUploadBaseImage: (rootId: string, file: File) => void;
  /** 删除当前基础图（恢复上传占位），Plan#71 反馈：上传后应可删除/替换 */
  onDeleteBaseMedia: (rootId: string) => void;
}): React.ReactElement {
  const isDark = theme.mode === 'dark';
  const surface = isDark ? '#161616' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const fileRef = useRef<HTMLInputElement>(null);
  const baseImg = tree.baseState.referenceImages?.find((m) => m.type === 'image');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', borderRadius: CARD_RADIUS, overflow: 'hidden',
      background: surface, border: `1px solid ${border}`,
    }}>
      {/* 头：step1 + 统一术语「基础状态」
          2026-09-04 征集 #155：删除按 kind 派生的术语（原「角色形象·三视图定妆」预设了角色必是人形，
          生物/机器人/动物类角色被错称）与右侧彩色模板徽标，统一叫「基础状态」。
          baseState.templateType / templateReason 数据字段保留（后端 LLM 契约），仅不再展示。 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: `linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.28) 62%, rgba(0,0,0,0) 100%)`,
        color: '#fff', fontSize: 11, fontWeight: 600,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 16, borderRadius: 999, background: 'rgba(255,255,255,0.22)', fontSize: 9, padding: '0 6px', flexShrink: 0 }}>1</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('subject.baseState', '基础状态')}</span>
      </div>

      <div style={{ display: 'flex', gap: 10, padding: 10 }}>
        {/* 媒体缩略/上传 */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {baseImg?.key ? (
            <>
              <MediaThumb mediaKey={baseImg.key} dark={isDark} type="image" />
              {/* hover：替换 / 删除 */}
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 8, display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                background: 'rgba(0,0,0,0.42)', opacity: 0, transition: 'opacity 0.15s',
              }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0'; }}>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title={t('subject.replaceMedia', '替换')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.12)', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <RefreshCw size={9} />{t('subject.replaceMedia', '替换')}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteBaseMedia(tree.rootId)}
                  title={t('subject.deleteMedia', '删除媒体')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid rgba(255,120,120,0.55)', background: 'rgba(220,38,38,0.25)', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <Trash2 size={9} />{t('common.delete')}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title={t('subject.uploadBaseImage', '上传图片')}
              style={{
                width: MEDIA_SIZE, height: MEDIA_SIZE, borderRadius: 12, cursor: 'pointer',
                border: `1.5px dashed ${border}`, background: 'transparent',
                color: textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
              }}
            >
              <UploadIcon size={22} />
              <span style={{ fontSize: 10, opacity: 0.8 }}>{t('subject.uploadBaseImage', '上传图片')}</span>
            </button>
          )}
        </div>

        {/* 完整提示词（复制钮） */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: textMuted }}>{t('subject.basePrompt', '完整提示词')}</span>
            <span style={{ flex: 1 }} />
            <CopyButton text={tree.baseState.prompt || ''} t={t} muted={textMuted} />
          </div>
          <textarea
            value={tree.baseState.prompt ?? ''}
            onChange={(e) => onUpdateBaseState(tree.rootId, { prompt: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            rows={6}
            placeholder={t('subject.basePromptPlaceholder', '完整三视图/多角度参考提示词（可按 kind 使用模板后由 AI 参数化填充）')}
            style={{
              width: '100%', resize: 'vertical', border: `1px solid ${border}`, borderRadius: 6,
              background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
              color: textPrimary, fontSize: 10.5, outline: 'none', padding: 6, fontFamily: 'inherit',
            }}
          />
          {tree.baseState.templateReason && (
            <div style={{ marginTop: 4, fontSize: 9, color: textMuted }}>{tree.baseState.templateReason}</div>
          )}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUploadBaseImage(tree.rootId, f); e.target.value = ''; }} />
    </div>
  );
}

/** 状态卡（大纲逐行；统一一套展示：媒体预览/图标 + 完整提示词；占位卡点击打开来源面板） */
function StateCard({
  node, tree, theme, t, episodes, activeEpisodeNumber, onUpdateNode, onDeleteNode, onInsertAfter, onOpenSourcePanel, onClearStateMedia,
}: {
  node: SubjectTreeNode;
  tree: SubjectTree;
  theme: ThemeConfig;
  t: ReturnType<typeof useTranslation>['t'];
  episodes?: Array<{ number: number; title?: string }>;
  /** 当前剧集编号（方案 C）：标注为其它集的状态显示小号次要标签；未标注 = 通用不加标签 */
  activeEpisodeNumber?: number | null;
  onUpdateNode: (rootId: string, nodeId: string, patch: Partial<SubjectTreeNode>) => void;
  onDeleteNode: (rootId: string, nodeId: string) => void;
  onInsertAfter: (rootId: string, afterNodeId: string, type: SubjectNodeMedia) => void;
  /** 点占位卡/已有媒体/替换/重新关联 → 打开「来源四类」@形态面板（anchorEl = 面板弹在其下方） */
  onOpenSourcePanel: (rootId: string, nodeId: string, anchorEl?: HTMLElement | null) => void;
  onClearStateMedia: (rootId: string, nodeId: string) => void;
}): React.ReactElement {
  const isDark = theme.mode === 'dark';
  const surface = isDark ? '#161616' : '#ffffff';
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;

  const firstMedia = (node.media ?? [])[0];
  const mediaAlive = useCasAlive(firstMedia?.key);
  // 引用来源徽标（双向可见：来自画布节点/上传/项目资产/公共库 + 来源名）
  const origin = firstMedia?.origin;
  const originTypeLabel = origin
    ? {
      upload: t('subject.sourceUpload', '上传'),
      canvas: t('subject.canvasNode', '画布'),
      project: t('subject.sourceProject', '本项目资产'),
      library: t('subject.sourceLibrary', '我的资产库'),
    }[origin.type]
    : '';
  const originText = origin
    ? `${t('subject.mediaFromPrefix', '来自')}${originTypeLabel}${origin.label ? ` · ${origin.label}` : ''}`
    : '';
  // 方案 C（2026-11-05）：标注为其它集 → 小号次要标签（不禁用不隐藏，仍可点击选择）；
  // 未标注 = 通用，不加标签；activeEpisodeNumber 取不到(null) = 无本集上下文，不加标签。
  const otherEpisodeTags = (activeEpisodeNumber == null || (node.appearEpisodes ?? []).length === 0
    || node.appearEpisodes!.includes(activeEpisodeNumber))
    ? []
    : node.appearEpisodes!;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', borderRadius: CARD_RADIUS, overflow: 'hidden',
      background: surface, border: `1px solid ${border}`,
    }}>
      {/* 头：step + 状态名 + 类型 + AI + 操作 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: `linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.28) 62%, rgba(0,0,0,0) 100%)`,
        color: '#fff', fontSize: 11, fontWeight: 600,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 16, borderRadius: 999, background: 'rgba(255,255,255,0.22)', fontSize: 9, padding: '0 6px', flexShrink: 0 }}>
          {typeof node.step === 'number' ? node.step : '?'}
        </span>
        {/* 状态名：可编辑（征集 #152：此前为纯 span，用户无法修改状态名） */}
        <input
          value={node.state || ''}
          onChange={(e) => onUpdateNode(tree.rootId, node.id, { state: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={t('subject.newState', '新状态')}
          style={{
            flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: '#fff',
            fontWeight: 600, fontSize: 11, outline: 'none', fontFamily: 'inherit', padding: 0,
          }}
        />
        {/* 方案 C：标注为其它集的小号次要标签（如「标注为第 3 集」）；未标注/命中本集不显示 */}
        {otherEpisodeTags.length > 0 && (
          <span
            title={t('subject.appearEpisodesHint', '勾选该状态出现的集数；未选 = 全部剧集')}
            style={{ display: 'inline-flex', alignItems: 'center', fontSize: 8.5, color: 'rgba(255,255,255,0.62)', background: 'rgba(255,255,255,0.08)', borderRadius: 999, padding: '1px 6px', flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {t('subject.taggedEpisodes', { list: otherEpisodeTags.join('、'), defaultValue: `标注为第 ${otherEpisodeTags.join('、')} 集` })}
          </span>
        )}
        {/* 2026-11-05 修改：删掉「T 文本」类型徽标 —— 状态是否为文本由内容决定，类型看媒体区即可 */}
        {origin && (
          <span title={originText} style={{ display: 'inline-flex', alignItems: 'center', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 8.5, color: 'rgba(255,255,255,0.85)', background: 'rgba(255,255,255,0.10)', borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>
            {originText}
          </span>
        )}
        {node.source === 'ai' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 8, color: 'rgba(255,255,255,0.9)', background: 'rgba(59,130,246,0.55)', borderRadius: 999, padding: '1px 6px', flexShrink: 0 }} title={t('subject.AIStateImageHint', 'AI 生成图：不满意可删除后重新上传/生成')}>
            <Sparkles size={8} />{t('subject.aiBadge', 'AI')}
          </span>
        )}
        <CopyButton text={node.fullPrompt || node.deltaPrompt || ''} t={t} muted="rgba(255,255,255,0.7)" />
        <button
          type="button"
          onClick={() => onDeleteNode(tree.rootId, node.id)}
          title={t('common.delete')}
          style={{ display: 'inline-flex', padding: 2, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', flexShrink: 0 }}
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* 主体：媒体（图缩略/音频波形+播放器）+ 完整提示词
          2026-11-05 修改：删掉「T 文本」占位分支 —— 空状态一律显示可点击的通用占位卡（Paperclip），
          点击打开来源面板；已有媒体点击同样打开面板做替换（hover 另有 替换/删除 快捷动作） */}
      <div style={{ display: 'flex', gap: 10, padding: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {firstMedia?.key ? (
            <>
              {node.type === 'audio' ? (
                <div
                  tabIndex={-1}
                  title={t('subject.replaceMedia', '替换')}
                  onClick={(e) => onOpenSourcePanel(tree.rootId, node.id, e.currentTarget)}
                  style={{
                    width: MEDIA_SIZE, height: MEDIA_SIZE, borderRadius: 12, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', color: textMuted,
                  }}
                >
                  <AudioLines size={26} />
                  <audio
                    controls
                    src={getResourceUrl(firstMedia.key, 'full') ?? undefined}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: MEDIA_SIZE - 32, height: 30 }}
                  />
                </div>
              ) : (
                <div
                  tabIndex={-1}
                  title={t('subject.replaceMedia', '替换')}
                  onClick={(e) => onOpenSourcePanel(tree.rootId, node.id, e.currentTarget)}
                  style={{ width: MEDIA_SIZE, height: MEDIA_SIZE, borderRadius: 12, cursor: 'pointer', overflow: 'hidden' }}
                >
                  <MediaThumb mediaKey={firstMedia.key} dark={isDark} type={node.type === 'video' ? 'video' : 'image'} />
                </div>
              )}
              {/* hover：替换 / 删除（含 AI 图）；断链时改显「引用已失效」占位 */}
              {mediaAlive ? (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 8, display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                background: 'rgba(0,0,0,0.42)', opacity: 0, transition: 'opacity 0.15s',
              }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0'; }}>
                <button
                  type="button"
                  onClick={(e) => onOpenSourcePanel(tree.rootId, node.id, e.currentTarget)}
                  title={t('subject.replaceMedia', '替换')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.12)', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <RefreshCw size={9} />{t('subject.replaceMedia', '替换')}
                </button>
                <button
                  type="button"
                  onClick={() => onClearStateMedia(tree.rootId, node.id)}
                  title={t('subject.deleteMedia', '删除媒体')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid rgba(255,120,120,0.55)', background: 'rgba(220,38,38,0.25)', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <Trash2 size={9} />{t('common.delete')}
                </button>
              </div>
              ) : (
                /* 断链诚实（2026-11-04）：引用文件已被 GC → 常显失效占位，可重新关联/移除 */
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 12, display: 'flex',
                  flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: 'rgba(0,0,0,0.62)', color: '#fff',
                }}>
                  <span style={{ fontSize: 10 }}>{t('subject.mediaBroken', '引用已失效')}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={(e) => onOpenSourcePanel(tree.rootId, node.id, e.currentTarget)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.14)', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {t('subject.relink', '重新关联')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onClearStateMedia(tree.rootId, node.id)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid rgba(255,120,120,0.55)', background: 'rgba(220,38,38,0.25)', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={(e) => onOpenSourcePanel(tree.rootId, node.id, e.currentTarget)}
              title={t('subject.uploadMediaHint', '点击上传图片或语音')}
              style={{ width: MEDIA_SIZE, height: MEDIA_SIZE, borderRadius: 12, cursor: 'pointer', border: `1.5px dashed ${border}`, background: 'transparent', color: textMuted, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Paperclip size={20} />
              <span style={{ fontSize: 10, opacity: 0.8 }}>{t('subject.uploadMedia', '上传图片/语音')}</span>
            </button>
          )}
        </div>

        {/* 完整提示词（统一输入框；不再拆分识别语/差异词） */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 备注标签（2026-11-04 约定）：提示词区小号次要色文本标签，明确这是给 AI 的补充说明 */}
          <div title={t('subject.stateRemarkHint', '给 AI 的补充说明')} style={{ fontSize: 9, fontWeight: 600, color: textMuted, marginBottom: 3 }}>
            {t('subject.stateRemark', '备注')}
          </div>
          <textarea
            value={node.fullPrompt || node.deltaPrompt || ''}
            onChange={(e) => onUpdateNode(tree.rootId, node.id, { fullPrompt: e.target.value, deltaPrompt: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            rows={6}
            placeholder={t('subject.statePromptPlaceholder', '描述该状态的形象/动作/差异，AI 会结合基础形态自动完善…')}
            style={{
              width: '100%', resize: 'vertical', border: `1px solid ${border}`, borderRadius: 6,
              background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
              color: textPrimary, fontSize: 10.5, outline: 'none', padding: 6, fontFamily: 'inherit',
            }}
          />
          {node.type === 'video' && (
            /* 历史视频资产：不再支持新关联，仅保留引用（2026-11-04） */
            <div style={{ marginTop: 4, fontSize: 9, display: 'flex', alignItems: 'center', gap: 3, color: textMuted }}>
              <Film size={10} />
              {t('subject.videoLegacyNote', '视频不再支持，仅保留引用')}
            </div>
          )}
          {/* 出现集数多选（2026-11-04 约定：替换原「仅作引导」帮助文案位置） */}
          <EpisodeMultiSelect node={node} tree={tree} episodes={episodes} t={t} onUpdateNode={onUpdateNode} />
        </div>
      </div>

      {/* 操作行（2026-11-05 修改：去掉按钮上方边线） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 8px' }}>
        {/* 2026-11-04：底部「上传素材」按钮已删（直接点上方占位卡片上传，来源面板承载） */}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => onInsertAfter(tree.rootId, node.id, 'text')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px dashed ${border}`, background: 'transparent', color: textMuted, cursor: 'pointer', fontSize: 9.5, borderRadius: 6, padding: '2px 8px' }}
        >
          <Plus size={10} />
          {t('subject.insertBelow', '在下方插入状态')}
        </button>
      </div>
    </div>
  );
}

/** 大纲化单个主体树 */
function TreeOutline({
  tree, theme, colorCard, t, episodes, activeEpisodeNumber, handlers,
}: {
  tree: SubjectTree;
  theme: ThemeConfig;
  colorCard?: { palette: ColorCardSwatch[] } | null;
  t: ReturnType<typeof useTranslation>['t'];
  /** 出现集数候选（script-store 实时读取；新增集自动出现） */
  episodes?: Array<{ number: number; title?: string }>;
  /** 当前剧集编号（方案 C：相关性排序 + 「标注为第 N 集」标签；null = 退回原顺序不加标签） */
  activeEpisodeNumber?: number | null;
  handlers: {
    onUpdateNode: (rootId: string, nodeId: string, patch: Partial<SubjectTreeNode>) => void;
    onUpdateBaseState: (rootId: string, patch: Partial<SubjectBaseState>) => void;
    onRenameRoot: (rootId: string, name: string) => void;
    onChangeKind: (rootId: string, kind: ProductionItemKind) => void;
    onDeleteNode: (rootId: string, nodeId: string) => void;
    onDeleteRoot?: (rootId: string) => void;
    /** 点占位卡/替换/重新关联 → 打开来源面板（统一走 linkSubjectStateMedia） */
    onOpenSourcePanel: (rootId: string, nodeId: string, anchorEl?: HTMLElement | null) => void;
    onUploadBaseImage: (rootId: string, file: File) => void;
    onDeleteBaseMedia: (rootId: string) => void;
    onClearStateMedia: (rootId: string, nodeId: string) => void;
    onInsertAfter: (rootId: string, afterNodeId: string, type: SubjectNodeMedia) => void;
    onAddBottom: (rootId: string, type: SubjectNodeMedia) => void;
  };
}): React.ReactElement {
  const isDark = theme.mode === 'dark';
  const textMuted = theme.toolbar.textMuted;
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  const surface = isDark ? '#0d0d0d' : '#f5f5f4';
  const meta = KIND_META[tree.kind];
  const norm = normalizeSubjectTree(tree);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: surface, borderRadius: 16, padding: 14 }}>
      {colorCard && colorCard.palette && colorCard.palette.length > 0 && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {colorCard.palette.map((s) => (
            <div key={s.id} title={`${s.id} ${s.name} ${s.hex} — ${s.usage}`} style={{ width: 16, height: 16, borderRadius: 4, background: s.hex, border: `1px solid ${border}` }} />
          ))}
          <span style={{ fontSize: 9, color: textMuted, marginLeft: 4 }}>{t('subject.colorCard', '项目色卡')}</span>
        </div>
      )}

      {/* root 简单卡 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderRadius: CARD_RADIUS, padding: '8px 12px',
        background: isDark ? '#161616' : '#ffffff', border: `1px solid ${border}`,
      }}>
        <Dropdown
          trigger={['click']}
          menu={{
            items: (['character', 'scene', 'prop'] as ProductionItemKind[]).map((k) => ({ key: k, label: t(KIND_META[k].labelKey) })),
            selectable: true,
            selectedKeys: [tree.kind],
            onClick: ({ key }) => { if (key !== tree.kind) handlers.onChangeKind(tree.rootId, key as ProductionItemKind); },
          }}
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${border}`, background: 'transparent', color: textMuted, fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 999, padding: '2px 8px' }}
          >
            {t(meta.labelKey)} <ChevronDown size={9} />
          </button>
        </Dropdown>
        <input
          value={tree.name}
          onChange={(e) => handlers.onRenameRoot(tree.rootId, e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={t('storyboard.addSubject')}
          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: theme.toolbar.text, fontWeight: 700, fontSize: 13, outline: 'none' }}
        />
        <span style={{ fontSize: 9, color: textMuted, flexShrink: 0, opacity: 0.8 }}>rootId: {tree.rootId.slice(0, 8)}</span>
        {/* 删除整个主体（征集 #154：AI 识别创建的主体是产物，不是只读，用户必须能删） */}
        {handlers.onDeleteRoot && (
          <button
            type="button"
            onClick={() => handlers.onDeleteRoot?.(tree.rootId)}
            onPointerDown={(e) => e.stopPropagation()}
            title={t('subject.deleteSubject', '删除主体')}
            style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, border: 'none', background: 'transparent', color: textMuted, cursor: 'pointer', padding: 2, borderRadius: 4 }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* 2026-09-04 征集 #154：移除「形象锚点句」输入框 UI。
          约定：锚点句属于给 LLM 看的一致性锁定数据，不需要给用户展示编辑；
          它已在 baseState.prompt / 各状态提示词里逐字重复体现。
          数据结构 `SubjectTree.identityAnchor` **保留**（后端 entity-tools.ts save_subject_tree
          的 schema 仍要求 LLM 产出并逐字复用），仅去掉前端录入界面。 */}

      {/* 基础形态 = 第 1 张卡 */}
      <BaseStateCard tree={norm} theme={theme} t={t} onUpdateBaseState={handlers.onUpdateBaseState} onUploadBaseImage={handlers.onUploadBaseImage} onDeleteBaseMedia={handlers.onDeleteBaseMedia} />

      {/* 状态卡（逐行）。方案 C（2026-11-05）：显示排序 = 本集命中/未标注在前、标注为其它集在后；
          display-only 稳定排序，norm.states 数据顺序不变、卡片不禁用不隐藏，仍可点击选择 */}
      {sortStatesByEpisodeRelevance(norm.states, activeEpisodeNumber ?? null).map((node) => (
        <StateCard
          key={node.id}
          node={node}
          tree={norm}
          theme={theme}
          t={t}
          episodes={episodes}
          activeEpisodeNumber={activeEpisodeNumber}
          onUpdateNode={handlers.onUpdateNode}
          onDeleteNode={handlers.onDeleteNode}
          onInsertAfter={handlers.onInsertAfter}
          onOpenSourcePanel={handlers.onOpenSourcePanel}
          onClearStateMedia={handlers.onClearStateMedia}
        />
      ))}

      {/* 底部添加 */}
      <BottomAddBar rootId={tree.rootId} theme={theme} t={t} onAdd={handlers.onAddBottom} />
    </div>
  );
}

function BottomAddBar({
  rootId, theme, t, onAdd,
}: {
  rootId: string;
  theme: ThemeConfig;
  t: ReturnType<typeof useTranslation>['t'];
  onAdd: (rootId: string, type: SubjectNodeMedia) => void;
}): React.ReactElement {
  const isDark = theme.mode === 'dark';
  const textMuted = theme.toolbar.textMuted;
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  // 2026-09-03 重构：添加状态统一一个按钮（不再弹出图片/视频/音频/文本类型选择），
  // 新状态默认为文本卡，用户上传素材后按文件类型自动识别为 image/video/audio。
  // 2026-09-04 征集 #152：删除原「✨ AI 生成状态」按钮——它是假 AI 入口（零 AI 调用，只本地插一张
  // source:'ai' 空卡，效果等同「添加状态」），且会无条件覆盖 subjectAiIndex 破坏 A 基线契约。
  // 约束：主体状态的 AI 生成一律走画布 Agent 聊天，编辑器内不设任何 AI 按钮。
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={() => onAdd(rootId, 'text')}
        title={t('subject.addStateHint', '添加状态（上传素材自动识别图片/视频/音频，不传则为文本）')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 14px', cursor: 'pointer',
          border: `1.5px dashed ${border}`, borderRadius: 8, background: 'transparent', color: textMuted, fontSize: 11,
        }}
      >
        <Plus size={12} />
        {t('subject.addState', '添加状态')}
      </button>
    </div>
  );
}

// ===== 主组件 =====
export const StoryboardSubjectTree = memo(function StoryboardSubjectTree({
  trees, theme, activeKind = 'all', colorCard, onChange, onAddSubject, onDeleteRoot, disableScroll, episodes, activeEpisodeNumber, projectId,
}: StoryboardSubjectTreeProps): React.ReactElement {
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  const updateNode = useCallback((rootId: string, nodeId: string, patch: Partial<SubjectTreeNode>) => {
    onChange(trees.map((tr) => {
      if (tr.rootId !== rootId) return tr;
      return { ...tr, states: tr.states.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) };
    }));
  }, [trees, onChange]);

  const updateBaseState = useCallback((rootId: string, patch: Partial<SubjectBaseState>) => {
    onChange(trees.map((tr) => {
      if (tr.rootId !== rootId) return tr;
      return { ...tr, baseState: { ...tr.baseState, ...patch } };
    }));
  }, [trees, onChange]);

  /** 新状态默认名（2026-11-04 约定）：以形象名称为前缀，避免一堆无归属的「状态1」 */
  const defaultStateName = useCallback((tr: SubjectTree): string => (
    buildDefaultStateName(tr.name, nextStateStep(tr), (n) => t('subject.stateLabelN', { n, defaultValue: `状态${n}` }))
  ), [t]);

  /** 在指定卡之后插入新状态（默认 text，用户上传素材自动识别类型） */
  const insertAfter = useCallback((rootId: string, afterNodeId: string, type: SubjectNodeMedia = 'text') => {
    onChange(trees.map((tr) => {
      if (tr.rootId !== rootId) return tr;
      const idx = tr.states.findIndex((n) => n.id === afterNodeId);
      const node = createSubjectNode(defaultStateName(tr), type, 'user', rootId, {
        step: nextStateStep(tr),
      });
      if (idx < 0) return { ...tr, states: [...tr.states, node] };
      const states = [...tr.states];
      states.splice(idx + 1, 0, node);
      return { ...tr, states };
    }));
  }, [trees, onChange, defaultStateName]);

  const addBottom = useCallback((rootId: string, type: SubjectNodeMedia = 'text') => {
    onChange(trees.map((tr) => {
      if (tr.rootId !== rootId) return tr;
      const node = createSubjectNode(defaultStateName(tr), type, 'user', rootId, {
        step: nextStateStep(tr),
      });
      return { ...tr, states: [...tr.states, node] };
    }));
  }, [trees, onChange, defaultStateName]);

  /** 删除状态：先释放其全部媒体 CAS 引用（手动上传的主体私有文件靠它回收，防孤儿），再移除卡 */
  const deleteNode = useCallback((rootId: string, nodeId: string) => {
    if (projectId) {
      void releaseSubjectStateMediaRefs({ trees, projectId, rootId, stateId: nodeId });
    }
    onChange(trees.map((tr) => {
      if (tr.rootId !== rootId) return tr;
      return { ...tr, states: tr.states.filter((n) => n.id !== nodeId) };
    }));
  }, [trees, onChange, projectId]);

  const renameRoot = useCallback((rootId: string, name: string) => {
    onChange(trees.map((tr) => (tr.rootId === rootId ? { ...tr, name } : tr)));
  }, [trees, onChange]);

  const changeKind = useCallback((rootId: string, kind: ProductionItemKind) => {
    const DEFAULT_TEMPLATE: Record<ProductionItemKind, SubjectTemplateType> = {
      character: 'character_lineup', scene: 'environment_panorama', prop: 'prop_detail',
    };
    onChange(trees.map((tr) => {
      if (tr.rootId !== rootId || tr.kind === kind) return tr;
      return { ...tr, kind, baseState: { ...tr.baseState, templateType: DEFAULT_TEMPLATE[kind], templateReason: '' } };
    }));
  }, [trees, onChange]);

  /**
   * 「资产 → 主体状态」唯一写入函数（2026-11-04 约定收口）：
   * 占位卡点击 / hover 替换 / 失效重新关联 / 画布右键发送，两个入口都调 linkSubjectStateMedia。
   * 这里走 UI 内存态：返回新 trees → onChange → 父级写回容器（不二次落盘）。
   */
  const handleSourcePick = useCallback(async (rootId: string, stateId: string, asset: SubjectStateMediaAsset | null) => {
    try {
      const { trees: next } = await linkSubjectStateMedia({ trees, projectId, rootId, stateId, asset });
      onChange(next);
    } catch {
      antdMessage.error(t('subjectCreate.saveFailed'));
    }
  }, [trees, projectId, onChange, antdMessage, t]);

  /** 来源面板目标（null = 关闭；anchorEl = @ 面板形态弹在触发行下方） */
  const [sourcePanelTarget, setSourcePanelTarget] = useState<{
    rootId: string; nodeId: string; anchorEl?: HTMLElement | null;
  } | null>(null);
  const openSourcePanel = useCallback((rootId: string, nodeId: string, anchorEl?: HTMLElement | null) => {
    setSourcePanelTarget({ rootId, nodeId, anchorEl: anchorEl ?? null });
  }, []);
  const handlePanelPick = useCallback((asset: SubjectStateMediaAsset) => {
    const target = sourcePanelTarget;
    if (!target) return;
    setSourcePanelTarget(null);
    void handleSourcePick(target.rootId, target.nodeId, asset);
  }, [sourcePanelTarget, handleSourcePick]);

  /** 删除状态卡媒体（全部清空 → 回到占位；CAS 引用经 linkSubjectStateMedia 正确释放） */
  const clearStateMedia = useCallback((rootId: string, nodeId: string) => {
    void handleSourcePick(rootId, nodeId, null);
  }, [handleSourcePick]);

  /** 上传基础形态图（替换已有 image 首张；无则追加） */
  const uploadBaseImage = useCallback(async (rootId: string, file: File) => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    const uploaded = await uploadAsset(file);
    const d = uploaded.data as { kind?: string; storageKey?: string; dataUrl?: string };
    const storageKey = d.storageKey ?? '';
    if (!storageKey) { antdMessage.error(t('subjectCreate.saveFailed')); return; }
    onChange(trees.map((tr) => {
      if (tr.rootId !== rootId) return tr;
      const cur = tr.baseState.referenceImages ?? [];
      const ref: SubjectNodeMediaRef = { key: storageKey, type: 'image' };
      const next = cur.length > 0
        ? cur.map((m, i) => (i === 0 && m.type === 'image' ? ref : m))
        : [ref];
      // 首张非 image（罕见）→ 直接替换第一项为 image
      const finalNext = next[0]?.type !== 'image' ? [ref, ...next] : next;
      return { ...tr, baseState: { ...tr.baseState, referenceImages: finalNext } };
    }));
  }, [trees, onChange, isAuthenticated, antdMessage, t]);

  /** 删除基础形态图（全部清空 → 回到上传占位） */
  const clearBaseMedia = useCallback((rootId: string) => {
    onChange(trees.map((tr) => {
      if (tr.rootId !== rootId) return tr;
      return { ...tr, baseState: { ...tr.baseState, referenceImages: [] } };
    }));
  }, [trees, onChange]);

  const filtered = useMemo(
    // 方案 C（2026-11-05）：主体列表按与本集相关性显示排序（display-only 稳定排序，不改 trees 数据与树结构）
    () => sortTreesByEpisodeRelevance(
      activeKind === 'all' ? trees : trees.filter((tr) => tr.kind === activeKind),
      activeEpisodeNumber ?? null,
    ),
    [trees, activeKind, activeEpisodeNumber],
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflowY: disableScroll ? 'visible' : 'auto', padding: '0 8px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
          {filtered.map((tr, idx) => (
            <div key={tr.rootId} style={{ width: '100%', minWidth: 640, maxWidth: 900 }}>
              <TreeOutline
                tree={tr}
                theme={theme}
                colorCard={idx === 0 ? colorCard : null}
                t={t}
                episodes={episodes}
                activeEpisodeNumber={activeEpisodeNumber}
                handlers={{
                  onUpdateNode: updateNode,
                  onUpdateBaseState: updateBaseState,
                  onRenameRoot: renameRoot,
                  onChangeKind: changeKind,
                  onDeleteNode: deleteNode,
                  onDeleteRoot,
                  onOpenSourcePanel: openSourcePanel,
                  onUploadBaseImage: uploadBaseImage,
                  onDeleteBaseMedia: clearBaseMedia,
                  onClearStateMedia: clearStateMedia,
                  onInsertAfter: insertAfter,
                  onAddBottom: addBottom,
                }}
              />
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 48, width: '100%',
              color: theme.toolbar.textMuted, borderRadius: 16,
              border: `1.5px dashed ${theme.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`,
              background: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            }}>
              <Plus size={28} style={{ opacity: 0.35 }} />
              <span style={{ fontSize: 12, textAlign: 'center', opacity: 0.8 }}>{t('subject.empty')}</span>
              <button
                type="button"
                onClick={() => onAddSubject(activeKind === 'all' ? 'character' : activeKind)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 16px', borderRadius: 8, background: theme.toolbar.accent, color: '#fff', fontSize: 12, cursor: 'pointer', border: 'none' }}
              >
                <Plus size={13} />
                {t('storyboard.addSubject')}
              </button>
            </div>
          )}
        </div>
      </div>
      {/* 来源面板（@ 引用面板形态；四分区：画布/公共/本项目/手动上传）。
          写入统一走 linkSubjectStateMedia（不复制文件，只挂引用） */}
      <SubjectMediaSourcePanel
        open={sourcePanelTarget !== null}
        onClose={() => setSourcePanelTarget(null)}
        theme={theme}
        projectId={projectId}
        anchorEl={sourcePanelTarget?.anchorEl ?? null}
        current={(() => {
          const m = sourcePanelTarget
            ? trees.find((tr) => tr.rootId === sourcePanelTarget.rootId)
                ?.states.find((n) => n.id === sourcePanelTarget.nodeId)?.media?.[0]
            : undefined;
          if (!m?.key) return null;
          if (m.type !== 'image' && m.type !== 'audio' && m.type !== 'video') return null;
          return { storageKey: m.key, kind: m.type };
        })()}
        onPick={handlePanelPick}
        onRemove={sourcePanelTarget ? () => clearStateMedia(sourcePanelTarget.rootId, sourcePanelTarget.nodeId) : undefined}
      />
    </div>
  );
});
