/**
 * LoRA 推荐清单守护（2026-11-21 用户截图口径）
 *
 * 断言：
 * 1. 清单里的文件名/强度必须是用户截图里给的那几组（不许凭感觉改）；
 * 2. 组合顺序 = 串联顺序（先 realism-people，再 电影镜头）；
 * 3. 本机缺文件时套用必须失败并报出缺哪些，不许静默截断；
 * 4. 不预勾：清单只是数据，是否启用只由勾选/套用决定。
 */
import { describe, expect, it } from 'vitest';
import {
  LORA_PRESETS,
  LORA_PRESET_DIALOGUE_COMBO,
  LORA_PRESET_LOCAL_8STEP_R2V,
  LORA_PRESET_TURBO_4STEP_FL2V,
  loraPresetById,
  missingPresetFiles,
  presetToRows,
} from '../director-lora-presets';
import { MAX_LORAS } from '../director-lora';

const TURBO = 'minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors';
const REALISM = 'h3-realism-people-t2v-i2v-r2v.safetensors';
const LENS = '电影镜头_000019000.safetensors';
const LOCAL8 = 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors';

describe('director-lora-presets 推荐清单', () => {
  it('三条推荐：官方 4 步 / 文戏组合 / 本机 8 步，文件名与截图一致', () => {
    expect(LORA_PRESETS).toHaveLength(3);
    const turbo = loraPresetById(LORA_PRESET_TURBO_4STEP_FL2V)!;
    expect(turbo.items.map((i) => i.name)).toEqual([TURBO]);
    expect(turbo.items[0]!.strength).toBe(0.7);

    const combo = loraPresetById(LORA_PRESET_DIALOGUE_COMBO)!;
    expect(combo.items.map((i) => `${i.name}@${i.strength}`)).toEqual([`${REALISM}@0.8`, `${LENS}@0.3`]);
    expect(combo.caveat).toContain('r34l1sm');

    const local = loraPresetById(LORA_PRESET_LOCAL_8STEP_R2V)!;
    expect(local.items.map((i) => i.name)).toEqual([LOCAL8]);
    expect(local.items[0]!.strength).toBe(1.0);
  });

  it('每条推荐都必须有强项描述，且强度在 0–2、条数不超上限', () => {
    for (const preset of LORA_PRESETS) {
      // 2026-11-22 用户口径：卡片文案要短。强项一句 ≤ 60 字，注意一句 ≤ 46 字，不写小作文。
      expect(preset.strengths.trim().length).toBeGreaterThan(0);
      expect(preset.strengths.length).toBeLessThanOrEqual(60);
      if (preset.caveat) expect(preset.caveat.length).toBeLessThanOrEqual(46);
      expect(preset.items.length).toBeGreaterThan(0);
      expect(preset.items.length).toBeLessThanOrEqual(MAX_LORAS);
      for (const item of preset.items) {
        expect(item.name.endsWith('.safetensors')).toBe(true);
        expect(item.strength).toBeGreaterThan(0);
        expect(item.strength).toBeLessThanOrEqual(2);
        expect(item.role.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('本机缺文件：套用失败并点名缺哪个（不静默跳过）', () => {
    const combo = loraPresetById(LORA_PRESET_DIALOGUE_COMBO)!;
    const missing = missingPresetFiles(combo, [LOCAL8]);
    expect(missing).toEqual([REALISM, LENS]);
    const res = presetToRows(combo, [REALISM]); // 只下了一条
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toContain(LENS);
    expect(res.reason).not.toContain(REALISM);
  });

  it('本机齐全：套用得到顺序正确的 rows（顺序 = 串联顺序）', () => {
    const combo = loraPresetById(LORA_PRESET_DIALOGUE_COMBO)!;
    const res = presetToRows(combo, [REALISM, LENS, LOCAL8]);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.rows).toEqual([
      { name: REALISM, strength: 0.8 },
      { name: LENS, strength: 0.3 },
    ]);
  });

  it('清单本身不产生选中态：preset 只是数据，不返回任何「默认勾选」', () => {
    // 结构性守护：preset 上没有 enabled/checked 之类字段（启用只能来自用户勾选/套用）
    for (const preset of LORA_PRESETS) {
      expect(Object.keys(preset)).not.toContain('checked');
      expect(Object.keys(preset)).not.toContain('enabled');
      expect(Object.keys(preset)).not.toContain('default');
    }
  });

  it('4 步档的注意必须把步数当决定项，禁止写「糊 / 弱于 8 步」这种定论（2026-11-22 口径）', () => {
    const turbo = loraPresetById(LORA_PRESET_TURBO_4STEP_FL2V)!;
    const caveat = turbo.caveat ?? '';
    expect(caveat).toContain('步数才是决定项');
    expect(caveat).not.toContain('糊');
    expect(caveat).not.toContain('弱于 8 步');
    expect(caveat).not.toContain('降');
  });
});
