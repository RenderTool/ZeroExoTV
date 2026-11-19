/**
 * 本地数据服务（fs-server）启动器（2026-11-18）。
 *
 * 为什么需要这一层：vite 里直接 spawn 的进程仍然是 dev 的子进程，
 * 用 taskkill /T、进程树清理、某些 IDE 的「停止全部」都会顺着父子链把它一起杀掉，
 * 表现就是 Agent 干活途中 8790 反复掉线。这里由一次性 launcher 再 spawn 一次，
 * launcher 立刻退出，服务进程的父进程变成已结束的 PID —— 清理 dev 的进程树碰不到它。
 *
 * 用法：node tools/start-fs-server.mjs <dist/index.js> [--port 8790]
 * 幂等由服务自身保证（端口已有实例即 process.exit(0)）。
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const entry = process.argv[2];
if (!entry) {
  process.stderr.write('[fs-server] 缺少入口文件路径\n');
  process.exit(1);
}

const extraArgs = process.argv.slice(3);
const child = spawn(process.execPath, [path.resolve(entry), '--fs-server', ...extraArgs], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
child.unref();
// launcher 立即退出：不等待、不代理日志（服务日志要看就单独前台跑 pnpm fs）
process.exit(0);
