/**
 * script-snapshot-panel — 剧本版本（快照）面板（2026-11-04 快照/版本功能）
 *
 * 挂在剧本全屏编辑器 overlay 右侧：列表 + 滚动（不铺满整屏）。
 *  - 每行：时间 / 来源（自动·保存前·手动·恢复前）/ 字数 / 与上一版增删字符摘要；
 *  - 行操作：预览（只读正文，不改当前编辑内容）、恢复（二次确认，走
 *    restoreScriptSnapshot：先落 pre-restore 再 writeScript(baseVersion)，冲突按既有提示）；
 *  - 手动删除（2026-11-05）：hover 显示删除按钮 → 立即从列表移除（软删，数据留在内存），
 *    底部撤销条 7 秒内可整体撤销（连续删除合并为一条提示）；超时 / 关闭面板才真删文件；
 *    删除最新一条需二次确认（文案明确「这是最新版本」）；删除进行中禁止恢复该条；
 *    面板顶部：手动创建快照（命名可选，留空用时间，不受 5 分钟时间窗限制）；
 *  - 打开面板时触发老 backups/ 一次性归并（dry-run 打清单 → 迁移，幂等）。
 *
 * i18n：本面板 key 挂在 scriptEditor.scriptSnapshot.* 下（三语 JSON 同路径）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Input, Tag, Tooltip } from 'antd';
import { CircleX, Eye, RotateCcw, Camera, Trash2 } from 'lucide-react';
import {
  listSnapshots, ensureLegacyMigrated, deleteSnapshotFile, undeleteSnapshot, type SnapshotReason,
} from '@/entities/snapshot-store.js';
import { createScriptSnapshot, type ScriptSnapshot, type ScriptEntity } from '@/entities/script-store.js';
import { normalizeScriptText, countScriptChars } from '@/shared/utils/script-count.js';

export interface ScriptSnapshotPanelProps {
  projectId: string;
  onClose: () => void;
  /** 恢复回调（由剧本页注入：restoreScriptSnapshot + 冲突提示 + 编辑器刷新） */
  onRestore: (snap: ScriptSnapshot) => Promise<void>;
  /** 配色（与全屏编辑器同源） */
  accent: string;
  border: string;
  text: string;
  textMuted: string;
  surface: string;
  zIndex?: number;
  /** 删除撤销窗口（ms，默认 7000；测试注入用） */
  undoWindowMs?: number;
}

/** 删除撤销窗口默认值（6–8 秒区间内取 7s） */
export const SNAPSHOT_UNDO_WINDOW_MS = 7000;

function pad(n: number): string { return String(n).padStart(2, '0'); }

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function entityText(entity: ScriptEntity): string {
  return entity.episodes.map((ep) => normalizeScriptText(ep.content ?? '')).join('\n');
}

function entityChars(entity: ScriptEntity): number {
  return entity.episodes.reduce((sum, ep) => sum + countScriptChars(ep.content ?? ''), 0);
}

