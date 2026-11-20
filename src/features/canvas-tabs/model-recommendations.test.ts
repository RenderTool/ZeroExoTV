/**
 * 2026-11-20 事故：32B 文本编码器 bf16 是 48G 单文件，通用「≥24G 就推荐 bf16」的规则
 * 在 48G 卡上直接把整张卡占满（TE 49G staged + 主模型 20G + VAE 3G = 必 OOM）。
 * 档位必须按文件真实体积定：int8 26G → 32G 起；bf16 48G → 80G 起。
 */
import { describe, expect, it } from 'vitest';
import { isModelOverBudget, modelTier, pickPreferredModel } from './model-recommendations.js';

const CLIPS = [
  'qwen3vl_32b_minimax_h3_bf16.safetensors',
  'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
  'qwen3vl_4b_bf16.safetensors',
];

describe('pickPreferredModel：按显存下限挑，不许把 48G 卡压给 bf16 编码器', () => {
  it('48G 卡只选 int8 编码器，绝不选 48G 的 bf16', () => {
    expect(pickPreferredModel('clip', CLIPS, 48)).toBe('qwen3vl_32b_minimax_h3_int8_convrot.safetensors');
  });

  it('80G 卡才允许 bf16 编码器', () => {
    expect(pickPreferredModel('clip', CLIPS, 80)).toBe('qwen3vl_32b_minimax_h3_bf16.safetensors');
  });

  it('32G 以下没有可用 32B 编码器时不乱选', () => {
    expect(pickPreferredModel('clip', ['qwen3vl_32b_minimax_h3_int8_convrot.safetensors'], 24)).toBeUndefined();
  });

  it('显存未知时不自动选（宁可不选，也不猜）', () => {
    expect(pickPreferredModel('clip', CLIPS, null)).toBeUndefined();
  });

  it('本机只有超预算文件时不返回它们', () => {
    expect(pickPreferredModel('clip', ['qwen3vl_32b_minimax_h3_bf16.safetensors'], 48)).toBeUndefined();
  });
});

describe('isModelOverBudget：已选中的超预算模型要能被识别并降档', () => {
  it('48G 卡上选了 bf16 编码器 = 超预算', () => {
    expect(isModelOverBudget('clip', 'qwen3vl_32b_minimax_h3_bf16.safetensors', 48)).toBe(true);
    expect(isModelOverBudget('clip', 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', 48)).toBe(false);
  });

  it('非字典文件与显存未知都按“不超预算”放行', () => {
    expect(isModelOverBudget('clip', 'companyX_qwen3vl_h3_int8.safetensors', 8)).toBe(false);
    expect(isModelOverBudget('clip', 'qwen3vl_32b_minimax_h3_bf16.safetensors', null)).toBe(false);
  });

  it('档位文案带显存下限', () => {
    expect(modelTier('clip', 'qwen3vl_32b_minimax_h3_bf16.safetensors')?.minGb).toBe(80);
  });
});
