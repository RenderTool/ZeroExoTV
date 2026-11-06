/**
 * script-import-service — 剧本导入落盘编排（2026-11-04 重做做剧本导入·写盘层）
 *
 * 纪律：
 * - 唯一写者仍是 @/entities/script-store（writeScript + baseVersion 乐观并发）；
 *   本模块只做「读最新实体 → 按策略组装新 episodes → 交回 writeScript」，绝不绕过；
 * - 绝不写 graph / node.data；备份也只写 entities/backups/ 下的普通 JSON；
 * - 覆盖策略先备份后替换，备份失败抛 ScriptImportBackupError 并中止导入；
 * - ScriptConflictError 原样上抛（UI 提示「剧本已被其他会话修改，请重新导入」），
 *   不静默覆盖、不自动重试强写；
 * - 幂等：同一 projectId + 同一内容 + 同一策略的在途请求收敛到同一个 Promise
 *   （按钮 loading 锁之外的第二道闸，连点两次只落一次）。
 */

import { writeJson } from '@/platform/fs';
import {
  readScript, writeScript,
  nextEpisodeNumber, autoEpisodeTitle,
  type ScriptEntity, type ScriptEpisode,
} from '@/entities/script-store.js';
import type { ParsedScriptImport } from './script-import-parser.js';
import { scriptContentLength } from './script-import-parser.js';

export type ScriptImportStrategy = 'append' | 'overwrite' | 'new-episode';

export interface ScriptImportCommitRequest {
  projectId: string;
  parsed: ParsedScriptImport;
  strategy: ScriptImportStrategy;
  /** append/overwrite 的目标集；缺省用实体 activeEpisodeId */
  targetEpisodeId?: string;
  /** append 插入位置：默认 end（追加到末尾），可选 start（插入到开头） */
  position?: 'end' | 'start';
  /** 备份时间戳（测试注入用；默认取当前时间） */
  now?: Date;
}

export interface ScriptImportCommitResult {
  entity: ScriptEntity;
  strategy: ScriptImportStrategy;
  /** 本次写入影响的目标集（new-episode = 首个新建集） */
  targetEpisodeId: string;
  /** new-episode 策略实际新建的集 id 列表 */
  createdEpisodeIds: string[];
  /** 落盘后实体总集数 */
  episodeCount: number;
  /** 目标集字符数变化（new-episode 时 charBefore=0） */
  charBefore: number;
  charAfter: number;
  /** overwrite 策略的备份文件相对路径 */
  backupPath?: string;
}

export class ScriptImportBackupError extends Error {
  constructor(path: string, cause: unknown) {
    super(`覆盖前备份失败，已中止导入：${path}（${cause instanceof Error ? cause.message : String(cause)}）`);
    this.name = 'ScriptImportBackupError';
  }
}

// ---------- 备份 ----------

function backupTimestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function scriptBackupPath(projectId: string, episodeId: string, now: Date): string {
  return `projects/${projectId}/entities/backups/script-${episodeId}-${backupTimestamp(now)}.json`;
}

/** 覆盖前把整份实体快照写入 backups/；失败抛 ScriptImportBackupError，调用方中止导入 */
async function backupScriptEntity(projectId: string, entity: ScriptEntity, episodeId: string, now: Date): Promise<string> {
  const path = scriptBackupPath(projectId, episodeId, now);
  try {
    await writeJson(path, entity);
  } catch (err) {
    throw new ScriptImportBackupError(path, err);
  }
  return path;
}

// ---------- 内容拼接 ----------

/** 追加/插入拼接：两段都是 HTML 块（>…<）直接相接，否则补 \n 分隔；不动已有内容语义 */
function joinContent(existing: string, imported: string, position: 'end' | 'start'): string {
  if (!existing.trim()) return imported;
  if (!imported.trim()) return existing;
  const glue = existing.trimEnd().endsWith('>') && imported.trimStart().startsWith('<') ? '' : '\n';
  return position === 'start' ? `${imported}${glue}${existing}` : `${existing}${glue}${imported}`;
}

