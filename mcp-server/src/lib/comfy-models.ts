/**
 * 读「网页模型映射面板」当前选中的四件套（2026-11-20）
 *
 * 网页把选择广播到 `.lf/zeroexo/app_meta/comfyui-models.json`（localStorage 只有浏览器有，
 * MCP 是另一个进程，读不到）。这里按优先级读：
 *   1) comfyui-models.json（新）
 *   2) comfyui-endpoint.json 里夹带的 models（旧格式，兼容）
 * 都没有 → null（调用方必须明确报错，禁止让插件退回模板自选 48G bf16）。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { dataRoot } from "../config.js";

export interface ComfyModels {
  unet?: string;
  videoVae?: string;
  audioVae?: string;
  clip?: string;
  clipType?: string;
}

const MODELS_REL = path.join(".lf", "zeroexo", "app_meta", "comfyui-models.json");
const ENDPOINT_REL = path.join(".lf", "zeroexo", "app_meta", "comfyui-endpoint.json");

async function readJson(rel: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(path.join(dataRoot(), rel), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pickModels(src: unknown): ComfyModels | null {
  if (!src || typeof src !== "object") return null;
  const m = src as Record<string, unknown>;
  const str = (k: string): string => (typeof m[k] === "string" ? (m[k] as string).trim() : "");
  const out: ComfyModels = {
    ...(str("unet") ? { unet: str("unet") } : {}),
    ...(str("videoVae") ? { videoVae: str("videoVae") } : {}),
    ...(str("audioVae") ? { audioVae: str("audioVae") } : {}),
    ...(str("clip") ? { clip: str("clip") } : {}),
    clipType: str("clipType") || "minimax",
  };
  return out.unet || out.videoVae || out.audioVae || out.clip ? out : null;
}

export async function readBroadcastComfyModels(): Promise<ComfyModels | null> {
  const modelsFile = await readJson(MODELS_REL);
  if (modelsFile) {
    const picked = pickModels(modelsFile.models ?? modelsFile);
    if (picked) return picked;
  }
  const endpointFile = await readJson(ENDPOINT_REL);
  if (endpointFile) {
    const picked = pickModels(endpointFile.models);
    if (picked) return picked;
  }
  return null;
}
