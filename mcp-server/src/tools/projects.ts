/** 项目域：list_projects / get_project / open_project / create_project */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot, frontendBaseUrl } from "../config.js";
import { createProject, getProjectOverview, readProjectsMeta, updateProjectMeta } from "../store/projects.js";
import { defTool, type Ctx } from "./_register.js";

export function registerProjectTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_projects",
    description: "列出 token 作用域内可见的全部项目（含更新时间、节点数）。",
    bits: ["project.read"],
    schema: {},
    handler: async (_args, token) => {
      const metas = await readProjectsMeta(dataRoot());
      const visible =
        token.projectIds === "*" ? metas : metas.filter((m) => token.projectIds.includes(m.id));
      return visible.map((m) => ({
        id: m.id, title: m.title, updatedAt: m.updatedAt, nodeCount: m.nodeCount, tags: m.tags,
      }));
    },
  });

  defTool(server, ctx, {
    name: "get_project",
    description: "获取项目详情与资产路径概览（entities 就绪状态、CAS 文件数、目录路径）。",
    bits: ["project.read"],
    schema: { projectId: z.string() },
    handler: async (args) => getProjectOverview(dataRoot(), args.projectId),
  });

  defTool(server, ctx, {
    name: "open_project",
    description: "返回项目在前端编辑器中的打开 URL（hash 路由 #/editor/<id>）。",
    bits: ["project.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      await getProjectOverview(dataRoot(), args.projectId); // 不存在则抛 NOT_FOUND
      return { projectId: args.projectId, url: `${frontendBaseUrl()}/#/editor/${args.projectId}` };
    },
  });

  defTool(server, ctx, {
    name: "create_project",
    description: "新建项目：写 projects.json 信封 + 建 projects/<id>/entities 目录骨架（不写 graph，留前端首开自建）。",
    bits: ["project.write"],
    schema: {
      title: z.string().min(1),
      tags: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const meta = await createProject(dataRoot(), { title: args.title, tags: args.tags });
      return { projectId: meta.id, title: meta.title, url: `${frontendBaseUrl()}/#/editor/${meta.id}` };
    },
  });

  defTool(server, ctx, {
    name: "update_project_meta",
    description: "更新项目元信息（标题、标签）。至少提供 title 或 tags 之一。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      title: z.string().min(1).optional(),
      tags: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const patch: { title?: string; tags?: string[] } = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.tags !== undefined) patch.tags = args.tags;
      if (patch.title === undefined && patch.tags === undefined) {
        throw new Error("至少提供 title 或 tags 之一");
      }
      const meta = await updateProjectMeta(dataRoot(), args.projectId, patch);
      return { projectId: meta.id, title: meta.title, tags: meta.tags, updatedAt: meta.updatedAt };
    },
  });
}
