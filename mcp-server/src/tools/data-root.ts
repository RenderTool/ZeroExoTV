/**
 * 数据根迁移后的收尾工具（2026-11-17 用户要求）
 *
 * 用户换数据目录后有两件事必须由 Agent 主动完成，而不是让用户自己去装/删：
 * 1. 感知：MCP 知道自己装在旧根里、新根里还没有安装，旧根还留着整份数据；
 * 2. 收尾：先问用户「旧目录还要不要」，再按答复把 MCP 安装目录搬到新根，最后删旧根。
 * 因此这里给只读体检 + 两个写工具（都必须 userConfirmed:true，且删除必须先跑 dryRun）。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot, installBase, installDir, readRootHistory } from "../config.js";
import { McpError } from "../errors.js";
import { defTool, guardDryRunConfirm, guardUserConfirmed, type Ctx } from "./_register.js";

/** 只清理 ZeroExo 自己的目录，绝不递归删用户放在同一层里的其它文件 */
const ZEROEXO_DIRS = ["projects", "assets", "media", "entities", ".lf", ".mcp", ".mcp-server", ".audit"] as const;

async function dirSize(abs: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        try {
          total += (await fs.stat(p)).size;
        } catch { /* 忽略读不到的文件 */ }
      }
    }
  };
  await walk(abs);
  return total;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

