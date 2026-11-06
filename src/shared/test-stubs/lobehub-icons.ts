/**
 * Vitest 专用 stub：@lobehub/icons 内部 import @lobehub/fluent-emoji，
 * 其 es/index.js 用目录导入（Node ESM 不支持，jsdom 测试解析挂死）。
 * brand-icons 只需要图标组件引用，测试环境给每个具名导出返回 null 组件。
 * 仅经 vitest.config.ts 的 resolve.alias 注入，生产构建不受影响。
 */
import type { FC } from 'react';

const Icon: FC<{ size?: number | string; color?: string; className?: string }> = () => null;

export const OpenAI = Icon;
export const Claude = Icon;
export const Gemini = Icon;
export const DeepSeek = Icon;
export const Stability = Icon;
export const Volcengine = Icon;
export const Bailian = Icon;
export const SiliconCloud = Icon;
export const Qwen = Icon;
export const Doubao = Icon;
export const Zhipu = Icon;
export const Grok = Icon;
export const Minimax = Icon;
export const Moonshot = Icon;
export const Kimi = Icon;
export const Hunyuan = Icon;
export default Icon;
