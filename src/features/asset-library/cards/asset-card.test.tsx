/**
 * 资产库卡片验收（2026-11-05）：
 * ① **列表页**卡片不显示悬浮「发送到画布 / 发送到导演台」动作按钮（抽屉侧通过显式
 *    showQuickActions 打开，见 MaterialGroup.lightbox.test.tsx），也不出现
 *    「当前没有打开的画布，可在画布内素材抽屉使用」提示；
 * ② 点击卡片任意位置 → 打开大图查看器（MediaLightbox 可见且 img src 有值）。
 *
 * 卡片渲染用真实 AssetCardGrid；查看器用真实 MediaLightbox（仅 mock 统一解析链入口）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useState } from 'react';

const { mediaUrlMock, authUrlMock } = vi.hoisted(() => ({
  mediaUrlMock: vi.fn(),
  authUrlMock: vi.fn(),
}));

vi.mock('@/shared/hooks/use-media-object-url.js', () => ({ useMediaObjectUrl: mediaUrlMock }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: authUrlMock }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: vi.fn(() => false) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }),
}));
// 卡片封面解析：测试只关心动作/点击，封面给空串走可读占位
vi.mock('@zeroexo/plugin-nodes', () => ({ usePreviewImage: () => '' }));

import { AssetCardGrid } from './asset-card.js';
import { MediaLightbox, type MediaLightboxItem } from '@/shared/components/media-lightbox.js';
import { MasonryGrid } from '@/shared/components/masonry-grid.js';

const THEME = {
  mode: 'light',
  toolbar: { text: '#111', textMuted: '#888', border: '#ddd', accent: '#1677ff' },
  node: { fill: '#fff' },
} as any;

const ASSET = {
  id: 'asset-1',
  title: '图 A',
  kind: 'image',
  scope: 'library',
  createdAt: '2026-11-05T00:00:00.000Z',
  data: { kind: 'image', storageKey: 'cas:aaa.png' },
} as any;

const T = ((k: string, d?: any) => (typeof d === 'string' ? d : k)) as any;

function renderCard(asset: any = ASSET) {
  return render(
    <AssetCardGrid
      item={asset}
      selected={false}
      multiSelectEnabled={false}
      onToggleSelect={() => undefined}
      onOpen={() => undefined}
      onRename={() => undefined}
      onDelete={() => undefined}
      onDownload={() => undefined}
      onContextMenu={() => undefined}
      // 关键：即便旧参数仍被透传，卡片也不得渲染悬浮动作按钮/提示
      onSendToCanvas={() => undefined}
      onSendToDirector={() => undefined}
      theme={THEME}
      t={T}
    />,
  );
}

/** 点击卡片 → 大图查看器（与页面/抽屉同一接线：onOpen → setLightbox） */
function PageLikeHarness() {
  const [lightbox, setLightbox] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);
  return (
    <>
      <AssetCardGrid
        item={ASSET}
        selected={false}
        multiSelectEnabled={false}
        onToggleSelect={() => undefined}
        onOpen={() => setLightbox({ items: [{ id: ASSET.id, title: ASSET.title, storageKey: 'cas:aaa.png' }], index: 0 })}
        onRename={() => undefined}
        onDelete={() => undefined}
        onDownload={() => undefined}
        onContextMenu={() => undefined}
        theme={THEME}
        t={T}
      />
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox((cur) => (cur ? { ...cur, index: i } : cur))}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

beforeEach(() => {
  mediaUrlMock.mockReset();
  mediaUrlMock.mockImplementation((key: string | undefined) => ({
    url: `blob:${key}`, failed: false, reason: undefined, markError: vi.fn(), origin: 'blob',
  }));
  authUrlMock.mockReset();
  authUrlMock.mockReturnValue(undefined);
});

