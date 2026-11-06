/**
 * ScriptTabContent - 顶部「剧本」页签内容
 *
 * 2026-11-02 约定：剧本不再落画布节点。
 * 2026-11-04 单例槽位改造：剧本是四个固定槽位之一，页签不可关闭，onClose 退化为切回画布槽位。
 * 2026-11-04 剧本实体化（根治）：
 * - 唯一事实源 = projects/<projectId>/entities/script.json；
 * - 读写只经唯一写者 @/entities/script-store（readScript / writeScript / watchScript）；
 * - 槽位绑定 slotBindings.script = projectId（editor-page 确保实体存在后写入）；
 * - 编辑防抖写回带 baseVersion 乐观并发：版本冲突 → 拒绝写入、提示并重新载入最新实体；
 * - 外部（MCP/手工）改动 script.json 由 watchScript 轮询发现并实时刷新；
 * - 不再读/写 .lf 剧本资产（旧测试数据已由 scripts/tools/migrate/purge-legacy.mjs 清除）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { CANVAS_TAB_KEY, useCanvasTabStore } from './canvas-tab-store.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { CanvasTabContentBoundary } from './CanvasTabContentBoundary.js';
import { ScriptFullscreenEditor } from '@/features/canvas-nodes/storyboard/script-fullscreen-editor.js';
import {
  readScript, watchScript, writeScript, ScriptConflictError,
  restoreScriptSnapshot, nextEpisodeNumber, autoEpisodeTitle,
  type ScriptEntity, type ScriptEpisode, type ScriptSnapshot,
} from '@/entities/script-store.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import { ScriptImportModal } from '@/features/canvas-nodes/storyboard/components/script-import-modal.js';
import { scriptContentLength } from '@/features/canvas-nodes/storyboard/script-import-parser.js';

export interface ScriptTabContentProps {
  /** 「重新初始化剧本」按钮回调（显式用户动作；由 editor-page 注入 ensureScriptEntity，不走激活链路） */
  onReinitScript: () => void;
}

