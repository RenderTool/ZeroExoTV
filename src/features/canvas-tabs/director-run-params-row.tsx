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
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InputNumber, Popover, Select } from 'antd';
import { Play, SlidersHorizontal } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { AspectRatioPicker } from '@/features/generator-settings/aspect-ratio-picker.js';
import { useLastSeed } from '@/shared/last-seed-store.js';
import { MAX_LORAS, normalizeLoras, type LoraRow } from '@/entities/director-lora.js';
import { fetchBridgeModels } from './comfyui-bridge-client.js';
import { useComfyuiConnectionStore } from './comfyui-connection.js';
import { useComfyuiEndpointStore } from './comfyui-endpoint.js';
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
 * 出片预设（2026-11-20 用户定稿）：只负责「填充参数」，点完用户照样能手动改。
 * 预览 8 步 / ×0.4 / 参考图 match；中等 12 步 / ×0.8 / max；成片 15 步 / ×1.0 / max。
 * 不碰比例、种子这两个跟画质无关的项。
 */
export const QUALITY_PRESETS = [
  { id: 'preview', label: '预览', steps: 8, scaleFactor: 0.4, refImageSize: 'match' },
  { id: 'standard', label: '中等', steps: 12, scaleFactor: 0.8, refImageSize: 'max' },
  { id: 'final', label: '成片', steps: 15, scaleFactor: 1.0, refImageSize: 'max' },
] as const;

export type QualityPresetId = (typeof QUALITY_PRESETS)[number]['id'];

