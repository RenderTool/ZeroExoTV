# ZeroExo ComfyUI

ZeroExo ComfyUI 是一个本地优先的 AI 影视生产画布：剧本、分镜、主体库、素材、导演台和 ComfyUI 出片在同一条工作流里完成。

前端是静态网页，可直接部署到 GitHub Pages；生成能力连接用户本机或云端的 ComfyUI；IDE / Agent 通过本地 MCP 服务接入。

## 在线体验

GitHub Pages 部署完成后访问：

https://RenderTool.github.io/ZeroExoTV/

网页本身不包含 ComfyUI 和模型，需要在本机或云端运行 ComfyUI。

## 本地开发

要求：Node.js 18+、pnpm 9+。

```bash
pnpm install
pnpm dev
```

开发地址：

```text
http://localhost:5180/
```

`pnpm dev` 会自动探测并拉起本地数据服务 `http://127.0.0.1:8790`；该服务负责项目、素材和历史产物的磁盘读写。

生产构建：

```bash
pnpm build
pnpm preview
```

## 目录与数据

项目数据默认保存在本机数据目录，MCP 和网页必须指向同一个目录。

首次使用在网页顶栏「服务 → 数据目录」选择目录。数据目录中的内容：

- 项目与画布
- 素材与历史产物
- 子画布副本
- 主体库

换目录不会删除旧目录文件。

## MCP

MCP 服务位于 `mcp-server/`，默认提供 stdio 和 Streamable HTTP 两种传输。

本地开发启动 HTTP：

```bash
cd mcp-server
pnpm build
node dist/index.js --http --port 8787
```

发布 npm 后用户可以直接：

```bash
npx -y @zeroexo/mcp-server --http
```

也可以直接用随静态站发布的安装包，不需要另开云空间：

```bash
npx --yes --package=https://RenderTool.github.io/ZeroExoTV/downloads/zeroexo-mcp-server.tgz -- zeroexo-mcp --http --port 8787
```

安装包地址：

```text
https://RenderTool.github.io/ZeroExoTV/downloads/zeroexo-mcp-server.tgz
```

服务地址：

- MCP：`http://127.0.0.1:8787/mcp`
- 数据服务：`http://127.0.0.1:8790`

IDE 配置（HTTP）：

```json
{
  "mcpServers": {
    "zeroexo": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

网页顶栏「服务 → MCP」可以复制完整接入配置和 token。

说明：MCP 是本地服务，不部署在 GitHub Pages 上。GitHub Pages 只托管静态网页；MCP 需要运行在用户电脑或用户自己的服务器上。

## ComfyUI 插件

画布提交导演台、图片和视频任务前，ComfyUI 必须安装本项目的配套插件。

1. 打开网页顶栏「服务 → ComfyUI 插件」。
2. 下载 `ComfyUI_ZeroExoNodes.zip`。
3. 解压到：

```text
ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes
```

4. 重启 ComfyUI。

插件压缩包也随静态站发布在：

```text
https://RenderTool.github.io/ZeroExoTV/downloads/ComfyUI_ZeroExoNodes.zip
```

## GitHub Pages 部署

仓库包含 `.github/workflows/deploy-pages.yml`，推送到 `main` 后自动执行：

1. 安装依赖。
2. `pnpm build`。
3. 上传静态产物并通过 GitHub Pages 发布。

部署使用仓库名作为子路径，构建时自动设置：

```text
VITE_BASE_PATH=/ZeroExoTV/
```

如果使用自定义域名，把工作流中的 `VITE_BASE_PATH` 改成 `/`。

首次部署如果 Pages 尚未启用，工作流会尝试自动启用；若仓库权限不允许，需要在仓库 Settings → Pages 手动选择 GitHub Actions 或对应发布分支。

## 更新发布

推送到 `main` 后，工作流会重新生成三样东西：

- 静态网页
- `downloads/zeroexo-mcp-server.tgz`
- `downloads/ComfyUI_ZeroExoNodes.zip`

ComfyUI 插件源码在 `comfyui-plugin/ComfyUI_ZeroExoNodes/`，工作流每次从源码重新打包，不再依赖本机手工生成的 ZIP。

MCP 包和插件包还会生成带版本的副本，便于 Agent 绕过缓存下载明确版本。

已经安装到本机的 MCP 和 ComfyUI 插件不会因为网页更新而自动替换：

- MCP 需要重新下载并重启进程。
- ComfyUI 插件需要替换 `custom_nodes/ComfyUI_ZeroExoNodes` 并重启 ComfyUI。

## 项目结构

```text
src/                前端应用
packages/           画布、节点、渲染、持久化等插件包
mcp-server/         MCP 服务与数据文件服务
public/openlib/     随站点发布的开源素材库
public/downloads/   随站点发布的 ComfyUI 插件 ZIP
project-rules/      项目规格、计划与交接文档
```

## 验证

```bash
pnpm typecheck
pnpm test:unit
pnpm build
```
