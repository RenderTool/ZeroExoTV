/**
 * LocalH3ParamForm — 画布视频节点「H3ZeroExo」的参数面板。
 *
 * 直接复用导演台「参数」面板的同一套控件（比例九宫格 / 尺寸系数 / 换算尺寸 / 步数 / 种子 / 参考图尺寸），
 * 仅在顶部多一个「时长」——两处不再各写一套 UI。
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import {
  NumberInput,
  SettingGroup,
  SettingsPopoverShell,
} from '@/features/generator-settings/settings-popover-shell.js';
import { RATIO_OPTIONS } from '@/features/generator-settings/aspect-ratio-picker.js';
import { DirectorParamsControls } from '@/features/canvas-tabs/director-run-params-row.js';
import {
  SCALE_FACTOR_MAX,
  SCALE_FACTOR_MIN,
  resolveVideoSize,
} from '@/entities/director-params.js';

export function LocalH3ParamForm({
  paramValues,
  onChange,
  theme,
}: {
  paramValues: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  const seconds = Number(paramValues.seconds ?? 5);

  // 兼容旧参数：以前只存过 size 字符串 → 反推比例与系数，保证「面板显示 = 实际生成」
  const derived = useMemo(() => {
    const storedAspect = typeof paramValues.aspect === 'string' ? paramValues.aspect : '';
    const storedScale = Number(paramValues.scaleFactor);
    if (storedAspect) {
      return { aspect: storedAspect, scaleFactor: Number.isFinite(storedScale) ? storedScale : 1 };
    }
    const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(paramValues.size ?? ''));
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      const ratio = w / h;
      const nearest = RATIO_OPTIONS.reduce((best, opt) =>
        Math.abs(opt.ratio - ratio) < Math.abs(best.ratio - ratio) ? opt : best, RATIO_OPTIONS[0]!);
      const base = resolveVideoSize(nearest.value, 1).width || w;
      const scaleFactor = Math.min(SCALE_FACTOR_MAX, Math.max(SCALE_FACTOR_MIN, w / base));
      return { aspect: nearest.value, scaleFactor: Math.round(scaleFactor * 100) / 100 };
    }
    return { aspect: '16:9', scaleFactor: 1 };
  }, [paramValues.aspect, paramValues.scaleFactor, paramValues.size]);

  const size = resolveVideoSize(derived.aspect, derived.scaleFactor);
  const summary = `${seconds}s · ${size.width}×${size.height}`;

  const handleControlsChange = (patch: Record<string, unknown>): void => {
    const next = { ...paramValues, aspect: derived.aspect, scaleFactor: derived.scaleFactor, ...patch };
    const resolved = resolveVideoSize(String(next.aspect ?? '16:9'), Number(next.scaleFactor ?? 1));
    onChange({ ...patch, size: `${resolved.width}x${resolved.height}` });
  };

  return (
    <SettingsPopoverShell summary={summary} theme={theme} panelWidth={360} triggerVariant="dropdown">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SettingGroup title={t('nodeDock.h3Duration', '时长')} color={theme.toolbar.textMuted}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NumberInput
              value={String(seconds)}
              min={1}
              max={30}
              theme={theme}
              onChange={(v) => onChange({ seconds: Math.max(1, Math.min(30, Number(v) || 1)) })}
            />
            <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
              {t('nodeDock.h3DurationUnit', '秒')}
            </span>
          </div>
        </SettingGroup>

        <DirectorParamsControls
          params={{ ...paramValues, aspect: derived.aspect, scaleFactor: derived.scaleFactor }}
          onChange={handleControlsChange}
          subColor={theme.toolbar.textMuted}
        />
      </div>
    </SettingsPopoverShell>
  );
}
