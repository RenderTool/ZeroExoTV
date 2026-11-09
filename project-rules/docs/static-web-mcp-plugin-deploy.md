# 静态网页 + MCP + ComfyUI 插件部署

## 1. GitHub Pages

- 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
- 推送到 `main` 会触发 `.github/workflows/deploy-pages.yml`。
- 项目站点默认使用 `/<repo>/` 作为 base；自定义域名时把 workflow 里的 `VITE_BASE_PATH` 改成 `/`。
- 前端是 hash 路由，Pages 不需要 SPA fallback。
- `public/openlib` 和 `public/downloads/ComfyUI_ZeroExoNodes.zip` 随静态构建一起发布。

## 2. MCP

`mcp-server` 已按 npm 包配置：

```bash
cd mcp-server
npm publish --access public
```

用户本地启动：

```bash
npx -y @zeroexo/mcp-server --http
```

该进程同时提供：

- `http://127.0.0.1:8787/mcp`：Agent / IDE 的 MCP HTTP
- `http://127.0.0.1:8790`：网页读写数据目录

Agent 配置：

```json
{
  "mcpServers": {
    "zeroexo": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

如果没有 npm 发布权限，可在 `mcp-server` 执行 `npm pack`，把 tarball 放到 GitHub Release，让用户：

```bash
npx -y ./zeroexo-mcp-server-0.1.0.tgz --http
```

## 3. ComfyUI 插件

- ZIP 已放在 `public/downloads/ComfyUI_ZeroExoNodes.zip`，Pages 部署后可直接下载。
- 安装路径：`ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes`。
- 解压后重启 ComfyUI。
- 云端 ComfyUI 必须允许 custom nodes；共享型 SaaS 若不允许安装插件，需要自建云镜像。

## 4. 已知限制

- Pages 是 HTTPS；浏览器访问 `http://127.0.0.1` 可能触发混合内容限制，需在目标浏览器实测。若被拦，网页也本地起，或本地服务改 HTTPS。
- 文件服务默认 CORS `*` 且无鉴权，仅适合本机；公开部署前应加本地 token 和来源白名单。
- 网页不包含 ComfyUI 模型；模型和 GPU 仍在用户本机或云端 ComfyUI。
