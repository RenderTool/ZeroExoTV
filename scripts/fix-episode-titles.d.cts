/** scripts/fix-episode-titles.cjs 的类型声明（vitest 对照测试 import 用；规则镜像 script-store） */
export function autoEpisodeTitle(number: number): string;
export function isDefaultEpisodeTitle(title: string | null | undefined, number: number): boolean;
export function isDirtyEpisodeTitle(title: string | null | undefined, number: number): boolean;
export function repairPlan(
  episodes: ReadonlyArray<{ id: string; number: number; title: string }>,
): Array<{ episodeId: string; from: string; to: string }>;
