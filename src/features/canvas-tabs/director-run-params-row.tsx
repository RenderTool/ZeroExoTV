/**
 * 导演台导轨「参数」/「运行」按钮（2026-11-04 约定：参数合并到单个「参数」按钮，
 * 分辨率比例外面要有文本标签显示在视频预览区；运行选中按钮文案改为「运行」，移到批量附近）
 * 2026-11-05 二调：参数按钮不出现外边线，批量放运行左边 ——
 * 参数按钮去全部 border/outline/box-shadow 描边（含 hover），只以 hover/激活背景色体现可点；
 * 两个按钮拆分注入，工具行顺序 = 添加/链接/删除/参数/批量/运行，批量紧邻运行左侧）
 *
 * - 比例下拉 / ×系数 / 换算尺寸 chip 收进「参数」的浮层面板（antd Popover，沿用应用下拉样式），
 *   不再裸在导轨上；全界面唯一一份（提示词面板侧零渲染）。
 * - 「运行」= 只跑当前激活片段并打开 dry-run 预检（行为不变，仅文案 运行选中 → 运行）。
 * - 预览区文字标签（16:9 · 1512×840）由 StoryboardVideoStage 的 paramsLabel 承担，随参数实时更新。
 * - 参数持久化链路不变：仍写 shared.params（aspect/scaleFactor）。
 *
 * 窄窗降级（@container railToolbar，容器 = 导轨工具行）：先隐藏按钮文字（图标+title），
 * 「批量」始终可见；整行 overflowX auto 不换行。
 */
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InputNumber, Popover, Select } from 'antd';
import { Play, SlidersHorizontal } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { AspectRatioPicker } from '@/features/generator-settings/aspect-ratio-picker.js';
import { useLastSeed } from '@/shared/last-seed-store.js';
import {
  REF_IMAGE_SIZE_OPTIONS,
  SCALE_FACTOR_MAX,
  SCALE_FACTOR_MIN,
  clampScaleFactor,
  resolveVideoSize,
} from '@/entities/director-params.js';
import type { WorkbenchSharedParams } from '@/entities/slot-containers.js';

export interface DirectorParamsPanelProps {
  shared: WorkbenchSharedParams;
  onSharedChange: (patch: Partial<WorkbenchSharedParams>) => void;
  subColor: string;
}

export interface DirectorParamsControlsProps {
  /** aspect / scaleFactor / steps / seed / refImageSize */
  params: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  subColor: string;
}

/**
 * 参数控件本体：比例九宫格 + 尺寸系数 + 换算尺寸 + 采样步数 + 种子 + 参考图尺寸。
 * 导演台「参数」面板与画布视频节点参数面板共用这一份（用户要求两处一致）。
 */
export function DirectorParamsControls({ params, onChange, subColor }: DirectorParamsControlsProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const aspect = String(params['aspect'] ?? '16:9');
  const scaleFactor = Number(params['scaleFactor'] ?? 1);
  const resolvedSize = resolveVideoSize(aspect, scaleFactor);
  const seedValue = Number(params['seed'] ?? -1);
  const lastSeed = useLastSeed();

  const setParam = (key: string, v: unknown) => onChange({ [key]: v });

  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } as const;
  const labelStyle = { fontSize: 11, color: subColor, flexShrink: 0 } as const;

  return (
    <>
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <span style={labelStyle}>{t('director.aspect', '视频比例')}</span>
        <AspectRatioPicker
          value={aspect}
          theme={theme}
          onChange={(v) => setParam('aspect', v)}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('director.scaleFactor', '尺寸系数')}</span>
        <InputNumber
          data-param-key="scaleFactor"
          aria-label={t('director.scaleFactor', '尺寸系数')}
          size="small"
          min={SCALE_FACTOR_MIN}
          max={SCALE_FACTOR_MAX}
          step={0.05}
          precision={2}
          prefix="×"
          value={scaleFactor}
          onChange={(v) => { if (typeof v === 'number' && Number.isFinite(v)) setParam('scaleFactor', v); }}
          onBlur={(e) => {
            const clamped = clampScaleFactor(e.target.value);
            if (clamped !== scaleFactor) setParam('scaleFactor', clamped);
          }}
          className="director-input-number"
          style={{ width: 120, height: 25 }}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('director.resolvedSize', '换算尺寸')}</span>
        <span data-resolved-size style={{ fontSize: 11, color: subColor, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {resolvedSize.width}×{resolvedSize.height}
        </span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('director.steps', '采样步数')}</span>
        <InputNumber
          data-param-key="steps"
          aria-label={t('director.steps', '采样步数')}
          size="small"
          min={1}
          max={200}
          step={1}
          value={Number(params['steps'] ?? 25)}
          onChange={(v) => { if (typeof v === 'number' && Number.isFinite(v)) setParam('steps', Math.min(200, Math.max(1, Math.round(v)))); }}
          className="director-input-number"
          style={{ width: 120, height: 25 }}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('director.seed', '种子')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            data-seed-random
            data-selected={seedValue < 0 ? 'true' : undefined}
            onClick={() => setParam('seed', -1)}
            style={{
              height: 25, padding: '0 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
              border: `1px solid ${seedValue < 0 ? theme.toolbar.accent : theme.toolbar.border}`,
              background: seedValue < 0 ? 'rgba(128,128,128,0.16)' : 'transparent',
              color: 'inherit',
            }}
          >
            {t('director.seedRandom', '随机')}
          </button>
          <InputNumber
            data-param-key="seed"
            aria-label={t('director.seed', '种子')}
            size="small"
            min={-1}
            max={0x7fffffff}
            step={1}
            precision={0}
            value={seedValue < 0 ? null : seedValue}
            placeholder={t('director.seedRandom', '随机')}
            onChange={(v) => setParam('seed', typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : -1)}
            className="director-input-number"
            style={{ width: 110, height: 25 }}
          />
        </div>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('director.lastSeed', '上次种子')}</span>
        {lastSeed == null ? (
          <span data-last-seed style={{ fontSize: 11, color: subColor }}>{t('director.lastSeedNone', '暂无')}</span>
        ) : (
          <button
            type="button"
            data-last-seed
            onClick={() => setParam('seed', lastSeed)}
            title={t('director.lastSeedReuse', '点击复用上次种子')}
            style={{
              border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
              fontSize: 11, color: subColor, fontVariantNumeric: 'tabular-nums',
            }}
          >
            {lastSeed}
          </button>
        )}
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('director.refImageSize', '参考图尺寸')}</span>
        <Select
          data-param-key="refImageSize"
          aria-label={t('director.refImageSize', '参考图尺寸')}
          size="small"
          value={String(params['refImageSize'] ?? 'match')}
          onChange={(v) => setParam('refImageSize', v)}
          options={REF_IMAGE_SIZE_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          className="director-select"
          popupClassName="director-select-popup"
          style={{ width: 160, height: 25 }}
        />
      </div>
    </>
  );
}

