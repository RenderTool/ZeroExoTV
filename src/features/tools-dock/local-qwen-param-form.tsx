/**
 * LocalQwenParamForm — 画布图片节点「QwenImage2.1」的参数面板。
 *
 * 与视频节点共用同一套参数面板语言（SettingGroup + AspectRatioPicker + 25px 输入行），
 * 但保留图片自己的语义：跟随原图 / 2K 尺寸 / 优化提示词 / 透明背景 / 步数/贴合度/修改幅度/种子。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InputNumber } from 'antd';
import { ChevronDown, ChevronRight, Expand, Image as ImageIcon, Scan } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import {
  SettingGroup,
  SettingsPopoverShell,
  SwitchRow,
} from '@/features/generator-settings/settings-popover-shell.js';
import { AspectRatioPicker, type RatioOption } from '@/features/generator-settings/aspect-ratio-picker.js';
import { useLastSeed } from '@/shared/last-seed-store.js';
import { clampQwenSize, QWEN_DEFAULT_STEPS } from '@/features/canvas-tabs/qwen-limits.js';

const RATIOS = [
  { key: '1:1', ratio: 1 },
  { key: '4:3', ratio: 4 / 3 },
  { key: '3:4', ratio: 3 / 4 },
  { key: '16:9', ratio: 16 / 9 },
  { key: '9:16', ratio: 9 / 16 },
  { key: '21:9', ratio: 21 / 9 },
] as const;

type Quality = 'source' | '1k' | '2k' | 'custom';

/** 1K/2K = 最短边固定 1K/2K？不，按最长边 1024/2048，另一边按比例换算（16 对齐） */
function sizeForRatio(key: string, quality: '1k' | '2k'): { width: number; height: number } {
  const ratio = RATIOS.find((r) => r.key === key)?.ratio ?? 4 / 3;
  const long = quality === '2k' ? 2048 : 1024;
  const w = ratio >= 1 ? long : Math.round((long * ratio) / 16) * 16;
  const h = ratio >= 1 ? Math.round(long / ratio / 16) * 16 : long;
  return clampQwenSize(w, h);
}

const ASPECT_OPTIONS: RatioOption[] = RATIOS.map((r) => ({
  value: r.key,
  label: r.key,
  ratio: r.ratio,
}));

