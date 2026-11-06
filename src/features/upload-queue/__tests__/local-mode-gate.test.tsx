/**
 * 本地模式（CLOUD_ENABLED=false）上传队列门控验证
 *
 * 背景：「上传完成」批量进度面板是云端同步队列时代的产物。
 * 本地版（Plan#83，数据落本地目录）下要求：
 * 1. useUploadQueue / useAssetUploadQueue 不在内存里维护上传会话
 *    （不写 upload-queue-store、不订阅 UploadQueue 事件）；
 * 2. UploadQueueOverlay 与 syncBadge 在两个挂载点为条件渲染（不挂载），
 *    而非 display:none 驻留。
 *
 * 本文件 = 功能断言（1）+ 结构断言（2）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { TaskId } from '@zeroexo/plugin-upload-queue';
import { useAssetUploadQueue } from '../use-upload-queue.js';
import { useUploadQueueStore } from '../upload-queue-store.js';
import { CLOUD_ENABLED } from '@/services/sync/sync-store.js';

// 上传落盘链路替换为假实现（不碰本地数据目录）
vi.mock('@/features/asset-picker/services/upload-asset.js', () => ({
  uploadAsset: vi.fn(async (file: File) => ({
    title: file.name,
    data: { kind: 'image', dataUrl: 'data:image/png;base64,x' },
  })),
}));

// hook 顶层依赖的画布重型链路（本测试只覆盖 uploadFiles，不会触达）
vi.mock('@zeroexo/core', () => ({ AddNodeCommand: class {} }));
vi.mock('@zeroexo/plugin-nodes', () => ({ createAssetNode: vi.fn() }));
vi.mock('@zeroexo/plugin-layout', () => ({ arrangeNodes: vi.fn(() => new Map()) }));

/** 最小 UploadQueue 桩：同步完成任务并支持事件订阅探测 */
function makeQueueStub() {
  let seq = 0;
  const tasks = new Map<TaskId, { status: string; result?: unknown; error?: string; input: unknown }>();
  const on = vi.fn(() => (): void => {});
  return {
    on,
    getTask: (id: TaskId) => tasks.get(id),
    addTasks: vi.fn((files: File[], handler: (f: File) => Promise<unknown>) => {
      const ids = files.map((f) => {
        const id = `task-${++seq}` as TaskId;
        tasks.set(id, { status: 'pending', input: f });
        void handler(f).then((result) => {
          const t = tasks.get(id);
          if (t) { t.status = 'done'; t.result = result; }
        });
        return id;
      });
      return ids;
    }),
    waitForTasks: vi.fn(async () => {
      // 等所有 handler 微任务落定
      await new Promise((r) => setTimeout(r, 0));
    }),
    removeTasks: vi.fn(),
    reset: vi.fn(),
  };
}

const SRC_ROOT = path.resolve(__dirname, '../../..');

describe('本地模式上传队列门控（CLOUD_ENABLED=false）', () => {
  beforeEach(() => {
    useUploadQueueStore.getState().reset();
  });

  it('前前提：本仓库当前为本地版构建', () => {
    expect(CLOUD_ENABLED).toBe(false);
  });

  it('uploadFiles 不维护上传会话：store 零写入、UploadQueue.on 零订阅，结果照常返回', async () => {
    const queue = makeQueueStub();
    const { result } = renderHook(() => useAssetUploadQueue(queue as never));

    const files = [new File(['x'], '下载.jpg', { type: 'image/jpeg' })];
    const out = await result.current.uploadFiles(files);

    // 结果照常返回（上传功能本身不受影响）
    expect(out).toHaveLength(1);
    // 内存里无上传会话：store 保持初始空态
    const s = useUploadQueueStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.visible).toBe(false);
    expect(s.total).toBe(0);
    expect(s.processing).toBe(false);
    // 连事件监听都没起
    expect(queue.on).not.toHaveBeenCalled();
  });
});

describe('条件渲染结构断言（不挂载，而非 display:none）', () => {
  it('editor-page.tsx：UploadQueueOverlay 与 syncBadge 均以 CLOUD_ENABLED 条件渲染', () => {
    const src = readFileSync(
      path.join(SRC_ROOT, 'pages/editor/editor-canvas/editor-page.tsx'),
      'utf8',
    );
    expect(src).toContain('{CLOUD_ENABLED && <UploadQueueOverlay');
    expect(src).toContain('syncBadge={!state.loading && CLOUD_ENABLED');
  });

  it('asset-library-modals.tsx：UploadQueueOverlay 以 CLOUD_ENABLED 条件渲染', () => {
    const src = readFileSync(
      path.join(SRC_ROOT, 'features/asset-library/components/asset-library-modals.tsx'),
      'utf8',
    );
    const gateIdx = src.indexOf('{CLOUD_ENABLED && (');
    const overlayIdx = src.indexOf('<UploadQueueOverlay');
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(overlayIdx).toBeGreaterThan(gateIdx);
  });

  it('use-upload-queue.ts：两个 hook 的 store 会话与事件订阅均由 CLOUD_ENABLED 门控', () => {
    const src = readFileSync(
      path.join(SRC_ROOT, 'features/upload-queue/use-upload-queue.ts'),
      'utf8',
    );
    // processFiles 与 uploadFiles 各一份门控
    expect(src.match(/const trackSession = CLOUD_ENABLED;/g)).toHaveLength(2);
    // 本地分支不起事件监听
    expect(src).toContain('const unsub = trackSession');
  });
});
