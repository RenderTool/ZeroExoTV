/**
 * 发布域：把当前工作区的修复提交到 GitHub。
 *
 * - mode="pr"   ：新分支 + 提交 + 推送 + 开 PR，绝不碰 main（客户/LLM 路径）
 * - mode="main" ：仅本机维护者直推 main
 *
 * 工具本身不做代码修改，只负责把已经改好的工作区变成可审核的提交/PR。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "../errors.js";
import { defTool, type Ctx } from "./_register.js";

const run = promisify(execFile);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd, windowsHide: true, timeout: 120_000 });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new McpError("GIT_FAILED", (e.stderr || e.stdout || e.message || "git 执行失败").trim());
  }
}

function repoFromRemote(remote: string): { owner: string; repo: string } {
  const m = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i.exec(remote.trim());
  if (!m) throw new McpError("VALIDATION", `无法从 remote 解析 GitHub 仓库: ${remote}`);
  return { owner: m[1]!, repo: m[2]! };
}

export function registerReleaseTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "publish_fix",
    description:
      "提交已改好的工作区：mode=pr（默认）新分支+提交+推送+开 GitHub PR，绝不改 main；mode=main 仅本机维护者直推 main。会先 typecheck/build，再提交。必须 confirm:true；dryRun 只看计划。",
    bits: ["project.write"],
    schema: {
      mode: z.enum(["pr", "main"]).default("pr"),
      title: z.string().min(1),
      body: z.string().optional(),
      commitMessage: z.string().optional(),
      branchName: z.string().optional(),
      base: z.string().default("main"),
      verify: z.boolean().default(true),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      const cwd = await git(process.cwd(), ["rev-parse", "--show-toplevel"]);
      const status = await git(cwd, ["status", "--porcelain"]);
      if (!status) throw new McpError("VALIDATION", "工作区没有改动，没有可提交的修复");
      const branch = args.branchName ?? `fix/${Date.now().toString(36)}-${args.mode}`;
      if (args.mode === "main" && args.base !== "main") {
        throw new McpError("VALIDATION", "直推 main 模式只允许 base=main");
      }
      const plan = {
        cwd, mode: args.mode, branch: args.mode === "pr" ? branch : args.base,
        changedFiles: status.split(/\r?\n/).filter(Boolean).length,
        verify: args.verify,
      };
      if (args.dryRun) return { ...plan, written: false, dryRun: true };
      if (!args.confirm) throw new McpError("CONFIRM_REQUIRED", "发布修复必须带 confirm:true");

      if (args.verify) {
        await run(pnpm, ["typecheck"], { cwd, windowsHide: true, timeout: 600_000 }).catch((err) => {
          const e = err as { stderr?: string; stdout?: string };
          throw new McpError("VERIFY_FAILED", `pnpm typecheck 失败：${(e.stderr || e.stdout || "").trim().slice(-2000)}`);
        });
        await run(pnpm, ["build"], { cwd, windowsHide: true, timeout: 600_000 }).catch((err) => {
          const e = err as { stderr?: string; stdout?: string };
          throw new McpError("VERIFY_FAILED", `pnpm build 失败：${(e.stderr || e.stdout || "").trim().slice(-2000)}`);
        });
      }

      if (args.mode === "pr") {
        const current = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
        if (current !== branch) await git(cwd, ["checkout", "-b", branch]);
      }
      await git(cwd, ["add", "-A"]);
      await git(cwd, ["commit", "-m", args.commitMessage ?? args.title]);
      const pushTarget = args.mode === "pr" ? branch : args.base;
      await git(cwd, ["push", "-u", "origin", pushTarget]);
      const head = await git(cwd, ["rev-parse", "--short", "HEAD"]);

      if (args.mode === "main") {
        return { ...plan, written: true, head, pushed: `origin/${args.base}`, pr: null };
      }

      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
      if (!token) {
        return {
          ...plan, written: true, head, pushed: `origin/${branch}`,
          pr: null,
          next: "分支已推送，但未配置 GITHUB_TOKEN/GH_TOKEN，无法自动开 PR；请到 GitHub 手动开 PR。",
        };
      }
      const remote = await git(cwd, ["remote", "get-url", "origin"]);
      const { owner, repo } = repoFromRemote(remote);
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: args.title,
          head: branch,
          base: args.base,
          body: args.body ?? "",
          draft: true,
        }),
      });
      const data = (await res.json().catch(() => null)) as { html_url?: string; message?: string } | null;
      if (!res.ok) throw new McpError("GITHUB_FAILED", data?.message ?? `GitHub PR 创建失败: ${res.status}`);
      return { ...plan, written: true, head, pushed: `origin/${branch}`, pr: data?.html_url ?? null };
    },
  });
}
