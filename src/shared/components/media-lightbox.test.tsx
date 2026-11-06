/**
 * MediaLightbox 单测（2026-11-05）——列表卡片「点图看大图」验收：
 * ① 挂载可见（遮罩 + aria-modal）；
 * ② img src 有值（storageKey 走统一解析链；直连条目走 url / fallbackUrl）；
 * ③ ESC 关闭；④ 左右方向键切换同列表前后条目；
 * ⑤ 点遮罩（按下+抬起都在遮罩、位移<6px）关闭，内容区/视频/工具条点击不关闭；
 *   按下在内容、抬起在遮罩不关闭；拖拽位移>6px 不关闭；关闭后焦点回触发元素；
 * ⑥ 解析失败显示可读原因，不留空白/坏图。
 *
 * 取图链在这里只 mock 入口（useMediaObjectUrl / useAuthResourceUrl），
 * 不新建、不 revoke blob URL —— 与产品实现约束一致。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useState } from 'react';

const { mediaUrlMock, authUrlMock, backendKeyMock } = vi.hoisted(() => ({
  mediaUrlMock: vi.fn(),
  authUrlMock: vi.fn(),
  backendKeyMock: vi.fn(() => false),
}));

vi.mock('@/shared/hooks/use-media-object-url.js', () => ({ useMediaObjectUrl: mediaUrlMock }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: authUrlMock }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: backendKeyMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }),
}));

import { MediaLightbox, type MediaLightboxItem } from './media-lightbox.js';

const ITEMS: MediaLightboxItem[] = [
  { id: 'a', title: '图 A', storageKey: 'cas:aaa.png' },
  { id: 'b', title: '图 B', storageKey: 'cas:bbb.png' },
  { id: 'c', title: '图 C', storageKey: 'cas:ccc.png' },
];

function ok(key: string | undefined) {
  return { url: `blob:${key}`, failed: false, reason: undefined, markError: vi.fn(), origin: 'blob' };
}

/** 受控 harness：与页面/抽屉同一接线（index 受控 + onClose 卸载） */
function Harness({ items, onCloseSpy }: {
  items: MediaLightboxItem[];
  onCloseSpy?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <MediaLightbox
      items={items}
      index={index}
      onIndexChange={setIndex}
      onClose={() => { setOpen(false); onCloseSpy?.(); }}
    />
  );
}

beforeEach(() => {
  mediaUrlMock.mockReset();
  authUrlMock.mockReset();
  backendKeyMock.mockReset();
  backendKeyMock.mockReturnValue(false);
  authUrlMock.mockReturnValue(undefined);
  mediaUrlMock.mockImplementation((key: string | undefined) => ok(key));
});

