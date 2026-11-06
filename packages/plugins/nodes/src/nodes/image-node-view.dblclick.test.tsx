/**
 * 画布图片节点「双击不变」回归单测（2026-11-05 用户拍板）。
 *
 * 背景：节点内双击曾把图片内容 transform 从 1× 切到 1:1（2026-11-04 既有实现），
 * 用户明确不要「节点内双击变大」。本轮只移除双击缩放路径，滚轮缩放与角柄 resize 保留。
 *
 * 断言：双击前后 node.size 不变（240×320）、img transform 不变、无缩放持久化写回。
 */
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../utils/hydrate.js', () => ({
  useProgressiveImage: () => 'data:image/png;base64,AAAA',
  buildBackendUrl: () => '',
}));
vi.mock('../base-node-view.js', () => ({
  BaseNodeView: ({ children }: any) => <div>{children}</div>,
  AIStateView: ({ children }: any) => <div>{children}</div>,
  useHasIncomingEdges: () => false,
  nodeActionBus: { emit: vi.fn() },
}));
vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({ theme: { node: { fill: '#000' }, toolbar: { textMuted: '#888' } } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../utils/replace-node-image.js', () => ({ replaceNodeImage: vi.fn() }));

import { ImageNodeView } from './image-node-view.js';

function makeNode() {
  return {
    id: 'img-1',
    type: 'image',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 320 },
    data: {
      kind: 'image',
      status: 'success',
      storageKey: 'cas:img.png',
      content: 'data:image/png;base64,AAAA',
      naturalWidth: 1024,
      naturalHeight: 1365,
    },
  } as any;
}

describe('图片节点双击：尺寸与内部缩放均不变', () => {
  it('双击前/后 node.size 与 img transform 完全一致，且不写回缩放状态', () => {
    const node = makeNode();
    const commandQueue = { execute: vi.fn() } as any;
    const { container } = render(
      <ImageNodeView
        node={node}
        pins={[]}
        isSelected={false}
        isHovered={false}
        forceShowPins={false}
        updateNode={vi.fn() as any}
        commandQueue={commandQueue}
        invK={1}
        connectionController={null}
        contentOnly
      />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    const transformBefore = img.style.transform;
    const sizeBefore = { ...node.size };

    fireEvent.doubleClick(img.parentElement as HTMLElement);

    expect(img.style.transform).toBe(transformBefore);
    expect(node.size).toEqual(sizeBefore);
    expect(node.size.width / node.size.height).toBeCloseTo(240 / 320, 5);
    expect(commandQueue.execute).not.toHaveBeenCalled();
  });
});
