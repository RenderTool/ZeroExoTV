/**
 * shot-quality-check — 分镜提示词质量闸门（2026-11-19 用户要求）
 *
 * 检查「提示词里的 @PictureN / <Subject N> 块」与「本段实际槽位」是否一一对得上：
 * - 悬空引用：@Picture5 但本段只有 4 个图片槽 → error（生成必错位）
 * - 主体块与槽位名不符：<Subject 5> 说米拉，@Picture5 指向布布 → error
 * - 重复主体块：两个 Subject 指向同一槽号 → error
 * - 空提示词 → error；场景图存在但提示词没引用 → warn
 *
 * 生成前必须 0 error 才允许提交；UI 用同一份结果做徽标提示，禁止各算一套。
 */
export type ShotQualityCode =
  | 'EMPTY_PROMPT'
  | 'DANGLING_REF'
  | 'SLOT_MISMATCH'
  | 'DUP_SUBJECT_BLOCK'
  | 'SCENE_UNREFERENCED'
  | 'NO_ACTION_BEAT'
  | 'CAST_NOT_IN_SCENE'
  | 'SUBJECT_NOT_IN_BODY';

export interface ShotQualityIssue {
  level: 'error' | 'warn';
  code: ShotQualityCode;
  message: string;
}

interface ShotRefLike {
  id?: string;
  kind?: string;
  title?: string;
  slotNo?: number;
  storageKey?: string;
  url?: string;
}

interface ShotLike {
  imagePrompt?: string;
  references?: ShotRefLike[];
}

const LABEL_KIND: Record<string, string> = { Picture: 'image', Audio: 'audio', Video: 'video' };