/** 与上一版差异摘要（公共前后缀剥离，增删字符数；不做逐行 diff 渲染） */
function charDiff(oldS: string, newS: string): { added: number; deleted: number } {
  let start = 0;
  const min = Math.min(oldS.length, newS.length);
  while (start < min && oldS[start] === newS[start]) start += 1;
  let endOld = oldS.length;
  let endNew = newS.length;
  while (endOld > start && endNew > start && oldS[endOld - 1] === newS[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }
  return { added: endNew - start, deleted: endOld - start };
}

const reasonColor: Record<SnapshotReason, string> = {
  auto: 'blue',
  'pre-save': 'default',
  manual: 'gold',
  'pre-restore': 'purple',
};

export function ScriptSnapshotPanel(props: ScriptSnapshotPanelProps): React.ReactElement {
  const { projectId, onClose, onRestore, accent, border, text, textMuted, surface, zIndex } = props;
  const undoWindowMs = props.undoWindowMs ?? SNAPSHOT_UNDO_WINDOW_MS;
  const { t } = useTranslation();
  const { modal } = App.useApp();
  /** 新 → 旧 */
  const [snaps, setSnaps] = useState<ScriptSnapshot[] | null>(null);
  const [manualName, setManualName] = useState('');
  const [creating, setCreating] = useState(false);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScriptSnapshot | null>(null);
  /** 软删暂存：文件仍在盘上，撤销窗内可整体恢复（不参与渲染列表） */
  const pendingRef = useRef<ScriptSnapshot[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    await ensureLegacyMigrated(projectId); // 老 backups/ 一次性归并（dry-run → 迁移，幂等）
    const list = await listSnapshots<ScriptEntity>(projectId, 'script', { withSize: true });
    const pending = new Set(pendingRef.current.map((s) => s.fileName));
    setSnaps([...list].reverse().filter((s) => !pending.has(s.fileName))); // 新 → 旧；软删中的不回显
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  /** 真删：把软删暂存全部落盘删除（幂等；文件缺失静默） */
  const flushPending = useCallback(async (): Promise<void> => {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const items = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    for (const s of items) {
      try {
        await deleteSnapshotFile(projectId, 'script', s.fileName);
      } catch (err) {
        console.error('[script-snapshot-panel] delete snapshot failed (skip):', err);
      }
    }
  }, [projectId]);

  /** 软删一条：列表立即移除 + 暂存到内存；连续删除合并为一条撤销提示（窗口重置） */
  const softDelete = useCallback((snap: ScriptSnapshot): void => {
    if (pendingRef.current.some((s) => s.fileName === snap.fileName)) return; // 重复点击幂等
    pendingRef.current = [...pendingRef.current, snap];
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => { void flushPending(); }, undoWindowMs);
    setPendingCount(pendingRef.current.length);
    setSnaps((prev) => (prev ? prev.filter((s) => s.fileName !== snap.fileName) : prev));
    setPreview((p) => (p?.fileName === snap.fileName ? null : p)); // 正在预览该条 → 关闭预览
  }, [flushPending, undoWindowMs]);

  /** 面板关闭/卸载：撤销入口已消失 → 把未撤销的软删真正落盘删除 */
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      const items = pendingRef.current;
      pendingRef.current = [];
      for (const s of items) void deleteSnapshotFile(projectId, 'script', s.fileName).catch(() => {});
    };
  }, [projectId]);

  const handleCreate = useCallback(async (): Promise<void> => {
    setCreating(true);
    try {
      await createScriptSnapshot(projectId, manualName.trim() || undefined);
      setManualName('');
      await load();
    } finally {
      setCreating(false);
    }
  }, [projectId, manualName, load]);

  const handleRestoreClick = useCallback((snap: ScriptSnapshot): void => {
    modal.confirm({
      title: t('scriptEditor.scriptSnapshot.confirmRestoreTitle', '确认恢复该版本？'),
      // 2026-11-05 用户指令：本项目所有确认弹窗一律屏幕居中（与 script-import-modal 同款）
      centered: true,
      content: t('scriptEditor.scriptSnapshot.confirmRestoreBody', '当前内容会先保存为「恢复前」快照，可随时再恢复回来。'),
      okText: t('scriptEditor.scriptSnapshot.restore', '恢复'),
      cancelText: t('common.cancel', '取消'),
      onOk: async () => {
        // 安全边界：该条正处于删除流程（软删暂存中）→ 禁止恢复
        if (pendingRef.current.some((s) => s.fileName === snap.fileName)) return;
        setRestoringKey(snap.fileName);
        try {
          await onRestore(snap);
          await load(); // 恢复后刷新（pre-restore 已入库）
        } finally {
          setRestoringKey(null);
        }
      },
    });
  }, [modal, onRestore, load, t]);

  /** 删除入口：非最新 → 直接软删（撤销条兜底）；最新 → 二次确认（明确告知是最新版） */
  const handleDeleteClick = useCallback((snap: ScriptSnapshot, isLatest: boolean): void => {
    if (!isLatest) {
      softDelete(snap);
      return;
    }
    modal.confirm({
      title: t('scriptEditor.scriptSnapshot.confirmDeleteLatestTitle', '删除最新版本？'),
      centered: true,
      content: t(
        'scriptEditor.scriptSnapshot.confirmDeleteLatestBody',
        '这是当前最新的快照版本。删除后短时间内可撤销，超时后将从版本历史中永久移除。',
      ),
      okText: t('scriptEditor.scriptSnapshot.delete', '删除'),
      cancelText: t('common.cancel', '取消'),
      onOk: () => { softDelete(snap); },
    });
  }, [modal, softDelete, t]);

  /** 撤销全部软删：按原文件名/原内容写回 → 重新拉列表（排序位置与删除前一致） */
  const handleUndo = useCallback(async (): Promise<void> => {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const items = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    for (const s of items) {
      try {
        await undeleteSnapshot(projectId, 'script', s);
      } catch (err) {
        console.error('[script-snapshot-panel] undelete snapshot failed:', err);
      }
    }
    await load();
  }, [projectId, load]);

  const iconBtn: React.CSSProperties = { width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  const list = preview ? [preview] : (snaps ?? []);
  const totalBytes = (snaps ?? []).reduce((sum, s) => sum + (s.sizeBytes ?? 0), 0);

  return (
    <div
      data-script-snapshot-panel
      style={{
        position: 'absolute', top: 56, right: 12, bottom: 12, width: 396,
        zIndex: zIndex ?? 34000,
        display: 'flex', flexDirection: 'column',
        borderRadius: 10, border: `1px solid ${border}`, background: surface,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)', color: text, overflow: 'hidden',
      }}
    >
      {/* 删除入口 hover 显隐（行尾删除按钮；列表与预览态行为一致） */}
      <style>{`
        .script-snapshot-row .script-snapshot-delete-btn { opacity: 0; transition: opacity 0.15s; }
        .script-snapshot-row:hover .script-snapshot-delete-btn,
        .script-snapshot-row .script-snapshot-delete-btn:focus-visible { opacity: 1; }
      `}</style>

      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {t('scriptEditor.scriptSnapshot.title', '版本历史')}
        </span>
        {snaps !== null ? (
          <span data-snapshot-meta style={{ fontSize: 11, color: textMuted, flex: 1 }}>
            {t('scriptEditor.scriptSnapshot.meta', {
              defaultValue: '{{n}} 个版本 · {{size}}',
              n: snaps.length,
              size: formatBytes(totalBytes),
            })}
          </span>
        ) : <span style={{ flex: 1 }} />}
        <Tooltip title={t('common.close', '关闭')}>
          <Button type="text" size="small" icon={<CircleX size={15} />} onClick={onClose} style={{ ...iconBtn, color: textMuted }} />
        </Tooltip>
      </div>

      {/* 预览态：返回列表 + 删除（与列表行为一致） */}
      {preview ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${border}` }}>
          <Button size="small" onClick={() => setPreview(null)} style={{ color: accent, borderColor: border }}>
            {t('scriptEditor.scriptSnapshot.backToList', '← 返回列表')}
          </Button>
          <Button
            size="small"
            className="script-snapshot-delete-btn"
            data-snapshot-delete={preview.fileName}
            icon={<Trash2 size={12} />}
            onClick={() => handleDeleteClick(preview, snaps?.[0]?.fileName === preview.fileName)}
            style={{ fontSize: 11, color: textMuted, borderColor: border, opacity: 1 }}
          >
            {t('scriptEditor.scriptSnapshot.delete', '删除')}
          </Button>
        </div>
      ) : (
        /* 手动创建快照（命名可选，留空用时间） */
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${border}` }}>
          <Input
            size="small"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder={t('scriptEditor.scriptSnapshot.namePlaceholder', '快照名称（可选，留空用时间）')}
            style={{ flex: 1, color: text }}
            data-snapshot-name-input
          />
          <Button size="small" icon={<Camera size={13} />} loading={creating} onClick={() => void handleCreate()} style={{ color: accent, borderColor: border }}>
            {t('scriptEditor.scriptSnapshot.create', '创建快照')}
          </Button>
        </div>
      )}

      {/* 列表 / 预览（滚动区，不铺满整屏） */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }} data-snapshot-list>
        {snaps === null ? (
          <div style={{ padding: 16, color: textMuted, fontSize: 12 }}>{t('common.loading', '加载中…')}</div>
        ) : list.length === 0 ? (
          <div style={{ padding: 16, color: textMuted, fontSize: 12 }}>{t('scriptEditor.scriptSnapshot.empty', '暂无快照')}</div>
        ) : preview ? (
          <pre data-snapshot-preview style={{ margin: 0, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.8, color: text }}>
            {entityText(preview.entity)}
          </pre>
        ) : (
          list.map((snap, idx) => {
            const prev = list[idx + 1]; // 更旧一份
            const diff = prev ? charDiff(entityText(prev.entity), entityText(snap.entity)) : null;
            const label = snap.name?.trim() || formatTime(snap.createdAt);
            return (
              <div key={snap.fileName} className="script-snapshot-row" style={{ padding: '8px 12px', borderBottom: `1px solid ${border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12 }}>{label}</span>
                  <Tag color={reasonColor[snap.reason]} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}>
                    {t(`scriptEditor.scriptSnapshot.source.${snap.reason}`, snap.reason)}
                  </Tag>
                  <span style={{ fontSize: 11, color: textMuted }}>
                    {entityChars(snap.entity)} {t('scriptEditor.scriptSnapshot.chars', '字')}
                  </span>
                  {diff ? (
                    <span style={{ fontSize: 11, color: textMuted }} data-snapshot-diff>
                      {`+${diff.added} / -${diff.deleted}`}
                    </span>
                  ) : null}
                  <Tooltip title={t('scriptEditor.scriptSnapshot.delete', '删除')}>
                    <Button
                      type="text"
                      size="small"
                      className="script-snapshot-delete-btn"
                      data-snapshot-delete={snap.fileName}
                      icon={<Trash2 size={13} />}
                      onClick={() => handleDeleteClick(snap, idx === 0)}
                      style={{ ...iconBtn, minWidth: 26, color: textMuted, marginInlineStart: 'auto' }}
                    />
                  </Tooltip>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <Button size="small" icon={<Eye size={12} />} onClick={() => setPreview(snap)} style={{ fontSize: 11, color: textMuted, borderColor: border }}>
                    {t('scriptEditor.scriptSnapshot.preview', '预览')}
                  </Button>
                  <Button
                    size="small"
                    icon={<RotateCcw size={12} />}
                    loading={restoringKey === snap.fileName}
                    onClick={() => handleRestoreClick(snap)}
                    style={{ fontSize: 11, color: accent, borderColor: border }}
                    data-snapshot-restore={snap.fileName}
                  >
                    {t('scriptEditor.scriptSnapshot.restore', '恢复')}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部撤销条：软删暂存期间显示（连续删除合并为一条） */}
      {pendingCount > 0 ? (
        <div
          data-snapshot-undo-bar
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: `1px solid ${border}`, fontSize: 12, color: textMuted }}
        >
          <span style={{ flex: 1 }}>
            {t('scriptEditor.scriptSnapshot.deleted', {
              defaultValue: '已删除 {{count}} 个版本',
              count: pendingCount,
            })}
          </span>
          <Button
            size="small"
            type="primary"
            data-snapshot-undo
            onClick={() => void handleUndo()}
            style={{ fontSize: 12 }}
          >
            {t('scriptEditor.scriptSnapshot.undo', '撤销')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
