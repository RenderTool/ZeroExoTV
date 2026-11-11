/**
 * 部署路径与静态资源（2026-11-11 用户自定义域名 404 反馈）：
 * - runtime-config / favicon 必须走 %BASE_URL%，否则子路径（/ZeroExoTV/）下会打到域名根目录 404；
 * - public/runtime-config.js 必须随构建产出，避免可选配置 404；
 * - index.html 带「旧 hash 资源 404 → 带 cache-bust 重载一次」的自愈脚本。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('静态资源与部署路径', () => {
  it('index.html：runtime-config / favicon 使用 BASE_URL，不再用域名根绝对路径', () => {
    const html = read('index.html');
    expect(html).toContain('%BASE_URL%runtime-config.js');
    expect(html).toContain('%BASE_URL%favicon.ico');
    expect(html).not.toContain('src="/runtime-config.js"');
    expect(html).not.toContain('href="/favicon.ico"');
  });

  it('public/runtime-config.js 存在且注入 window.env 默认值', () => {
    expect(existsSync(resolve(process.cwd(), 'public/runtime-config.js'))).toBe(true);
    expect(read('public/runtime-config.js')).toContain('window.env');
  });

  it('index.html 带旧 hash 资源 404 的自愈重载（限频一次）', () => {
    const html = read('index.html');
    expect(html).toContain("url.indexOf('/assets/')");
    expect(html).toContain('location.replace');
    expect(html).toContain('zx_asset_reload_at');
  });
});
