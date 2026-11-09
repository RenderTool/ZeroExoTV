/**
 * open-library UI - 开源资产库展示基元（2026-11-05）
 *
 * 只含与宿主无关的基元：缩略图（占位不白屏）、meta/画廊查询 Hooks、页大小常量。
 * 展示编排（分类/搜索/网格/分页/18+ 门控/卡片动作）在 open-lib-browser.tsx
 * ——抽屉与独立 #/openlib 页共用那一个单一定义源，本模块不再自带整块分区。
 * 数据全部来自 ./open-library.ts 只读 API；远程条目首用下载落 CAS 走
 * ./import-open-lib-entry.ts。
 *
 * 性能铁律：queryOpenLib 查询侧分页（默认 60/页），UI 只渲染单页，严禁全量渲染。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import { resolveMediaUrl } from '@/platform/media.js';
import { cardCoverMetrics, CARD_COVER_TRANSITION, useMasonryColumnWidth } from '@/shared/components/masonry-grid.js';
import { ImageOff } from 'lucide-react';
import {
  getOpenLibMeta,
  openLibSiteUrl,
  queryOpenLib,
  type OpenLibEntry,
  type OpenLibGalleryId,
  type OpenLibMeta,
  type OpenLibPage,
} from './open-library.js';

export const OPEN_LIB_PAGE_SIZE = 60;

// ===== 缩略图 URL 解析 =====

/** 缩略图地址解析：站点相对路径（bundled /openlib/...）与远程 CDN URL 原样返回；本地 cas: 键转 objectURL */
export async function resolveOpenLibImageUrl(entry: OpenLibEntry): Promise<string> {
  const raw = entry.imageUrl ?? '';
  if (/^https?:/i.test(raw)) return raw;
  if (raw.startsWith('/')) return openLibSiteUrl(raw); // bundled thumbs：兼容 GitHub Pages 子路径
  if (raw.startsWith('cas:')) {
    const url = await resolveMediaUrl(raw);
    return url || entry.cdnUrl || raw;
  }
  return entry.cdnUrl || raw;
}

/**
 * 单条目缩略图（异步解析本地 cas 键；解析完成前显示占位，不白屏）。
 * 加载失败兜底（2026-11-05 @ 面板要求）：img onError → 回退占位 + 可读原因（title 悬浮
 * 与角标文案），不显示坏图（裂图标）。
 */
export function OpenLibThumb({ entry, theme }: { entry: OpenLibEntry; theme: ThemeConfig }): React.ReactElement {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  // 瀑布流高度：真实比例未知时先 1:1 占位，img 落图后按 naturalWidth/Height 平滑过渡一次
  const [aspect, setAspect] = useState<number | null>(null);
  const columnWidth = useMasonryColumnWidth();
  const cover = cardCoverMetrics(columnWidth, aspect);
  useEffect(() => {
    let alive = true;
    setUrl('');
    setFailed(false);
    setAspect(null);
    void resolveOpenLibImageUrl(entry).then((u) => {
      if (alive) setUrl(u);
    });
    return () => { alive = false; };
  }, [entry.id, entry.imageUrl, entry.cdnUrl]);
  const isDark = theme.mode === 'dark';
  if (!url || failed) {
    const reason = failed ? '图源加载失败（cdn 未命中或离线）' : '图源解析中…';
    return (
      <div
        data-openlib-thumb-failed={failed || undefined}
        title={reason}
        style={{
          width: '100%', height: cover.height, borderRadius: 8,
          transition: CARD_COVER_TRANSITION,
          background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
          display: 'grid', placeItems: 'center', color: theme.toolbar.textMuted, gap: 2,
          gridAutoFlow: 'row',
        }}
      >
        <ImageOff size={18} style={{ opacity: 0.5 }} />
        <span style={{ fontSize: 10, padding: '0 4px', textAlign: 'center' }}>{reason}</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={entry.title}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        const el = e.currentTarget;
        setAspect((prev) => (prev == null && el.naturalWidth > 0 ? el.naturalWidth / el.naturalHeight : prev));
      }}
      style={{
        width: '100%', height: cover.height, objectFit: cover.fit, borderRadius: 8, display: 'block',
        transition: CARD_COVER_TRANSITION,
      }}
    />
  );
}

// ===== meta（模块级缓存由 open-library.ts 保证） =====

export function useOpenLibMeta(): { meta: OpenLibMeta | null; loading: boolean } {
  const [meta, setMeta] = useState<OpenLibMeta | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void getOpenLibMeta()
      .then((m) => { if (alive) setMeta(m); })
      .catch(() => { if (alive) setMeta(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { meta, loading };
}

// ===== 画廊查询 Hook（查询侧分页；关键词防抖） =====

export interface UseOpenLibGalleryOptions {
  gallery?: OpenLibGalleryId;
  pageSize?: number;
  /** 需年龄确认通过才生效（open-library.ts 内部同样门控，双保险） */
  includeAdult?: boolean;
}

export function useOpenLibGallery(opts: UseOpenLibGalleryOptions) {
  const [category, setCategoryState] = useState<string | null>(null);
  const [keyword, setKeywordState] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<OpenLibPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const reqId = useRef(0);

  // 关键词防抖（250ms）
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    void queryOpenLib({
      gallery: opts.gallery,
      category: category ?? undefined,
      keyword: debouncedKeyword || undefined,
      includeAdult: opts.includeAdult,
      page,
      pageSize: opts.pageSize ?? OPEN_LIB_PAGE_SIZE,
    })
      .then((r) => { if (reqId.current === id) setResult(r); })
      .catch(() => { if (reqId.current === id) setResult(null); })
      .finally(() => { if (reqId.current === id) setLoading(false); });
  }, [opts.gallery, opts.includeAdult, opts.pageSize, category, debouncedKeyword, page]);

  const setCategory = useCallback((c: string | null) => { setCategoryState(c); setPage(1); }, []);
  const resetFilters = useCallback(() => { setCategoryState(null); setKeywordState(''); setPage(1); }, []);

  return {
    category, setCategory,
    keyword, setKeyword: setKeywordState,
    page, setPage,
    result, loading,
    resetFilters,
  };
}
