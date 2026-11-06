/**
 * NovelNodeSheet - novel 长文本素材节点（Plan#74 重做：像出片节点一样的实体内容卡）
 *
 * 关键修正（2026-09-06 Plan#74 Phase D：长文本改为「工作区资源式」，对齐视频/图片）：
 * 正文**不再落资产库**，作为本地 text: 资源按 storageKey 存储（uploadTextResource）。
 * 节点只存 storageKey/title/wordCount；渲染时经 resolveTextContent 读正文。
 * 手动"保存到素材"才由调用方生成 kind:'text' 资产。
 *
 * Plan#75 D5 导入/编辑时机链：
 * - 编辑保存链：全屏查看器（AssetDetailViewer）接通 editable/onSave/onContentChange，
 *   保存时 saveTextResource 同 key 覆盖写入（storageKey 不变、引用不断）+ detectChapters
 *   重算 chapters[] 经 onDataChange 回写节点（行号/偏移漂移自然消除）。
 * - 存量惰性补：旧数据节点无 chapters[] 时，加载正文后现算一次补上（幂等，只跑一次）。
 *
 * 形态（对齐出片节点：有内容感的实体卡，非四不像小壳）：
 * - 有内容：标题 + 字数 + 正文前几行预览；全屏 → 统一 AssetDetailViewer（kind=text，传真实 content）
 * - 失效：storageKey 存在但本地资源已丢失/被 GC → 失效标记（重新导入）
 * - 空壳：无 storageKey → 「导入文本」按钮（emit novel:import-into）
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type CSSProperties } from 'react';
import { BookOpen, FileUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { resolveTextContent, saveTextResource } from '@zeroexo/plugin-persistence';
import { detectChapters, type ChapterAnchor } from '@/shared/utils/episode-marker-detector.js';
import { AssetDetailViewer, type AssetDetailData } from '@/shared/components/asset-detail-viewer.js';
import { CreationNodeEmptyCard } from '../creation-node-empty-card.js';

export interface NovelNodeSheetProps {
  nodeId: string;
  /** 工作区文本资源 key（正文按此从本地 localforage 读取；无则为空壳待导入） */
  storageKey?: string;
  title?: string;
  wordCount?: number;
  /** 章节锚点索引（Plan#75 D5：导入/保存时随节点落库；缺失时惰性现算补上） */
  chapters?: ChapterAnchor[];
  /** 节点数据变更回写（保存重算/惰性补 chapters 由调用方 updateNode 落库） */
  onDataChange?: (patch: Record<string, unknown>) => void;
}

