/**
 * global-style — 全剧风格写入口（2026-11-13）
 *
 * 风格是**全剧设定**：script.meta.visualStyle 存快照；保存时同步改写所有主体/状态提示词的风格块。
 * 本文件是 UI（本剧信息 / 主体状态面板）共用的唯一写入路径，不各自拼一套。
 */
import {
  readScript, writeScript, type ScriptVisualStyle,
} from '@/entities/script-store.js';
import { readStoryboardContainer, updateStoryboardContainer } from '@/entities/slot-containers.js';
import { applyStylePromptToPrompt, stylePresetPrompt, type StylePreset } from '@/shared/style-presets.js';

export interface SaveGlobalStyleResult {
  visualStyle: ScriptVisualStyle;
  /** 被改写的状态提示词数量 */
  synced: number;
}

/** 把所有主体/状态提示词的风格块统一改写为给定片段；返回受影响数量 */
export async function rewriteSubjectPrompts(projectId: string, stylePrompt: string): Promise<number> {
  if (!stylePrompt.trim()) return 0;
  let synced = 0;
  try {
    const sb = await readStoryboardContainer(projectId);
    const trees = Array.isArray(sb?.subjectTree)
      ? (sb.subjectTree as Array<{ states?: Array<Record<string, unknown>> }>)
      : [];
    const nextTrees = trees.map((tr) => ({
      ...tr,
      states: (tr.states ?? []).map((st) => {
        const prompt = String(st.fullPrompt ?? st.deltaPrompt ?? '');
        if (!prompt.trim()) return st;
        const applied = applyStylePromptToPrompt(prompt, stylePrompt);
        if (applied === prompt) return st;
        synced += 1;
        return { ...st, fullPrompt: applied, deltaPrompt: applied };
      }),
    }));
    if (synced > 0) await updateStoryboardContainer(projectId, { subjectTree: nextTrees });
  } catch { /* 提示词同步失败不阻断 meta 写入；调用方提示用户重试 */ }
  return synced;
}

/** 选中一套风格 → 写 meta + 统一改写主体提示词；返回受影响数量 */
export async function saveGlobalStyle(projectId: string, preset: StylePreset): Promise<SaveGlobalStyleResult> {
  const script = await readScript(projectId);
  if (!script) throw new Error('剧本不存在，无法设置全剧风格');
  const visualStyle: ScriptVisualStyle = {
    presetId: preset.id,
    name: preset.nameZh,
    prompt: stylePresetPrompt(preset),
    image: preset.image,
  };
  await writeScript(projectId, {
    baseVersion: script.version,
    meta: { ...(script.meta ?? {}), visualStyle },
  });
  const synced = await rewriteSubjectPrompts(projectId, visualStyle.prompt);
  return { visualStyle, synced };
}
