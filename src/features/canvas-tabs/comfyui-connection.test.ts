/**
 * 云端/第三方模型仓库常把 LTX、Wan 的 VAE 排在最前；默认挑选必须只认 MiniMax H3，
 * 不能因为文件名里带 video/audio 就选中普通 VAE。
 */
import { describe, expect, it } from 'vitest';
import { pickDefaultModels } from './comfyui-connection.js';

const empty = { unet: '', videoVae: '', audioVae: '', clip: '' };

describe('pickDefaultModels：只挑 MiniMax H3 兼容版本', () => {
  it('VAE 列表混入 LTX/Wan 时，仍优先 MiniMax H3 专用 VAE', () => {
    const picked = pickDefaultModels({
      unet: ['wan2.2_t2v.safetensors', 'minimax_h3_hybrid_fl2va_ref2va_b15-49-int8.safetensors'],
      vae: [
        'LTX23_video_vae_bf16.safetensors',
        'LTX23_audio_vae_bf16.safetensors',
        'Wan2_1_VAE_bf16.safetensors',
        'minimax_h3_video_vae_fp16.safetensors',
        'minimax_h3_audio_vae_fp32.safetensors',
      ],
      clip: ['t5xxl_fp16.safetensors', 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors'],
    }, empty);
    expect(picked.unet).toContain('minimax_h3');
    expect(picked.videoVae).toBe('minimax_h3_video_vae_fp16.safetensors');
    expect(picked.audioVae).toBe('minimax_h3_audio_vae_fp32.safetensors');
    expect(picked.clip).toBe('qwen3vl_32b_minimax_h3_int8_convrot.safetensors');
  });

  it('当前选中的是普通 VAE 时不保留，改为 H3 版本', () => {
    const picked = pickDefaultModels({
      unet: ['minimax_h3_ref2va_int8_convrot.safetensors'],
      vae: ['LTX23_video_vae_bf16.safetensors', 'minimax_h3_video_vae_int8_convrot.safetensors'],
      clip: ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],
    }, { ...empty, videoVae: 'LTX23_video_vae_bf16.safetensors' });
    expect(picked.videoVae).toBe('minimax_h3_video_vae_int8_convrot.safetensors');
  });

  it('没有 H3 兼容 VAE 时留空，交给用户明确选择（不静默选普通 VAE）', () => {
    const picked = pickDefaultModels({
      unet: ['minimax_h3_ref2va_int8_convrot.safetensors'],
      vae: ['LTX23_video_vae_bf16.safetensors', 'Wan2_1_VAE_bf16.safetensors'],
      clip: ['qwen3vl_32b_minimax_h3_int8_convrot.safetensors'],
    }, empty);
    expect(picked.videoVae).toBe('');
    expect(picked.audioVae).toBe('');
  });

  it('第三方量化版只要文件名带 h3 也能识别', () => {
    const picked = pickDefaultModels({
      unet: ['MiniMaxH3_hybrid_int8_companyX.safetensors'],
      vae: ['companyX_h3_video_vae_int8.safetensors', 'companyX_h3_audio_vae_int8.safetensors'],
      clip: ['companyX_qwen3vl_h3_int8.safetensors'],
    }, empty);
    expect(picked.videoVae).toBe('companyX_h3_video_vae_int8.safetensors');
    expect(picked.audioVae).toBe('companyX_h3_audio_vae_int8.safetensors');
    expect(picked.clip).toBe('companyX_qwen3vl_h3_int8.safetensors');
  });
});
