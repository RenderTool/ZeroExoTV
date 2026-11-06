/**
 * open-lib-browser - 开源资产库浏览器 · 单一定义源（2026-11-05 需求定稿）
 *
 * 约束：独立页（#/openlib）与画布抽屉「开源库」段必须分类展示一致——复用本组件：
 * 同一套分类展示、同一卡片尺寸、同一 hover/右键动作，不另造第二套。
 *
 * - 数据全部来自 open-library.ts 只读 API；查询侧分页（60/页），严禁全量渲染；
 * - 卡片动作与我的/本项目作用域完全一致（card-send-actions 单一定义源）：
 *   画布抽屉（宿主注入 sendToCanvas）→ hover 动作按钮（画布 → 导演台）+ 右键菜单；
 *   独立页（无画布宿主）→ 不渲染发送动作，只做浏览；开源库仅额外标注「只读」角标，
 *   动作集合不缩减；发送执行器单源内聚在本组件（importOpenLibEntry 按需下载落 CAS
 *   → store.sendToCanvas / sendAssetToWorkbench）；
 * - 18+ 默认隐藏，本组件提供一次年龄确认入口（确认后同库所有页面生效，可撤销）；
 * - 授权摘要与原站链接以次级信息行呈现（两个宿主一致）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { App, Dropdown } from 'antd';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  confirmAge,
  isAgeConfirmed,
  openLibSiteUrl,
  revokeAgeConfirmation,
  type OpenLibEntry,
  type OpenLibGalleryId,
  type OpenLibGalleryMeta,
} from './open-library.js';
import {
  OpenLibThumb,
  useOpenLibGallery,
  useOpenLibMeta,
  OPEN_LIB_PAGE_SIZE,
} from './open-library-ui.js';
import { importOpenLibEntry } from './import-open-lib-entry.js';
import { runOpenLibSpillCleanupOnce } from './cleanup-open-lib-spill.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { buildSendMenuItems, SendActionButtons } from '@/features/asset-library/cards/card-send-actions.js';
import { MediaLightbox, type MediaLightboxItem } from '@/shared/components/media-lightbox.js';
import { MasonryGrid } from '@/shared/components/masonry-grid.js';
import { sendAssetToWorkbench } from '@/features/canvas-assets/send-to-workbench.js';
import {
  CategoryChips,
  EmptyState,
  PaginationBar,
  SearchBox,
  SkeletonGrid,
  SCROLL_AREA_STYLE,
  ToolbarRow,
} from '@/features/canvas-assets/components/common.js';

/** 遮罩点击关闭的位移阈值（与 MediaLightbox 同一规则） */
const AGE_MODAL_CLOSE_MAX_MOVE = 6;

/**
 * 18+ 确认模态（2026-11-05 用户定稿：屏幕居中，不再贴在触发 chip 旁）。
 *
 * 旧实现用 `App.useApp().modal.confirm`，antd 的 App holder 渲染在抽屉 DOM 内，
 * 抽屉祖先的 transform 会让 fixed 定位退化为相对容器 → 浮层贴在 chip 附近。
 * 改为自建模态：portal 到 document.body、position:fixed inset:0、flex 居中、
 * min(440px, 92vw)；Esc / 点遮罩取消（按下+抬起同目标且位移 <6px），
 * 焦点默认落主按钮、Tab 循环限制在模态内、关闭后焦点回触发 chip。
 */
