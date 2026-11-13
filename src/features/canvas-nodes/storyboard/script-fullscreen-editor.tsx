/**
 * ScriptFullscreenEditor - 独立通用全屏剧本编辑器
 *
 * 脱离画布节点耦合，可在任意位置（资产库、画布 Modal 等）使用。
 * 内聚全屏覆盖层、纸张编辑器、剧集侧边栏、可拖拽分割线、底部工具栏。
 *
 * 用法：
 * ```tsx
 * <ScriptFullscreenEditor
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   episodes={episodes}
 *   activeEpisodeId={activeId}
 *   onEpisodesChange={setEpisodes}
 *   onActiveEpisodeChange={setActiveId}
 *   title="剧本名称"
 * />
 * ```
 */
import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, CircleX, FileUp, Eye, EyeOff, ArrowUpDown, GripVertical, Undo2, Redo2, History, ChevronDown } from 'lucide-react';
import { App, Button, ConfigProvider, Tooltip, Input, Modal, Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { countScript } from '@/shared/utils/script-count.js';
import { ScriptStructuredEditor } from '@/features/canvas-nodes/script-editor/script-structured-editor.js';
import type { ScriptHistoryControls } from '@/features/canvas-nodes/script-editor/script-history.js';
import { ScriptSnapshotPanel } from './script-snapshot-panel.js';
import type { ScriptSnapshot } from '@/entities/script-store.js';
import { displayEpisodeTitle } from '@/entities/script-store.js';
import { buildScriptAiBrief } from '../script-editor/script-ai-brief.js';
import { htmlToPlainText } from '@/pages/editor/editor-canvas/use-editor-interactions/helpers.js';
import { EpisodeList } from './components/EpisodeList.js';
import { getEpisodePageCount, splitContentIntoPages } from './hooks/use-episode-manager.js';
import type { Episode } from './script-types.js';

export interface ScriptFullscreenEditorProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 剧本标题 */
  title?: string;
  /** 全部剧集 */
  episodes: Episode[];
  /** 当前选中剧集 id */
  activeEpisodeId: string;
  /** 剧集变更回调 */
  onEpisodesChange: (episodes: Episode[]) => void;
  /** 当前剧集变更回调 */
  onActiveEpisodeChange: (id: string) => void;
  /** 复合更新（同时写入 episodes + activeEpisodeId） */
  onEpisodesAndActiveChange: (episodes: Episode[], activeEpisodeId?: string) => void;
  /** 新增剧集回调 */
  onAddEpisode: () => void;
  /** 标签显隐开关 */
  showLabels?: boolean;
  onShowLabelsChange?: (next: boolean) => void;
  /** 自定义导入点击回调（外部提供时使用外部导入流程，否则使用内置文件输入） */
  onImportClick?: () => void;
  /**
   * Plan#50:内嵌模式（画布顶部页签内显示）——容器改 absolute 填满父级、不做 createPortal。
   * 关闭按钮在 embedded 下隐藏（由页签的 X 关闭），避免双关闭入口。
   */
  embedded?: boolean;
  /** 快照/版本面板：传入 projectId 才显示「版本」入口（剧本页注入；画布内嵌模式不传） */
  snapshotProjectId?: string;
  /** 恢复快照回调（restoreScriptSnapshot 编排 + 冲突提示 + 编辑器刷新，由剧本页注入） */
  onRestoreSnapshot?: (snap: ScriptSnapshot) => Promise<void>;
}

/** 剧集列表默认宽度 (px) */
const DEFAULT_EPISODE_LIST_WIDTH = 216;

/** 剧集列表最小/最大宽度 */
const MIN_EPISODE_LIST_WIDTH = 160;
const MAX_EPISODE_LIST_WIDTH = 400;

