import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';

// ===== `.js` 说明符回落到同名 `.ts/.tsx`（2026-11-17 报障根因修复）=====
// 这个仓库的源码统一用 ESM 写法 `import './x.js'`（指向同目录的 x.ts）。
// 一旦有人跑 in-source 的 tsc，src 下就会出现与 .ts 同名的 .js，Vite 会优先加载那份
// 旧编译产物 —— 改了 .ts 不生效、运行时还会报 "does not provide an export named ..."。
// 这些 .js 已按要求清掉；这里让解析器在 .js 缺失时回落到 .ts/.tsx，源码即唯一事实源。
function resolveTsFromJsSpecifier(): Plugin {
  const tryExts = ['.ts', '.tsx'] as const;
  return {
    name: 'zeroexo-resolve-ts-from-js-specifier',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.js')) return null;
      let base: string;
      if (source.startsWith('@/')) base = path.resolve(__dirname, './src', source.slice(2, -3));
      else if (source.startsWith('.')) base = path.resolve(path.dirname(importer), source.slice(0, -3));
      else return null;
      for (const ext of tryExts) {
        const candidate = `${base}${ext}`;
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

// ===== 版本清单（2026-11-11 用户要求）=====
// 网页与 MCP 都显示版本号，并提供「官方最新版 vs 本地版本」对照：
// - 构建时把 version.json 写进 dist（GitHub Pages 部署后即官方最新版清单）；
// - 页面内用 __APP_VERSION__ 显示本地版本，fetch version.json 比对官方最新版。
const APP_PKG = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
const MCP_PKG = JSON.parse(readFileSync(path.resolve(__dirname, 'mcp-server/package.json'), 'utf8')) as { version: string };
function versionManifest(): Plugin {
  const payload = (): string => JSON.stringify({
    appVersion: APP_PKG.version,
    mcpVersion: MCP_PKG.version,
    commit: (() => { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return ''; } })(),
    builtAt: new Date().toISOString(),
  });
  return {
    name: 'zeroexo-version-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0]!.endsWith('/version.json')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(payload());
          return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0]!.endsWith('/version.json')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(payload());
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: payload() });
    },
  };
}