function AgeGateModal({ theme, title, content, confirmText, cancelText, onConfirm, onCancel, restoreFocusTo }: {
  theme: ThemeConfig;
  title: string;
  content: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  restoreFocusTo: HTMLElement | null;
}): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const pressRef = useRef<{ target: EventTarget | null; x: number; y: number } | null>(null);

  // 打开时焦点落主按钮
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Esc 取消 + Tab 焦点陷阱
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const nodes = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((n) => !n.hasAttribute('disabled'));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      } else if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!dialog.contains(active)) {
        e.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  // 关闭后焦点回到触发元素（不抢滚动位置）
  useEffect(() => () => {
    if (restoreFocusTo && document.contains(restoreFocusTo)) {
      try { restoreFocusTo.focus({ preventScroll: true }); } catch { restoreFocusTo.focus(); }
    }
  }, [restoreFocusTo]);

  // 点遮罩取消：按下 + 抬起都在遮罩本身，位移 < 6px（点卡片本体不取消）
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    pressRef.current = { target: e.target, x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;
    if (press.target !== e.currentTarget || e.target !== e.currentTarget) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) >= AGE_MODAL_CLOSE_MAX_MOVE) return;
    onCancel();
  };

  const isDark = theme.mode === 'dark';
  return createPortal(
    <div
      data-openlib-age-backdrop=""
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div
        ref={dialogRef}
        data-openlib-age-modal=""
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: 'min(440px, 92vw)',
          borderRadius: 8,
          background: isDark ? '#1f1f1f' : '#ffffff',
          color: theme.toolbar.text,
          border: `1px solid ${theme.toolbar.border}`,
          boxShadow: '0 18px 48px rgba(0,0,0,0.32)',
          padding: '20px 22px',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: theme.toolbar.textMuted }}>{content}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            data-openlib-age-cancel=""
            onClick={onCancel}
            style={{
              height: 34, padding: '0 16px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${theme.toolbar.border}`, background: 'transparent',
              color: theme.toolbar.text, fontFamily: 'inherit',
            }}
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-openlib-age-confirm=""
            onClick={onConfirm}
            style={{
              height: 34, padding: '0 16px', fontSize: 13, fontWeight: 500, borderRadius: 8,
              cursor: 'pointer', border: 'none', background: '#e5484d', color: '#fff', fontFamily: 'inherit',
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 单条目卡片：动作入口 = hover 动作按钮（仅画布抽屉；排在标题行右端，位于封面之外，
 * 行高只由宿主类型决定，hover 不改布局）+ 右键菜单。点击卡片本体（非动作）打开大图查看器。
 * 独立页无画布宿主 → 不渲染任何发送动作；@ 面板嵌入模式（传 onPick）点击是
 * 「入库 + 插入当前片段」，同样不渲染发送动作。开源库额外标注「只读」角标。
 */
function OpenLibEntryCard({ entry, theme, importing, canvasDisabled, onSendToCanvas, onSendToDirector, onPick, onOpenEntry, showSendActions, t }: {
  entry: OpenLibEntry;
  theme: ThemeConfig;
  importing: boolean;
  canvasDisabled: boolean;
  onSendToCanvas: (e: OpenLibEntry) => void;
  onSendToDirector: (e: OpenLibEntry) => void;
  /** @ 面板嵌入模式：点击条目 = 入库 + 插入当前片段 */
  onPick?: (e: OpenLibEntry) => void;
  /** 点击条目打开大图查看器（非 @ 面板模式） */
  onOpenEntry?: (e: OpenLibEntry) => void;
  /** 是否渲染发送动作（hover 按钮 + 右键菜单；仅画布内素材抽屉为 true） */
  showSendActions: boolean;
  t: (k: string, o?: any) => string;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const hasJapaneseTitle = /[\u3040-\u30ff\u31f0-\u31ff]/.test(entry.title);
  const displayTitle = hasJapaneseTitle ? `素材 ${entry.srcId}` : entry.title;
  const card = (
    <div
      data-openlib-entry={entry.id}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, position: 'relative',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onPick ? () => onPick(entry) : () => onOpenEntry?.(entry)}
      // 开源条目也可拖入画布（2026-11-05）：payload 走 x-openlib-item，画布侧先入库再建节点
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-openlib-item', JSON.stringify(entry));
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <OpenLibThumb entry={entry} theme={theme} />
      {/* 只读角标（开源库条目不可编辑/不可删除，仅此标注差异） */}
      <span style={{
        position: 'absolute', top: 6, left: 6, zIndex: 6,
        fontSize: 10, lineHeight: '16px', padding: '0 6px', borderRadius: 4,
        background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.85)',
      }}>
        {t('openLib.readonlyBadge')}
      </span>
      {onPick && importing ? (
        <span data-openlib-pick-hint style={{
          position: 'absolute', top: 6, right: 6, zIndex: 7,
          fontSize: 10, lineHeight: '16px', padding: '0 6px', borderRadius: 4,
          background: 'rgba(0,0,0,0.55)', color: '#fff', whiteSpace: 'nowrap',
        }}>
          {t('openLib.importing', '导入中…')}
        </span>
      ) : null}
      {/* 标题行 + 动作行：动作**内联**排在标题右端（与我的资产卡片同一落位，2026-11-05）；
          不再绝对定位，也不再给标题预留 paddingRight 补偿；行高仅抽屉宿主固定为 36px */}
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        height: showSendActions && !onPick ? 36 : 16,
      }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 11, color: theme.toolbar.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={entry.title}>
          {displayTitle}
        </span>
        {showSendActions && !onPick && (
          <SendActionButtons
            onSendToCanvas={() => onSendToCanvas(entry)}
            onSendToDirector={() => onSendToDirector(entry)}
            kind="image"
            importing={importing}
            visible={hovered}
            alwaysVisible
            t={t as any}
          />
        )}
      </div>
    </div>
  );
  if (onPick || !showSendActions) return card;
  return (
    <Dropdown
      menu={{
        items: [...buildSendMenuItems({
          onSendToCanvas: () => onSendToCanvas(entry),
          onSendToDirector: () => onSendToDirector(entry),
          kind: 'image',
          canvasDisabled,
          t: t as any,
        })],
      }}
      trigger={['contextMenu']}
    >
      {card}
    </Dropdown>
  );
}

