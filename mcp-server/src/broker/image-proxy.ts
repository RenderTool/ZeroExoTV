/**
 * 图片作业代理（2026-11-17 定稿口径）。
 *
 * MCP 只做三件事：代理发起、认领台账、结果归档。
 *   - 发起：POST 插件 /zeroexo/v1/jobs（生成与采样预览都在插件/ComfyUI 端，网页可见）；
 *   - 台账：写一条 claims 记录，把 jobId 绑到项目 / 目标节点 / 上游参考图 / 主体；
 *   - 归档：结果由网页按 jobId 认领并落 CAS，MCP 查询时只读插件状态。
 * 网页关掉不影响作业继续跑，重开网页读台账即可接回进度与预览。
 *
 * 尺寸口径（2026-11-17 用户纠正）：参考图只做引导，出图尺寸按请求；
 * 只有带 mask 的改图才按原图尺寸，参考图不参与尺寸计算、也不缩放。
 */

import path from "node:path";
import { McpError } from "../errors.js";
import { resolveComfyBase, uploadComfyImage } from "./comfy.js";
import { clampQwenSize, resolveMegapixelSize } from "./params.js";
import { submitImageJob } from "./plugin-client.js";
import { imageSize, readStorageBuffer, resolveCanvasNodeStorageKey } from "./executor.js";
import { newClaimId, writeClaim, type ClaimRecord } from "../store/claims.js";

export interface ProxyImageRequest {
  prompt: string;
  model?: "moss" | "krea2" | "qwen";
  title?: string;
  aspect?: string;
  megapixels?: number;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  negative_prompt?: string;
  sourceStorageKey?: string;
  sourceNodeId?: string;
  maskStorageKey?: string;
  /** 网页认领时落到的节点 id；不给就用 jobId 生成一个稳定 id */
  nodeId?: string;
}

export interface ProxyImageResult {
  jobId: string;
  claimId: string;
  nodeId: string;
  model: "qwen" | "krea2" | "moss";
  kind: "canvas_image" | "subject_image" | "canvas_video";
  state: string;
  width: number;
  height: number;
}

function alignTo(value: number, step: number, min = 64, max = 2048): number {
  const n = Math.max(min, Math.min(max, Math.round(value / step) * step));
  return n;
}

function resolveSize(input: {
  model: "qwen" | "krea2" | "moss";
  width?: number;
  height?: number;
  aspect?: string;
  megapixels?: number;
}): { width: number; height: number } {
  const { model, width, height, aspect, megapixels } = input;
  if (width && height) {
    if (model === "qwen") return clampQwenSize(width, height);
    if (model === "moss") return { width: alignTo(width, 16), height: alignTo(height, 16) };
    return { width: alignTo(width, 32), height: alignTo(height, 32) };
  }
  if (aspect) {
    const raw = resolveMegapixelSize(aspect, megapixels, model === "moss" ? 16 : 32, 1);
    if (model === "qwen") return clampQwenSize(raw.width, raw.height);
    if (model === "moss") return { width: alignTo(raw.width, 16), height: alignTo(raw.height, 16) };
    return { width: alignTo(raw.width, 32), height: alignTo(raw.height, 32) };
  }
  if (model === "qwen") return { width: 2048, height: 1536 };
  return { width: 2048, height: 2048 };
}

/** 单张图：代理提交到插件，写认领台账 */
export async function submitProxyImage(
  projectId: string,
  req: ProxyImageRequest,
  kind: "canvas_image" | "subject_image" = "canvas_image",
  subject?: ClaimRecord["subject"],
): Promise<ProxyImageResult> {
  if (!projectId) throw new McpError("VALIDATION", "缺少 projectId");
  if (!req.prompt?.trim()) throw new McpError("VALIDATION", "缺少提示词");

  const base = await resolveComfyBase();
  const sourceKey = req.sourceStorageKey
    ?? (req.sourceNodeId ? await resolveCanvasNodeStorageKey(projectId, req.sourceNodeId) : null);
  const source = sourceKey ? await readStorageBuffer(sourceKey) : null;
  const mask = req.maskStorageKey ? await readStorageBuffer(req.maskStorageKey) : null;

  const model: "qwen" | "krea2" | "moss" = source ? "qwen" : (req.model ?? "moss");

  // 尺寸：改图跟原图，参考生图按请求
  let size: { width: number; height: number };
  if (mask && source) {
    const s = imageSize(source);
    size = clampQwenSize(s.width, s.height);
  } else {
    size = resolveSize({ model, width: req.width, height: req.height, aspect: req.aspect, megapixels: req.megapixels });
  }

  const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const jobId = `mp_${stamp}`;
  let inputName = "";
  if (source) {
    const ext = (sourceKey && path.extname(sourceKey).replace(/^\./, "")) || "png";
    inputName = (await uploadComfyImage(base, source, `zxm_${stamp}.${ext}`)) ?? "";
    if (!inputName) throw new McpError("IO_ERROR", "参考图上传 ComfyUI 失败");
  }
  let maskName = "";
  if (mask) {
    maskName = (await uploadComfyImage(base, mask, `zxm_${stamp}_mask.png`)) ?? "";
  }

  const steps = req.steps && req.steps > 0 ? req.steps : model === "qwen" ? 25 : model === "krea2" ? 10 : 25;
  const seed = typeof req.seed === "number" ? req.seed : -1;
  const negative = req.negative_prompt ?? "";

  const common = {
    seed,
    steps,
    width: size.width,
    height: size.height,
  };

  const jobKind = model === "qwen" ? "qwen_image_edit" : model === "krea2" ? "krea2_t2i" : "moss_image_t2i";
  const params: Record<string, unknown> = model === "qwen"
    ? {
      edit_prompt: inputName ? `参考图1：${req.prompt}` : req.prompt,
      negative_prompt: negative,
      input_image: inputName,
      mask_image: maskName,
      cfg: 1,
      denoise: 1,
      // 关键：只有「带 mask 的改图」才吃原图 latent（尺寸跟随原图）。
      // 普通参考生图必须走 EmptyLatent，width/height 才真正决定出图尺寸；
      // 旧值 !inputName 让所有参考图都走原图 latent，16:9/2K 请求永远被参考图尺寸覆盖。
      edit_mode: !maskName,
      use_llm_enhance: false,
      ...common,
    }
    : model === "krea2"
      ? { prompt: req.prompt, negative_prompt: negative, cfg: 4.5, ...common }
      : { prompt: req.prompt, negative_prompt: negative, cfg: 3.5, ...common };

  const submitted = await submitImageJob(
    { kind: jobKind, clientJobId: jobId, project: projectId, params },
    base,
  );

  const claimId = newClaimId();
  const now = new Date().toISOString();
  const claim: ClaimRecord = {
    schemaVersion: 1,
    claimId,
    jobId: submitted.jobId,
    projectId,
    kind,
    nodeId: req.nodeId ?? `mcp_${submitted.jobId}`,
    sourceNodeId: req.sourceNodeId,
    sourceStorageKey: sourceKey ?? undefined,
    prompt: req.prompt,
    title: req.title?.trim() || undefined,
    model,
    params: { ...common, aspect: req.aspect, megapixels: req.megapixels, negative_prompt: negative },
    subject,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  await writeClaim(claim);

  return {
    jobId: submitted.jobId,
    claimId,
    nodeId: claim.nodeId,
    model,
    kind,
    state: submitted.state,
    width: size.width,
    height: size.height,
  };
}