// ===== 本地数据服务独立守护（2026-11-18 用户报障：Agent 干活期间 8787/8790 反复掉线）=====
// 用户打开页面时 fs-server（默认 8790）必须始终在线，否则前端退到临时存储、素材读取失败。
// 1. dev/preview 启动时只探测 8790 的 /health：已在线就什么都不做；离线才拉起；
// 2. 拉起经 tools/start-fs-server.mjs 的一次性 launcher 二次 spawn：服务不挂在 dev 的进程树上，
//    dev/preview 关闭、Ctrl+C、进程树清理都不会带走它（直接在 vite 里 spawn 会被 tree-kill 连着杀）；
// 3. 幂等由服务自身保证（端口已有实例即 process.exit(0)）；要停服务只能显式结束该进程。
const FS_SERVER_PORT = process.env.ZEROEXO_FS_PORT ?? '8790';
function zeroexoFsServer(): Plugin {
  const start = (log: { info: (m: string) => void; warn: (m: string) => void }): void => {
    void fetch(`http://127.0.0.1:${FS_SERVER_PORT}/health`)
      .then((r) => {
        if (r.ok) {
          log.info(`[fs-server] ${FS_SERVER_PORT} 已有实例在线，跳过拉起`);
        } else {
          throw new Error('health 非 200');
        }
      })
      .catch(() => {
        const dist = path.resolve(__dirname, 'mcp-server/dist/index.js');
        if (!existsSync(dist)) {
          log.warn('[fs-server] 缺少 mcp-server/dist/index.js：先执行 pnpm fs:build，或用 pnpm fs 前台启动');
          return;
        }
        const launcher = path.resolve(__dirname, 'tools/start-fs-server.mjs');
        spawn(process.execPath, [launcher, dist, '--port', FS_SERVER_PORT], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref();
        log.info(`[fs-server] 已拉起独立守护进程 http://127.0.0.1:${FS_SERVER_PORT}（关闭 dev 不会停止它）`);
        // 起没起来以 /health 为准，别只看 spawn 是否成功
        setTimeout(() => {
          void fetch(`http://127.0.0.1:${FS_SERVER_PORT}/health`)
            .then((r) => {
              if (r.ok) log.info(`[fs-server] ${FS_SERVER_PORT} 就绪`);
              else log.warn(`[fs-server] ${FS_SERVER_PORT} 未就绪：页面会退到临时存储`);
            })
            .catch(() => log.warn(`[fs-server] ${FS_SERVER_PORT} 未就绪：页面会退到临时存储`));
        }, 1500);
      });
  };
  return {
    name: 'zeroexo-fs-server',
    configureServer(server) {
      start(server.config.logger);
    },
    configurePreviewServer(server) {
      start(server.config.logger);
    },
  };
}

/**
 * 构建产物单版本化（2026-11-06 用户验收：dist 里堆积了 30+ 个历史 chunk / 91 MB）
 *
 * `emptyOutDir: true` 会全量删除 dist（含 public/openlib 的 7268 张静态缩略图），
 * 既触发编辑器的批量删除保护、又让每次构建重新复制 7000+ 文件。因此拆成两件事：
 * - `dist/openlib`、`dist/stress` 静态资源保留：文件名固定，Vite 每次覆盖，不会堆版本；
 * - `dist/assets` 是 Vite 每次重新生成的 hashed chunk：构建前清空，磁盘永远只留当前一套。
 *
 * 清理走 Node fs（构建进程内部），仅动 dist/assets，不触碰静态资源与其它目录。
 */
function cleanStaleBuildAssets(): Plugin {
  return {
    name: 'zeroexo-clean-stale-build-assets',
    apply: 'build',
    buildStart() {
      const dir = path.resolve(__dirname, 'dist', 'assets');
      if (!existsSync(dir)) return;
      let removed = 0;
      for (const name of readdirSync(dir)) {
        rmSync(path.join(dir, name), { recursive: true, force: true });
        removed += 1;
      }
      console.log(`[build] 清理历史 chunk ${removed} 个；dist/assets 仅保留本次构建产物`);
    },
  };
}

export default defineConfig({
  // GitHub Pages 项目站点：部署时设置 VITE_BASE_PATH=/<repo>/；自定义域名/根站点保持 /
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [resolveTsFromJsSpecifier(), tailwindcss(), react(), zeroexoFsServer(), cleanStaleBuildAssets(), versionManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_PKG.version),
    __MCP_VERSION__: JSON.stringify(MCP_PKG.version),
  },
  build: {
    // 静态资源目录（public/openlib 7268 张）原样保留；旧 hashed chunk 由
    // cleanStaleBuildAssets 在构建前清理。不要改回空目录全删：会触发批量删除保护。
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // ===== Monorepo 开发模式 alias: 直接指向 workspace 包的 src 目录,
      //       修改 packages/*/src 后 HMR 立即生效(无需手动 tsc build/watch) =====
      '@zeroexo/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@zeroexo/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@zeroexo/plugin-ai-provider': path.resolve(__dirname, './packages/plugins/ai-provider/src/index.ts'),
      '@zeroexo/plugin-connection': path.resolve(__dirname, './packages/plugins/connection/src/index.ts'),
      '@zeroexo/plugin-group': path.resolve(__dirname, './packages/plugins/group/src/index.ts'),
      '@zeroexo/plugin-history': path.resolve(__dirname, './packages/plugins/history/src/index.ts'),
      '@zeroexo/plugin-image-editor': path.resolve(__dirname, './packages/plugins/image-editor/src/index.ts'),
      '@zeroexo/plugin-interaction': path.resolve(__dirname, './packages/plugins/interaction/src/index.ts'),
      '@zeroexo/plugin-keyboard': path.resolve(__dirname, './packages/plugins/keyboard/src/index.ts'),
      '@zeroexo/plugin-layout': path.resolve(__dirname, './packages/plugins/layout/src/index.ts'),
      '@zeroexo/plugin-minimap': path.resolve(__dirname, './packages/plugins/minimap/src/index.ts'),
      '@zeroexo/plugin-node-registry': path.resolve(__dirname, './packages/plugins/node-registry/src/index.ts'),
      '@zeroexo/plugin-nodes': path.resolve(__dirname, './packages/plugins/nodes/src/index.tsx'),
      '@zeroexo/plugin-persistence': path.resolve(__dirname, './packages/plugins/persistence-localforage/src/index.ts'),
      '@zeroexo/plugin-render-react': path.resolve(__dirname, './packages/plugins/render-react/src/index.ts'),
      '@zeroexo/plugin-selection': path.resolve(__dirname, './packages/plugins/selection/src/index.ts'),
      '@zeroexo/plugin-theme': path.resolve(__dirname, './packages/plugins/theme/src/index.ts'),
      '@zeroexo/plugin-upload-queue': path.resolve(__dirname, './packages/plugins/upload-queue/src/index.ts'),
      '@zeroexo/preset-default': path.resolve(__dirname, './packages/presets/default/src/index.ts'),
    },
  },
  server: {
    port: 5180,
    host: true,
    // 允许任意 Host 访问:Cloudflare 公网隧道(trycloudflare.com 随机域名)测试用,
    // 默认只放行 localhost,公网访问会 403 Blocked request
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
      // Yjs 实时同步 WebSocket 转发到后端
      '/ws-sync': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
      '/ws-sync': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
