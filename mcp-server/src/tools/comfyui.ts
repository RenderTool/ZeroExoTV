/** ComfyUI 当前连接状态（读网页广播，2026-11-14） */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { defTool, type Ctx } from "./_register.js";

interface Broadcast {
  schemaVersion?: number;
  address?: string;
  backend?: string | null;
  connected?: boolean;
  updatedAt?: string;
}

const BROADCAST_REL = path.join(".lf", "zeroexo", "app_meta", "comfyui-endpoint.json");

async function readBroadcast(): Promise<Broadcast | null> {
  try {
    const raw = await fs.readFile(path.join(dataRoot(), BROADCAST_REL), "utf8");
    const parsed = JSON.parse(raw) as Broadcast;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** 对地址做一次 /system_stats 探测（云端地址同样适用） */
async function probe(address: string): Promise<{ reachable: boolean; status: number | null; error?: string }> {
  const base = address.replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`${base}/system_stats`, { signal: ctrl.signal });
    return { reachable: res.ok, status: res.status };
  } catch (err) {
    return { reachable: false, status: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export function registerComfyuiTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "get_comfyui_status",
    description:
      "读取网页当前连接的 ComfyUI 地址与状态（含云端地址），并探测 /system_stats。" +
      "诊断「ComfyUI 未连接 / 作业 pending」前必须先调这个，禁止假设 127.0.0.1:8188；" +
      "地址以网页广播的 .lf/zeroexo/app_meta/comfyui-endpoint.json 为准。",
    bits: ["project.read"],
    schema: { projectId: z.string().optional() },
    handler: async () => {
      const b = await readBroadcast();
      if (!b?.address) {
        return {
          found: false,
          hint:
            "网页还没广播 ComfyUI 地址（或未授权数据目录）。不要假设 localhost:8188；" +
            "先让用户在网页顶栏「ComfyUI 连接」里填地址并测试连接（云端地址也填这里），再重试。",
        };
      }
      const p = await probe(b.address);
      return {
        found: true,
        address: b.address,
        backend: b.backend ?? null,
        connected: b.connected === true,
        reachable: p.reachable,
        httpStatus: p.status,
        probeError: p.error ?? null,
        updatedAt: b.updatedAt ?? null,
        hint:
          p.reachable
            ? "地址可达；若作业仍 pending，检查网页是否打开当前项目（作业由网页消费）。"
            : "地址不可达：确认云端 ComfyUI 在线、地址/协议正确；不要退回 localhost:8188 猜测。",
      };
    },
  });
}