/** 「参数」浮层面板（导演台）：把 shared.params 接到共用控件上 */
export const DirectorParamsPanel = memo(function DirectorParamsPanel({
  shared,
  onSharedChange,
  subColor,
}: DirectorParamsPanelProps) {
  return (
    <div data-params-panel style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0', minWidth: 280 }}>
      <DirectorParamsControls
        params={shared.params}
        onChange={(patch) => onSharedChange({ params: { ...shared.params, ...patch } })}
        subColor={subColor}
      />
    </div>
  );
});

export interface DirectorParamsButtonProps {
  shared: WorkbenchSharedParams;
  onSharedChange: (patch: Partial<WorkbenchSharedParams>) => void;
  subColor: string;
  textColor?: string;
}

/**
 * 导轨「参数」按钮（无边框款，与 添加/链接/删除/批量 同款视觉权重）：
 * 2026-11-05 约定：参数按钮不出现外边线 —— 默认/hover/激活态均无 border/outline/
 * box-shadow 描边，只用 hover 背景色与开面板激活底色（绿 tint，对齐 RailIconButton active）
 * 体现可点；高 25、间距 6 与同排按钮一致。
 */
export const DirectorParamsButton = memo(function DirectorParamsButton({
  shared,
  onSharedChange,
  subColor,
  textColor = 'currentColor',
}: DirectorParamsButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // 无边框铁律（内联 + CSS 双保险）：任何态都不出现 border/outline/描边 box-shadow；
  // hover = 中性底色，开面板 = 绿 tint 激活（rgba(0,199,88,0.16)+#00c758，同 RailIconButton）。
  // 窄窗降级（容器 = 导轨工具行，containerName: railToolbar 在 multitrack 工具行声明）：
  // 先隐藏按钮文字（图标+title），「批量」始终可见；整行 overflowX auto 不换行。
  const btnCss = useMemo(() => `
    [data-params-trigger] { border: 0; outline: none; box-shadow: none; }
    [data-params-trigger]:hover { background: rgba(128,128,128,0.16); }
    [data-params-trigger][data-open="true"],
    [data-params-trigger][data-open="true"]:hover { background: rgba(0,199,88,0.16); color: #00c758; }
    @container railToolbar (max-width: 900px) {
      [data-btn-label] { display: none; }
      [data-params-trigger],[data-run-selected] { padding: 0 6px; }
    }
  `, []);

  return (
    <>
      <style>{btnCss}</style>
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger="click"
        placement="bottom"
        arrow={false}
        content={<DirectorParamsPanel shared={shared} onSharedChange={onSharedChange} subColor={subColor} />}
      >
        <button
          type="button"
          data-params-trigger
          data-open={open}
          title={t('director.params', '参数')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, height: 25, padding: '0 8px',
            borderRadius: 5, fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap', cursor: 'pointer',
            border: 0, outline: 'none', boxShadow: 'none', background: 'transparent', color: textColor,
          }}
        >
          <SlidersHorizontal size={12} />
          <span data-btn-label>{t('director.params', '参数')}</span>
        </button>
      </Popover>
    </>
  );
});

export interface DirectorRunButtonProps {
  /** 「运行」= 只跑当前激活片段（打开 dry-run 预检）；无激活片段时禁用 */
  runDisabled?: boolean;
  onRun: () => void;
  accentColor: string;
}

/** 导轨「运行」按钮（主行动 · 实心 accent）：渲染在「批量」右侧（顺序 …参数/批量/运行） */
export const DirectorRunButton = memo(function DirectorRunButton({
  runDisabled,
  onRun,
  accentColor,
}: DirectorRunButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-run-selected
      disabled={runDisabled}
      title={runDisabled ? t('director.runSelectedDisabled', '没有选中片段') : t('director.run', '运行当前片段')}
      onClick={onRun}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, height: 25, padding: '0 8px',
        borderRadius: 5, fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap',
        border: 'none', background: accentColor, color: '#fff',
        cursor: runDisabled ? 'not-allowed' : 'pointer',
        opacity: runDisabled ? 0.5 : 1,
      }}
    >
      <Play size={12} />
      <span data-btn-label>{t('director.run', '运行')}</span>
    </button>
  );
});
