/**
 * 数据根自愈（2026-11-22 用户拍板后仅保留这一件事）。
 *
 * 原先这里是一个 `--fs-server` 本地 HTTP 文件服务（默认 8790），把 dataRoot 以 REST
 * 暴露给前端、免掉浏览器授权。它从未出现在任何用户界面上，用户只知道有 MCP——
 * 属于"不可见服务"，已整体移除：
 * - 网页读写本地文件 = 浏览器目录授权（File System Access）；
 * - 任务心跳 / 进度 = MCP 自己的 `--http` 端口（/mcp 与 /tasks 同一端口）。
 *
 * 保留：数据根目录创建 + `zeroexo-root.json` 标记（MCP 启动时幂等执行，供外部工具认目录）。
 */

import path from "node:path";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { dataRoot } from "./config.js";

/** 原子写：temp + rename（与 MCP store 层写纪律一致，不留半文件） */
async function atomicWrite(abs: string, buf: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, abs);
}

async function ensureDataRoot(): Promise<void> {
  await fs.mkdir(path.resolve(dataRoot()), { recursive: true });
}

/** 数据根缺失 zeroexo-root.json 时幂等创建（外部工具按这个标记认目录） */
async function ensureRootMarker(): Promise<void> {
  const marker = path.join(path.resolve(dataRoot()), "zeroexo-root.json");
  const exists = await fs.stat(marker).then((s) => s.isFile(), () => false);
  if (!exists) {
    await atomicWrite(marker, Buffer.from(
      JSON.stringify({ app: "zeroexo-studio", version: 1, createdAt: new Date().toISOString() }, null, 2) + "\n",
    ));
    process.stderr.write(`[zeroexo-mcp] 已创建数据根标记 zeroexo-root.json\n`);
  }
}

export async function ensureFsRoot(): Promise<void> {
  try {
    await ensureDataRoot();
    await ensureRootMarker();
  } catch (err) {
    process.stderr.write(`[zeroexo-mcp] 数据根自愈失败（不阻断启动）: ${(err as Error).message}\n`);
  }
}
