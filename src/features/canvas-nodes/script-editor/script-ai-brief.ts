/**
 * script-ai-brief — 剧本「问AI」复制内容（2026-11-12 用户要求）
 *
 * 与导演台片段「问AI」同一用途：把「哪一集、什么内容、要改什么」整理成一段可直接粘给
 * 任意 LLM Agent 的文本，Agent 用 MCP 的 get_current_project / get_script 就能定位并修改。
 */
import type { Episode } from '../storyboard/script-types';

export interface ScriptAiBriefInput {
  projectId?: string;
  projectTitle?: string;
  episode: Episode;
  episodeIndex: number;
  totalEpisodes: number;
  /** 本集纯文本（HTML 已转纯文本），给 AI 完整上下文 */
  plainText: string;
}

export function buildScriptAiBrief(input: ScriptAiBriefInput): string {
  const { projectId, projectTitle, episode, episodeIndex, totalEpisodes, plainText } = input;
  const lines: string[] = [
    '请先调用 get_current_project 确认当前项目，再用 get_script 读取剧本；只改下面这一集，不要动其他集。',
    '',
    `项目：${projectId ?? '（当前打开的项目）'}${projectTitle ? `（${projectTitle}）` : ''}`,
    `集数：第 ${episodeIndex + 1} / ${totalEpisodes} 集（episodeId=${episode.id}）`,
    `集标题：${episode.title?.trim() || '（未命名）'}`,
    '',
    '【当前剧本（纯文本）】',
    plainText.trim() || '（空）',
    '',
    '【修改要求】',
    '按我随后给出的修改意见修改这一集；保持标准剧本格式：',
    '### 第N场：场景 · 内/外 · 日/夜',
    '动作行（直接写画面与动作）',
    '角色：台词（全角冒号；同一角色名全片逐字一致）',
    '',
    '只输出修改后的这一集剧本正文，不要解说、不要 Markdown 代码块；',
    '不要新增/删除场次以外的无关内容，不要改变事件链和人物关系。',
  ];
  return lines.join('\n');
}
