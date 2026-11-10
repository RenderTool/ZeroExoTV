/**
 * 连接即概览：MCP initialize 的 instructions 里直接带「当前数据状态」。
 * 目的：新会话连上来第一眼就知道有哪些项目、各自做到哪一步、缺什么，
 * 不需要用户再把流程和现状讲一遍。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { readCurrentProject } from "../store/current-project.js";

interface ProjectMeta {
  id: string;
  title: string;
  updatedAt?: string;
  nodeCount?: number;
}

interface OverviewLine {
  id: string;
  title: string;
  script: { episodes: number; scenes: number; title?: string } | null;
  subjects: { total: number; withImage: number; missing: string[] } | null;
  workbench: {
    shots: number;
    withPrompt: number;
    withRefs: number;
    paramsReady: boolean;
    missingRefs: number;
  } | null;
  next: string;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function countScenes(html: string | undefined): number {
  return (html ?? "").match(/class="script-scene-heading"/g)?.length ?? 0;
}

async function projectLine(meta: ProjectMeta, root: string): Promise<OverviewLine> {
  const dir = paths.entitiesDir(meta.id, root);
  const script = await readJson<{ title?: string; episodes?: Array<{ content?: string }> }>(path.join(dir, "script.json"));
  const storyboard = await readJson<{
    entities?: Array<{ name: string; kind: string; images?: unknown[]; coverKey?: string | null }>;
  }>(path.join(dir, "storyboard.json"));
  const workbench = await readJson<{
    shots?: Array<{ imagePrompt?: string; videoPrompt?: string; references?: unknown[] }>;
    sharedParams?: { params?: Record<string, unknown> };
  }>(path.join(dir, "workbench.json"));

  const subjects = storyboard?.entities ?? [];
  const shots = workbench?.shots ?? [];
  const params = workbench?.sharedParams?.params ?? {};
  return {
    id: meta.id,
    title: meta.title,
    script: script
      ? {
          title: script.title,
          episodes: script.episodes?.length ?? 0,
          scenes: (script.episodes ?? []).reduce((n, e) => n + countScenes(e.content), 0),
        }
      : null,
    subjects: storyboard
      ? {
          total: subjects.length,
          withImage: subjects.filter((s) => (s.images?.length ?? 0) > 0).length,
          missing: subjects.filter((s) => (s.images?.length ?? 0) === 0).map((s) => s.name),
        }
      : null,
    workbench: workbench
      ? {
          shots: shots.length,
          withPrompt: shots.filter((s) => (s.imagePrompt ?? "").trim().length > 0).length,
          withRefs: shots.filter((s) => (s.references?.length ?? 0) > 0).length,
          paramsReady: Object.keys(params).length >= 20,
          missingRefs: shots.filter((s) => (s.references?.length ?? 0) === 0).length,
        }
      : null,
    next: "",
  };
}

function nextStep(line: OverviewLine): string {
  if (!line.script) return "无剧本：先 import_script（标准剧本，正文从第一场开始）";
  if (!line.subjects) return "无主体库：scaffold_episode 生成占位主体，再补图";
  if (line.subjects.withImage < line.subjects.total) return `缺 ${line.subjects.missing.length} 个主体图：${line.subjects.missing.slice(0, 6).join("、")}`;
  if (!line.workbench) return "无导演台：scaffold_episode 生成占位片段与提示词";
  if (line.workbench.withPrompt < line.workbench.shots) return "有片段缺提示词：apply_shot_prompts";
  if (line.workbench.missingRefs > 0) return `${line.workbench.missingRefs} 段未挂素材：link_subject_to_shot 后 apply_shot_prompts`;
  if (!line.workbench.paramsReady) return "公共参数未装配：set_shared_params（键用 DIRECTOR_PARAM_SCHEMA）";
  return "数据齐备，可出片（前端运行）";
}

/** 生成给 LLM 看的一句话现状（尽量短，超量截断） */
export async function buildStateOverview(root: string, limit = 10): Promise<string> {
  const env = await readJson<{ value?: ProjectMeta[] }>(paths.projectsMeta(root));
  const metas = (env?.value ?? []).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (metas.length === 0) {
    return `# 当前数据状态（自动读取）\n\n数据根 ${root} 下还没有项目。先 create_project，再走技能流程（zeroexo://skills/pipeline）。`;
  }
  // 当前打开项目置顶提示：用户多半已经开在网页里，Agent 先报出来再问「是否操作它」
  const current = await readCurrentProject(root).catch(() => null);
  const currentLine = current
    ? current.source === "open"
      ? `\n当前打开（用户在网页里正开着）：${current.title || current.projectId}（${current.projectId}）——动手前先确认是不是操作它。`
      : `\n最近修改的项目：${current.title || current.projectId}（${current.projectId}）——没有打开记录，先确认是不是操作它。`
    : "";
  const lines: OverviewLine[] = [];
  for (const meta of metas.slice(0, limit)) {
    const line = await projectLine(meta, root);
    line.next = nextStep(line);
    lines.push(line);
  }
  const body = lines
    .map((l) => {
      const s = l.script ? `剧本 ${l.script.episodes} 集/${l.script.scenes} 场` : "无剧本";
      const sub = l.subjects ? `主体 ${l.subjects.withImage}/${l.subjects.total} 有图` : "无主体";
      const wb = l.workbench
        ? `导演台 ${l.workbench.shots} 段（提示词 ${l.workbench.withPrompt}，挂素材 ${l.workbench.withRefs}${l.workbench.paramsReady ? "" : "，参数未装"}）`
        : "无导演台";
      return `- ${l.id}｜${l.title}｜${s}｜${sub}｜${wb}\n  下一步：${l.next}`;
    })
    .join("\n");
  const more = metas.length > lines.length ? `\n（另有 ${metas.length - lines.length} 个项目未列出，list_projects 查全量）` : "";
  return `# 当前数据状态（自动读取，数据根 ${root}）${currentLine}\n\n${body}${more}\n\n读 zeroexo://skills/pipeline 按流程推进；改完数据跑 validate_project 自检。`;
}