export function LocalQwenParamForm({
  paramValues,
  onChange,
  theme,
  hasReference = false,
}: {
  paramValues: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
  theme: ThemeConfig;
  hasReference?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const storedMode = typeof paramValues.sizeMode === 'string' ? paramValues.sizeMode : '';
  const sourceMode = hasReference && (storedMode === 'source' || !storedMode);
  const fallback = sizeForRatio('4:3', '1k');
  const clamped = clampQwenSize(Number(paramValues.width ?? fallback.width), Number(paramValues.height ?? fallback.height));
  const width = clamped.width;
  const height = clamped.height;
  const steps = Number(paramValues.steps ?? QWEN_DEFAULT_STEPS);
  const cfg = Number(paramValues.cfg ?? 1);
  const denoise = Number(paramValues.denoise ?? 1);
  const seed = Number(paramValues.seed ?? -1);
  const optimize = paramValues.use_llm_enhance === true;
  const transparent = paramValues.transparent_background === true;
  const lastSeed = useLastSeed();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const nearestAspect = RATIOS.reduce((best, r) =>
    Math.abs(r.ratio - width / height) < Math.abs(best.ratio - width / height) ? r : best, RATIOS[1]!).key;
  const selectedAspect = sourceMode
    ? ''
    : RATIOS.find((r) => sizeForRatio(r.key, '1k').width === width && sizeForRatio(r.key, '1k').height === height)?.key
      ?? RATIOS.find((r) => sizeForRatio(r.key, '2k').width === width && sizeForRatio(r.key, '2k').height === height)?.key
      ?? '';
  const activeQuality: Quality = sourceMode
    ? 'source'
    : RATIOS.some((r) => sizeForRatio(r.key, '2k').width === width && sizeForRatio(r.key, '2k').height === height)
      ? '2k'
      : RATIOS.some((r) => sizeForRatio(r.key, '1k').width === width && sizeForRatio(r.key, '1k').height === height)
        ? '1k'
        : 'custom';
  const summary = `${sourceMode ? t('nodeDock.qwenSourceShort', '原图') : `${width}×${height}`} · ${steps} 步`;
  const subColor = theme.toolbar.textMuted;
  const labelStyle = { fontSize: 11, color: subColor, flexShrink: 0 } as const;
  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } as const;
  const inputStyle = { width: 120, height: 25 } as const;

  const pickQuality = (quality: '1k' | '2k'): void => {
    const ratioKey = selectedAspect || nearestAspect;
    const size = sizeForRatio(ratioKey, quality);
    onChange({ sizeMode: 'custom', ...size });
  };

  const pickSize = (key: string): void => {
    const quality = activeQuality === '2k' ? '2k' : '1k';
    const size = sizeForRatio(key, quality);
    onChange({ sizeMode: 'custom', ...size });
  };

  return (
    <SettingsPopoverShell
      summary={summary}
      theme={theme}
      panelWidth={360}
      placement="topLeft"
      triggerVariant="dropdown"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SettingGroup title={t('nodeDock.qwenSize', '画面尺寸')} color={subColor}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>{t('nodeDock.qwenQuality', '尺寸档位')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {([
                { key: 'source', label: t('nodeDock.qwenSource', '原图'), icon: <ImageIcon size={16} />, disabled: !hasReference },
                { key: '1k', label: '1K', icon: <Scan size={16} />, disabled: false },
                { key: '2k', label: '2K', icon: <Expand size={16} />, disabled: false },
              ] as const).map((item) => {
                const selected = activeQuality === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={item.disabled}
                    aria-pressed={selected}
                    onClick={() => {
                      if (item.disabled) return;
                      if (item.key === 'source') {
                        onChange({ sizeMode: 'source' });
                        return;
                      }
                      pickQuality(item.key);
                    }}
                    style={{
                      height: 56,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      borderRadius: 10,
                      border: `1px solid ${selected ? theme.toolbar.accent : theme.toolbar.border}`,
                      background: selected
                        ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)')
                        : 'transparent',
                      color: theme.toolbar.text,
                      cursor: item.disabled ? 'not-allowed' : 'pointer',
                      opacity: item.disabled ? 0.35 : 1,
                      fontSize: 11,
                      fontFamily: 'inherit',
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>{t('nodeDock.qwenAspect', '生成比例')}</span>
            <AspectRatioPicker
              value={selectedAspect}
              onChange={pickSize}
              theme={theme}
              options={ASPECT_OPTIONS}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('nodeDock.qwenResolvedSize', '换算尺寸')}</span>
            <span style={{ fontSize: 11, color: subColor, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {sourceMode ? t('nodeDock.qwenFollowSourceHint', '输出尺寸与输入图一致') : `${width}×${height}`}
            </span>
          </div>
          {!sourceMode && (
            <div style={{ ...rowStyle, justifyContent: 'flex-start', gap: 6 }}>
              <span style={{ ...labelStyle, width: 48 }}>{t('nodeDock.qwenSizeCustom', '自定义')}</span>
              <InputNumber
                size="small"
                min={64}
                max={2048}
                step={16}
                precision={0}
                value={width}
                onChange={(v) => {
                  if (typeof v === 'number' && Number.isFinite(v)) {
                    const next = clampQwenSize(v, height);
                    onChange({ sizeMode: 'custom', ...next });
                  }
                }}
                className="director-input-number"
                style={{ width: 88, height: 25 }}
              />
              <span style={{ fontSize: 11, color: subColor }}>×</span>
              <InputNumber
                size="small"
                min={64}
                max={2048}
                step={16}
                precision={0}
                value={height}
                onChange={(v) => {
                  if (typeof v === 'number' && Number.isFinite(v)) {
                    const next = clampQwenSize(width, v);
                    onChange({ sizeMode: 'custom', ...next });
                  }
                }}
                className="director-input-number"
                style={{ width: 88, height: 25 }}
              />
            </div>
          )}
        </SettingGroup>

        <div style={{ height: 1, background: theme.toolbar.border }} />

        <SettingGroup title={t('nodeDock.qwenPromptSection', '提示词')} color={subColor}>
          <SwitchRow
            label={t('nodeDock.qwenOptimizePrompt', '优化提示词')}
            checked={optimize}
            theme={theme}
            onChange={(checked) => onChange({ use_llm_enhance: checked })}
          />
          <SwitchRow
            label={t('nodeDock.qwenTransparent', '透明背景（PNG Alpha）')}
            checked={transparent}
            theme={theme}
            onChange={(checked) => onChange({ transparent_background: checked })}
          />
        </SettingGroup>

        <div style={{ height: 1, background: theme.toolbar.border }} />

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '2px 0',
            border: 'none', background: 'transparent', color: theme.toolbar.text, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{t('nodeDock.qwenAdvanced', '高级')}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: subColor }}>
            {steps} 步 · {cfg.toFixed(1)}
          </span>
        </button>
        {advancedOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
              style={inputStyle}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('nodeDock.qwenCfg', '贴合度')}</span>
            <InputNumber
              size="small"
              min={0}
              max={20}
              step={0.1}
              precision={1}
              value={cfg}
              onChange={(v) => { if (typeof v === 'number' && Number.isFinite(v)) onChange({ cfg: Math.max(0, Math.min(20, v)) }); }}
              className="director-input-number"
              style={inputStyle}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('nodeDock.qwenDenoise', '修改幅度')}</span>
            <InputNumber
              size="small"
              min={0}
              max={1}
              step={0.05}
              precision={2}
              value={denoise}
              onChange={(v) => { if (typeof v === 'number' && Number.isFinite(v)) onChange({ denoise: Math.max(0, Math.min(1, v)) }); }}
              className="director-input-number"
              style={inputStyle}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>{t('nodeDock.qwenSeed', '随机种子')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                data-qwen-seed-random
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
          </div>
        )}
      </div>
    </SettingsPopoverShell>
  );
}