export function ScriptTabContent({ onReinitScript }: ScriptTabContentProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  // 2026-11-04 实体化：剧本槽位绑定 = projectId（不再是 .lf 资产 id）
  const projectId = useCanvasTabStore((s) => s.slotBindings.script);
  const activateTab = useCanvasTabStore((s) => s.activateTab);
  // 2026-11-04 供应下线：接受裸 'script'（绑定未就绪的窗口期）与 'script:<projectId>' 两种 key
  const isActive = activeTabKey === 'script' || activeTabKey.startsWith('script:');

  const [entity, setEntity] = useState<ScriptEntity | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeEpisodeId, setActiveEpisodeId] = useState('');
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  const [retryTick, setRetryTick] = useState(0);
  const [dirtyTick, setDirtyTick] = useState(0);
  // 2026-11-04 重做做剧本导入：导入弹窗（预览层 + 三策略落盘，直连实体写者）
  const [importOpen, setImportOpen] = useState(false);
  const { theme } = useTheme();
  // 2026-11-04 约定（偏好记忆）：「显示标签/隐藏标签」持久化到全局偏好 store——
  // 页签切换会卸载本组件，此前开关只活在编辑器内部 useState，切走即丢；现受控传入，切回/刷新都保留
  const showLabels = useViewPrefsStore((s) => s.scriptEditor.showLabels);
  const setScriptShowLabels = useViewPrefsStore((s) => s.setScriptShowLabels);
  // 实体与脏标记走 ref：写回 effect 据此取 baseVersion，watch 推送据此避免覆盖未落盘编辑
  const entityRef = useRef<ScriptEntity | null>(null);
  const dirtyRef = useRef(false);

  const applyEntity = (fresh: ScriptEntity | null): void => {
    entityRef.current = fresh;
    setEntity(fresh);
    // ScriptEpisode.status 为 string、Episode.status 为 EpisodeStatus 联合类型，边界处显式收窄
    setEpisodes((fresh?.episodes ?? []) as Episode[]);
    setActiveEpisodeId(fresh ? (fresh.activeEpisodeId || fresh.episodes[0]?.id || '') : '');
  };

  // 载入剧本实体（槽位绑定 = projectId）+ 订阅外部写入
  useEffect(() => {
    const pid = isActive ? projectId : null;
    if (!pid) {
      applyEntity(null);
      setLoadState('idle');
      return;
    }
    let cancelled = false;
    setLoadState('loading');
    readScript(pid).then((found) => {
      if (cancelled) return;
      if (!found) {
        applyEntity(null);
        setLoadState('missing'); // 实体不存在——渲染可见空态，不再白屏
        return;
      }
      applyEntity(found);
      setLoadState('ready');
    }).catch((err: unknown) => {
      if (cancelled) return;
      console.error('[ScriptTabContent] read script entity failed:', err);
      applyEntity(null);
      setLoadState('error');
    });
    // 外部（MCP/手工改文件）写入由 watchScript 轮询发现；本会话内 writeScript 即时推送。
    // 回显防护：版本号与本地一致 = 自己刚写的，跳过；本地有未落盘编辑时不被远端覆盖。
    const unwatch = watchScript(pid, (fresh) => {
      if (!fresh || fresh.version === entityRef.current?.version || dirtyRef.current) return;
      applyEntity(fresh);
      setLoadState('ready');
    });
    return () => { cancelled = true; unwatch(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, projectId, retryTick]);

  const markDirty = (): void => {
    dirtyRef.current = true;
    setDirtyTick((v) => v + 1);
  };

  // 编辑防抖写回实体（乐观并发：baseVersion 不匹配 → ScriptConflictError → 提示并重载）
  useEffect(() => {
    if (!dirtyRef.current || !projectId) return;
    const timer = window.setTimeout(() => {
      const base = entityRef.current;
      if (!base || episodes.length === 0) { dirtyRef.current = false; return; }
      dirtyRef.current = false;
      // 以编辑器返回的 Episode 为准，按 id 合并回实体扩展字段（status/segments 等）
      const merged: ScriptEpisode[] = episodes.map((e) => ({
        status: 'draft',
        ...(base.episodes.find((x) => x.id === e.id) ?? {}),
        ...e,
      }));
      void writeScript(projectId, {
        baseVersion: base.version,
        episodes: merged,
        activeEpisodeId,
      }).then((next) => {
        entityRef.current = next;
        setEntity(next);
      }).catch((err: unknown) => {
        if (err instanceof ScriptConflictError) {
          message.warning(t('canvasTab.scriptConflict', '剧本已被外部修改，已重新载入最新版本'));
          void readScript(projectId).then((fresh) => { if (fresh) applyEntity(fresh); });
        } else {
          console.error('[ScriptTabContent] write script entity failed:', err);
          message.error(t('canvasTab.scriptSaveFailed', '剧本保存失败，请重试'));
        }
      });
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyTick, projectId]);

  // 快照恢复（2026-11-04 版本面板）：restoreScriptSnapshot 内部先落 pre-restore 快照（当前版），
  // 再以 writeScript(baseVersion=当前盘上版本) 写入恢复内容；版本冲突按既有提示处理并重载
  // 最新实体（不静默覆盖），成功后直接刷新编辑器内容（不触发防抖写盘——恢复内容已落盘）
  const handleRestoreSnapshot = useCallback(async (snap: ScriptSnapshot) => {
    if (!projectId) return;
    dirtyRef.current = false; // 取消在途防抖写回，避免旧编辑覆盖恢复结果
    try {
      const entity = await restoreScriptSnapshot(projectId, snap);
      applyEntity(entity);
    } catch (err: unknown) {
      if (err instanceof ScriptConflictError) {
        message.warning(t('canvasTab.scriptConflict', '剧本已被外部修改，已重新载入最新版本'));
        void readScript(projectId).then((fresh) => { if (fresh) applyEntity(fresh); });
      } else {
        console.error('[ScriptTabContent] restore snapshot failed:', err);
        message.error(t('canvasTab.scriptRestoreFailed', '快照恢复失败，请重试'));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, message, t]);

  if (!isActive) return null;

  // 实体缺失（加载中/未找到/失败）渲染可见空态，不再 return null 白屏。
  // 「重新初始化剧本」走 editor-page 供应（ensureScriptEntity 创建空实体），watch 推送后本组件自动就绪。
  if (!entity) {
    const busy = loadState === 'idle' || loadState === 'loading';
    const hint = busy
      ? t('canvasTab.scriptLoading', '正在加载剧本…')
      : loadState === 'error'
        ? t('canvasTab.scriptLoadError', '剧本读取失败，请重试')
        : t('canvasTab.scriptMissing', '此项目尚无剧本');
    return (
      <CanvasTabContentBoundary>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          color: theme.toolbar.textMuted, fontSize: 13,
        }}>
          <div>{hint}</div>
          {!busy && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setRetryTick((v) => v + 1)}
                style={{
                  padding: '4px 14px', fontSize: 12, cursor: 'pointer', borderRadius: 4,
                  border: `1px solid ${theme.toolbar.textMuted}`, background: 'transparent',
                  color: theme.toolbar.text,
                }}
              >
                {t('canvasTab.retry', '重试')}
              </button>
              <button
                type="button"
                onClick={onReinitScript}
                style={{
                  padding: '4px 14px', fontSize: 12, cursor: 'pointer', borderRadius: 4,
                  border: 'none', background: theme.toolbar.accent, color: '#fff',
                }}
              >
                {t('canvasTab.reinitScript', '重新初始化剧本')}
              </button>
            </div>
          )}
        </div>
      </CanvasTabContentBoundary>
    );
  }

  return (
    <CanvasTabContentBoundary>
      <ScriptFullscreenEditor
        open
        embedded
        onClose={() => activateTab(CANVAS_TAB_KEY)}
        title={entity.title}
        episodes={episodes}
        activeEpisodeId={activeEpisodeId}
        onEpisodesChange={(eps) => { setEpisodes(eps); markDirty(); }}
        onActiveEpisodeChange={(id) => { setActiveEpisodeId(id); markDirty(); }}
        onEpisodesAndActiveChange={(eps, activeId) => {
          setEpisodes(eps);
          if (activeId !== undefined) setActiveEpisodeId(activeId);
          markDirty();
        }}
        onAddEpisode={() => {
          // 2026-11-04 乱名修复：自动标题只由 number 派生「第N集」，不走 i18n 拼接
          // （旧写法把 assetLibrary.defaultEpisodeTitle=「第1集」整串当作前缀拼出了「第1集2集」）
          const nextNum = nextEpisodeNumber(episodes);
          const newEp: Episode = {
            id: `ep-${Date.now()}`,
            number: nextNum,
            title: autoEpisodeTitle(nextNum),
            content: '',
          };
          setEpisodes([...episodes, newEp]);
          setActiveEpisodeId(newEp.id);
          markDirty();
        }}
        onImportClick={() => setImportOpen(true)}
        showLabels={showLabels}
        onShowLabelsChange={setScriptShowLabels}
        snapshotProjectId={projectId ?? undefined}
        onRestoreSnapshot={handleRestoreSnapshot}
      />
      {/* 剧本导入弹窗：预览确认后经 script-import-service 走 writeScript 落盘，
          成功后本组件重读实体刷新（同时取消未落盘的防抖写回，避免覆盖导入结果） */}
      {projectId && (
        <ScriptImportModal
          open={importOpen}
          projectId={projectId}
          activeEpisode={(() => {
            const ep = episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0];
            return ep ? { id: ep.id, number: ep.number, title: ep.title, chars: scriptContentLength(ep.content) } : null;
          })()}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            dirtyRef.current = false;
            void readScript(projectId).then((fresh) => { if (fresh) applyEntity(fresh); });
          }}
        />
      )}
    </CanvasTabContentBoundary>
  );
}