export const NovelNodeSheet = memo(function NovelNodeSheet({
  nodeId,
  storageKey,
  title,
  wordCount,
  chapters,
  onDataChange,
}: NovelNodeSheetProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;

  // 按 storageKey 从本地分桶读取正文（resolveTextContent 空/无命中返回 ''）
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (storageKey) {
      resolveTextContent(storageKey)
        .then((c) => { if (!cancelled) { setContent(c); setLoaded(true); } })
        .catch(() => { if (!cancelled) { setContent(''); setLoaded(true); } });
    } else {
      setContent(''); setLoaded(true);
    }
    return () => { cancelled = true; };
  }, [storageKey]);

  const hasContent = loaded && !!storageKey && !!content;
  // 有 storageKey 但本地资源丢失/被 GC = 失效 → 重新导入
  const stale = loaded && !!storageKey && !content;

  // ===== 全屏查看/编辑（novel:read 事件 + 快捷按钮 双入口）=====
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => {
    const unsub = nodeActionBus.on('novel:read', (e: { nodeId: string }) => {
      if (e.nodeId === nodeId) setViewerOpen(true);
    });
    return () => unsub?.();
  }, [nodeId]);

  // ===== Plan#75 D5 编辑保存链 =====
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // 编辑期间的草稿（Monaco onChange 回传；取消编辑即丢弃）
  const draftRef = useRef('');

  const openViewer = useCallback(() => { if (hasContent) setViewerOpen(true); }, [hasContent]);
  const importText = useCallback(() => { nodeActionBus.emit('novel:import-into', { nodeId }); }, [nodeId]);

  // 保存：同 key 覆盖写入正文 + 重算章节锚点回写节点（编辑后偏移漂移自然消除）
  const handleSave = useCallback(async () => {
    if (!storageKey || saving) return;
    const next = draftRef.current;
    setSaving(true);
    try {
      await saveTextResource(storageKey, next);
      setContent(next);
      const recalculated = detectChapters(next).chapters;
      onDataChange?.({ chapters: recalculated, wordCount: next.length });
      setEditing(false);
      message.success(t('canvasNodes.novelSaved', '已保存'));
    } catch (err) {
      console.error('保存长文本失败:', err);
      message.error(t('canvasNodes.novelSaveFailed', '保存失败'));
    } finally {
      setSaving(false);
    }
  }, [storageKey, saving, onDataChange, t]);

  // ===== 存量惰性补（Plan#75 D5）：旧数据无 chapters[] → 加载后现算一次补上（幂等）=====
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (!hasContent || !storageKey || backfilledRef.current) return;
    if (chapters && chapters.length > 0) { backfilledRef.current = true; return; }
    backfilledRef.current = true;
    const detected = detectChapters(content).chapters;
    if (detected.length > 0) onDataChange?.({ chapters: detected });
  }, [hasContent, storageKey, content, chapters, onDataChange]);

  const novelAsset: AssetDetailData | null = hasContent
    ? {
        id: storageKey!,
        title: title || t('canvasNodes.novelUntitled', '未命名长文本'),
        kind: 'text',
        bytes: content.length,
        data: { kind: 'text', content, chapters },
      }
    : null;

  // 正文预览（前几行非空行，纯展示，节点内不存正文）
  const preview = useMemo(
    () => content.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8).join('\n'),
    [content],
  );
  const displayWordCount = wordCount ?? content.length;

  const containerStyle: CSSProperties = {
    flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
    width: '100%', height: '100%', padding: 14, boxSizing: 'border-box', gap: 8, overflow: 'hidden',
  };

  // 空态（空壳 / 失效）统一用 CreationNodeEmptyCard（与剧本/分镜/出片同款 icon+行按钮，中性色）
  const emptyActions = useCallback((kind: 'import' | 'reimport'): Array<{
    key: string; icon: typeof BookOpen; label: string; onClick: () => void;
  }> => [
    {
      key: kind,
      icon: FileUp,
      label: kind === 'import' ? t('canvasNodes.novelImport', '导入文本') : t('canvasNodes.novelReimport', '重新导入'),
      onClick: importText,
    },
  ], [importText, t]);

  return (
    <>
      <div style={containerStyle}>
        {stale ? (
          /* 失效态：本地资源已丢失/被 GC → 统一空态卡（同款冗余，去红色告警） */
          <CreationNodeEmptyCard icon={BookOpen} actions={emptyActions('reimport')} />
        ) : hasContent ? (
          /* 有内容：正文预览 + 底部标题/字数（原「查看全文」按钮位；点击标题行可全屏阅读） */
          <>
            <div
              style={{
                flex: 1, minHeight: 0, overflow: 'hidden', fontSize: 11.5, lineHeight: 1.7, color: mutedColor,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maskImage: 'linear-gradient(to bottom, #000 60%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 60%, transparent 100%)',
              }}
            >
              {preview || t('canvasNodes.novelEmptyContent', '（无正文）')}
            </div>
            <div
              onClick={openViewer}
              title={t('canvasNodes.novelView', '查看全文')}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0, cursor: 'pointer' }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {title || t('canvasNodes.novelUntitled', '未命名长文本')}
              </span>
              <span style={{ fontSize: 11, color: mutedColor, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                {displayWordCount ? t('canvasNodes.novelWordCount', { count: displayWordCount }) : t('canvasNodes.novelReady', '已导入')}
                {/* Plan#75 D7：N 章徽标，点击进全屏查看器（TOC 侧栏） */}
                {chapters && chapters.length > 0 && (
                  <span
                    onClick={(e) => { e.stopPropagation(); openViewer(); }}
                    style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 9999, cursor: 'pointer',
                      background: `${theme.toolbar.accent}18`, color: theme.toolbar.accent, fontWeight: 600,
                      lineHeight: '18px',
                    }}
                    title={t('canvasNodes.novelViewChapters', '查看目录')}
                  >
                    {chapters.length}{t('canvasNodes.chapterUnit', '章')}
                  </span>
                )}
              </span>
            </div>
          </>
        ) : (
          /* 空壳：无文本 → 统一空态卡（与出片同款 icon+按钮，中性色） */
          <CreationNodeEmptyCard icon={BookOpen} actions={emptyActions('import')} />
        )}
      </div>
      {viewerOpen && novelAsset && (
        <AssetDetailViewer
          asset={novelAsset}
          onClose={() => { setEditing(false); setViewerOpen(false); }}
          editable
          editing={editing}
          onEditingChange={setEditing}
          saving={saving}
          onSave={handleSave}
          onContentChange={(next) => { draftRef.current = next; }}
        />
      )}
    </>
  );
});
