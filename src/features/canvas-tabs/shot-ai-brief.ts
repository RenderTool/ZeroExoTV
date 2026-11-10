/**
 * shot-ai-brief — 「问AI」复制的镜头信息（2026-11-10 用户要求）
 *
 * 目的：用户在导演台选中某个片段，点「问AI」复制一段文本，粘给任意 LLM Agent 后，
 * Agent 能立刻定位到「哪个项目、哪一段、当前提示词和参数」，再按用户随后的修改建议改这一段。
 * 文本里必须带 projectId + shotId，并要求 Agent 走 get_current_project / get_workbench。
 */
import type { WorkbenchShot } from '@/features/canvas-nodes/storyboard/workbench-types';
import type { WorkbenchSharedParams } from '@/entities/slot-containers';

export interface ShotAiBriefInput {
  projectId: string;
  projectTitle?: string;
  shot: WorkbenchShot;
  shotIndex: number;
  totalShots: number;
  shared?: WorkbenchSharedParams;
}

export function buildShotAiBrief(input: ShotAiBriefInput): string {
  const { projectId, projectTitle, shot, shotIndex, totalShots, shared } = input;
  const p = (shared?.params ?? {}) as Record<string, unknown>;
  const aspect = typeof p.aspect === 'string' ? p.aspect : undefined;
  const scaleFactor = p.scaleFactor ?? p.scale_factor;
  const steps = p.steps;
  const seed = p.seed;
  const cfg = p.cfg;
  const guideFrames = p.guide_frames;
  const refs = shot.references ?? [];
  const refText = refs.length > 0
    ? refs.map((r, i) => `${i + 1}. ${r.kind ?? '素材'}${r.title ? `：${r.title}` : ''}`).join('；')
    : '无';

  const lines = [
    '请先调用 get_current_project 确认当前项目，再用 get_workbench 读取下面这个项目，',
    `定位到 shotId=${shot.id} 的片段（第 ${shotIndex + 1}/${totalShots} 段），只改这一段，不要动其它片段。`,
    '',
    `项目：${projectId}${projectTitle ? `（${projectTitle}）` : ''}`,
    `镜头：第 ${shot.number} 段 / 共 ${totalShots} 段（shotId=${shot.id}）`,
    `时长：${shot.duration}s`,
    `状态：${shot.status}${shot.clipState ? ` · ${shot.clipState}` : ''}`,
    '',
    '【当前画面提示词】',
    shot.imagePrompt?.trim() || '（空）',
    '',
    '【当前视频/运动提示词】',
    shot.videoPrompt?.trim() || '（空）',
  ];
  if (shot.negativePrompt?.trim()) {
    lines.push('', '【负面提示词】', shot.negativePrompt.trim());
  }
  lines.push('', '【参考素材】', `${refs.length} 个：${refText}`);
  lines.push('', '【段间引导】', shot.guide?.id
    ? `有（${shot.guide.id}${shot.guide.frames ? ` · ${shot.guide.frames} 帧` : ''}）`
    : `无（片段开关：${shot.continuation?.enabled ? '开' : '关'}）`);
  lines.push('', '【公共参数】', [
    `档位 ${shared?.presetId ?? '-'}`,
    aspect ? `比例 ${aspect}` : null,
    scaleFactor !== undefined ? `系数 ${String(scaleFactor)}` : null,
    steps !== undefined ? `步数 ${String(steps)}` : null,
    cfg !== undefined ? `cfg ${String(cfg)}` : null,
    seed !== undefined ? `种子 ${String(seed)}` : null,
    guideFrames !== undefined ? `引导帧 ${String(guideFrames)}` : null,
  ].filter(Boolean).join(' · '));
  lines.push(
    '',
    '【我的修改建议】',
    '（在这里写：改什么、保留什么；如果要改提示词请直接给最终提示词。）',
  );
  return lines.join('\n');
}