describe('资产库卡片：悬浮动作按钮已移除', () => {
  it('不存在发送/导演台/下载悬浮按钮（只剩底部「更多」一个按钮）', () => {
    const { container } = renderCard();
    // 旧版悬浮动作区 = 两个 28×28 按钮（发送飞机 + 导演台/下载），移除后仅剩底部更多菜单按钮
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    // 抽屉专属快捷动作（showQuickActions）在列表页缺省关闭
    expect(container.querySelector('[data-card-action]')).toBeNull();
    expect(container.textContent).not.toContain('当前没有打开的画布');
    expect(container.textContent).not.toContain('openLib.noCanvasTarget');
    expect(container.textContent).not.toContain('assetLibrary.sendToCanvas');
    expect(container.textContent).not.toContain('assetLibrary.sendToDirector');
  });

  it('点击卡片任意位置 → 大图查看器可见且 img src 有值', () => {
    const { container } = render(<PageLikeHarness />);
    expect(document.querySelector('[data-lightbox]')).toBeNull();
    // 真实 DOM 手势序列：卡片根 pointerdown → pointerup → click
    const span = container.querySelector('span') as HTMLElement;
    const card = span.parentElement?.parentElement as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 12, clientY: 12 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 12, clientY: 12 });
    fireEvent.click(card);
    const overlay = document.querySelector('[data-lightbox]');
    expect(overlay).toBeTruthy();
    // portal 到 body：遮罩不受列表/弹窗祖先裁剪
    expect(overlay?.parentElement).toBe(document.body);
    const img = document.querySelector('[data-lightbox] img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('blob:cas:aaa.png');
    // ESC 关闭
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('[data-lightbox]')).toBeNull();
  });
});

describe('瀑布流卡片：封面高度按真实比例（类目尺寸实测）', () => {
  // 卡片不在 MasonryGrid 内时列宽回退 220px（与 useMasonryColumnWidth 缺省一致）
  const COL = 220;
  const make = (width?: number, height?: number) => ({
    ...ASSET,
    data: { kind: 'image', storageKey: 'cas:aaa.png', width, height },
  });

  it('竖长图（1:9）触上限 → 高度 1.9×列宽且 contain（卡内完整可见，不再裁）', () => {
    const { container } = renderCard(make(900, 8100));
    const cover = container.querySelector('[data-card-cover]') as HTMLElement;
    expect(cover.getAttribute('data-card-cover-fit')).toBe('contain');
    expect(parseFloat(cover.style.height)).toBeCloseTo(COL * 1.9, 3);
  });

  it('3:4 竖图 → 高度 4/3×列宽，cover', () => {
    const { container } = renderCard(make(900, 1200));
    const cover = container.querySelector('[data-card-cover]') as HTMLElement;
    expect(cover.getAttribute('data-card-cover-fit')).toBe('cover');
    expect(parseFloat(cover.style.height)).toBeCloseTo(COL * 4 / 3, 3);
  });

  it('宽图（16:9）触下限 → 高度 0.75×列宽', () => {
    const { container } = renderCard(make(1920, 1080));
    const cover = container.querySelector('[data-card-cover]') as HTMLElement;
    expect(parseFloat(cover.style.height)).toBeCloseTo(COL * 0.75, 3);
  });

  it('未知比例 → 先按 1:1 占位（列宽高度），且高度带过渡（解析后只过渡一次）', () => {
    const { container } = renderCard(make(undefined, undefined));
    const cover = container.querySelector('[data-card-cover]') as HTMLElement;
    expect(parseFloat(cover.style.height)).toBeCloseTo(COL, 3);
    expect(cover.style.transition).toContain('height');
  });
});

describe('瀑布流性能（无虚拟化实测）', () => {
  it('240 张卡片一次性挂载耗时', () => {
    const items = Array.from({ length: 240 }, (_, i) => ({
      ...ASSET,
      id: `asset-${i}`,
      title: `图 ${i}`,
      data: { kind: 'image', storageKey: `cas:${i}.png`, width: 900, height: 1200 },
    }));
    const t0 = performance.now();
    render(
      <MasonryGrid columns={5}>
        {items.map((item) => (
          <AssetCardGrid
            key={item.id}
            item={item}
            selected={false}
            multiSelectEnabled={false}
            onToggleSelect={() => undefined}
            onOpen={() => undefined}
            onRename={() => undefined}
            onDelete={() => undefined}
            onDownload={() => undefined}
            onContextMenu={() => undefined}
            theme={THEME}
            t={T}
          />
        ))}
      </MasonryGrid>,
    );
    const cost = performance.now() - t0;
    // jsdom 渲染耗时（生产浏览器更快）：给宽松上限，只防“O(n²) 级别的实现退化”
    console.log(`[masonry] 240 张卡片 jsdom 挂载 ${cost.toFixed(0)}ms`);
    expect(cost).toBeLessThan(5000);
  });
});
