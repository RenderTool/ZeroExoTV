/**
 * Vitest 专用 stub：@lobehub/fluent-emoji 的 es/index.js 用目录导入（Node ESM 不支持，
 * jsdom/vitest 解析报错）。测试环境不需要真实表情渲染，提供最小实现。
 * 仅经 vitest.config.ts 的 resolve.alias 注入，生产构建不受影响。
 */
export const FluentEmoji = (_props: { emoji?: string; size?: number }): null => null;
export default FluentEmoji;