describe('MediaLightbox：可见性 / 取图 / 关闭 / 切换', () => {
  it('挂载可见：遮罩 + aria-modal，img src 来自统一解析链', () => {
    render(<Harness items={ITEMS} />);
    const overlay = document.querySelector('[data-lightbox]');
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute('aria-modal')).toBe('true');
    const img = document.querySelector('[data-lightbox] img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('blob:cas:aaa.png');
    expect(document.querySelector('[data-lightbox-title]')?.textContent).toContain('图 A');
    expect(document.querySelector('[data-lightbox-counter]')?.textContent?.replace(/\s/g, '')).toBe('1/3');
  });

  it('ESC 关闭查看器', () => {
    const onCloseSpy = vi.fn();
    render(<Harness items={ITEMS} onCloseSpy={onCloseSpy} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-lightbox]')).toBeNull();
  });

  it('方向键切换同列表前后条目（右→2，左→1）', () => {
    render(<Harness items={ITEMS} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.querySelector('[data-lightbox-counter]')?.textContent?.replace(/\s/g, '')).toBe('2/3');
    expect(document.querySelector('[data-lightbox-title]')?.textContent).toContain('图 B');
    const img2 = document.querySelector('[data-lightbox] img') as HTMLImageElement;
    expect(img2.getAttribute('src')).toBe('blob:cas:bbb.png');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(document.querySelector('[data-lightbox-counter]')?.textContent?.replace(/\s/g, '')).toBe('1/3');
  });

  // 2026-11-05 用户拍板：内容容器铺 92vw/92vh，用户看到的“空白处”在内容容器/舞台上，
  // 旧语义“点内容区不关闭”等于只能点那 4% 的外遮罩 → 点半天关不掉。现：空白处一点就关。
  it('点击内容区空白处 → 关闭（新语义）', () => {
    const onCloseSpy = vi.fn();
    render(<Harness items={ITEMS} onCloseSpy={onCloseSpy} />);
    const content = document.querySelector('[data-lightbox-content]') as HTMLElement;
    fireEvent.pointerDown(content, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(content, { clientX: 40, clientY: 40 });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-lightbox]')).toBeNull();
  });

  it('点击媒体本体（图片）→ 不关闭（平移/缩放不误关）', () => {
    const onCloseSpy = vi.fn();
    render(<Harness items={ITEMS} onCloseSpy={onCloseSpy} />);
    const img = document.querySelector('[data-lightbox] img') as HTMLElement;
    expect(img).toBeTruthy();
    fireEvent.pointerDown(img, { clientX: 8, clientY: 8 });
    fireEvent.pointerUp(img, { clientX: 8, clientY: 8 });
    expect(onCloseSpy).not.toHaveBeenCalled();
  });

  it('点击遮罩仍关闭（按下+抬起都在遮罩、位移 0）', () => {
    const onCloseSpy = vi.fn();
    render(<Harness items={ITEMS} onCloseSpy={onCloseSpy} />);
    const overlay = document.querySelector('[data-lightbox-backdrop]') as HTMLElement;
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(overlay, { clientX: 10, clientY: 10 });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-lightbox]')).toBeNull();
  });

  it('按下在内容、抬起在遮罩 → 不关闭', () => {
    const onCloseSpy = vi.fn();
    render(<Harness items={ITEMS} onCloseSpy={onCloseSpy} />);
    const overlay = document.querySelector('[data-lightbox-backdrop]') as HTMLElement;
    const content = document.querySelector('[data-lightbox-content]') as HTMLElement;
    fireEvent.pointerDown(content, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(overlay, { clientX: 40, clientY: 40 });
    expect(onCloseSpy).not.toHaveBeenCalled();
  });

  it('遮罩上拖拽位移 > 6px 松手 → 不关闭（拖拽平移/缩放不误关）', () => {
    const onCloseSpy = vi.fn();
    render(<Harness items={ITEMS} onCloseSpy={onCloseSpy} />);
    const overlay = document.querySelector('[data-lightbox-backdrop]') as HTMLElement;
    // jsdom 无 PointerEvent 构造器：用 MouseEvent + pointer* 类型，clientX/Y 才真实生效
    fireEvent(overlay, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    fireEvent(overlay, new MouseEvent('pointermove', { bubbles: true, clientX: 24, clientY: 22 }));
    fireEvent(overlay, new MouseEvent('pointerup', { bubbles: true, clientX: 24, clientY: 22 }));
    expect(onCloseSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-lightbox]')).toBeTruthy();
  });

  it('点视频画面不关闭（控制条可用）', () => {
    const onCloseSpy = vi.fn();
    render(<Harness items={[{ id: 'v', title: '视频', kind: 'video', storageKey: 'cas:v.mp4' }]} onCloseSpy={onCloseSpy} />);
    const video = document.querySelector('[data-lightbox-video]') as HTMLElement;
    fireEvent.pointerDown(video, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(video, { clientX: 40, clientY: 40 });
    fireEvent.click(video);
    expect(onCloseSpy).not.toHaveBeenCalled();
  });

  it('点遮罩关闭后焦点回到触发元素', () => {
    function FocusHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>打开</button>
          {open && (
            <MediaLightbox
              items={ITEMS}
              index={0}
              onIndexChange={() => undefined}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    const { getByTestId } = render(<FocusHarness />);
    const trigger = getByTestId('trigger') as HTMLButtonElement;
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.querySelector('[data-lightbox-backdrop]')).toBeTruthy();
    const overlay = document.querySelector('[data-lightbox-backdrop]') as HTMLElement;
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(overlay, { clientX: 10, clientY: 10 });
    expect(document.querySelector('[data-lightbox]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('解析失败：显示可读原因，不渲染坏图', () => {
    mediaUrlMock.mockReturnValue({
      url: undefined, failed: true, reason: '图片文件不可用（未落盘或已被清理）', markError: vi.fn(), origin: 'none',
    });
    render(<Harness items={ITEMS} />);
    expect(document.querySelector('[data-lightbox] img')).toBeNull();
    expect(document.querySelector('[data-lightbox-failed]')?.textContent).toContain('图片文件不可用');
  });

  it('开源库直连条目：主源失败 → 同源缩略图回退并标注', () => {
    const direct: MediaLightboxItem[] = [
      { id: 'o1', title: '开源图', url: 'https://cdn.example/x.jpg', fallbackUrl: '/openlib/thumbs/x.jpg' },
    ];
    render(<Harness items={direct} />);
    const img = document.querySelector('[data-lightbox] img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn.example/x.jpg');
    fireEvent.error(img);
    const fallbackImg = document.querySelector('[data-lightbox] img') as HTMLImageElement;
    expect(fallbackImg.getAttribute('src')).toBe('/openlib/thumbs/x.jpg');
    expect(document.querySelector('[data-lightbox-fallback]')?.textContent).toContain('本地缩略图');
  });

  // 2026-11-05 用户定稿：图片 / 视频 / 文本统一走同一个壳，不再弹旧详情面板
  it('视频：同壳内 <video controls autoplay muted> 且有 src', () => {
    render(<Harness items={[{ id: 'v', title: '视频', kind: 'video', storageKey: 'cas:v.mp4' }]} />);
    const video = document.querySelector('[data-lightbox-video]') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe('blob:cas:v.mp4');
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(document.querySelector('[data-lightbox] img')).toBeNull();
  });

  it('文本：<pre> 只读展示，保留换行且不出现旧详情面板', () => {
    render(<Harness items={[{ id: 't', title: '文本', kind: 'text', content: '第一行\n第二行' }]} />);
    const pre = document.querySelector('[data-lightbox-text]') as HTMLElement;
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toBe('第一行\n第二行');
    // 旧资产详情面板标记不得出现在资产查看路径
    expect(document.querySelector('[data-asset-detail-viewer]')).toBeNull();
  });
});
