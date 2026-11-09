/**
 * hooks 顺序回归测试（2026-11-04）
 *
 * 背景：用户报 "Rendered more hooks than during the previous render"。
 * AST 全量扫描 483 个生产文件（src 320 + packages 163），唯一真实违规：
 * packages/plugins/render-react/src/components/edge-layer.tsx 的 EdgeItem ——
 * `if (!endpoints) return null` 出现在 9×useRef + 1×useEffect 之前，
 * endpoints 空→非空翻转时同一 fiber hooks 数 0→10。
 * 修复：全部 hooks 上移至 early return 之前。
 *
 * 本测试自证：
 * 1) EdgeItem 连续两次 render（props 变化）不抛 hooks 错误（动态）
 * 2) edge-layer.tsx 源码中 EdgeItem 的 early return 位于全部 hooks 之后（静态防回退）
 * 3) HistoryGroup 空态→非空态两套输入连续 render 不抛 hooks 错误（动态）
 * 4) HistoryGroup/CanvasAssetsPanel 源码无 early return（静态防回退）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSrc = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf-8');

vi.mock('@zeroexo/plugin-nodes', () => ({
  usePreviewImage: () => '',
  nodeActionBus: { on: () => () => undefined, emit: () => undefined },
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
      modal: { confirm: vi.fn() },
    }),
  },
  Button: ({ children }: { children?: React.ReactNode }) => <button type="button">{children}</button>,
  Pagination: () => <div data-testid="pagination" />,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Dropdown: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

import { EdgeItem } from '../../../packages/plugins/render-react/src/components/edge-layer.js';
import { HistoryGroup } from './groups/HistoryGroup.js';
import { countHistoryByKind } from './history-utils.js';
import type { Asset } from '@/features/asset-picker/index.js';

/** 捕获 console.error 中的 hooks 顺序错误 */
function watchHookErrors(): { has: () => boolean; restore: () => void } {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return {
    has: () => spy.mock.calls.some((args) => /Rendered (more|fewer) hooks/.test(String(args[0]))),
    restore: () => spy.mockRestore(),
  };
}

// ===== 1) EdgeItem 动态：连续两次 render =====

const mkNode = (id: string, x: number) => ({
  id,
  type: 'test',
  position: { x, y: 0 },
  size: { width: 100, height: 50 },
});

const edgeItemProps = {
  edge: { id: 'e1', source: { nodeId: 'a', pinId: 'out' }, target: { nodeId: 'b', pinId: 'in' } },
  source: mkNode('a', 0),
  target: mkNode('b', 300),
  extensions: new Map(),
  pinDefaults: {},
  invK: 1,
  pathFn: () => 'M 0 0 L 1 1',
  stroke: '#fff',
  sw: 2,
  store: { subscribeDragOffsets: () => () => undefined },
  // `as never` 会让 spread 变成非对象类型（TS2698）；用组件 props 类型断言保留字段检查
} as unknown as Parameters<typeof EdgeItem>[0];

describe('EdgeItem hooks 顺序（修复后）', () => {
  afterEach(() => cleanup());

  it('连续两次 render（几何变化）不抛 hooks 错误', () => {
    const w = watchHookErrors();
    const { rerender } = render(
      <svg><EdgeItem {...edgeItemProps} /></svg>,
    );
    rerender(
      <svg><EdgeItem {...edgeItemProps} source={mkNode('a', 50)} /></svg>,
    );
    expect(w.has()).toBe(false);
    w.restore();
  });

  it('源码静态断言：EdgeItem 的 early return 在全部 hooks 之后', () => {
    const src = readSrc('packages/plugins/render-react/src/components/edge-layer.tsx');
    const start = src.indexOf('export const EdgeItem');
    const end = src.indexOf('interface ActiveVisualGroup', start);
    const body = src.slice(start, end);
    // 匹配真实语句行（排除注释里对 guard 字符串的引用）
    const guard = body.search(/\n\s*if \(!endpoints\) return null;/);
    expect(guard).toBeGreaterThan(-1);
    // 所有 hooks 必须出现在 guard 之前
    for (const hook of ['useRef', 'useEffect']) {
      const last = body.lastIndexOf(`${hook}(`);
      expect(last).toBeGreaterThan(-1);
      expect(last, `${hook} 必须早于 early return`).toBeLessThan(guard);
    }
    expect(body.indexOf('const gRef = useRef')).toBeLessThan(guard);
  });
});

// ===== 2) HistoryGroup 动态：空态→非空态两套输入 =====

const PID = 'proj-hooks-1';
const theme = {
  mode: 'dark',
  toolbar: { text: '#fff', textMuted: '#888', accent: '#e94560' },
} as never;

function mkStore(assets: Asset[]) {
  return {
    allAssets: assets,
    historyProjectId: PID,
    historyCounts: countHistoryByKind(assets, PID),
    libraryHashes: new Set<string>(),
    promoteToLibrary: vi.fn(async () => undefined),
    handleDownloadItem: vi.fn(async () => undefined),
  } as never;
}

const genAsset = {
  id: 'g1',
  title: '生成图',
  kind: 'image',
  scope: 'project',
  projectId: PID,
  createdAt: '2026-11-04T04:00:00.000Z',
  data: { kind: 'image', dataUrl: '', storageKey: 'cas:x.png', width: 800, height: 450, origin: 'generation' },
} as Asset;

describe('HistoryGroup hooks 顺序（空态/非空态）', () => {
  afterEach(() => cleanup());

  it('空态→非空态连续 render 不抛 hooks 错误', () => {
    const w = watchHookErrors();
    const { rerender } = render(<HistoryGroup store={mkStore([])} theme={theme} />);
    rerender(<HistoryGroup store={mkStore([genAsset])} theme={theme} />);
    rerender(<HistoryGroup store={mkStore([])} theme={theme} />);
    expect(w.has()).toBe(false);
    w.restore();
  });

  it('源码静态断言：本轮新组件无 early return（hooks 不会被跳过）', () => {
    for (const rel of [
      'src/features/canvas-assets/groups/HistoryGroup.tsx',
      'src/features/canvas-assets/CanvasAssetsPanel.tsx',
    ]) {
      const src = readSrc(rel);
      expect(src.includes('return null'), `${rel} 不应含 early return`).toBe(false);
    }
  });
});
