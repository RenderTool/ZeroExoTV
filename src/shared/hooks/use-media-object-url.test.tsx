/**
 * useMediaObjectUrl — hook 级验收测试（2026-11-05 简化版）
 *
 * 验收契约（对应「图片整片空白」事故）：
 * ① 同一 storageKey 多个消费者挂载 → 共享同一 URL，只解析一次存储；
 * ② 组件卸载 / 大批量挂载卸载都**不 revoke** 任何 URL（会话级缓存）；
 * ③ 模拟 onError：markError → 丢弃缓存 → 重读存储 → 新 URL 自动恢复；
 *    重解析仍失败 → 显示可读原因（不展示坏图）；
 * ④ IMAGE_CONTENT_UPDATED_EVENT（内容覆盖写）→ 同 key 全部持有者换新 URL，
 *    旧 URL 仍不 revoke。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { __configureMediaUrlProviderForTests, IMAGE_CONTENT_UPDATED_EVENT } from '@zeroexo/plugin-persistence';
import { useMediaObjectUrl } from './use-media-object-url.js';

/** 可编程变体链解析（按调用序出队返回值：{ blob }=成功 / null=无文件） */
const chainResults: Array<{ blob: Blob; origin: string } | null> = [];
const chainMock = vi.fn(async () => chainResults.shift() ?? null);
vi.mock('@/shared/media/resolve-media-blob.js', () => ({
  resolveMediaBlob: vi.fn(),
  resolveMediaBlobChain: () => chainMock(),
}));

let seq = 0;
const createMock = vi.fn((): string => {
  seq += 1;
  return `blob:hook:${seq}`;
});
const revokeMock = vi.fn();

beforeEach(() => {
  // 先重置 provider（清理上一用例缓存时可能产生 revoke），再挂 mock 并清计数，
  // 否则上一用例的回收会被误算进本用例断言
  __configureMediaUrlProviderForTests();
  seq = 0;
  chainResults.length = 0;
  chainMock.mockClear();
  createMock.mockClear();
  revokeMock.mockClear();
  (URL as unknown as Record<string, unknown>).createObjectURL = createMock;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeMock;
});

afterEach(() => cleanup());

interface ProbeProps {
  storageKey?: string;
}

/** 消费者探针：渲染解析出的 URL / failed / reason，按钮触发 markError（模拟 <img> onError） */
function Probe({ storageKey }: ProbeProps): ReactElement {
  const media = useMediaObjectUrl(storageKey, 'image', ['preview', 'thumb']);
  return createElement(
    'div', {},
    createElement('span', { 'data-testid': 'url' }, media.url),
    createElement('span', { 'data-testid': 'failed' }, String(media.failed)),
    createElement('span', { 'data-testid': 'reason' }, media.reason),
    createElement('button', { 'data-testid': 'err', onClick: () => media.markError() }, 'err'),
  );
}

describe('useMediaObjectUrl（会话级媒体 URL）', () => {
  it('① 同 key 多消费者共享同一 URL；卸载不回收', async () => {
    chainResults.push({ blob: new Blob(['x']), origin: 'preview' });
    const a = render(createElement(Probe, { storageKey: 'image:shared' }));
    await waitFor(() => expect(within(a.container).getByTestId('url').textContent).toBe('blob:hook:1'));
    const b = render(createElement(Probe, { storageKey: 'image:shared' }));
    await waitFor(() => expect(within(b.container).getByTestId('url').textContent).toBe('blob:hook:1'));
    expect(createMock).toHaveBeenCalledTimes(1); // 只创建一个 URL
    expect(chainMock).toHaveBeenCalledTimes(1); // 只读一次存储

    a.unmount();
    expect(revokeMock).toHaveBeenCalledTimes(0);
    expect(within(b.container).getByTestId('url').textContent).toBe('blob:hook:1');

    b.unmount();
    expect(revokeMock).toHaveBeenCalledTimes(0); // 会话内不中途回收
  });

  it('② 大批量挂载卸载不会 revoke 任何在用 URL', async () => {
    chainResults.push({ blob: new Blob(['x']), origin: 'preview' });
    const a = render(createElement(Probe, { storageKey: 'image:keep' }));
    const b = render(createElement(Probe, { storageKey: 'image:keep' }));
    await waitFor(() => expect(within(b.container).getByTestId('url').textContent).toBe('blob:hook:1'));
    a.unmount();
    for (let i = 0; i < 300; i++) {
      chainResults.push({ blob: new Blob(['y']), origin: 'preview' });
      render(createElement(Probe, { storageKey: `image:press-${i}` })).unmount();
    }
    await waitFor(() => expect(revokeMock).toHaveBeenCalledTimes(0));
    expect(within(b.container).getByTestId('url').textContent).toBe('blob:hook:1');
    expect(within(b.container).getByTestId('failed').textContent).toBe('false');
    b.unmount();
  });

  it('③ 模拟 onError（URL 失效）：丢弃缓存 → 重读存储 → 新 URL 自动恢复，旧 URL 不 revoke', async () => {
    chainResults.push({ blob: new Blob(['x']), origin: 'preview' });
    const { container } = render(createElement(Probe, { storageKey: 'image:heal' }));
    await waitFor(() => expect(within(container).getByTestId('url').textContent).toBe('blob:hook:1'));

    chainResults.push({ blob: new Blob(['x2']), origin: 'preview' }); // 重读存储有文件
    fireEvent.click(within(container).getByTestId('err'));
    await waitFor(() => expect(within(container).getByTestId('url').textContent).toBe('blob:hook:2'));
    expect(revokeMock).toHaveBeenCalledTimes(0); // 旧 URL 仍可能被别的 <img> 使用
    expect(within(container).getByTestId('failed').textContent).toBe('false');
  });

  it('③b 重读仍失败：显示可读原因（素材文件缺失），不展示坏图', async () => {
    chainResults.push({ blob: new Blob(['x']), origin: 'preview' });
    const { container } = render(createElement(Probe, { storageKey: 'image:gone' }));
    await waitFor(() => expect(within(container).getByTestId('url').textContent).toBe('blob:hook:1'));

    chainResults.push(null); // 重读存储：文件没了
    fireEvent.click(within(container).getByTestId('err'));
    await waitFor(() => expect(within(container).getByTestId('failed').textContent).toBe('true'));
    expect(within(container).getByTestId('url').textContent).toBe('');
    expect(within(container).getByTestId('reason').textContent).toContain('素材文件缺失');
  });

  it('④ IMAGE_CONTENT_UPDATED_EVENT：同 key 覆盖写后全部持有者自动换新 URL', async () => {
    chainResults.push({ blob: new Blob(['x']), origin: 'preview' });
    const a = render(createElement(Probe, { storageKey: 'image:upd' }));
    const b = render(createElement(Probe, { storageKey: 'image:upd' }));
    await waitFor(() => expect(within(a.container).getByTestId('url').textContent).toBe('blob:hook:1'));

    chainResults.push({ blob: new Blob(['x2']), origin: 'preview' });
    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_CONTENT_UPDATED_EVENT, { detail: { storageKey: 'image:upd' } }),
      );
    });
    await waitFor(() => expect(within(a.container).getByTestId('url').textContent).toBe('blob:hook:2'));
    await waitFor(() => expect(within(b.container).getByTestId('url').textContent).toBe('blob:hook:2'));
    expect(within(a.container).getByTestId('url').textContent).toBe(within(b.container).getByTestId('url').textContent);
    expect(revokeMock).toHaveBeenCalledTimes(0);
    expect(chainMock).toHaveBeenCalledTimes(2); // 初始一次 + 内容事件重读一次
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
