/**
 * upgrade-audit — 升级后查漏补缺（2026-11-13 用户要求）
 *
 * 用户原话：MCP 更新应该提醒用户的 Agent「上一个版本处理流程中可能存在的纰漏」，
 * 要主动问是否查漏补缺修复；不能只用版本更新糊弄过去。
 *
 * 本文件只读项目数据，按**当前**规则找「旧流程留下的洞」，每条给出证据、影响与修复工具。
 */

export interface UpgradeFinding {
  code: string;
  severity: "high" | "medium" | "low";
  title: string;
  count: number;
  detail: string;
  fix: string;
}

export interface UpgradeAuditResult {
  ok: boolean;
  findings: UpgradeFinding[];
  summary: { high: number; medium: number; low: number };
}

interface ScriptLike {
  episodes?: Array<{ id?: string; number?: number; title?: string }>;
  meta?: { visualStyle?: { presetId?: string; prompt?: string } };
}

interface StoryboardLike {
  entities?: Array<{ id?: string; name?: string; kind?: string; note?: string }>;
  subjectTree?: unknown;
}

interface WorkbenchLike {
  shots?: Array<{
    id?: string;
    number?: number;
    episodeId?: string;
    imagePrompt?: string;
    videoPrompt?: string;
  }>;
}

interface TreeLike {
  name?: string;
  kind?: string;
  states?: Array<{
    state?: string;
    fullPrompt?: string;
    deltaPrompt?: string;
    media?: Array<{ prompt?: string; type?: string }>;
  }>;
}

function promptOfState(st: NonNullable<TreeLike["states"]>[number]): string {
  return String(st.fullPrompt ?? st.deltaPrompt ?? "").trim();
}

/** 纯函数（可测试）：按当前规则扫旧数据 */
export function auditProjectData(input: {
  script: ScriptLike | null;
  storyboard: StoryboardLike | null;
  workbench: WorkbenchLike | null;
}): UpgradeAuditResult {
  const findings: UpgradeFinding[] = [];
  const trees = (Array.isArray(input.storyboard?.subjectTree)
    ? input.storyboard?.subjectTree
    : []) as TreeLike[];
  const episodes = input.script?.episodes ?? [];
  const episodeIds = new Set(episodes.map((e) => e.id).filter((id): id is string => typeof id === "string"));
  const multiEpisode = episodes.length > 1;

  if (trees.length > 0 && !input.script?.meta?.visualStyle?.prompt) {
    findings.push({
      code: "GLOBAL_STYLE_UNSET",
      severity: "high",
      title: "全剧风格未设置",
      count: 1,
      detail: "主体提示词没有统一风格来源；旧数据可能各自写死风格，画面会漂。",
      fix: "list_style_presets → 让用户选一套 → set_global_style(dryRun→userConfirmed+baseVersion)",
    });
  }

  const emptyBase = trees.filter((tr) => {
    const base = tr.states?.[0];
    return !base || !promptOfState(base);
  });
  if (emptyBase.length > 0) {
    findings.push({
      code: "SUBJECT_PROMPT_EMPTY",
      severity: "high",
      title: "主体基础状态没有提示词",
      count: emptyBase.length,
      detail: `涉及：${emptyBase.map((t) => t.name ?? "未命名").slice(0, 8).join("、")}。旧流程只建了主体名、没跑 set_subject_profile。`,
      fix: "set_subject_profile（完整字段）生成提示词；有图先 read_asset 反推",
    });
  }

  const oldStyle = trees.flatMap((tr) => (tr.states ?? []).filter((st) => {
    const p = promptOfState(st);
    return p && /按剧本|按题材|待补|占位/.test(p);
  }));
  if (oldStyle.length > 0) {
    findings.push({
      code: "PROMPT_PLACEHOLDER",
      severity: "medium",
      title: "提示词仍有旧占位话术",
      count: oldStyle.length,
      detail: "出现「按剧本…定 / 待补 / 占位」等旧模板文字，生成会随机。",
      fix: "设置全剧风格后 set_global_style 统一改写；或逐状态 set_subject_profile",
    });
  }

  const imgNoPrompt = trees.flatMap((tr) => (tr.states ?? []).flatMap((st) => (st.media ?? []).filter(
    (m) => (m.type ?? "image") === "image" && !String(m.prompt ?? "").trim(),
  )));
  if (imgNoPrompt.length > 0) {
    findings.push({
      code: "SUBJECT_IMAGE_NO_PROMPT",
      severity: "medium",
      title: "主体图没有反推提示词",
      count: imgNoPrompt.length,
      detail: "旧流程把图挂上了但没写画面反推 prompt，后续无法复现/判断一致性。",
      fix: "read_asset 看图 → 反推 prompt → 重新 set_subject_image 带上 prompt",
    });
  }

  const shots = input.workbench?.shots ?? [];
  if (multiEpisode && shots.length > 0) {
    const unassigned = shots.filter((s) => !s.episodeId);
    if (unassigned.length > 0) {
      findings.push({
        code: "SHOT_EPISODE_UNASSIGNED",
        severity: "high",
        title: "导演台片段没有分集",
        count: unassigned.length,
        detail: "旧流程把多集片段平铺在一个导演台里；新 UI 按 episodeId 分组，缺省会全部落进「未分集」。",
        fix: "按剧本集顺序重新 split_script_to_shots（会带 episodeId），或逐段 add_segment 指定 episodeId 后迁移",
      });
    }
    const unknown = shots.filter((s) => s.episodeId && !episodeIds.has(s.episodeId));
    if (unknown.length > 0) {
      findings.push({
        code: "SHOT_EPISODE_UNKNOWN",
        severity: "medium",
        title: "片段指向已删除的集",
        count: unknown.length,
        detail: "episodeId 在剧本里已不存在，界面会显示「已删除的集」。",
        fix: "重新绑定到现存集，或清理这些片段",
      });
    }
  }

  const emptyShotPrompts = shots.filter((s) => !String(s.imagePrompt ?? "").trim() || !String(s.videoPrompt ?? "").trim());
  if (emptyShotPrompts.length > 0) {
    findings.push({
      code: "SHOT_PROMPT_EMPTY",
      severity: "medium",
      title: "片段提示词为空",
      count: emptyShotPrompts.length,
      detail: "旧流程只拆了片段、没写双轨提示词；直接出片会随机。",
      fix: "apply_shot_prompts 或 set_shot_prompt 按镜头卡补 imagePrompt/videoPrompt",
    });
  }

  const summary = { high: 0, medium: 0, low: 0 };
  for (const f of findings) summary[f.severity] += 1;
  return { ok: findings.length === 0, findings, summary };
}

/** 升级自查说明（Agent 连上/更新后先读，再跑 audit_upgrade） */
export const UPGRADE_GUIDE = `# 升级 / 连上后的查漏补缺（必做）

当前版本的处理流程比旧版本多了几条硬约束（主体强制字段 + 看图反推、全剧风格、
导演台按集、镜头卡）。**旧项目很可能是在这些约束之前做的**，所以不要只说「已更新」。

1. 先调 \`audit_upgrade({ projectId })\`（只读，不改任何文件）。
2. 把 findings 按严重度报给用户：每条说清「旧流程漏了什么 → 现在会导致什么 → 用什么工具修」。
3. **问用户是否现在查漏补缺**；不要擅自批量改。用户确认后按 fix 里的工具逐项修。
4. 修完再跑一次 \`audit_upgrade\`，ok=true 才继续。
5. 不要用「版本已更新」代替这次检查；也不要静默跳过。`;
