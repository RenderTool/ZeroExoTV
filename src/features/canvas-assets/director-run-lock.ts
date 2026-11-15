/**
 * 当前这批正在生成/已排队的分镜 id。
 * 抽屉替换视频源时，不仅生成中的段要锁，整批里已经完成的段也要锁，
 * 否则后续段还在跑时换掉前面的封面会打乱版本/guide。
 */
let locked = new Set<string>();

export function setLockedShotIds(ids: Iterable<string>): void {
  locked = new Set(ids);
}

export function clearLockedShotIds(): void {
  locked = new Set();
}

export function isShotLocked(id: string | undefined): boolean {
  return !!id && locked.has(id);
}
