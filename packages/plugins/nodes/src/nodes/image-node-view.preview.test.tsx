/**
 * 图片节点生成中：采样预览帧 / 步进进度必须传到 AIStateView（与视频节点同款）。
 * 之前只有视频节点接了这两项，图片节点一直是纯骨架、没有进度。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock('../utils/hydrate.js', () => ({
  useProgressiveImage: () => 'data:image/png;base64,AAAA',
  buildBackendUrl: () => '',
}));
vi.mock('../base-node-view.js', () => ({
  BaseNodeView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AIStateView: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    captured.props = props;
    return <div>{props.children as React.ReactNode}</div>;
  },
  useHasIncomingEdges: () => false,
  nodeActionBus: { emit: vi.fn() },
}));
vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({ theme: { node: { fill: '#000' }, toolbar: { textMuted: '#888' } } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../utils/replace-node-image.js', () => ({ replaceNodeImage: vi.fn() }));

import { ImageNodeView } from './image-node-view.js';
import {
  clearGeneratingProgress,
  clearGeneratingPreview,
  setGeneratingPreview,
  setGeneratingProgress,
} from '../generating-preview-store.js';

function makeNode(status: string) {
  return {
    id: 'img-gen-1',
    type: 'image',
    position: { x: 0, y: 0 },
    size: { width: 340, height: 240 },
    data: { kind: 'image', status, content: '' },
  } as never;
}

function renderNode(status: string): void {
  render(
    <ImageNodeView
      node={makeNode(status)}
      pins={[]}
      isSelected={false}
      isHovered={false}
      forceShowPins={false}
      updateNode={vi.fn() as never}
      commandQueue={{ execute: vi.fn() } as never}
      invK={1}
      store={{} as never}
    />,
  );
}

afterEach(() => {
  clearGeneratingPreview('img-gen-1');
  clearGeneratingProgress('img-gen-1');
  captured.props = null;
});

describe('图片节点生成中预览/进度', () => {
  it('status=loading 时把预览帧与步进传给 AIStateView', () => {
    setGeneratingPreview('img-gen-1', 'data:image/jpeg;base64,FRAME');
    setGeneratingProgress('img-gen-1', { step: 7, totalSteps: 25 });
    renderNode('loading');
    expect(captured.props?.previewImage).toBe('data:image/jpeg;base64,FRAME');
    expect(captured.props?.progress).toMatchObject({ step: 7, totalSteps: 25 });
  });

  it('非 loading 态不传（不污染历史图/失败态）', () => {
    setGeneratingPreview('img-gen-1', 'data:image/jpeg;base64,FRAME');
    renderNode('success');
    expect(captured.props?.previewImage).toBeUndefined();
    expect(captured.props?.progress).toBeUndefined();
  });
});
