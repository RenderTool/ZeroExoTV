/**
 * DockFooterBar - 生成输入面板底栏（模型 Select + 参数弹层 + 字数 + 生成按钮）
 *
 * 从 node-generate-dock.tsx 提取，已导出给 workbench-prompt-dock.tsx 复用。
 * 职责单一：底栏操作行渲染。
 */

import { memo, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { LoaderCircle, Lock, Sparkles } from 'lucide-react';
import { StyledSelect, type StyledSelectOption } from './styled-select.js';
import { DynamicParamForm, type ChannelConstraints } from '@/features/generator-settings/dynamic-param-form.js';
import { LOCAL_VIDEO_MODEL_KEY, LOCAL_IMAGE_MODEL_KEY, KREA2_MODEL_KEY, MOSS_MODEL_KEY } from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { LocalQwenParamForm } from './local-qwen-param-form.js';
import { Krea2ParamForm } from './krea2-param-form.js';
import { MossParamForm } from './moss-param-form.js';
import { LocalH3ParamForm } from './local-h3-param-form.js';
import { PromptLibraryMenu } from '@/features/prompt-library/prompt-library-menu.js';
import type { GenerationMode } from './node-generate-dock.js';

export const DockFooterBar = memo(function DockFooterBar({
  nodeId,
  mode,
  model,
  modelOptions,
  paramValues,
  hasImageReference = false,
  isRunning,
  hasText,
  textLength = 0,
  interruptible = true,
  onAction,
  onConfigChange,
  onParamValuesChange,
  onPromptPreset,
  onConstraintsReady,
  mentionRequired,
  dropUp = false,
  hideModelSelect = false,
  trailing,
}: {
  nodeId: string;
  mode: GenerationMode;
  model: string;
  modelOptions: StyledSelectOption[];
  paramValues: Record<string, any>;
  hasImageReference?: boolean;
  isRunning: boolean;
  hasText: boolean;
  textLength?: number;
  interruptible?: boolean;
  dropUp?: boolean;
  onAction: () => void;
  onConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  onParamValuesChange: (patch: Record<string, any>) => void;
  onPromptPreset?: (body: string) => void;
  onConstraintsReady?: (constraints?: ChannelConstraints) => void;
  mentionRequired?: boolean;
  /** 生成按钮之前的业务动作（如主体「发送到画布」），保证生成永远在最后 */
  trailing?: ReactNode;
  /** Plan#74 Phase B：agent-proxy 模式（script/storyboard）隐藏模型选择——LLM 统一在 Agent 侧设置，避免上下文割裂 */
  hideModelSelect?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const spinRef = useRef<HTMLSpanElement>(null);
  const actionDisabled = !isRunning && !hasText;
  const actionTitle = mentionRequired
    ? t('nodeDock.mentionStackedHint', '堆叠节点需 @ 内部资源才会作为输入源')
    : isRunning ? t('prompt.stop', '停止') : t('prompt.generate', '生成');

  useEffect(() => {
    const el = spinRef.current;
    if (!el || !isRunning) return;
    const anim = el.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 1000, iterations: Infinity },
    );
    return () => anim.cancel();
  }, [isRunning]);

  return (
    <>
      {!hideModelSelect && (
        <StyledSelect
          value={model}
          options={modelOptions}
          onChange={(m) => {
            onConfigChange?.(nodeId, { model: m });
            // 2026-11-11：Krea2(10步/3MP) ↔ Moss(25步/1MP) ↔ Qwen(25步/1MP) 参数不通用，
            // 切换模型必须重置为新模型默认值，否则会拿上一个模型的 10 步去跑 Moss。
            if (mode === 'image' && m !== model && (m.startsWith('zeroexo:') || model.startsWith('zeroexo:'))) {
              const defaults = m === MOSS_MODEL_KEY
                ? { steps: 25, cfg: 2.5, megapixels: 1 }
                : m === KREA2_MODEL_KEY
                  ? { steps: 10, cfg: 1, megapixels: 3, eta: 0.55 }
                  : { steps: 25, cfg: 1 };
              onParamValuesChange(defaults);
            }
          }}
          minWidth={120}
          maxWidth={180}
          height={26}
          forceDropUp={dropUp}
        />
      )}
      {onConfigChange && mode !== 'text' && modelOptions.length > 0 ? (
        mode === 'video' && model === LOCAL_VIDEO_MODEL_KEY ? (
          <LocalH3ParamForm paramValues={paramValues} onChange={(patch) => onParamValuesChange(patch)} theme={theme} />
        ) : mode === 'image' && model === LOCAL_IMAGE_MODEL_KEY ? (
          <LocalQwenParamForm paramValues={paramValues} onChange={(patch) => onParamValuesChange(patch)} theme={theme} hasReference={hasImageReference} />
        ) : mode === 'image' && model === KREA2_MODEL_KEY ? (
          <Krea2ParamForm paramValues={paramValues} onChange={(patch) => onParamValuesChange(patch)} theme={theme} />
        ) : mode === 'image' && model === MOSS_MODEL_KEY ? (
          <MossParamForm paramValues={paramValues} onChange={(patch) => onParamValuesChange(patch)} theme={theme} />
        ) : (
          <DynamicParamForm
            model={model}
            generationMode={mode}
            paramValues={paramValues}
            onChange={(patch) => onParamValuesChange(patch)}
            theme={theme}
            onConstraintsReady={onConstraintsReady}
          />
        )
      ) : null}
      {mode === 'image' && onPromptPreset ? (
        <PromptLibraryMenu onPick={onPromptPreset} />
      ) : null}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: theme.toolbar.textMuted ?? '', lineHeight: 1, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {textLength} 字
        </span>
      </div>
      {trailing}
      {isRunning && !interruptible ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 36, padding: '0 12px', borderRadius: 18, flexShrink: 0, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`, color: theme.toolbar.textMuted ?? '', fontSize: 12, fontWeight: 500, userSelect: 'none' }}
          title={t('nodeDock.lockedGenerating', '媒体生成提交后不可取消,请稍候')}>
          <Lock size={13} style={{ flexShrink: 0 }} />
          {t('nodeDock.lockedGenerating', '生成中，不可取消')}
        </span>
      ) : (
        <button type="button" onClick={onAction} disabled={actionDisabled} aria-label={isRunning ? t('prompt.stop', '停止') : t('prompt.generate', '生成')} title={actionTitle}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0, minWidth: 34, height: 34, padding: 0, border: 'none', borderRadius: 8, background: actionDisabled ? (isDark ? '#262626' : '#e5e5e5') : isRunning ? (theme.toolbar.danger ?? '#dc2626') : theme.toolbar.accent, color: actionDisabled ? (isDark ? '#666' : '#999') : '#fff', cursor: actionDisabled ? 'not-allowed' : 'pointer', opacity: actionDisabled ? 0.4 : 1, transition: 'opacity 140ms ease', fontFamily: 'inherit' }}>
          {isRunning ? (
            <span ref={spinRef} style={{ display: 'inline-flex', alignItems: 'center' }}><LoaderCircle size={16} /></span>
          ) : (
            <Sparkles size={16} />
          )}
        </button>
      )}
    </>
  );
});