/** 开源条目 → 大图查看条目：主源高清原图（cdnUrl），失败回落站点同源打包缩略图 */
function openLibLightboxItem(entry: OpenLibEntry): MediaLightboxItem {
  const bundled = entry.imageUrl
    ? (/^https?:/i.test(entry.imageUrl) ? entry.imageUrl : openLibSiteUrl(entry.imageUrl))
    : undefined;
  const hasJapaneseTitle = /[\u3040-\u30ff\u31f0-\u31ff]/.test(entry.title);
  return {
    id: entry.id,
    title: hasJapaneseTitle ? `素材 ${entry.srcId}` : entry.title,
    url: entry.cdnUrl,
    fallbackUrl: bundled,
  };
}

/** 授权摘要徽标（次级信息：能否商用/能否再分发/授权类型） */
function LicenseBadges({ meta: g, theme }: { meta: OpenLibGalleryMeta; theme: ThemeConfig }): React.ReactElement {
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const badge = (ok: boolean): React.CSSProperties => ({
    fontSize: 10, lineHeight: '16px', padding: '0 6px', borderRadius: 4, whiteSpace: 'nowrap',
    background: ok
      ? (isDark ? 'rgba(109,193,84,0.15)' : 'rgba(109,193,84,0.12)')
      : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'),
    color: ok ? '#6dc154' : theme.toolbar.textMuted,
  });
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
      <span style={badge(g.license.commercialUse)}>{g.license.commercialUse ? t('openLib.licenseCommercial') : t('openLib.licenseNoCommercial')}</span>
      <span style={badge(g.license.redistribution)}>{g.license.redistribution ? t('openLib.licenseRedistribute') : t('openLib.licenseNoRedistribute')}</span>
      <span style={badge(g.license.type === 'cc0')}>{g.license.type === 'cc0' ? 'CC0' : t('openLib.licenseRestricted')}</span>
    </span>
  );
}

export interface OpenLibBrowserProps {
  theme: ThemeConfig;
  /**
   * 插入画布执行器（store.sendToCanvas 链路）。提供 = 画布内素材抽屉：
   * 卡片渲染「发送到画布 / 发送到导演台」hover 动作与右键菜单；
   * 未提供 = 无画布宿主（独立 #/openlib 页）→ 不渲染发送动作，只做浏览
   */
  sendToCanvas?: (asset: Asset) => void;
  /**
   * @ 面板嵌入模式（2026-11-05）：点击条目 = importOpenLibEntry 入库 → 本回调
   * （导演台 @ 面板用它插入当前片段素材槽 + `@PictureN `）。提供后卡片渲染为
   * 「点击插入」形态（不渲染画布/导演台动作），分类/搜索/分页/18+ 门控不变。
   */
  onPickAsset?: (asset: Asset) => void;
}

/**
 * 开源库浏览器主体：库 chips + 库内分类 + 搜索 + 18+ 门控 + 条目网格（60/页）+ 分页。
 * 画布抽屉（OpenLibGroup）与独立页（OpenLibPage）唯一共用的展示/动作实现。
 */
