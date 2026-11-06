import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vitest 单元测试配置
 *
 * 仅用于 ChatArea 拆分后的组件单元测试（jsdom 环境）。
 * 与 vite.config.ts 共享相同的 @ → ./src 别名。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // ===== 与 vite.config.ts 保持一致（Plan#71 T6/T8 单测需 import storyboard-utils →
      // @zeroexo/plugin-nodes 等 monorepo workspace 包） =====
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
      // @lobehub/icons（ai-config/brand-icons）内部 import @lobehub/fluent-emoji，
      // 其 es/index.js 目录导入 Node ESM 拒解析、jsdom 测试挂死 → 用 null 组件 stub 替代（生产构建走 vite.config）
      '@lobehub/icons': path.resolve(__dirname, './src/shared/test-stubs/lobehub-icons.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'packages/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/**',
        'packages/core/src/**',
      ],
    },
  },
});
