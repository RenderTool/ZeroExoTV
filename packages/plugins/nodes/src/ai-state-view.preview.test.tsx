/**
 * AIStateView 实时预览回归：画布视频节点生成中必须把 /ws 帧铺到节点内容区。
 * 之前只有 contentOnly 分支传 previewImage，普通节点分支漏了，导致画布节点看不到预览帧。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AIStateView } from './base-node-view.js';

afterEach(cleanup);

describe('AIStateView 生成中实时预览', () => {
  it('status=loading 且传 previewImage → 渲染 data-generating-preview 图片', () => {
    const { container } = render(
      <AIStateView
        status="loading"
        accentColor="#ff6a00"
        emptyIcon={null}
        hasContent={false}
        onReplace={() => undefined}
        backgroundColor="#000"
        skeleton="media"
        skeletonKind="video"
        previewImage="data:image/png;base64,AAAA"
      >
        <div />
      </AIStateView>,
    );
    const img = container.querySelector('[data-generating-preview]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('status=idle 时不渲染预览图（避免把帧当成正式产物）', () => {
    const { container } = render(
      <AIStateView
        status="idle"
        accentColor="#ff6a00"
        emptyIcon={null}
        hasContent={false}
        onReplace={() => undefined}
        backgroundColor="#000"
        previewImage="data:image/png;base64,AAAA"
      >
        <div />
      </AIStateView>,
    );
    expect(container.querySelector('[data-generating-preview]')).toBeNull();
  });
});

describe('AIStateView 采样进度', () => {
  it('status=loading 且传 progress → 渲染进度条与按步数计算的宽度', () => {
    const { container } = render(
      <AIStateView
        status="loading"
        accentColor="#ff6a00"
        emptyIcon={null}
        hasContent={false}
        onReplace={() => undefined}
        backgroundColor="#000"
        skeleton="media"
        skeletonKind="video"
        progress={{ step: 3, totalSteps: 8, phaseLabel: '采样' }}
      >
        <div />
      </AIStateView>,
    );
    const bar = container.querySelector('[data-generating-progress-bar]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe('38%');
    expect(container.querySelector('[data-generating-progress-text]')).toBeTruthy();
  });

  it('未传 progress 时不渲染进度条（不影响其他生成节点）', () => {
    const { container } = render(
      <AIStateView
        status="loading"
        accentColor="#ff6a00"
        emptyIcon={null}
        hasContent={false}
        onReplace={() => undefined}
        backgroundColor="#000"
        skeleton="media"
      >
        <div />
      </AIStateView>,
    );
    expect(container.querySelector('[data-generating-progress]')).toBeNull();
  });
});
