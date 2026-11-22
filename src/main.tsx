// 存储底座装配（必须第一条 import：早于任何 localforage 实例创建，负责磁盘驱动与回落顺序）
import { bootReady } from './platform/boot.js';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@zeroexo/plugin-theme';
import { setExternalMediaBlobResolver } from '@zeroexo/plugin-persistence';
import { getMediaBlob } from './platform/media.js';
import { App } from './app.js';
// TailwindCSS 全局样式 (必须在 React render 之前执行)
import './app.css';
// 副作用初始化 i18n(必须在 React render 之前执行)
import './i18n/config.js';
// Tailwind CSS v4 已通过 app.css 接管全局样式(字体/动画/滚动条)
// global-styles.ts 已迁移到 app.css 并删除
// 本地版（Plan#83）：自动孤儿回收已停用——磁盘上静默删用户文件风险不可逆；
// 改为「未引用清单只报告 + 用户在存储面板勾选删」与「删项目时级联删其目录」。
// （原实现：startPeriodicCleanup(24 * 60)）

// 导演台成片写在 platform/media 磁盘（video:assets/...），不是 persistence 的 media_files 桶；
// 注册磁盘解析器，让 useHydratedContent/resolveMediaUrl 能读到正式视频与首帧。
setExternalMediaBlobResolver(getMediaBlob);

// 2026-11-19 用户要求：预览 / 引导里的视频禁止进浏览器「画中画」。
// 1) 关键 <video> 已加 disablePictureInPicture；
// 2) 这里做全局兜底：右键菜单 / 快捷键 / 站点例外进入 PiP 时立刻退出，
//    否则缩略图被拉成浮动小窗非常影响体验。
document.addEventListener('enterpictureinpicture', () => {
  if (document.pictureInPictureElement) {
    void document.exitPictureInPicture().catch(() => { /* ignore */ });
  }
}, true);

// 渲染不再无限等待启动链（2026-11-22 白屏修复）：最多 1s，超时也先渲染，
// 由 RootGate / 授权提示接住，绝不让用户看到一张空白页。
const BOOT_TIMEOUT_MS = 1000;
const bootSettled = Promise.race([
  bootReady,
  new Promise<void>((resolve) => { setTimeout(resolve, BOOT_TIMEOUT_MS); }),
]);
void bootSettled.then(() => {
  document.getElementById('boot-splash')?.remove();
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <ThemeProvider initialMode="dark">
      <App />
    </ThemeProvider>,
  );
});
