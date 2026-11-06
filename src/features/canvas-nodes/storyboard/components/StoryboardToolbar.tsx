/**
 * StoryboardToolbar - 分镜弹窗组件集合
 *
 * 包含：重新生成弹窗。
 * 2026-11-04：表格模式移除，随表格删除链路使用的 DeleteConfirmModal 一并删除（无残留引用）。
 * 2026-09-07 Plan#77 U1/U5：底部/全屏顶部工具栏（含关联剧本下拉）已删除——
 * 连线即关联，关联关系由节点数据 linkedScript 驱动，不再提供手动切换入口。
 */
import { type CSSProperties, type ReactElement } from 'react';
import { Button, Modal, Steps } from 'antd';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Check } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';

// ===== 样式函数 =====

export const regenOptionBtnStyle = (border: string): CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
  width: '100%', padding: '12px 16px', cursor: 'pointer',
  border: `1px solid ${border}`, borderRadius: 10,
  background: 'transparent', fontFamily: 'inherit',
  transition: 'all 0.15s', textAlign: 'left',
});

export const regenOptionActiveStyle = (accent: string): CSSProperties => ({
  borderColor: accent, background: `${accent}14`,
});

// ===== 重新生成弹窗 =====

export interface RegenModalProps {
  regenMeta: null | { episodeId: string; episodeTitle?: string };
  regenStep: number;
  regenOption: 'overwrite' | 'compare';
  onStepChange: (step: number) => void;
  onOptionChange: (option: 'overwrite' | 'compare') => void;
  onCancel: () => void;
  onOverwriteRegen: () => void;
  /** @deprecated 2026-11-04 单例槽位：「新对比节点」已移除，保留字段仅为兼容调用方签名 */
  onNewCompareRegen: () => void;
  linkedScript: { id: string; title?: string } | undefined;
}

export function RegenModal({
  regenMeta,
  regenStep,
  regenOption,
  onStepChange,
  onOptionChange,
  onCancel,
  onOverwriteRegen,
  linkedScript,
}: RegenModalProps): ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  if (!regenMeta) return null;

  return (
    <Modal
      open={!!regenMeta}
      onCancel={onCancel}
      centered
      width={480}
      footer={null}
      title={null}
      styles={{
        container: { background: theme.toolbar.background, padding: 0, overflow: 'hidden', borderRadius: 16, border: `1px solid ${cardBorder}` },
        mask: { background: 'transparent' },
      }}
    >
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${cardBorder}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: textColor }}>{t('storyboard.regenerateStoryboard')}</div>
        <div style={{ fontSize: 12, color: mutedColor, marginTop: 4 }}>
          {linkedScript?.title ? `「${linkedScript.title}」` : ''}
          {regenMeta.episodeTitle ? ` · ${regenMeta.episodeTitle}` : ''}
        </div>
      </div>

      {/* Steps 导航 */}
      <div style={{ padding: '20px 24px 4px' }}>
        <Steps
          current={regenStep}
          size="small"
          items={[
            { title: t('storyboard.selectAction') },
            { title: t('common.confirm') },
          ]}
        />
      </div>

      {/* Step 0: 选择操作 */}
      {regenStep === 0 && (
        <div style={{ padding: '20px 24px' }}>
          <div style={{ fontSize: 12, color: mutedColor, marginBottom: 12, fontWeight: 600 }}>
            {t('storyboard.selectMethod')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => { onOptionChange('overwrite'); onStepChange(1); }}
              style={{ ...regenOptionBtnStyle(cardBorder), ...(regenOption === 'overwrite' ? regenOptionActiveStyle(accent) : {}) }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('storyboard.overwriteEpisode')}</span>
                <span style={{ fontSize: 12, color: mutedColor, marginTop: 2 }}>{t('storyboard.overwriteEpisodeDesc')}</span>
              </div>
            </button>
            {/* 2026-11-04 单例槽位改造：移除「新对比节点」选项——分镜不再支持多实例，
                重生成一律覆盖到项目的唯一分镜槽位节点 */}
          </div>
        </div>
      )}

      {/* Step 1: 确认 */}
      {regenStep === 1 && (
        <div style={{ padding: '20px 24px' }}>
          <div style={{ fontSize: 12, color: mutedColor, marginBottom: 12, fontWeight: 600 }}>
            {t('storyboard.confirmInfo')}
          </div>
          <div style={{
            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            borderRadius: 10, padding: '12px 16px',
            border: `1px solid ${cardBorder}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: textColor, padding: '4px 0' }}>
              <span style={{ color: mutedColor }}>{t('storyboard.operation')}</span>
              <span>{regenOption === 'overwrite' ? t('storyboard.overwriteEpisode') : t('storyboard.newCompareNode')}</span>
            </div>
            {linkedScript && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: textColor, padding: '4px 0' }}>
                <span style={{ color: mutedColor }}>{t('storyboard.associateScript')}</span>
                <span>{linkedScript.title || t('storyboard.script')}</span>
              </div>
            )}
            {regenMeta.episodeTitle && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: textColor, padding: '4px 0' }}>
                <span style={{ color: mutedColor }}>{t('storyboard.processingEpisode')}</span>
                <span>{regenMeta.episodeTitle}</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: mutedColor, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} />
            {t('storyboard.undoableAfterRegen')}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '12px 24px', borderTop: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {regenStep === 0 ? (
          <Button size="small" type="text" onClick={onCancel} style={{ color: mutedColor }}>
            {t('common.cancel')}
          </Button>
        ) : (
          <Button size="small" type="text" icon={<ChevronLeft size={14} />} onClick={() => onStepChange(0)} style={{ color: mutedColor }}>
            {t('storyboard.previousStep')}
          </Button>
        )}
        <div style={{ flex: 1 }} />
        {regenStep === 1 && (
          <Button
            size="small"
            type="primary"
            // 2026-11-04：'compare'（新对比节点）选项已移除（分镜单例），确认恒为覆盖重生成
            onClick={() => {
              onOverwriteRegen();
            }}
            style={{ fontSize: 12 }}
          >
            {regenOption === 'overwrite' ? t('storyboard.startOverwrite') : t('storyboard.createNode')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
