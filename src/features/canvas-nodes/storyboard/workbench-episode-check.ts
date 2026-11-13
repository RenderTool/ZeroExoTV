/**
 * workbench-episode-check — 导演台「本集检查」（2026-11-13）
 *
 * 用户界面只讲人话：这一集还差什么、点一下能定位到哪一段。
 * 不出现 sceneId / camera / REF 槽位 / 同义重复 这类工程术语；
 * 那些结构留在内部，新手只需要知道「能不能出片、还缺什么」。
 */
import type { WorkbenchShot } from './workbench-types';

export interface EpisodeCheckIssue {
  key: 'image' | 'video' | 'reference' | 'duration';
  /** 给用户看的短句（不出现字段名/错误码） */
  label: string;
  count: number;
  shotIds: string[];
}

export interface EpisodeCheckResult {
  shotCount: number;
  durationSec: number;
  issues: EpisodeCheckIssue[];
  ready: boolean;
}

const MIN_SEC = 5;
const MAX_SEC = 15;

function idsOf(shots: readonly WorkbenchShot[]): string[] {
  return shots.map((s) => s.id);
}

/** 纯函数：本集片段 → 用户能看懂的三五条结论 */
export function buildEpisodeCheck(shots: readonly WorkbenchShot[]): EpisodeCheckResult {
  const list = shots.filter((s) => s && typeof s === 'object');
  const missingImage = list.filter((s) => !String(s.imagePrompt ?? '').trim());
  const missingVideo = list.filter((s) => !String(s.videoPrompt ?? '').trim());
  const noRefs = list.filter((s) => (s.references ?? []).length === 0);
  const badDuration = list.filter((s) => !(s.duration >= MIN_SEC && s.duration <= MAX_SEC));

  const issues: EpisodeCheckIssue[] = [];
  if (missingImage.length > 0) {
    issues.push({ key: 'image', label: '还没写画面提示词', count: missingImage.length, shotIds: idsOf(missingImage) });
  }
  if (missingVideo.length > 0) {
    issues.push({ key: 'video', label: '还没写视频提示词', count: missingVideo.length, shotIds: idsOf(missingVideo) });
  }
  if (noRefs.length > 0) {
    issues.push({ key: 'reference', label: '还没有参考图', count: noRefs.length, shotIds: idsOf(noRefs) });
  }
  if (badDuration.length > 0) {
    issues.push({ key: 'duration', label: `时长不在 ${MIN_SEC}–${MAX_SEC} 秒`, count: badDuration.length, shotIds: idsOf(badDuration) });
  }

  return {
    shotCount: list.length,
    durationSec: list.reduce((sum, s) => sum + (Number(s.duration) || 0), 0),
    issues,
    ready: issues.length === 0,
  };
}
