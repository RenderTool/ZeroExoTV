/**
 * 部署路径与静态资源（2026-11-11 用户自定义域名 404 反馈）：
 * - 用相对 base（./）让同一份构建同时适配域名根与项目子路径；
 * - 运行环境默认值内联在 index.html，避免外部 runtime-config.js 404；
 * - index.html 带「旧 hash 资源 404 → 带 cache-bust 重载一次」的自愈脚本。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('静态资源与部署路径', () => {
  it('index.html：inline 默认 window.env，不再依赖外部 runtime-config.js', () => {
    const html = read('index.html');
    expect(html).toContain('window.env = window.env || {};');
    expect(html).not.toContain('src="%BASE_URL%runtime-config.js"');
    expect(html).not.toContain('src="/runtime-config.js"');
    expect(html).toContain('%BASE_URL%favicon.ico');
  });

  it('public/runtime-config.js 仍可作为覆盖文件存在', () => {
    expect(existsSync(resolve(process.cwd(), 'public/runtime-config.js'))).toBe(true);
  });

  it('两个部署工作流都用相对 base（同一构建适配根路径与子路径）', () => {
    for (const wf of ['.github/workflows/deploy-pages.yml', '.github/workflows/deploy-gh-pages.yml']) {
      expect(read(wf)).toContain('VITE_BASE_PATH: ./');
    }
  });

  it('index.html 带旧 hash 资源 404 的自愈重载（限频一次）', () => {
    const html = read('index.html');
    expect(html).toContain("url.indexOf('/assets/')");
    expect(html).toContain('location.replace');
    expect(html).toContain('zx_asset_reload_at');
  });
});
