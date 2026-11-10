/**
 * Krea2ParamForm — 画布图片节点「Krea2」的参数面板（仅线上 ComfyUI）。
 *
 * 与 Qwen 面板同一套视觉语言，但只保留 Krea2 真正支持的项：比例 + 百万像素（32 对齐）、
 * 采样步数、种子。不支持参考图 / 透明底 / 跟随原图（模型没有这些输入）。
 */
import { InputNumber } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import { SettingGroup, SettingsPopoverShell } from '@/features/generator-settings/settings-popover-shell.js';
import { AspectRatioPicker, type RatioOption } from '@/features/generator-settings/aspect-ratio-picker.js';
import { useLastSeed } from '@/shared/last-seed-store.js';
import { KREA2_DEFAULT_MEGAPIXELS, KREA2_DEFAULT_STEPS, resolveKrea2Size } from '@/pages/editor/editor-canvas/interactions/local-krea2-image.js';

const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'] as const;

const ASPECT_OPTIONS: RatioOption[] = ASPECTS.map((key) => {
  const [w = 1, h = 1] = key.split(':').map(Number);
  return { value: key, label: key, ratio: w / h };
});

const MP_OPTIONS = [1, 2, 3, 4] as const;

export function Krea2ParamForm({
  paramValues,
  onChange,
  theme,
}: {
  paramValues: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  const aspect = typeof paramValues.aspect === 'string' ? paramValues.aspect : '1:1';
  const megapixels = Number(paramValues.megapixels ?? KREA2_DEFAULT_MEGAPIXELS);
  const steps = Number(paramValues.steps ?? KREA2_DEFAULT_STEPS);
  const seed = Number(paramValues.seed ?? -1);
  const lastSeed = useLastSeed();
  const size = resolveKrea2Size(aspect, megapixels);
  const subColor = theme.toolbar.textMuted;
  const labelStyle = { fontSize: 11, color: subColor, flexShrink: 0 } as const;
  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } as const;
  const summary = `${size.width}×${size.height} · ${steps} 步`;

  return (
    <SettingsPopoverShell summary={summary} theme={theme} panelWidth={340} placement="topLeft" triggerVariant="dropdown">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SettingGroup title={t('nodeDock.krea2Size', '画面尺寸')} color={subColor}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>{t('nodeDock.krea2Aspect', '画面比例')}</span>
            <AspectRatioPicker value={aspect} onChange={(key) => onChange({ aspect: key })} theme={theme} options={ASPECT_OPTIONS} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>{t('nodeDock.krea2Megapixels', '百万像素')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {MP_OPTIONS.map((mp) => {
                const selected = megapixels === mp;
                return (
                  <button
                    key={mp}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onChange({ megapixels: mp })}
                    style={{
                      height: 32, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                      border: `1px solid ${selected ? theme.toolbar.accent : theme.toolbar.border}`,
                      background: selected ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)') : 'transparent',
                      color: theme.toolbar.text,
                    }}
                  >
                    {mp} MP
                  </button>
                );
              })}
            </div>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('nodeDock.krea2ResolvedSize', '换算尺寸')}</span>
            <span style={{ fontSize: 11, color: subColor, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {size.width}×{size.height}
            </span>
          </div>
        </SettingGroup>

        <div style={{ height: 1, background: theme.toolbar.border }} />

        <SettingGroup title={t('nodeDock.krea2Sampling', '采样')} color={subColor}>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('nodeDock.qwenSteps', '步数')}</span>
            <InputNumber
              size="small"
              min={1}
              max={100}
              step={1}
              precision={0}
              value={steps}
              onChange={(v) => { if (typeof v === 'number' && Number.isFinite(v)) onChange({ steps: Math.max(1, Math.min(100, Math.round(v))) }); }}
              className="director-input-number"
              style={{ width: 120, height: 25 }}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('nodeDock.qwenSeed', '随机种子')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                data-krea2-seed-random
                onClick={() => onChange({ seed: -1 })}
                style={{
                  height: 25, padding: '0 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
                  border: `1px solid ${seed < 0 ? theme.toolbar.accent : theme.toolbar.border}`,
                  background: seed < 0 ? 'rgba(128,128,128,0.16)' : 'transparent',
                  color: 'inherit',
                }}
              >
                {t('nodeDock.qwenSeedRandom', '随机')}
              </button>
              <InputNumber
                size="small"
                min={-1}
                max={0x7fffffff}
                step={1}
                precision={0}
                value={seed < 0 ? null : seed}
                placeholder={t('nodeDock.qwenSeedRandom', '随机')}
                onChange={(v) => onChange({ seed: typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : -1 })}
                className="director-input-number"
                style={{ width: 110, height: 25 }}
              />
            </div>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('nodeDock.qwenLastSeed', '上次种子')}</span>
            {lastSeed == null ? (
              <span style={{ fontSize: 11, color: subColor }}>{t('nodeDock.qwenLastSeedNone', '暂无')}</span>
            ) : (
              <button
                type="button"
                onClick={() => onChange({ seed: lastSeed })}
                title={t('nodeDock.qwenLastSeedReuse', '点击复用上次种子')}
                style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 11, color: subColor, fontVariantNumeric: 'tabular-nums' }}
              >
                {lastSeed}
              </button>
            )}
          </div>
        </SettingGroup>
      </div>
    </SettingsPopoverShell>
  );
}