export function OpenLibBrowser({ theme, sendToCanvas, onPickAsset }: OpenLibBrowserProps): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { meta, loading: loadingMeta } = useOpenLibMeta();

  // 会话级自动清理：移除旧版「发送到画布」误入个人资产库的开源条目（未被真实引用的）
  useEffect(() => {
    void runOpenLibSpillCleanupOnce();
  }, []);

  const galleries = useMemo(
    () => (meta ? (Object.keys(meta.galleries) as OpenLibGalleryId[]).map((k) => meta.galleries[k]).filter((g) => g.indexed) : []),
    [meta],
  );
  const [galleryId, setGalleryId] = useState<OpenLibGalleryId | null>(null);
  const activeGallery: OpenLibGalleryMeta | null = galleryId
    ? (meta?.galleries[galleryId] ?? null)
    : (galleries[0] ?? null);

  // 18+ 门控：一次确认全局生效（localStorage），本组件内可撤销
  const [ageConfirmed, setAgeConfirmed] = useState(isAgeConfirmed());
  // 18+ 确认弹窗（2026-11-05：自建屏幕居中模态，portal 到 body）
  const [ageGateOpen, setAgeGateOpen] = useState(false);
  const ageGateTriggerRef = useRef<HTMLButtonElement>(null);
  const [ageGateReturnFocus, setAgeGateReturnFocus] = useState<HTMLElement | null>(null);

  const q = useOpenLibGallery({ gallery: activeGallery?.id, includeAdult: ageConfirmed });

  // 大图查看（点卡片任意位置打开；ESC/方向键/遮罩点击由 MediaLightbox 处理）
  const [lightbox, setLightbox] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);
  const openLightbox = (entry: OpenLibEntry) => {
    const entries = q.result?.items ?? [];
    const items = entries.map(openLibLightboxItem);
    const idx = entries.findIndex((e) => e.id === entry.id);
    setLightbox({ items, index: idx >= 0 ? idx : 0 });
  };

  // 首次使用导入中条目集合（id → 发送按钮转圈）
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const markImporting = (id: string, on: boolean) => {
    setImporting((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  /** 导入落 CAS 后发送（插入画布 / 导演台 / @ 面板插入共用：先按需下载成资产，再走现有链路；唯一执行器） */
  const importAndSend = async (entry: OpenLibEntry, target: 'canvas' | 'workbench' | 'pick') => {
    if (importing.has(entry.id)) return;
    if (target === 'canvas' && !sendToCanvas) return;
    if (target === 'pick' && !onPickAsset) return;
    markImporting(entry.id, true);
    try {
      const asset = await importOpenLibEntry(entry);
      // CDN 拿不到高清原图时的降级标注（import 内已回落同源打包缩略图）——必须告知用户，禁止静默降级
      if ((asset.data as { quality?: string } | null)?.quality === 'local-thumb') {
        message.warning(t('openLib.thumbFallback', '已使用本地缩略图（高清原图不可用）'));
      }
      if (target === 'canvas') {
        sendToCanvas?.(asset);
      } else if (target === 'pick') {
        onPickAsset?.(asset);
      } else {
        sendAssetToWorkbench(asset, message, t);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('openLib.importFailed'));
    } finally {
      markImporting(entry.id, false);
    }
  };

  const unlockAdult = () => {
    // 记录触发元素：关闭（取消/Esc/遮罩/确认）后焦点回到该 chip
    const active = typeof document === 'undefined' ? null : document.activeElement;
    setAgeGateReturnFocus(
      ageGateTriggerRef.current ?? (active instanceof HTMLElement ? active : null),
    );
    setAgeGateOpen(true);
  };

  const confirmUnlockAdult = () => {
    confirmAge();
    setAgeConfirmed(true);
    setAgeGateOpen(false);
  };

  const revokeAdult = () => {
    revokeAgeConfirmation();
    setAgeConfirmed(false);
    q.setPage(1);
  };

  if (loadingMeta) return <SkeletonGrid theme={theme} />;
  if (galleries.length === 0) return <EmptyState theme={theme} text={t('openLib.empty')} />;

  return (
    <>
      {/* 库选择（chips）+ 授权摘要/原站链接次级信息（与宿主无关，两处一致） */}
      <ToolbarRow>
        <CategoryChips
          items={galleries.map((g) => ({ key: g.id, label: g.title, count: g.entryCount }))}
          active={activeGallery?.id ?? null}
          onChange={(k) => { setGalleryId((k as OpenLibGalleryId)); q.setCategory(null); q.setPage(1); }}
          theme={theme}
        />
        {activeGallery && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <LicenseBadges meta={activeGallery} theme={theme} />
            <a
              href={activeGallery.sourceUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: theme.toolbar.accent, flexShrink: 0 }}
            >
              {t('openLib.sourceSite')}
              <ExternalLink size={11} />
            </a>
          </span>
        )}
      </ToolbarRow>
      {/* 库内分类 + 搜索 */}
      <ToolbarRow style={{ paddingTop: 0 }}>
        <CategoryChips
          items={[
            { key: null, label: t('openLib.allCategories') },
            // 2026-11-05 修复「有计数、无结果」：数字取查询结果里按同一过滤规则算出的
            // categoryCounts（已含 18+ 门控），不再用 meta.json 的静态统计
            ...(activeGallery?.categories ?? []).map((c) => ({
              key: c.id,
              label: c.title,
              count: q.result?.categoryCounts?.[c.id] ?? c.count,
            })),
          ]}
          active={q.category}
          onChange={(k) => q.setCategory(k)}
          theme={theme}
        />
      </ToolbarRow>
      <ToolbarRow style={{ paddingTop: 0 }}>
        <SearchBox value={q.keyword} onChange={q.setKeyword} placeholder={t('openLib.searchPlaceholder')} theme={theme} />
      </ToolbarRow>

      {/* 18+ 门控行：未确认 → 解锁入口；已确认 → 可撤销 */}
      {(q.result?.adultHidden ?? 0) > 0 && !ageConfirmed && (
        <ToolbarRow style={{ paddingTop: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 11,
            color: theme.toolbar.textMuted,
          }}>
            <ShieldAlert size={13} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              {t('openLib.adultHiddenHint', { count: q.result?.adultHidden ?? 0 })}
            </span>
            <button
              ref={ageGateTriggerRef}
              type="button"
              data-testid="openlib-age-gate-button"
              onClick={unlockAdult}
              style={{
                height: 24, padding: '0 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${theme.toolbar.border}`, background: 'transparent',
                color: theme.toolbar.text, fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              {t('openLib.ageGateEntry')}
            </button>
          </div>
        </ToolbarRow>
      )}
      {ageConfirmed && (q.result?.adultHidden ?? 0) === 0 && (q.result?.total ?? 0) > 0 && (
        <ToolbarRow style={{ paddingTop: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: theme.toolbar.textMuted, flex: 1 }}>
            <ShieldAlert size={13} />
            <span style={{ flex: 1 }}>{t('openLib.adultUnlocked')}</span>
            <button type="button" onClick={revokeAdult} style={{
              height: 24, padding: '0 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${theme.toolbar.border}`, background: 'transparent',
              color: theme.toolbar.textMuted, fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>
              {t('openLib.ageGateRevoke')}
            </button>
          </div>
        </ToolbarRow>
      )}

      {/* 条目网格（单页 60 条，只读可用） */}
      <div style={SCROLL_AREA_STYLE}>
        {q.loading && !q.result ? (
          <SkeletonGrid theme={theme} />
        ) : (q.result?.items ?? []).length === 0 ? (
          <EmptyState theme={theme} text={t('openLib.emptyGallery')} />
        ) : (
          // 2026-11-05 与资产列表/抽屉保持同一瀑布流（同列数断点、同高度夹取规则）
          <MasonryGrid paddingX={20} paddingBottom={8}>
            {(q.result?.items ?? []).map((entry) => (
              <OpenLibEntryCard
                key={entry.id}
                entry={entry}
                theme={theme}
                importing={importing.has(entry.id)}
                showSendActions={!!sendToCanvas}
                canvasDisabled={!sendToCanvas}
                onSendToCanvas={(e) => void importAndSend(e, 'canvas')}
                onSendToDirector={(e) => void importAndSend(e, 'workbench')}
                onPick={onPickAsset ? (e) => void importAndSend(e, 'pick') : undefined}
                onOpenEntry={onPickAsset ? undefined : openLightbox}
                t={t as any}
              />
            ))}
          </MasonryGrid>
        )}
      </div>

      <PaginationBar
        page={q.page}
        total={q.result?.total ?? 0}
        pageSize={OPEN_LIB_PAGE_SIZE}
        onChange={q.setPage}
      />

      {/* 大图查看：主源高清原图 → 失败回落站点同源缩略图（不新建 blob URL） */}
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox((cur) => (cur ? { ...cur, index: i } : cur))}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* 18+ 确认：屏幕居中模态（portal 到 body；文案/按钮与原实现一致） */}
      {ageGateOpen && (
        <AgeGateModal
          theme={theme}
          title={t('openLib.ageGateTitle')}
          content={t('openLib.ageGateContent')}
          confirmText={t('openLib.ageGateConfirm')}
          cancelText={t('common.cancel', { defaultValue: '取消' })}
          onConfirm={confirmUnlockAdult}
          onCancel={() => setAgeGateOpen(false)}
          restoreFocusTo={ageGateReturnFocus}
        />
      )}
    </>
  );
}
