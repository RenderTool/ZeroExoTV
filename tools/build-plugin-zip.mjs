/**
 * 打包 ComfyUI 插件 ZIP（2026-11-21 用户要求：下载的 zip 必须带版本号）。
 *
 * 版本唯一来源：comfyui-plugin/ComfyUI_ZeroExoNodes/__init__.py 的 PLUGIN_VERSION。
 * 产物：
 *   public/downloads/ComfyUI_ZeroExoNodes-<ver>.zip   ← 官网下载按钮指向这个
 *   public/downloads/ComfyUI_ZeroExoNodes.zip         ← 「最新」兼容入口（历史链接不 404）
 * 旧的带版本 zip 会被清掉，仓库里只留当前版本。
 *
 * 用法：node tools/build-plugin-zip.mjs
 * bump-version.mjs 会自动调用它（保证代码版本与 zip 永远一致）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = path.join(ROOT, 'comfyui-plugin', 'ComfyUI_ZeroExoNodes');
const OUT_DIR = path.join(ROOT, 'public', 'downloads');
const PLUGIN_NAME = 'ComfyUI_ZeroExoNodes';

export function readPluginVersion() {
  const initPy = fs.readFileSync(path.join(PLUGIN_DIR, '__init__.py'), 'utf8');
  const match = initPy.match(/PLUGIN_VERSION\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error('读不到 PLUGIN_VERSION（comfyui-plugin/ComfyUI_ZeroExoNodes/__init__.py）');
  return match[1];
}

function zipFolder(srcDir, outFile) {
  // Compress-Archive 打出来的是「目录本身」进 zip；先复制成临时目录保证顶层目录名固定
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-plugin-'));
  const stage = path.join(tmp, PLUGIN_NAME);
  fs.cpSync(srcDir, stage, { recursive: true });
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path '${stage}' -DestinationPath '${outFile}' -Force`,
      ],
      { stdio: 'pipe' },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function buildPluginZip() {
  const version = readPluginVersion();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 清旧版本包（只保留当前版本）
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (name.startsWith(`${PLUGIN_NAME}-`) && name.endsWith('.zip') && name !== `${PLUGIN_NAME}-${version}.zip`) {
      fs.rmSync(path.join(OUT_DIR, name));
    }
  }

  const versioned = path.join(OUT_DIR, `${PLUGIN_NAME}-${version}.zip`);
  zipFolder(PLUGIN_DIR, versioned);
  const latest = path.join(OUT_DIR, `${PLUGIN_NAME}.zip`);
  fs.copyFileSync(versioned, latest);

  const sizeKb = Math.round(fs.statSync(versioned).size / 1024);
  console.log(`plugin zip -> public/downloads/${PLUGIN_NAME}-${version}.zip (${sizeKb} KB)`);
  return { version, file: `${PLUGIN_NAME}-${version}.zip` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  buildPluginZip();
}
