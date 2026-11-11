// 运行时品牌配置（2026-11-11）：默认空对象，保证 /runtime-config.js 始终存在，不再 404。
// 云端自建部署可在发布时覆盖本文件注入 window.env.BRANDING_CONFIG 等配置。
window.env = window.env || {};