/** 视频主模型推荐标签：只按文件名命中，标在选项上，绝不替用户选 */
const RECOMMENDED_UNET: Record<string, string> = {
  'minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors': '48G 及以下推荐',
  'minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors': '8G 推荐',
  'minimax_h3_hybrid_fl2va_ref2va_b30-49-bf16.safetensors': '需 ≥80G 显存',
  'minimax_h3_hybrid_fl2va_ref2va_b25-49-bf16.safetensors': '需 ≥48G 显存',
  'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors': '24G 以上推荐',
};

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
  /** 高级参数（2026-11-20）：视频主模型走连接面板同一份选择，LoRA 多行存 params.loras */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const connModels = useComfyuiConnectionStore((s) => s.models);
  const availableModels = useComfyuiConnectionStore((s) => s.availableModels);
  const setModel = useComfyuiConnectionStore((s) => s.setModel);
  const setConnected = useComfyuiConnectionStore((s) => s.setConnected);
  const connToken = useComfyuiConnectionStore((s) => s.token);
  const endpoint = useComfyuiEndpointStore((s) => s.address);
  const loras = normalizeLoras(params['loras']);
  const setLoras = (next: LoraRow[]) => setParam('loras', next);
  const updateLora = (index: number, patch: Partial<LoraRow>) => {
    setLoras(loras.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  /**
   * 展开时若还没有清单：主动拉一次（和「模型映射」同一个接口）。
   * 旧插件没有 lora 字段 → 明确提示要升级插件，不给假清单。
   */
  useEffect(() => {
    if (!advancedOpen) return;
    if (availableModels.unet.length > 0 && availableModels.lora.length > 0) return;
    if (!endpoint) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchBridgeModels(endpoint.replace(/\/+$/, ''), connToken || undefined);
        if (!cancelled && res.ok) {
          setConnected(true, { unet: res.unet, vae: res.vae, clip: res.clip, lora: res.lora ?? [] });
        }
      } catch {
        /* 清单拉不到：保持空，由提示语说明 */
      }
    })();
    return () => { cancelled = true; };
  }, [advancedOpen, endpoint, connToken, availableModels.unet.length, availableModels.lora.length, setConnected]);
  const loraHint = availableModels.lora.length === 0
    ? (
      <span style={{ fontSize: 10, color: subColor }}>
        {t('director.loraNotLoadedHint', '云端插件没有返回 LoRA 清单（旧版插件），升级插件后这里才能下拉选；现在留空 = 模板默认 8 步 turbo。')}
      </span>
    )
    : loras.length > 1
      ? (
        <span style={{ fontSize: 10, color: subColor }}>
          {t('director.loraMultiHint', '多条 LoRA 会按从上到下的顺序串联，显存与耗时都会涨。')}
        </span>
      )
      : null;

  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } as const;
  const labelStyle = { fontSize: 11, color: subColor, flexShrink: 0 } as const;

  return (
    <>
      <div style={{ ...rowStyle, gap: 6 }}>
        <span style={labelStyle}>{t('director.qualityPreset', '预设')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
          {QUALITY_PRESETS.map((preset) => {
            const active =
              Number(params['steps'] ?? 8) === preset.steps
              && Number(params['scaleFactor'] ?? 1) === preset.scaleFactor
              && String(params['refImageSize'] ?? 'match') === preset.refImageSize;
            return (
              <button
                key={preset.id}
                type="button"
                data-quality-preset={preset.id}
                data-selected={active ? 'true' : undefined}
                title={`${preset.steps} 步 · ×${preset.scaleFactor} · ${preset.refImageSize}`}
                onClick={() => onChange({
                  steps: preset.steps,
                  scaleFactor: preset.scaleFactor,
                  refImageSize: preset.refImageSize,
                })}
                style={{
                  height: 25, padding: '0 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
                  border: `1px solid ${active ? theme.toolbar.accent : theme.toolbar.border}`,
                  background: active ? 'rgba(128,128,128,0.16)' : 'transparent',
                  color: 'inherit',
                }}
              >
                {t(`director.qualityPreset_${preset.id}`, preset.label)}
              </button>
            );
          })}
        </div>
      </div>
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
          value={Number(params['steps'] ?? 8)}
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
      {/*
        高级参数（2026-11-20 用户口径）：视频主模型与 LoRA 都要在参数面板里放一份，
        但收进「高级」折叠，默认不打扰。LoRA 和模型一样「先拉清单 → 下拉选 → 带强度」，
        支持多条串联（ComfyUI 里就是多个 LoraLoaderModelOnly 逐节 patch MODEL）。
      */}
      <div style={{ ...rowStyle, paddingTop: 4 }}>
        <button
          type="button"
          data-advanced-toggle
          data-open={advancedOpen ? 'true' : undefined}
          onClick={() => setAdvancedOpen((v) => !v)}
          style={{
            flex: 1, height: 26, borderRadius: 5, fontSize: 11, cursor: 'pointer',
            border: `1px solid ${theme.toolbar.border}`, background: advancedOpen ? 'rgba(128,128,128,0.16)' : 'transparent',
            color: 'inherit', textAlign: 'left', padding: '0 10px',
          }}
        >
          {advancedOpen ? '▾ ' : '▸ '}{t('director.advanced', '高级参数（视频主模型 / LoRA）')}
        </button>
      </div>
      {advancedOpen ? (
        <div data-advanced-panel style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 2 }}>
          <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <span style={labelStyle}>{t('director.videoModel', '视频主模型')}</span>
            <Select
              data-param-key="unet"
              aria-label={t('director.videoModel', '视频主模型')}
              size="small"
              value={connModels.unet || undefined}
              placeholder={availableModels.unet.length ? t('director.pickModel', '选一个本机模型') : t('director.modelsNotLoaded', '清单未加载，先在「模型映射」里刷新')}
              options={availableModels.unet.map((name) => ({
                value: name,
                label: `${name}${RECOMMENDED_UNET[name] ? ` · ${RECOMMENDED_UNET[name]}` : ''}`,
              }))}
              onChange={(v) => { setModel('unet', v); setParam('unet', v); }}
              className="director-select"
              popupClassName="director-select-popup"
              style={{ width: '100%', height: 25 }}
            />
          </div>
          <div style={{ ...rowStyle, alignItems: 'baseline' }}>
            <span style={labelStyle}>{t('director.loraList', 'LoRA 串联')}</span>
            <span style={{ fontSize: 10, color: subColor }}>
              {loras.length}/{MAX_LORAS}
            </span>
          </div>
          {loraHint}
          {loras.map((lora, i) => (
            <div key={i} data-lora-row style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Select
                data-param-key={`lora_${i}`}
                aria-label={`LoRA ${i + 1}`}
                size="small"
                value={lora.name || undefined}
                placeholder={availableModels.lora.length ? t('director.pickLora', '选 LoRA 文件') : t('director.loraNotLoaded', '插件未返回 LoRA 清单')}
                options={availableModels.lora.map((name) => ({ value: name, label: name }))}
                onChange={(v) => updateLora(i, { name: v })}
                className="director-select"
                popupClassName="director-select-popup"
                style={{ flex: 1, height: 25 }}
              />
              <InputNumber
                data-param-key={`lora_strength_${i}`}
                aria-label={`LoRA ${i + 1} 强度`}
                size="small"
                min={0}
                max={2}
                step={0.05}
                precision={2}
                value={lora.strength}
                onChange={(v) => { if (typeof v === 'number' && Number.isFinite(v)) updateLora(i, { strength: v }); }}
                className="director-input-number"
                style={{ width: 78, height: 25 }}
              />
              <button
                type="button"
                data-lora-remove={i}
                onClick={() => setLoras(loras.filter((_, idx) => idx !== i))}
                title={t('director.removeLora', '删除这条 LoRA')}
                style={{
                  height: 25, width: 26, borderRadius: 5, cursor: 'pointer', fontSize: 12,
                  border: `1px solid ${theme.toolbar.border}`, background: 'transparent', color: 'inherit',
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            data-lora-add
            disabled={loras.length >= MAX_LORAS || availableModels.lora.length === 0}
            onClick={() => setLoras([...loras, { name: availableModels.lora[0] ?? '', strength: 1 }])}
            style={{
              height: 25, borderRadius: 5, fontSize: 11, cursor: loras.length >= MAX_LORAS ? 'not-allowed' : 'pointer',
              border: `1px dashed ${theme.toolbar.border}`, background: 'transparent', color: 'inherit',
              opacity: loras.length >= MAX_LORAS || availableModels.lora.length === 0 ? 0.5 : 1,
            }}
          >
            {t('director.addLora', '+ 添加 LoRA（按顺序串联）')}
          </button>
        </div>
      ) : null}
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