export function ScriptFullscreenEditor({
  open,
  onClose,
  episodes,
  activeEpisodeId,
  onEpisodesChange,
  onActiveEpisodeChange,
  onEpisodesAndActiveChange,
  onAddEpisode,
  showLabels = true,
  onShowLabelsChange,
  onImportClick,
  embedded = false,
  snapshotProjectId,
  onRestoreSnapshot,
}: ScriptFullscreenEditorProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { modal, message } = App.useApp();
  const isDark = theme.mode === 'dark';

  const activeEpisode = episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0];

  // 剧集派生统计
  const normalizedEpisodes = useMemo(() => episodes.map((ep, index) => {
    const pageCount = getEpisodePageCount(ep);
    return { ...ep, number: index + 1, pageCount, estimatedDuration: pageCount };
  }), [episodes]);

  /** 问AI：复制本集剧本（含项目/集定位与修改要求），直接粘给任意 Agent（2026-11-12 用户要求） */
  const handleAskAi = async (): Promise<void> => {
    if (!activeEpisode) return;
    const index = Math.max(0, episodes.findIndex((e) => e.id === activeEpisode.id));
    const brief = buildScriptAiBrief({
      projectId: snapshotProjectId,
      episode: activeEpisode,
      episodeIndex: index,
      totalEpisodes: episodes.length,
      plainText: htmlToPlainText(activeEpisode.content ?? ''),
    });
    try {
      await navigator.clipboard.writeText(brief);
      message.success(t('scriptEditor.askAiCopied', '已复制本集剧本，粘给 AI 修改即可'));
    } catch {
      message.error(t('scriptEditor.copyFailed', '复制失败，请手动选择复制'));
    }
  };


  const totalPages = useMemo(
    () => normalizedEpisodes.reduce((acc, ep) => acc + (ep.pageCount ?? 0), 0),
    [normalizedEpisodes],
  );
  const totalDuration = totalPages;

  // ── 稳定化 episodes/activeEpisodeId 引用：避免 handleContentChange 闭包捕获过时数据 ──
  const episodesRef = useRef(episodes);
  episodesRef.current = episodes;
  const activeEpisodeIdRef = useRef(activeEpisodeId);
  activeEpisodeIdRef.current = activeEpisodeId;
  const activeEpisodeRef = useRef(activeEpisode);
  activeEpisodeRef.current = activeEpisode;

  // ── 本地状态兜底（当外部未提供 onChange 回调时使用） ──
  const [localShowLabels, setLocalShowLabels] = useState(showLabels);
  const effectiveShowLabels = onShowLabelsChange ? showLabels : localShowLabels;

  // ── 撤销/重做（2026-11-04 删除丢内容修复）：句柄由 ScriptStructuredEditor 注入，
  //    可用态经 onHistoryChange 上报，工具栏按钮据此渲染禁用态 ──
  const historyControlsRef = useRef<ScriptHistoryControls | null>(null);
  const [histAvail, setHistAvail] = useState({ canUndo: false, canRedo: false });
  const handleHistoryChange = useCallback((canUndo: boolean, canRedo: boolean) => {
    setHistAvail((prev) => (prev.canUndo === canUndo && prev.canRedo === canRedo ? prev : { canUndo, canRedo }));
  }, []);

  // ── 快照/版本面板（2026-11-04）：仅剧本页（传 snapshotProjectId）显示入口 ──
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  const handleShowLabelsChange = useCallback(() => {
    if (onShowLabelsChange) {
      onShowLabelsChange(!showLabels);
    } else {
      setLocalShowLabels((v) => !v);
    }
  }, [onShowLabelsChange, showLabels]);

  // ── 文件导入 ──
  const importFileRef = useRef<HTMLInputElement>(null);
  const handleImportClick = useCallback(() => {
    if (onImportClick) {
      onImportClick();
    } else {
      importFileRef.current?.click();
    }
  }, [onImportClick]);
  /** 智能读取文本文件:UTF-8 优先,失败回落 GB18030(修复 Windows 中文 txt 常见 GBK 编码导致的中文乱码) */
  const readFileSmart = useCallback(async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    try {
      // 严格 UTF-8:非法字节序列会抛错,据此判定非 UTF-8 文件
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      try {
        // GB18030 是 GBK/GB2312 超集,兼容 Windows 中文 txt 常见编码
        return new TextDecoder('gb18030').decode(buf);
      } catch {
        return new TextDecoder('utf-8').decode(buf);
      }
    }
  }, []);
  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void readFileSmart(file).then((text) => {
      if (!text.trim()) return;
      // 将导入内容作为新剧集
      const newEp: Episode = {
        id: `ep-${Date.now()}`,
        number: episodes.length + 1,
        title: file.name.replace(/\.[^/.]+$/, ''),
        content: text,
      };
      onEpisodesAndActiveChange([...episodes, newEp], newEp.id);
    });
    e.target.value = '';
  }, [episodes, onEpisodesAndActiveChange, readFileSmart]);

  // ── 可拖拽分割线 ──
  const [episodeListWidth, setEpisodeListWidth] = useState(DEFAULT_EPISODE_LIST_WIDTH);
  const [splitterHovered, setSplitterHovered] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = episodeListWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [episodeListWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = startX.current - e.clientX;
      const newWidth = Math.max(MIN_EPISODE_LIST_WIDTH, Math.min(MAX_EPISODE_LIST_WIDTH, startWidth.current + dx));
      setEpisodeListWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── 跳转弹窗 ──
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpInput, setJumpInput] = useState('');
  const jumpInputRef = useRef<HTMLInputElement>(null);

  const handleJumpConfirm = useCallback(() => {
    const num = parseInt(jumpInput, 10);
    if (isNaN(num) || num < 1 || num > normalizedEpisodes.length) {
      modal.warning({
        title: t('storyboard.hint'),
        content: t('storyboard.episodeNotExist'),
        zIndex: Z_INDEX.FULLSCREEN_MODAL,
      });
      return;
    }
    const target = normalizedEpisodes[num - 1];
    if (target) {
      onActiveEpisodeChange(target.id);
    }
    setJumpOpen(false);
    setJumpInput('');
  }, [jumpInput, normalizedEpisodes, onActiveEpisodeChange, modal, t]);

  // 打开跳转时自动聚焦输入框
  useEffect(() => {
    if (jumpOpen && jumpInputRef.current) {
      setTimeout(() => jumpInputRef.current?.focus(), 50);
    }
  }, [jumpOpen]);

  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const accent = theme.toolbar.accent;
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;

  // 字数统计（无剧集时为空态 0 字,不再统计范文——征集 #148/#150:范文直写已废弃）
  // 2026-11-04：统一走 countScript 纯函数（去标签+解实体+折叠空白），与编辑器底栏/卡片/导入预览同口径
  const scriptStats = useMemo(
    () => countScript(episodes.length === 0 ? '' : (activeEpisode?.content || '')),
    [episodes.length, activeEpisode],
  );
  const wordCount = scriptStats.chars;

  // 内容变更（使用 ref 避免 stale closure）
  const handleContentChange = useCallback((value: string) => {
    const currentEpisodes = episodesRef.current;
    const currentActiveEpisode = activeEpisodeRef.current;
    console.log('[ScriptFullscreenEditor] handleContentChange called, value length:', value.length, 'episodes count:', currentEpisodes.length, 'activeId:', currentActiveEpisode?.id);
    if (currentEpisodes.length === 0) {
      const newEp: Episode = { id: `ep-${Date.now()}`, number: 1, title: '第1集', content: value };
      console.log('[ScriptFullscreenEditor] creating new episode:', newEp.id);
      onEpisodesChange([newEp]);
      onActiveEpisodeChange(newEp.id);
      return;
    }
    const updatedEpisodes = currentEpisodes.map((e) =>
      e.id === (currentActiveEpisode?.id) ? { ...e, content: value } : e,
    );
    console.log('[ScriptFullscreenEditor] updating episodes, matched:', currentEpisodes.some(e => e.id === currentActiveEpisode?.id));
    onEpisodesChange(updatedEpisodes);
  }, [onEpisodesChange, onActiveEpisodeChange]);

  // 剧集操作
  const handleAddEpisode = useCallback(() => {
    onAddEpisode();
  }, [onAddEpisode]);

  const handleDeleteEpisode = useCallback((ep: Episode) => {
    const filtered = episodes.filter((e) => e.id !== ep.id);
    // Plan#20 T9: 删集级联清理——通知画布层清理主体 episodeIds 与分镜按集映射
    nodeActionBus.emit('script:episodesDeleted', { nodeId: '', deletedIds: [ep.id] } as any);
    if (filtered.length === 0) {
      const newEp: Episode = { id: `ep-${Date.now()}`, number: 1, title: '第1集', content: '' };
      onEpisodesAndActiveChange([newEp], newEp.id);
    } else {
      const renumbered = filtered.map((e, i) => ({ ...e, number: i + 1 }));
      const nextActive = activeEpisode?.id === ep.id ? renumbered[0]!.id : undefined;
      onEpisodesAndActiveChange(renumbered, nextActive);
    }
  }, [episodes, activeEpisode?.id, onEpisodesAndActiveChange]);

  const handleRename = useCallback((id: string, title: string) => {
    onEpisodesChange(episodes.map((e) => (e.id === id ? { ...e, title } : e)));
  }, [episodes, onEpisodesChange]);

  const handleReorder = useCallback((ids: string[]) => {
    const reordered = ids
      .map((id) => episodes.find((e) => e.id === id))
      .filter(Boolean) as Episode[];
    if (reordered.length !== episodes.length) return;
    onEpisodesChange(reordered.map((ep, i) => ({ ...ep, number: i + 1 })));
  }, [episodes, onEpisodesChange]);

  const handleDuplicate = useCallback((id: string) => {
    const src = episodes.find((e) => e.id === id);
    if (!src) return;
    const copy: Episode = {
      ...src,
      id: `ep-${Date.now()}`,
      title: `${src.title}（副本）`,
      content: src.content,
      pageBreaks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const idx = episodes.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const next = [...episodes];
    next.splice(idx + 1, 0, copy);
    onEpisodesAndActiveChange(next, copy.id);
  }, [episodes, onEpisodesAndActiveChange]);

  const handleSplit = useCallback((id: string) => {
    const src = episodes.find((e) => e.id === id);
    if (!src) return;
    const pages = splitContentIntoPages(src.content);
    if (pages.length < 2) return;
    const now = new Date().toISOString();
    const first: Episode = {
      ...src,
      title: `${src.title}（上）`,
      content: pages[0]!.html,
      pageBreaks: [],
      updatedAt: now,
    };
    const second: Episode = {
      ...src,
      id: `ep-${Date.now()}`,
      title: `${src.title}（下）`,
      content: pages.slice(1).map((p) => p.html).join(''),
      pageBreaks: [],
      createdAt: now,
      updatedAt: now,
    };
    const idx = episodes.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const next = [...episodes];
    next.splice(idx, 1, first, second);
    onEpisodesAndActiveChange(next, second.id);
  }, [episodes, onEpisodesAndActiveChange]);

  const handleMergePrev = useCallback((id: string) => {
    const idx = episodes.findIndex((e) => e.id === id);
    if (idx <= 0) return;
    const prev = episodes[idx - 1]!;
    const cur = episodes[idx]!;
    const merged: Episode = {
      ...prev,
      content: `${prev.content}${cur.content}`,
      pageBreaks: [],
      updatedAt: new Date().toISOString(),
    };
    const next = episodes
      .filter((e) => e.id !== cur.id)
      .map((e) => (e.id === prev.id ? merged : e))
      // 与删除集同一编号规则：合并后重排 1..N（与 MCP merge_episode 一致）
      .map((e, i) => ({ ...e, number: i + 1 }));
    onEpisodesAndActiveChange(next, prev.id);
  }, [episodes, onEpisodesAndActiveChange]);

  if (!open) return null;

  // Plan#50:embedded 模式(页签内嵌)——不 createPortal、容器 absolute 填满父级(页签内容层),
  // 由调用方(剧本节点)自行 portal 到页签挂载点;非 embedded 保持原全屏覆盖形态。
  const overlay = (
    // 局部提升 antd 弹层基准:自制 overlay(Z_INDEX.FULLSCREEN=30000)之上的 antd 弹层
    // (Dropdown/Tooltip/Modal)由 token 自动分配 40000,替代手动 zIndex/overlayStyle
    <ConfigProvider theme={{ token: { zIndexPopupBase: 40000 } }}>
    <div style={overlayStyle(theme, embedded)}>
      {/* ===== 顶部 header ===== */}
      <div data-module-toolbar="script" style={headerStyle(cardBorder, theme, embedded)}>
        {/* 左侧：集数 + 主动作 + 通用编辑操作 */}
        <div data-toolbar-zone="left" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 1, height: 20, background: cardBorder, margin: '0 4px', flexShrink: 0 }} />
          {/* 2026-11-07 用户指令：标题处支持下拉切换集数（不用再去右侧列表点） */}
          <Dropdown
            trigger={['click']}
            placement="bottomLeft"
            menu={{
              items: normalizedEpisodes.map((ep) => ({
                key: ep.id,
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span>{displayEpisodeTitle(ep.title, ep.number)}</span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{t('episodeList.pageCount', { count: ep.pageCount ?? 0 })}</span>
                  </span>
                ),
              })),
              selectedKeys: [activeEpisodeId],
              onClick: ({ key }) => { if (key !== activeEpisodeId) onActiveEpisodeChange(key); },
            }}
          >
            <button
              type="button"
              data-script-episode-switch
              aria-label={t('storyboard.switchEpisode', '切换集数')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: 320,
                padding: '2px 4px', marginLeft: -4, border: 'none', borderRadius: 6,
                background: 'transparent', color: textColor, cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: 600, fontSize: 14, lineHeight: 1.4,
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeEpisode ? displayEpisodeTitle(activeEpisode.title, activeEpisode.number) : t('storyboard.untitled')}
              </span>
              <ChevronDown size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
            </button>
          </Dropdown>
          <div style={{ width: 1, height: 20, background: cardBorder, margin: '0 4px', flexShrink: 0 }} />
          <Tooltip title={t('scriptEditor.importScript') || '导入'}>
            <Button
              type="text"
              size="small"
              icon={<FileUp size={15} />}
              onClick={handleImportClick}
              style={{ ...toolBtnStyle, color: mutedColor }}
            >
              {t('storyboard.import')}
            </Button>
          </Tooltip>
          {/* 撤销/重做（2026-11-04）：编辑器历史栈控制，可用/禁用态实时反映 */}
          <Tooltip title={t('scriptEditor.undo') || '撤销'}>
            <Button
              type="text"
              size="small"
              data-script-undo
              icon={<Undo2 size={15} />}
              disabled={!histAvail.canUndo}
              onClick={() => historyControlsRef.current?.undo()}
              style={{ ...toolBtnStyle, color: mutedColor }}
            />
          </Tooltip>
          <Tooltip title={t('scriptEditor.redo') || '重做'}>
            <Button
              type="text"
              size="small"
              data-script-redo
              icon={<Redo2 size={15} />}
              disabled={!histAvail.canRedo}
              onClick={() => historyControlsRef.current?.redo()}
              style={{ ...toolBtnStyle, color: mutedColor }}
            />
          </Tooltip>
          {/* 版本/快照入口（2026-11-04）：与撤销/重做同组；仅剧本页注入 projectId 时显示 */}
          {snapshotProjectId ? (
            <Tooltip title={t('scriptEditor.scriptSnapshot.title', '版本历史')}>
              <Button
                type="text"
                size="small"
                data-script-snapshot
                icon={<History size={15} />}
                onClick={() => setSnapshotOpen((v) => !v)}
                style={{ ...toolBtnStyle, color: snapshotOpen ? accent : mutedColor }}
              />
            </Tooltip>
          ) : null}
        </div>

        {/* 右侧：视图 / 问AI / 统计（固定顺序） */}
        <div
          data-toolbar-zone="right"
          data-script-stats
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
            flex: 1, minWidth: 0, gap: 12, fontSize: 11, color: mutedColor,
            whiteSpace: 'nowrap', overflow: 'hidden',
          }}
        >
          <Tooltip title={effectiveShowLabels ? t('scriptEditor.hideLabels') || '隐藏标签' : t('scriptEditor.showLabels') || '显示标签'}>
            <Button
              type="text"
              size="small"
              icon={effectiveShowLabels ? <Eye size={15} /> : <EyeOff size={15} />}
              onClick={handleShowLabelsChange}
              style={{
                ...toolBtnStyle,
                color: !effectiveShowLabels ? accent : mutedColor,
                ...(!effectiveShowLabels ? { background: `${accent}18` } : {}),
              }}
            >
              {effectiveShowLabels ? t('storyboard.hideLabels') : t('storyboard.showLabels')}
            </Button>
          </Tooltip>
          <Tooltip title={t('scriptEditor.askAi', '问AI：复制本集剧本给 AI 修改')}>
            <Button
              type="text"
              size="small"
              data-script-ask-ai
              icon={<Sparkles size={15} />}
              onClick={() => void handleAskAi()}
              style={{ ...toolBtnStyle, color: mutedColor }}
            >
              {t('scriptEditor.askAiBtn', '问AI')}
            </Button>
          </Tooltip>
          <span style={{ width: 1, height: 12, background: cardBorder, flexShrink: 0 }} />
          <Tooltip title={t('storyboard.wordCountNoPunct', { count: scriptStats.charsNoPunct })}>
            <span>{t('canvasNodes.wordCount', { count: wordCount })}</span>
          </Tooltip>
          <span style={{ width: 1, height: 12, background: cardBorder, flexShrink: 0 }} />
          <span>{t('storyboard.totalPages')} <b style={{ color: textColor }}>{totalPages}</b></span>
          <span style={{ width: 1, height: 12, background: cardBorder, flexShrink: 0 }} />
          <span>{t('storyboard.totalDuration')} ≈<b style={{ color: textColor }}>{totalDuration}</b> {t('storyboard.minutes')}</span>
        </div>

        {/* 右侧：关闭 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 12, flexShrink: 0 }}>
          {/* Plan#50:embedded(页签)模式隐藏自带关闭按钮——关闭统一走页签 X。
              用 CircleX(圆+叉)而非细线 X,视觉重量与其它图标对齐 */}
          {!embedded && (
            <Tooltip title={t('hierarchy.close')}>
              <button
                type="button"
                aria-label={t('hierarchy.close')}
                onClick={onClose}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 20, height: 20, padding: 0, border: 'none', borderRadius: 6,
                  background: 'transparent', color: textColor, cursor: 'pointer',
                }}
              >
                <CircleX size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ===== 主内容区（编辑器 + 可拖拽分割线 + 剧集列表） ===== */}
      <div style={mainRowStyle}>
        {/* 纸张编辑器 */}
        <div style={editorAreaStyle(theme)}>
          <ScriptStructuredEditor
            key={activeEpisode?.id ?? 'empty'}
            value={activeEpisode?.content ?? ''}
            onChange={handleContentChange}
            accent={accent}
            border={cardBorder}
            text={textColor}
            textMuted={mutedColor}
            isDark={isDark}
            showLabels={effectiveShowLabels}
            menuZIndex={Z_INDEX.FULLSCREEN_EDITOR_MENU}
            scrollable={true}
            historyRef={historyControlsRef}
            onHistoryChange={handleHistoryChange}
          />
        </div>

        {/* 隐藏的文件导入输入框 */}
        <input
          ref={importFileRef}
          type="file"
          accept=".txt,.docx,.md,.html,.json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />

        {/* 可拖拽分割线 */}
        <div
          style={splitterOuterStyle(isDark, splitterHovered)}
          onMouseDown={handleSplitterMouseDown}
          onMouseEnter={() => setSplitterHovered(true)}
          onMouseLeave={() => setSplitterHovered(false)}
          title={t('storyboard.dragResizeEpisodeList')}
        >
          <div style={splitterHitAreaStyle(splitterHovered, isDark)}>
            <GripVertical size={14} />
          </div>
        </div>

        {/* 剧集列表(paddingBottom 10 与左侧 editorArea 对齐底部新增按钮基线) */}
        <div style={{ width: episodeListWidth, flexShrink: 0, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', paddingBottom: 10, overflow: 'hidden' }}>
          <EpisodeList
            episodes={normalizedEpisodes}
            activeEpisodeId={activeEpisodeId}
            accent={accent}
            border={cardBorder}
            text={textColor}
            textMuted={mutedColor}
            isDark={isDark}
            actions={
              // 2026-11-04:「跳转」从顶部统计条迁入剧集列表标题行最右侧(紧凑图标+文字)
              <Tooltip title={t('storyboard.jumpToEpisode')}>
                <Button
                  type="text"
                  size="small"
                  data-script-jump
                  icon={<ArrowUpDown size={12} />}
                  onClick={() => setJumpOpen(true)}
                  style={{
                    ...toolBtnStyle, color: mutedColor, fontSize: 11,
                    height: 22, padding: '0 6px', flexShrink: 0,
                  }}
                >
                  {t('storyboard.jump')}
                </Button>
              </Tooltip>
            }
            onSelect={onActiveEpisodeChange}
            onAdd={handleAddEpisode}
            onDelete={handleDeleteEpisode}
            onRename={handleRename}
            onReorder={handleReorder}
            onDuplicate={handleDuplicate}
            onSplit={handleSplit}
            onMergePrev={handleMergePrev}
          />
        </div>
      </div>

      {/* ===== 快照/版本面板（2026-11-04）：absolute 挂在 overlay 内右侧，列表+滚动 ===== */}
      {snapshotProjectId && onRestoreSnapshot && snapshotOpen ? (
        <ScriptSnapshotPanel
          projectId={snapshotProjectId}
          onClose={() => setSnapshotOpen(false)}
          onRestore={onRestoreSnapshot}
          accent={accent}
          border={cardBorder}
          text={textColor}
          textMuted={mutedColor}
          surface={theme.toolbar.editorSurface}
          zIndex={Z_INDEX.FULLSCREEN_EDITOR_MENU}
        />
      ) : null}

      {/* ===== 跳转弹窗 ===== */}
      <Modal
        title={t('storyboard.jumpToEpisode')}
        open={jumpOpen}
        onCancel={() => { setJumpOpen(false); setJumpInput(''); }}
        onOk={handleJumpConfirm}
        okText={t('storyboard.jump')}
        cancelText={t('common.cancel')}
        centered
        width={320}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, fontSize: 13, color: mutedColor }}>
          {t('storyboard.enterEpisodeNumber', { count: normalizedEpisodes.length })}
        </div>
        <Input
          ref={jumpInputRef as any}
          value={jumpInput}
          onChange={(e) => setJumpInput(e.target.value)}
          placeholder={`1 ~ ${normalizedEpisodes.length}`}
          maxLength={4}
          onPressEnter={handleJumpConfirm}
          autoFocus
        />
      </Modal>
    </div>
    </ConfigProvider>
  );

  if (embedded) return overlay;
  return createPortal(overlay, document.body);
}

