/**
 * 「问AI」镜头信息（2026-11-10 用户要求）：
 * 复制出去的文本必须让任意 Agent 立刻定位到「哪个项目、哪一段」，
 * 并带上当前提示词与参数；定位方式写死 get_current_project + get_workbench。
 */
import { describe, expect, it } from 'vitest';
import { buildShotAiBrief } from './shot-ai-brief.js';
import type { WorkbenchShot } from '@/features/canvas-nodes/storyboard/workbench-types';
import type { WorkbenchSharedParams } from '@/entities/slot-containers';

const shot: WorkbenchShot = {
  id: 'shot-abc',
  number: 2,
  description: '老张推门进来',
  shotType: 'medium',
  duration: 6,
  imagePrompt: '古装室内，暖光，老张推门进屋，中景',
  videoPrompt: '推门动作，缓慢推进',
  negativePrompt: 'blurry',
  status: 'pending',
  clipState: 'placeholder',
  references: [
    { id: 'r1', kind: 'image', title: '老张定妆图' },
    { id: 'r2', kind: 'audio', title: '台词录音' },
  ],
  continuation: { enabled: true },
} as WorkbenchShot;

const shared: WorkbenchSharedParams = {
  enabled: true,
  assets: [],
  presetId: 'h3',
  params: { aspect: '16:9', scaleFactor: 1, steps: 8, cfg: 1, seed: 42, guide_frames: 22 },
};

describe('buildShotAiBrief', () => {
  it('带项目 id + shotId + 段号，Agent 能定位', () => {
    const text = buildShotAiBrief({ projectId: 'proj-1', shot, shotIndex: 1, totalShots: 5, shared });
    expect(text).toContain('shotId=shot-abc');
    expect(text).toContain('第 2 段 / 共 5 段');
    expect(text).toContain('proj-1');
    expect(text).toContain('get_current_project');
    expect(text).toContain('get_workbench');
  });

  it('带当前提示词、参考素材、公共参数与修改建议占位', () => {
    const text = buildShotAiBrief({ projectId: 'proj-1', shot, shotIndex: 1, totalShots: 5, shared });
    expect(text).toContain('古装室内');
    expect(text).toContain('2 个：');
    expect(text).toContain('老张定妆图');
    expect(text).toContain('比例 16:9');
    expect(text).toContain('步数 8');
    expect(text).toContain('【我的修改建议】');
  });

  it('空提示词也要显式写（空），不能留白让 Agent 猜', () => {
    const text = buildShotAiBrief({
      projectId: 'p', shot: { ...shot, imagePrompt: undefined, videoPrompt: undefined }, shotIndex: 0, totalShots: 1,
    });
    expect(text).toContain('（空）');
  });
});