// ---------- 幂等在途去重 ----------

function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const inflight = new Map<string, Promise<ScriptImportCommitResult>>();

/**
 * 提交导入。相同请求（同项目/同策略/同目标/同内容哈希）在途时直接复用在途 Promise，
 * 连续两次点击只落盘一次。
 */
export function commitScriptImport(req: ScriptImportCommitRequest): Promise<ScriptImportCommitResult> {
  const key = [
    req.projectId, req.strategy, req.targetEpisodeId ?? '', req.position ?? 'end',
    hashText(req.parsed.htmlAll),
  ].join('|');
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = commitOnce(req).finally(() => {
    if (inflight.get(key) === task) inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}

async function commitOnce(req: ScriptImportCommitRequest): Promise<ScriptImportCommitResult> {
  const { projectId, parsed, strategy } = req;
  // 写前重读最新实体，baseVersion 取磁盘版本——冲突由 writeScript 抛 ScriptConflictError
  const entity = await readScript(projectId);
  if (!entity) throw new Error('剧本实体不存在，无法导入（请先在页签内初始化剧本）');

  if (strategy === 'new-episode') {
    let num = nextEpisodeNumber(entity.episodes);
    const created: ScriptEpisode[] = parsed.episodes.map((ep, i) => {
      const episode: ScriptEpisode = {
        id: `ep-${Date.now()}-${i}`,
        number: num,
        title: autoEpisodeTitle(num),
        content: ep.html,
        status: 'draft',
      };
      num += 1;
      return episode;
    });
    const firstCreated = created[0];
    if (!firstCreated) throw new Error('导入内容为空，未创建任何剧集');
    const next = await writeScript(projectId, {
      baseVersion: entity.version,
      episodes: [...entity.episodes, ...created],
      activeEpisodeId: firstCreated.id,
    });
    return {
      entity: next,
      strategy,
      targetEpisodeId: firstCreated.id,
      createdEpisodeIds: created.map((e) => e.id),
      episodeCount: next.episodes.length,
      charBefore: 0,
      charAfter: scriptContentLength(firstCreated.content),
    };
  }

  const targetId = req.targetEpisodeId || entity.activeEpisodeId || entity.episodes[0]?.id || '';
  const target = entity.episodes.find((e) => e.id === targetId);
  if (!target) throw new Error('未找到目标剧集，无法导入');

  if (strategy === 'overwrite') {
    // 先备份后替换；备份失败抛错，writeScript 不会执行
    const backupPath = await backupScriptEntity(projectId, entity, target.id, req.now ?? new Date());
    const charBefore = scriptContentLength(target.content);
    const replaced: ScriptEpisode = { ...target, content: parsed.htmlAll, status: 'draft' };
    const next = await writeScript(projectId, {
      baseVersion: entity.version,
      episodes: entity.episodes.map((e) => (e.id === target.id ? replaced : e)),
    });
    return {
      entity: next,
      strategy,
      targetEpisodeId: target.id,
      createdEpisodeIds: [],
      episodeCount: next.episodes.length,
      charBefore,
      charAfter: scriptContentLength(replaced.content),
      backupPath,
    };
  }

  // append：不重排、不删除已有内容，仅按位置拼接；空行规范由解析层完成
  const position = req.position ?? 'end';
  const charBefore = scriptContentLength(target.content);
  const mergedContent = joinContent(target.content, parsed.htmlAll, position);
  const merged: ScriptEpisode = { ...target, content: mergedContent };
  const next = await writeScript(projectId, {
    baseVersion: entity.version,
    episodes: entity.episodes.map((e) => (e.id === target.id ? merged : e)),
  });
  return {
    entity: next,
    strategy,
    targetEpisodeId: target.id,
    createdEpisodeIds: [],
    episodeCount: next.episodes.length,
    charBefore,
    charAfter: scriptContentLength(mergedContent),
  };
}