export function registerDataRootTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "data_root_status",
    description:
      "数据根与 MCP 安装位置体检（只读）：当前数据根、本进程从哪个目录启动、安装目录是否在新数据根下、"
      + "历史迁移留下的旧根是否还在、旧根里各目录占用多少。"
      + "用户在网页换过数据目录后先调这个，把「旧目录还在、MCP 还装在旧目录、要不要搬/删」讲清楚再问用户。",
    bits: ["project.read"],
    schema: {},
    handler: async () => {
      const root = dataRoot();
      const here = installDir();
      const base = installBase();
      const expected = path.join(root, ".mcp-server", "next");
      const history = readRootHistory(root);

      const previousRoots: Array<Record<string, unknown>> = [];
      for (const entry of history) {
        const oldRoot = path.resolve(entry.root);
        if (oldRoot === path.resolve(root)) continue;
        const present = await exists(oldRoot);
        const items: Array<{ name: string; exists: boolean; sizeMB: number }> = [];
        if (present) {
          for (const name of ZEROEXO_DIRS) {
            const abs = path.join(oldRoot, name);
            const ok = await exists(abs);
            items.push({ name, exists: ok, sizeMB: ok ? Math.round((await dirSize(abs)) / 1048576) : 0 });
          }
        }
        previousRoots.push({
          root: oldRoot,
          replacedAt: entry.replacedAt,
          exists: present,
          items,
        });
      }

      const inCurrentRoot = !!here && path.resolve(here).startsWith(path.resolve(root) + path.sep) && !base;
      const needsRelocate = !!base && path.resolve(base.root) !== path.resolve(root) && base.root !== "";

      return {
        dataRoot: root,
        serverEntry: process.argv[1] ?? null,
        installDir: here,
        installRoot: base?.root ?? null,
        expectedInstallDir: expected,
        installInsideDataRoot: path.resolve(here ?? "") === path.resolve(expected),
        needsRelocate,
        previousRoots,
        nextSteps: needsRelocate || previousRoots.length > 0
          ? [
            "把上面的事实告诉用户：MCP 还装在旧目录、旧目录还占多少空间",
            "问用户两件事：① 是否现在把 MCP 安装目录搬到新数据根 ② 旧目录是否删除（删除不可恢复）",
            "用户同意搬：调 relocate_mcp_install（userConfirmed:true），然后提示重启 MCP",
            "用户同意删：先 cleanup_old_data_root（root, dryRun:true）给清单，用户确认后再 confirm:true",
            "顺序必须是先搬 MCP、再删旧目录，否则正在运行的服务会被自己的删除操作打断",
          ]
          : ["安装目录与数据根已一致，无需处理"],
      };
    },
  });

  defTool(server, ctx, {
    name: "relocate_mcp_install",
    description:
      "把当前运行的 MCP 安装目录搬到当前数据根下的 .mcp-server\\next（写操作，必须用户同意）。"
      + "只复制现有安装（含 node_modules），不改数据、不删旧目录；完成后必须从新入口重启 MCP 服务，"
      + "重启后旧目录才可以删除。仓库里跑 dev 的入口（.../mcp-server/dist/index.js）无法搬迁，会直接报错。",
    bits: ["project.write"],
    schema: {
      userConfirmed: z.boolean().optional().describe("用户已同意把 MCP 安装目录搬到新数据根；必须 true"),
    },
    handler: async (args) => {
      guardUserConfirmed(args, "迁移 MCP 安装目录会复制整个安装包到新数据根");
      const root = dataRoot();
      const base = installBase();
      const here = installDir();
      if (!base || !here) {
        throw new McpError("VALIDATION", "当前 MCP 不是安装在 .mcp-server 目录里（可能是仓库 dev 入口），无法搬迁");
      }
      const from = path.join(base.root, base.rel);
      const to = path.join(root, base.rel);
      const entry = path.join(to, "node_modules", "@zeroexo", "mcp-server", "dist", "index.js");
      if (path.resolve(from) === path.resolve(to)) {
        return { ok: true, moved: false, message: "安装目录已在新数据根下，无需搬迁", installDir: to, serverEntry: process.argv[1] ?? null };
      }
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.cp(from, to, {
        recursive: true,
        force: true,
        // 安装包里的 tgz 备份不搬（省时间、省空间，也不影响运行）
        filter: (src) => !/(^|[\\/])pkg\.tgz/.test(src),
      });
      const entryExists = await exists(entry);
      return {
        ok: entryExists,
        moved: entryExists,
        from,
        to,
        serverEntry: entryExists ? entry : null,
        restartRequired: true,
        nextSteps: [
          "告诉用户：安装目录已搬到新数据根，必须从新入口重启 MCP 服务",
          `IDE 的 MCP 配置里把命令改成：node "${entry}" --http --port 8787`,
          "重启并确认 data_root_status 里 installInsideDataRoot 为 true",
          "确认新服务在线后，再问用户是否删除旧数据目录（cleanup_old_data_root dryRun → confirm）",
        ],
      };
    },
  });

  defTool(server, ctx, {
    name: "cleanup_old_data_root",
    description:
      "清理迁移后遗留的旧数据根（写操作，必须用户同意；删除不可恢复）。只删 ZeroExo 自己的目录"
      + "（projects/assets/media/entities/.lf/.mcp/.mcp-server/.audit），同一层其它文件原样保留。"
      + "当前数据根、盘根、用户主目录一律拒绝；MCP 还装在旧根里时也拒绝（必须先 relocate_mcp_install 并重启）。"
      + "第一次必须 dryRun:true 给用户看清单，得到答复后才 confirm:true。",
    bits: ["project.write"],
    schema: {
      root: z.string().describe("要清理的旧数据根绝对路径（必须是迁移记录里的旧根）"),
      dryRun: z.boolean().optional().describe("true = 只列清单不删"),
      confirm: z.boolean().optional().describe("true = 真正删除；与 dryRun 互斥"),
      userConfirmed: z.boolean().optional().describe("用户已明确同意删除旧目录；必须 true"),
    },
    handler: async (args) => {
      guardDryRunConfirm(args, { requireOne: true });
      guardUserConfirmed(args, "删除旧数据目录不可恢复");
      const target = path.resolve(String(args.root ?? "").trim());
      const root = path.resolve(dataRoot());
      if (target === root) throw new McpError("VALIDATION", "这是当前正在使用的数据根，拒绝删除");
      if (path.parse(target).root === target) throw new McpError("VALIDATION", "拒绝删除盘根");
      const base = installBase();
      if (base && path.resolve(base.root) === target) {
        throw new McpError("VALIDATION", "MCP 还装在旧数据根里：先调 relocate_mcp_install 并重启服务，再删旧目录");
      }
      const known = readRootHistory(root).some((e) => path.resolve(e.root) === target);
      if (!known) throw new McpError("VALIDATION", "该路径不在迁移记录里，拒绝删除（只清理确实迁移过的旧根）");
      if (!(await exists(target))) return { ok: true, root: target, missing: true, message: "旧目录已不存在" };

      const plan: Array<{ name: string; path: string; sizeMB: number }> = [];
      for (const name of ZEROEXO_DIRS) {
        const abs = path.join(target, name);
        if (await exists(abs)) plan.push({ name, path: abs, sizeMB: Math.round((await dirSize(abs)) / 1048576) });
      }
      if (args.dryRun) {
        return { ok: true, dryRun: true, root: target, items: plan, totalMB: plan.reduce((s, p) => s + p.sizeMB, 0) };
      }
      for (const item of plan) await fs.rm(item.path, { recursive: true, force: true });
      return {
        ok: true,
        root: target,
        removed: plan.map((p) => p.name),
        freedMB: plan.reduce((s, p) => s + p.sizeMB, 0),
        nextSteps: ["告诉用户旧目录已清理、释放了多少空间；旧目录里不属于 ZeroExo 的文件没有被删"],
      };
    },
  });
}
