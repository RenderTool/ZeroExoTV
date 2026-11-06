/**
 * useStackToast - 堆叠收纳/合并提示管理
 *
 * 从 editor-page.tsx 提取，职责单一：
 * 监听 stackCollected 事件，按 1.5s 窗口合并 + 计数，
 * 窗口内事件数 ≥ 阈值判定批量 → 完全静默。
 */
import { useEffect } from 'react';
import { nodeActionBus } from '@zeroexo/plugin-nodes';

const STACK_TOAST_KEY = 'stackCollected-batch';
const STACK_TOAST_WINDOW_MS = 1500;
const STACK_TOAST_DELAY_MS = 300;
const STACK_TOAST_BATCH_THRESHOLD = 10;

export function useStackToast(
  t: (key: string, options?: Record<string, unknown>) => string,
  message: { info: (opts: { key: string; content: React.ReactNode; duration: number }) => void; destroy: (key: string) => void },
): void {
  useEffect(() => {
    const w = {
      count: 0,
      mergedCount: 0,
      lastNodeId: '',
      lastTitle: '',
      timer: 0 as number,
      showTimer: 0 as number,
      batch: false,
    };
    const show = () => {
      const key = STACK_TOAST_KEY;
      const total = w.count + w.mergedCount;
      if (total === 1) {
        const merged = w.mergedCount === 1;
        const label = merged
          ? t('nodes.stackMerged', { title: w.lastTitle })
          : t('nodes.stackCollected', { title: w.lastTitle });
        message.info({
          key,
          content: merged ? (
            label
          ) : (
            <span>
              {label}
              <a
                style={{ marginLeft: 8, fontWeight: 600 }}
                onClick={() => {
                  nodeActionBus.emit('stackUndoCollect', { nodeId: w.lastNodeId });
                  message.destroy(key);
                }}
              >
                {t('nodes.stackUndo')}
              </a>
            </span>
          ),
          duration: merged ? 3 : 5,
        });
        return;
      }
      message.info({
        key,
        content: (
          <span>
            {t('nodes.stackCollectedBatch', { count: total })}
            {w.count > 0 ? (
              <a
                style={{ marginLeft: 8, fontWeight: 600 }}
                onClick={() => {
                  nodeActionBus.emit('stackUndoCollect', { nodeId: w.lastNodeId });
                  message.destroy(key);
                }}
              >
                {t('nodes.stackUndo')}
              </a>
            ) : null}
          </span>
        ),
        duration: 5,
      });
    };
    const flush = () => {
      if (w.timer) window.clearTimeout(w.timer);
      if (w.showTimer) window.clearTimeout(w.showTimer);
      w.timer = 0;
      w.showTimer = 0;
      if (!w.batch) {
        show();
      } else {
        message.destroy(STACK_TOAST_KEY);
      }
      w.count = 0;
      w.mergedCount = 0;
      w.lastNodeId = '';
      w.lastTitle = '';
      w.batch = false;
    };
    const unsubscribe = nodeActionBus.on('stackCollected', (event) => {
      const { nodeId, title, merged } = event as { nodeId: string; title: string; merged: boolean };
      if (!nodeId || typeof title !== 'string') return;
      if (merged) w.mergedCount += 1;
      else w.count += 1;
      w.lastNodeId = nodeId;
      w.lastTitle = title;
      if (w.count + w.mergedCount >= STACK_TOAST_BATCH_THRESHOLD) w.batch = true;
      if (w.timer === 0) {
        w.timer = window.setTimeout(flush, STACK_TOAST_WINDOW_MS);
        w.showTimer = window.setTimeout(() => {
          if (!w.batch) show();
        }, STACK_TOAST_DELAY_MS);
      }
    });
    return () => {
      unsubscribe();
      if (w.timer) window.clearTimeout(w.timer);
      if (w.showTimer) window.clearTimeout(w.showTimer);
    };
  }, [t, message]);
}