/** 槽位表：`kind:N` → 标题（去重，同一 id 只占一格） */
export function buildSlotMap(refs: ShotRefLike[] | undefined): Map<string, string> {
  const seen = new Set<string>();
  const slots = new Map<string, string>();
  let auto = { image: 0, audio: 0, video: 0 } as Record<string, number>;
  for (const r of refs ?? []) {
    const kind = r.kind ?? 'image';
    const key = `${r.id ?? ''}|${r.storageKey ?? r.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let slot = typeof r.slotNo === 'number' && r.slotNo >= 1 ? r.slotNo : undefined;
    if (!slot) {
      auto[kind] = (auto[kind] ?? 0) + 1;
      slot = auto[kind];
    }
    slots.set(`${kind}:${slot}`, r.title ?? r.id ?? '');
  }
  return slots;
}

/** 标题 → 实体名（「米拉-定妆」→「米拉」，「钟楼广场-概念图」→「钟楼广场」） */
function entityName(title: string): string {
  return title.split('-')[0]!.trim();
}

export function checkShotPrompt(shot: ShotLike): ShotQualityIssue[] {
  const issues: ShotQualityIssue[] = [];
  const prompt = shot.imagePrompt ?? '';
  const slots = buildSlotMap(shot.references);
  const counts = { Picture: 0, Audio: 0, Video: 0 } as Record<string, number>;
  for (const k of slots.keys()) {
    const label = k.split(':')[0]!;
    const labelKey = label === 'image' ? 'Picture' : label === 'audio' ? 'Audio' : 'Video';
    counts[labelKey] = (counts[labelKey] ?? 0) + 1;
  }

  if (!prompt.trim()) {
    issues.push({ level: 'error', code: 'EMPTY_PROMPT', message: '提示词为空，无法生成' });
    return issues;
  }

  // 1) 悬空引用
  for (const m of prompt.matchAll(/@(Picture|Audio|Video)(\d+)/g)) {
    const label = m[1]!;
    const n = Number(m[2]);
    const kind = LABEL_KIND[label]!;
    if (!slots.has(`${kind}:${n}`)) {
      issues.push({
        level: 'error',
        code: 'DANGLING_REF',
        message: `@${label}${n} 在本段没有对应槽位（当前 ${counts[label] ?? 0} 个）`,
      });
    }
  }

  // 2) 主体块：槽号必须唯一，且块里写的实体名要与该槽标题一致
  const usedSlots = new Map<number, string>();
  for (const m of prompt.matchAll(/<Subject (\d+)>[^\n]*?取自 @Picture(\d+)/g)) {
    const idx = Number(m[1]);
    const slot = Number(m[2]);
    const line = m[0];
    if (usedSlots.has(slot)) {
      issues.push({
        level: 'error',
        code: 'DUP_SUBJECT_BLOCK',
        message: `<Subject ${idx}> 与 <Subject ${usedSlots.get(slot)}> 指向同一个槽 @Picture${slot}`,
      });
      continue;
    }
    usedSlots.set(slot, String(idx));
    const nameMatch = line.match(/[>］]\s*是(?:角色|本段场景|本段道具)([^（(]+)/);
    const title = slots.get(`image:${slot}`);
    if (nameMatch && title) {
      const promptName = nameMatch[1]!.trim();
      const slotName = entityName(title);
      if (promptName && slotName && promptName !== slotName) {
        issues.push({
          level: 'error',
          code: 'SLOT_MISMATCH',
          message: `<Subject ${idx}> 写「${promptName}」，但 @Picture${slot} 是「${slotName}」`,
        });
      }
    }
  }

  // 3) 场景图存在却没被引用（弱检查，只提示）
  for (const [k, title] of slots.entries()) {
    if (!title.includes('概念图')) continue;
    const slot = Number(k.split(':')[1]);
    if (!prompt.includes(`@Picture${slot}`)) {
      issues.push({ level: 'warn', code: 'SCENE_UNREFERENCED', message: `场景槽 @Picture${slot}（${title}）未被提示词引用` });
    }
  }

  // 4) 本段动作必须写进提示词（2026-11-19 用户报障：提示词只有「场N 地点」，画面与剧本无关）
  const beatRaw = prompt.match(/本段动作：([^\n]*)/)?.[1] ?? '';
  const beatLine = beatRaw.split('动作到终点')[0]!.split('声音：')[0]!.trim();
  if (!beatLine) {
    issues.push({ level: 'error', code: 'NO_ACTION_BEAT', message: '本段没有写剧本动作（只有景别与机位），画面必然与剧本脱节' });
  }

  // 5) 没出场的角色不许当参考（2026-11-19 用户报障：第一场只有米拉，却挂了布布、老钟）
  if (beatLine) {
    for (const [k, title] of slots.entries()) {
      if (!k.startsWith('image:')) continue;
      if (title.includes('概念图')) continue;
      const name = entityName(title);
      const isRole = /(定妆|角色)/.test(title) || prompt.includes(`是角色${name}`);
      if (!isRole) continue;
      if (!beatLine.includes(name)) {
        issues.push({
          level: 'error',
          code: 'CAST_NOT_IN_SCENE',
          message: `「${name}」被挂成本段参考，但本段动作/剧本里没有它出场`,
        });
      }
    }
  }

  // 6) 声音名单不该列出不在场的角色（弱检查）
  const soundLine = prompt.match(/全段无人旁白；([^\n]*?)皆双唇紧闭/)?.[1] ?? '';
  if (soundLine && beatLine) {
    for (const name of soundLine.split('、').map((x) => x.trim()).filter(Boolean)) {
      if (!beatLine.includes(name)) {
        issues.push({ level: 'warn', code: 'CAST_NOT_IN_SCENE', message: `声音名单里的「${name}」本段没出场` });
      }
    }
  }

  // 7) 铁律（shots-prompts.md 第 111 条）：挂了参考图的槽位，正文必须出现 <Subject N> 名字，
  //    否则引擎把这行定义当纯文本、不锁那张图——画面里的「米拉」就变成随机角色。
  const bodyText = prompt.replace(/subject_definitions:[\s\S]*?(?=detailed_description:)/, '');
  for (const [k, title] of slots.entries()) {
    if (!k.startsWith('image:')) continue;
    const n = k.split(':')[1]!;
    if (!bodyText.includes(`<Subject ${n}>`)) {
      issues.push({
        level: 'error',
        code: 'SUBJECT_NOT_IN_BODY',
        message: `@Picture${n}（${entityName(title)}）只写在定义里，正文没有 <Subject ${n}> ${entityName(title)}，引擎不会锁这张图`,
      });
    }
  }

  return issues;
}

export function checkShots(shots: ShotLike[]): { shotIndex: number; issues: ShotQualityIssue[] }[] {
  return shots
    .map((s, i) => ({ shotIndex: i, issues: checkShotPrompt(s) }))
    .filter((x) => x.issues.some((i) => i.level === 'error'));
}