// ===== Styles =====

const toolBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
};

const overlayStyle = (
  theme: ReturnType<typeof useTheme>['theme'],
  embedded = false,
): React.CSSProperties => ({
  // Plan#50:embedded(页签内嵌)用 absolute 填满父容器;否则原全屏 fixed 覆盖
  position: embedded ? 'absolute' : 'fixed',
  inset: 0,
  zIndex: embedded ? undefined : Z_INDEX.FULLSCREEN,
  display: 'flex', flexDirection: 'column',
  background: theme.toolbar.editorPaper,
});

const headerStyle = (
  border: string,
  theme: ReturnType<typeof useTheme>['theme'],
  embedded = false,
): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  // embedded 模式被包在 antd Modal 内，Modal 右上角自带 56px 关闭按钮；
  // 留出空间避免 header 右侧的换肤/关闭按钮与 Modal 关闭按钮重叠
  padding: embedded ? '8px 56px 8px 16px' : '8px 16px',
  flexShrink: 0,
  borderBottom: `1px solid ${border}`,
  background: theme.toolbar.editorSurface,
});

const mainRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'row', flex: 1,
  minHeight: 0, overflow: 'visible', gap: 0,
};

const editorAreaStyle = (theme: ReturnType<typeof useTheme>['theme']): React.CSSProperties => ({
  flex: 1, display: 'flex', flexDirection: 'column',
  minWidth: 0, minHeight: 0, overflow: 'hidden',
  // paddingBottom 与 EpisodeList wrap 的 paddingBottom(10) 对齐，使两侧底部按钮在同一水平线；
  // 右 padding 归零（2026-11-04 滚动条贴边）：编辑器右缘直抵分割线，滚动条轨道贴容器右边缘，
  // 文字呼吸间距由 ScriptStructuredEditor 滚动容器的内层 paddingRight 提供，不靠本层留白
  padding: '16px 0 10px 16px', borderRadius: 8,
  background: theme.toolbar.editorPaper,
});

/** 可拖拽分割线外层 */
const splitterOuterStyle = (isDark: boolean, hovered: boolean): React.CSSProperties => ({
  width: 16,
  flexShrink: 0,
  cursor: 'col-resize',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: hovered
    ? (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)')
    : 'transparent',
  zIndex: Z_INDEX.BASE,
  transition: 'background 0.2s',
});

/** 分割线内部点击区域（带图标和视觉引导） */
const splitterHitAreaStyle = (hovered: boolean, isDark: boolean): React.CSSProperties => ({
  width: 4,
  height: hovered ? 64 : 40,
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: hovered
    ? (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')
    : 'rgba(128,128,128,0.3)',
  background: hovered
    ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)')
    : 'rgba(128,128,128,0.06)',
  transition: 'background 0.2s, color 0.2s, width 0.2s, height 0.2s, border-radius 0.2s',
  cursor: 'col-resize',
  pointerEvents: 'none',
});