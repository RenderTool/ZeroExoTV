/**
 * DirectorPromptPanel — 2026-11-04 线上版式对齐 + 槽位池 + @ 高亮 + 主体 Tab 验收
 *
 * 覆盖：
 * 1. 线上截图版式：标题行（L1）/槽位池（L2）/底部工具行（L7 批量 + 片段编辑/视频公共参数入口）；
 *    v5 抄来元素（data-card-title 等）= 0；@ 按钮残留 = 0；加号方块 = 1
 * 2. 提示词区 minHeight ≥180、overflow-y = auto、contentEditable
 * 3. 积分/credit 残留 = 0
 * 4. 资产面板：Tab = 资产/主体（小工具 = 0）；分组优先级 已入槽 → 项目资产 → 公共资产
 * 5. 槽位语义：池内再 @ 不新增槽位；池外有空位入栈 PictureN；满槽拒绝（无写入）；替换槽位 prompt 不变
 * 6. 主体状态图 → 图片槽位 + 槽位号引用
 * 7. 轨道 overlay 注入：绿箭头（勾上且有前序）/勾选框（模式态）
 * 8. 计数行/原生 select 残留 = 0
 *
 * react-i18next 与 asset-picker 全部 mock；antd 真实渲染（Popover portal 到 body）。
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { App as AntdApp } from 'antd';
import { WORKSPACE_SURFACE_RADIUS } from '@/shared/components/LAYOUT_CONSTANTS.js';
import {
  ASSET_PICK_DETAIL_WIDTH,
  ASSET_PICK_PANEL_HEIGHT,
  ASSET_PICK_PANEL_WIDTH,
  ASSET_PICK_ROW_HEIGHT,
  ASSET_PICK_THUMB_SIZE,
} from './director-prompt-panel.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let s = fallback ?? key;
      if (opts) for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('i18next', () => ({
  default: { use: () => ({ init: () => Promise.resolve() }) },
  createInstance: () => ({ use: () => ({ init: () => Promise.resolve() }) }),
}));

const mockAssets = vi.hoisted(() => ({
  assets: [
    { id: 'a1', title: '主角图', scope: 'project', data: { kind: 'image', dataUrl: 'data:image/png;base64,x', storageKey: 'k1' } },
    { id: 'a2', title: '场景图', scope: 'library', data: { kind: 'image', dataUrl: 'data:image/png;base64,y', storageKey: 'k2' } },
  ] as unknown[],
}));
vi.mock('@/features/asset-picker/use-assets.js', () => ({
  useAssets: () => ({ assets: mockAssets.assets, loading: false, error: null }),
}));

// 缩略图派生档解析 mock（thumb/preview/原图 三档可控，'' = 存储无此档；事件名为真实常量值）。
// 2026-11-05 媒体 URL 层重做后，thumb-image 经 useMediaObjectUrl + resolveMediaBlobChain 解析：
// persistence mock 同时提供「按变体读 Blob」（getImageVariantBlob/getMediaBlob，沿用 thumbMock 控档）
// 与「object URL 提供者」（acquire/release/subscribe/invalidate；acquire 返回确定性 URL
// blob:<origin>:<key>，invalidate 通知同 key 订阅者重解析——事件自愈与错误重试链路用）。
const thumbMock = vi.hoisted(() => ({
  thumb: vi.fn(async (k?: string) => (k ? `blob:thumb:${k}` : '')),
  preview: vi.fn(async (k?: string) => (k ? `blob:preview:${k}` : '')),
  orig: vi.fn(async (k?: string) => (k ? `blob:orig:${k}` : '')),
}));
const mediaUrlSubs = vi.hoisted(() => new Map<string, Set<() => void>>());
vi.mock('@zeroexo/plugin-persistence', () => ({
  IMAGE_CONTENT_UPDATED_EVENT: 'zeroexo:image-content-updated',
  // 2026-11-06 征集 #186 档位契约：ThumbImage / localVariants 按设计尺寸×DPR 选档
  IMAGE_VARIANT_SPECS: {
    thumb: { maxEdge: 96, quality: 0.6, sourceMinEdge: 96 },
    preview: { maxEdge: 1024, quality: 0.8, sourceMinEdge: 1024 },
    orig: { maxEdge: Number.POSITIVE_INFINITY, quality: 1, sourceMinEdge: 0 },
  },
  DEFAULT_DPR: 2,
  pickImageVariant: (cssPx: number, dpr = 2) =>
    cssPx * dpr <= 96 ? 'thumb' : cssPx * dpr <= 1024 ? 'preview' : 'orig',
  imageVariantChain: (cssPx: number, dpr = 2) =>
    cssPx * dpr <= 96 ? ['thumb', 'preview', 'orig']
      : cssPx * dpr <= 1024 ? ['preview', 'orig', 'thumb']
        : ['orig', 'preview', 'thumb'],
  CAS_KEY_PATTERN: /^cas:([0-9a-f]{64})\.[a-z0-9]+$/i,
  casVariantPath: (hash: string, variant: string) => `media/cas/${hash}.${variant}.jpg`,
  generateImageVariantBlobs: async () => ({ thumb: null, preview: null }),
  // 新解析链（resolve-media-blob）：按变体读 Blob（null = 存储无此档）
  getImageVariantBlob: async (key: string, variant: 'thumb' | 'preview' | 'orig') => {
    const url = variant === 'thumb' ? await thumbMock.thumb(key)
      : variant === 'preview' ? await thumbMock.preview(key)
        : await thumbMock.orig(key);
    return url ? ({ size: 1 } as Blob) : null;
  },
  getMediaBlob: async (key: string) => {
    const url = await thumbMock.orig(key);
    return url ? ({ size: 1 } as Blob) : null;
  },
  getVideoThumbBlob: async () => null,
  // 媒体 URL 提供者（use-media-object-url 契约）
  acquireMediaObjectUrl: async (
    providerKey: string,
    resolver: () => Promise<{ blob: Blob; origin: string } | null>,
  ) => {
    const res = await resolver();
    if (!res) return { ok: false as const, reason: '源未就绪（storageKey 未解析到文件）' };
    const key = providerKey.split('|').pop();
    return { ok: true as const, url: `blob:${res.origin}:${key}`, origin: res.origin };
  },
  releaseMediaObjectUrl: () => {},
  subscribeMediaObjectUrl: (key: string, fn: () => void) => {
    let set = mediaUrlSubs.get(key);
    if (!set) { set = new Set(); mediaUrlSubs.set(key, set); }
    set.add(fn);
    return () => { set?.delete(fn); };
  },
  invalidateMediaObjectUrl: (key: string) => {
    mediaUrlSubs.get(key)?.forEach((fn) => fn());
  },
  // 旧字符串解析链导出保留（兼容仍用它的调用方）
  resolveThumbnailUrl: thumbMock.thumb,
  resolvePreviewUrl: thumbMock.preview,
  resolveImageUrl: thumbMock.orig,
}));

// ===== 开源页签（OpenLibBrowser 嵌入）测试桩（2026-11-05）=====
// mock 数据源/入库/清理三模块；use-cas-upload 也 mock（导入链路单测在 use-cas-upload 侧）。
const openLibMock = vi.hoisted(() => {
  const entry = (n: number) => ({
    id: `openlib:hanami:s${n}`, gallery: 'hanami', srcId: `s${n}`, title: `开源图${n}`,
    category: 'cat-a', tags: [], adult: false, storage: 'remote',
    imageUrl: `https://cdn.test/${n}.jpg`, cdnUrl: `https://cdn.test/${n}-big.jpg`,
    sourceUrl: 'https://src.test/x',
    license: { type: 'cc0', commercialUse: true, redistribution: true },
  });
  return {
    entry,
    getOpenLibMeta: vi.fn(async () => ({
      schemaVersion: 2, generatedAt: '2026-11-05',
      source: { repo: 'r', site: 's' }, ageGate: { defaultHidden: true, note: 'n' },
      galleries: {
        hanami: {
          id: 'hanami', title: '花见', indexed: true, entryCount: 2,
          categories: [{ id: 'cat-a', title: '分类A', count: 2 }],
          sourceUrl: 'https://src.test/x',
          license: { type: 'cc0', commercialUse: true, redistribution: true },
        },
      },
      totals: { entries: 2, bundled: 0, remote: 2, adult: 0 },
    })),
    queryOpenLib: vi.fn(async () => ({ items: [entry(1), entry(2)], total: 2, page: 1, pageSize: 60, adultHidden: 0 })),
    resolveOpenLibImageUrl: vi.fn(async (e: { imageUrl: string }) => e.imageUrl),
    isAgeConfirmed: vi.fn(() => false),
    confirmAge: vi.fn(),
    revokeAgeConfirmation: vi.fn(),
    importOpenLibEntry: vi.fn(async (e: { id: string; title: string }) => ({
      id: e.id, title: e.title, scope: 'library',
      data: { kind: 'image', dataUrl: 'data:image/png;base64,x' },
    })),
  };
});
vi.mock('@/features/open-library/open-library.js', () => openLibMock);
vi.mock('@/features/open-library/import-open-lib-entry.js', () => ({
  importOpenLibEntry: openLibMock.importOpenLibEntry,
}));
vi.mock('@/features/open-library/cleanup-open-lib-spill.js', () => ({
  runOpenLibSpillCleanupOnce: vi.fn(async () => undefined),
}));
vi.mock('@/features/canvas-assets/use-cas-upload.js', () => ({
  useCasUpload: () => vi.fn(async () => []),
}));
// 统一导航入口 mock：导演台内部的 @ 插入 / 槽位替换不跳转（人已在原地）；
// 跳转只发生在非导演台来源走 sendAssetToWorkbench 的路径（send-to-workbench.test.ts 覆盖）
const navMock = vi.hoisted(() => ({ navigateToView: vi.fn() }));
vi.mock('@/features/canvas-tabs/navigate-to-view.js', () => navMock);

import { DirectorPromptPanel } from './director-prompt-panel.jsx';
import type { WorkbenchSharedParams } from '@/entities/slot-containers.js';
import type { WorkbenchShot } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import type { ProductionItem } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import type { SubjectTree } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';

const theme = {
  mode: 'dark',
  toolbar: { panel: '#1e1e20', text: '#e5e5e5', textMuted: '#888888', accent: '#3b82f6' },
} as never;

function makeShared(patch?: Partial<WorkbenchSharedParams>): WorkbenchSharedParams {
  return {
    enabled: true, assets: [], presetId: 'h3',
    params: { aspect: '16:9', scaleFactor: 1 },
    ...patch,
  };
}

function makeShot(patch?: Partial<WorkbenchShot>): WorkbenchShot {
  return {
    id: 'seg-2', number: 2, description: '', shotType: '中景', duration: 10,
    imagePrompt: '一位老人回头', status: 'pending', clipState: 'placeholder',
    ...patch,
  } as WorkbenchShot;
}

const SUBJECTS = [
  {
    id: 'sub-1', kind: 'character', name: '季莹', aliases: [], consistency: '',
    voice: '', note: '', episodeIds: [], coverKey: 'sk-1',
    images: [{ storageKey: 'sk-1', prompt: '', note: '', tags: [], stateTag: '基础形象' }],
  },
] as unknown as ProductionItem[];

function renderPanel(overrides?: {
  shared?: WorkbenchSharedParams;
  shot?: WorkbenchShot;
  subjects?: ProductionItem[];
  subjectTrees?: SubjectTree[];
  onSharedChange?: (p: Partial<WorkbenchSharedParams>) => void;
  onShotChange?: (p: Partial<WorkbenchShot>) => void;
  /** 2026-11-06 标题区跳转胶囊（宿主受控传入） */
  shotIndex?: number;
  totalShots?: number;
  onPrevShot?: () => void;
  onNextShot?: () => void;
}) {
  const shared = overrides?.shared ?? makeShared();
  const shot = overrides?.shot ?? makeShot();
  const utils = render(
    createElement(
      AntdApp,
      null,
      createElement(DirectorPromptPanel, {
        shared,
        onSharedChange: overrides?.onSharedChange ?? (() => {}),
        shot,
        shotIndex: overrides?.shotIndex ?? 1,
        totalShots: overrides?.totalShots ?? 5,
        onPrevShot: overrides?.onPrevShot ?? (() => {}),
        onNextShot: overrides?.onNextShot ?? (() => {}),
        onShotChange: overrides?.onShotChange ?? (() => {}),
        theme,
        isDark: true,
        subjects: overrides?.subjects,
        subjectTrees: overrides?.subjectTrees,
      }),
    ),
  );
  return { ...utils, shared, shot };
}

describe('面板版式（线上截图为唯一依据）', () => {
  it('2026-11-06 标题区镜头跳转胶囊：N / M 文案 + 边界禁用 + 点击只发信号', () => {
    const onPrevShot = vi.fn();
    const onNextShot = vi.fn();
    const { container } = renderPanel({ shotIndex: 1, totalShots: 5, onPrevShot, onNextShot });
    expect(container.querySelector('[data-director-shot-nav]')).toBeTruthy();
    expect(container.querySelector('[data-director-shot-count]')?.textContent).toBe('镜头 2 / 5');
    const prev = container.querySelector('[data-director-shot-prev]') as HTMLButtonElement;
    const next = container.querySelector('[data-director-shot-next]') as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    fireEvent.click(prev);
    fireEvent.click(next);
    expect(onPrevShot).toHaveBeenCalledTimes(1);
    expect(onNextShot).toHaveBeenCalledTimes(1);

    // 首段禁上一个、末段禁下一个（边界只由受控 props 决定，面板内不自建序号）
    expect((renderPanel({ shotIndex: 0, totalShots: 5 }).container
      .querySelector('[data-director-shot-prev]') as HTMLButtonElement).disabled).toBe(true);
    expect((renderPanel({ shotIndex: 4, totalShots: 5 }).container
      .querySelector('[data-director-shot-next]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('第八C+第九条：标题行整行移除（编号胶囊「片段 N / 分镜 N」均无，「分镜」字样 = 0）；v5 抄来元素 = 0；@ 按钮残留 = 0；加号方块 = 1', () => {
    const { container } = renderPanel();
    // 标题行编号标签两种均删；「引用资产及工具」随标题行移除
    expect(container.querySelector('[data-director-title]')).toBeNull();
    expect(container.querySelector('[data-meta-scene]')).toBeNull();
    expect(container.textContent).not.toContain('分镜');
    expect(container.textContent).not.toContain('引用资产及工具');
    // v5 抄来元素全删
    expect(container.querySelector('[data-card-title]')).toBeNull();
    expect(container.querySelector('[data-card-sub]')).toBeNull();
    expect(container.querySelector('[data-ref-thumbs]')).toBeNull();
    expect(container.querySelector('[data-run-now]')).toBeNull();
    expect(container.querySelector('[data-card-divider]')).toBeNull();
    // @ 按钮残留 = 0，加号方块 = 1（2026-11-05 公共素材 UI 彻底下线：只留片段单行素材池一个加号）
    expect(container.querySelector('[data-meta-mention]')).toBeNull();
    expect(container.querySelectorAll('[data-asset-add]').length).toBe(1);
    // 槽位池只此一行（片段素材池；无公共素材行、无第二行）
    expect(container.querySelector('[data-director-slotpool="shared"]')).toBeNull();
    expect(container.querySelector('[data-director-slotpool="segment"]')).toBeTruthy();
    // 公共素材 UI 清零：无 commonEnabled 勾选、无编号说明文案
    expect(container.querySelector('[data-shared-enabled]')).toBeNull();
    expect(container.querySelector('[data-slot-numbering-note]')).toBeNull();
    // 2026-11-04 第二条C：底部工具行整行移除（批量→导轨工具栏；片段编辑并入时长/引导胶囊；视频公共参数唯一入口=三件套）
    expect(container.querySelector('[data-director-toolbar]')).toBeNull();
    expect(container.querySelector('[data-toolbar-batch]')).toBeNull();
    expect(container.querySelector('[data-entry-segment]')).toBeNull();
    expect(container.querySelector('[data-entry-common]')).toBeNull();
    // 2026-11-05 调整：页签全部删除（含「片段参数」），无任何 Tab
    expect(container.querySelectorAll('[data-director-tab]').length).toBe(0);
  });

  it('提示词区：minHeight ≥180、overflow-y = auto、contentEditable（@ 行内高亮编辑器）', () => {
    const { container } = renderPanel();
    const ed = container.querySelector('[data-mention-editor="director-prompt-input"]') as HTMLElement;
    expect(ed).toBeTruthy();
    expect(Number.parseFloat(ed.style.minHeight)).toBeGreaterThanOrEqual(180);
    expect(ed.style.overflowY).toBe('auto');
    expect(ed.getAttribute('contenteditable')).toBe('true');
    // 不再是纯 textarea
    expect(container.querySelector('textarea[data-director-prompt-input]')).toBeNull();
  });

  it('提示词区圆角与画布外框同源：占位层与聚焦描边跟随同一 radius', () => {
    const { container } = renderPanel();
    const ed = container.querySelector('[data-mention-editor="director-prompt-input"]') as HTMLElement;
    // 输入区与外框共用 WORKSPACE_SURFACE_RADIUS
    expect(ed.style.borderRadius).toBe(`${WORKSPACE_SURFACE_RADIUS}px`);
    // 占位伪元素继承编辑区圆角，不会从圆角缺口漏出
    const placeholderStyle = document.getElementById('mention-editor-placeholder-style');
    expect(placeholderStyle?.textContent).toContain('border-radius:inherit');
    // 聚焦描边与滚动条轨道都按同一 radius 处理
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    expect(css).toContain('.director-prompt-input:focus-visible');
    expect(css).toContain(`border-radius: ${WORKSPACE_SURFACE_RADIUS}px`);
    expect(css).toContain(`::-webkit-scrollbar-track { background: transparent; margin: ${WORKSPACE_SURFACE_RADIUS}px 0; }`);
  });

  it('公共素材 UI 彻底下线 + 片段标题补回（2026-11-05 调整）：无页签；素材池单行从 1 连续编号；顶部左侧「镜头 N · Ns」；无公共提示词残留', () => {
    const { container } = renderPanel({
      shot: makeShot({
        references: [{ id: 'a1', kind: 'image', title: '主角图', url: 'data:image/png;base64,x', storageKey: 'k1' }],
      }),
    });
    // 无页签无标题 Tab：Tab 总数 = 0
    expect(container.querySelectorAll('[data-director-tab]').length).toBe(0);
    // 素材池单行：只此一行、槽号从 1 连续（Picture1 = 第 1 格），加号格唯一
    expect(container.querySelectorAll('[data-director-slotpool]').length).toBe(1);
    expect(container.querySelector('[data-slot="Picture1"]')).toBeTruthy();
    expect(container.querySelector('[data-asset-add="segment"]')).toBeTruthy();
    // 片段标题（2026-11-05 补回）：顶部左侧「镜头 N · Ns」，现有数据源
    const title = container.querySelector('[data-director-segment-title]') as HTMLElement;
    expect(title).toBeTruthy();
    expect(title.textContent).toMatch(/^镜头 \d+ · [\d.]+s$/);
    // 编辑器常驻（不再随 Tab 切换消失）
    expect(container.querySelector('[data-mention-editor="director-prompt-input"]')).toBeTruthy();
    // 无公共/共享提示词标签或占位文案
    expect(container.textContent).not.toMatch(/公共提示词|共享提示词/);
  });

  it('片段标题随选中片段实时变化（2026-11-05 补回）：rerender 后标题跟随 shot.number/duration', () => {
    const shared = makeShared();
    const tree = (shot: WorkbenchShot) =>
      createElement(
        AntdApp,
        null,
        createElement(DirectorPromptPanel, {
          shared,
          onSharedChange: () => {},
          shot,
          shotIndex: 1,
          totalShots: 5,
          onPrevShot: () => {},
          onNextShot: () => {},
          onShotChange: () => {},
          theme,
          isDark: true,
          subjects: undefined,
        }),
      );
    const utils = render(tree(makeShot({ number: 3, duration: 6 })));
    const title = utils.container.querySelector('[data-director-segment-title]') as HTMLElement;
    expect(title.textContent).toBe('镜头 3 · 6s');
    const before = title.textContent;
    utils.rerender(tree(makeShot({ number: 7, duration: 4.5 })));
    const title2 = utils.container.querySelector('[data-director-segment-title]') as HTMLElement;
    expect(title2.textContent).toBe('镜头 7 · 4.5s');
    expect(title2.textContent).not.toBe(before);
  });

  it('积分/credit 残留 = 0', () => {
    const { container } = renderPanel();
    expect(container.textContent).not.toMatch(/积分|credit|points|◆/i);
    expect(container.querySelector('[data-run-credits]')).toBeNull();
  });

  it('统一布局栅格（2026-11-04 参数区搬家后；2026-11-05 槽位放大 64、页签删除）：标题行为首行（行高 32、左「镜头 N · Ns」）、槽位 64、加号格 64；参数行已移出面板（导轨工具行唯一一份）', () => {
    const { container } = renderPanel({
      shot: makeShot({
        imagePrompt: '@Picture1 一位老人回头',
        references: [{ id: 'a1', kind: 'image', title: '主角图', url: 'data:image/png;base64,x', storageKey: 'k1' }],
      }),
    });
    const panel = container.querySelector('[data-director-prompt-panel]') as HTMLElement;
    // 顶部行为「镜头 N · Ns」标题行（首个内容子元素，行高 32），无页签空壳
    const headRow = Array.from(panel.children).find((el) => (el as HTMLElement).tagName !== 'STYLE') as HTMLElement;
    expect(headRow.querySelector('[data-director-segment-title]')).toBeTruthy();
    expect(headRow.querySelector('[data-director-tab]')).toBeNull();
    expect(headRow.style.height).toBe('32px');
    // 标题行右侧元信息胶囊（编号胶囊「分镜 N」已删）
    expect(headRow.querySelector('[data-meta-scene]')).toBeNull();
    expect(headRow.querySelector('[data-meta-duration]')).toBeTruthy();
    expect((headRow.querySelector('[data-meta-duration]') as HTMLElement).parentElement!.style.marginLeft).toBe('auto');
    // 2026-11-04 参数区搬家（约定）：比例/×系数/换算尺寸/运行选中整行移到导轨工具行
    // 「批量」附近（DirectorRunParamsRow，见 workbench-director-track.test）——面板内零渲染，不允许两份并存
    expect(container.querySelector('[data-params-run-row]')).toBeNull();
    expect(container.querySelector('[data-run-selected]')).toBeNull();
    expect(container.querySelector('[data-run-count]')).toBeNull();
    expect(container.querySelector('[data-run-all]')).toBeNull();
    expect(container.querySelector('[data-param-key="aspect"]')).toBeNull();
    expect(container.querySelector('[data-param-key="scaleFactor"]')).toBeNull();
    expect(container.querySelector('[data-resolved-size]')).toBeNull();
    // 胶囊统一高 25
    for (const el of Array.from(headRow.querySelectorAll<HTMLElement>('[data-meta-duration], [data-meta-continuity]'))) {
      expect(el.style.height).toBe('25px');
    }
    // 槽位格 64×64（2026-11-05 需求：放大），加号格同尺寸（公共行加号已删，唯一一个）
    const slot = container.querySelector('[data-slot="Picture1"]') as HTMLElement;
    expect(slot.style.width).toBe('64px');
    expect(slot.style.height).toBe('64px');
    expect(container.querySelectorAll('[data-asset-add]').length).toBe(1);
    const addBtn = container.querySelector('[data-asset-add="segment"]') as HTMLElement;
    expect(addBtn.style.width).toBe('64px');
    expect(addBtn.style.height).toBe('64px');
    // 面板 padding 16（间距档；第二条C 底栏移除后底部不再留 0）
    expect(panel.style.padding).toBe('16px');
  });

  it('面板无白底（参数行搬走后存量样式回归）', () => {
    const { container } = renderPanel({ shared: makeShared({ params: { aspect: '16:9', scaleFactor: 0.5 } }) });
    expect(container.querySelector('[data-video-params]')).toBeNull(); // 旧三件套容器已随标题行移除
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('[data-director-prompt-panel] [style]'))) {
      expect(el.style.background).not.toMatch(/#fff|rgb\(255,\s*255,\s*255\)/i);
      expect(el.style.backgroundColor).not.toMatch(/#fff|rgb\(255,\s*255,\s*255\)/i);
    }
  });

  it('计数行 `图 N/N` / 原生 <select> / data-director-param-entry 残留 = 0', () => {
    const { container } = renderPanel();
    expect(container.textContent).not.toMatch(/图 \d+\/\d+/);
    expect(container.querySelectorAll('select').length).toBe(0);
    expect(container.querySelector('[data-director-param-entry]')).toBeNull();
  });

  it('commonEnabled 开关随公共素材 UI 下线（2026-11-05）：界面不暴露；底部弹层入口同样 = 0', () => {
    const { container } = renderPanel();
    expect(container.querySelector('[data-shared-enabled]')).toBeNull();
    // 第二条C：原底部「视频公共参数」弹层入口已移除，不得有第二入口
    expect(container.querySelector('[data-entry-common]')).toBeNull();
    expect(container.querySelector('[data-common-params-popover]')).toBeNull();
  });

  it('片段编辑参数落点（第二条C）：片段参数 Tab 状态下存在 时长胶囊 + 段间引导胶囊（含引导参数 Popover）', () => {
    const { container } = renderPanel();
    expect(container.querySelector('[data-meta-duration]')).toBeTruthy();
    expect(container.querySelector('[data-meta-continuity]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-meta-continuity]') as Element);
    const pop = document.querySelector('[data-director-continuity-popover]');
    expect(pop).toBeTruthy();
    for (const key of ['continuityFromPrev', 'continuityMode', 'continuityOverlapFrames']) {
      expect(pop?.querySelector(`[data-param-key="${key}"]`)).toBeTruthy();
    }
  });

  it('「公共素材」痕迹清零（2026-11-05 调整）：整树无「公共参数/公共素材/片段素材」文本、无编号说明文案', () => {
    const { container } = renderPanel();
    // 标题行整行移除：无任何编号标题
    expect(container.querySelector('[data-director-title]')).toBeNull();
    // 公共/片段行标签、编号说明文案全部不存在
    expect(container.textContent).not.toContain('公共参数');
    expect(container.textContent).not.toContain('公共素材');
    expect(container.textContent).not.toContain('片段素材');
    expect(container.textContent).not.toMatch(/本片段从图片 \d+ 开始编号|与提示词 <Picture N> 一致/);
    expect(container.querySelector('[data-slotpool-label]')).toBeNull();
    expect(container.querySelector('[data-slot-numbering-note]')).toBeNull();
  });
});

describe('槽位池 + @ 入栈语义', () => {
  const shotWithA1 = () => makeShot({
    imagePrompt: '@Picture1 一位老人回头',
    references: [{ id: 'a1', kind: 'image', title: '主角图', url: 'data:image/png;base64,x', storageKey: 'k1' }],
  });

  it('已填槽位 = 小缩略图（64×64），hover 浮出大图+名称+移除', () => {
    const { container } = renderPanel({ shot: shotWithA1() });
    const slot = container.querySelector('[data-slot="Picture1"]') as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.style.width).toBe('64px');
    expect(slot.style.height).toBe('64px');
    // hover → 大图预览 + 名称
    fireEvent.mouseEnter(slot);
    const preview = container.querySelector('[data-slot-preview]');
    expect(preview).toBeTruthy();
    expect(preview?.textContent).toContain('主角图');
    expect(preview?.textContent).toContain('Picture1');
    expect(preview?.querySelector('[data-slot-remove]')).toBeTruthy();
  });

  it('外部插入一条资产（开源库/抽屉「加入当前片段」→ 宿主 updateShot → 面板 props 实时更新）→ 槽位行立即多一格、编号从 1 连续', () => {
    // 2026-11-05 回归：开源库「加入当前片段」提示成功但槽位无变化。链路为
    // 事件 → workbench-tab-content updateShot（setShots 立即改内存态）→ 本面板
    // props 驱动重渲染（无一次性快照）。断言：不重开面板/不刷新即多一格。
    const utils = renderPanel({ shot: shotWithA1() });
    expect(utils.container.querySelectorAll('[data-slot]').length).toBe(1);

    const withSecond = makeShot({
      imagePrompt: '@Picture1 一位老人回头',
      references: [
        { id: 'a1', kind: 'image', title: '主角图', url: 'data:image/png;base64,x', storageKey: 'k1' },
        { id: 'a2', kind: 'image', title: '外部插入图', storageKey: 'k2' },
      ],
    });
    utils.rerender(createElement(
      AntdApp,
      null,
      createElement(DirectorPromptPanel, {
        shared: utils.shared,
        onSharedChange: () => {},
        shot: withSecond,
        shotIndex: 1,
        totalShots: 5,
        onPrevShot: () => {},
        onNextShot: () => {},
        onShotChange: () => {},
        theme,
        isDark: true,
      }),
    ));
    expect(utils.container.querySelectorAll('[data-slot]').length).toBe(2);
    expect(utils.container.querySelector('[data-slot="Picture2"]')).toBeTruthy();
  });

  it('视频槽位（2026-11-05 视频预览）：格子首帧 poster <img>；hover 大图 <video muted loop playsInline autoPlay>（src 非空，可点播/暂停）', async () => {
    const shot = makeShot({ references: [{ id: 'v1', kind: 'video', title: '样片', storageKey: 'kv1' }] });
    const { container } = renderPanel({ shot });
    const slot = container.querySelector('[data-slot="Video1"]') as HTMLElement;
    expect(slot).toBeTruthy();
    // 格子：thumb 档派生 poster 存在 → 首帧 <img>（不是胶片图标）
    await waitFor(() => { expect(slot.querySelector('img')).toBeTruthy(); });
    // hover 大图：<video>（不许 <img> 塞 mp4），autoplay/loop/muted/playsinline + src 非空（异步解析 → waitFor）
    fireEvent.mouseEnter(slot);
    await waitFor(() => {
      expect(container.querySelector('[data-slot-preview] video')).toBeTruthy();
    });
    const video = container.querySelector('[data-slot-preview] video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBeTruthy();
    expect(video.hasAttribute('autoplay')).toBe(true);
    expect(video.hasAttribute('loop')).toBe(true);
    // muted 是 IDL property（不反射为 content attribute），断言 property
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
  });

  it('视频槽位（无 poster 派生档）：格子渲染 <video preload="metadata"> 取首帧，不回退胶片图标', async () => {
    const origThumb = thumbMock.thumb.getMockImplementation();
    const origPreview = thumbMock.preview.getMockImplementation();
    thumbMock.thumb.mockImplementation(async () => '');
    thumbMock.preview.mockImplementation(async () => '');
    try {
      const shot = makeShot({ references: [{ id: 'v1', kind: 'video', title: '样片', storageKey: 'kv1' }] });
      const { container } = renderPanel({ shot });
      await waitFor(() => {
        expect(container.querySelector('[data-slot="Video1"] video[data-thumb-video]')).toBeTruthy();
      });
      const cellVideo = container.querySelector('[data-slot="Video1"] video') as HTMLVideoElement;
      expect(cellVideo.getAttribute('preload')).toBe('metadata');
      expect(cellVideo.getAttribute('src')).toBe('blob:orig:kv1');
      expect(cellVideo.hasAttribute('autoplay')).toBe(false);
    } finally {
      thumbMock.thumb.mockImplementation(origThumb!);
      thumbMock.preview.mockImplementation(origPreview!);
    }
  });

  it('音频槽位（2026-11-05）：格子保持图标；hover 大图 <audio controls>（src 非空）', async () => {
    const shot = makeShot({ references: [{ id: 'au1', kind: 'audio', title: '旁白', storageKey: 'ka1' }] });
    const { container } = renderPanel({ shot });
    const slot = container.querySelector('[data-slot="Audio1"]') as HTMLElement;
    expect(slot).toBeTruthy();
    // 格子内不渲染 audio（图标形态）
    expect(slot.querySelector('audio')).toBeNull();
    // hover：<audio controls>，src 走同一解析链（原文件）
    fireEvent.mouseEnter(slot);
    await waitFor(() => { expect(container.querySelector('[data-slot-preview] audio')).toBeTruthy(); });
    const audio = container.querySelector('[data-slot-preview] audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe('blob:orig:ka1');
    expect(audio.hasAttribute('controls')).toBe(true);
  });

  it('视频源取不到（2026-11-05 禁止静默兜底）：显示可读原因，不冒充正常', async () => {
    const origThumb = thumbMock.thumb.getMockImplementation();
    const origPreview = thumbMock.preview.getMockImplementation();
    const origOrig = thumbMock.orig.getMockImplementation();
    thumbMock.thumb.mockImplementation(async () => '');
    thumbMock.preview.mockImplementation(async () => '');
    thumbMock.orig.mockImplementation(async () => '');
    try {
      const shot = makeShot({ references: [{ id: 'v1', kind: 'video', title: '样片', storageKey: 'kv1' }] });
      const { container } = renderPanel({ shot });
      await waitFor(() => {
        expect(container.querySelector('[data-slot="Video1"] [data-media-unresolved]')).toBeTruthy();
      });
      const cell = container.querySelector('[data-slot="Video1"] [data-media-unresolved]') as HTMLElement;
      expect(cell.textContent).toContain('视频源未就绪');
      expect(cell.getAttribute('title')).toContain('storageKey 未解析到文件');
    } finally {
      thumbMock.thumb.mockImplementation(origThumb!);
      thumbMock.preview.mockImplementation(origPreview!);
      thumbMock.orig.mockImplementation(origOrig!);
    }
  });

  it('提示词内 @ 高亮块 = 缩略图 16×16 + @名称，contentEditable=false 原子块（整块删除机制）', async () => {
    const { container } = renderPanel({ shot: shotWithA1() });
    const chips = container.querySelectorAll('[data-mention-label="Picture1"]');
    expect(chips.length).toBe(1);
    const chip = chips[0] as HTMLElement;
    expect(chip.getAttribute('contenteditable')).toBe('false');
    expect(chip.textContent).toContain('@主角图');
    // 第六条：chip 小图走同一派生链，异步解析后出现 img
    await waitFor(() => {
      expect(chip.querySelector('[data-thumb] img')).toBeTruthy();
    });
  });

  it('池内已有资产再 @ → 不新增槽位（references 不变），提示词追加同一槽位号引用', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ shot: shotWithA1(), onShotChange: (p) => patches.push(p) });
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    // 已入槽分组在最前
    const panel = container.querySelector('[data-director-asset-panel]');
    expect(panel?.textContent).toContain('已入槽');
    fireEvent.click(panel?.querySelector('[data-asset-panel-item="a1"]') as Element);
    expect(patches.some((p) => Array.isArray(p.references))).toBe(false);
    const promptPatch = patches.find((p) => typeof p.imagePrompt === 'string');
    expect(promptPatch?.imagePrompt).toContain('@Picture1 ');
  });

  it('池外资产 + 有空位 → 占第一个空槽位（Picture1）并插入槽位号引用', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ onShotChange: (p) => patches.push(p) });
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    fireEvent.click(container.querySelector('[data-asset-panel-item="a1"]') as Element);
    const refPatch = patches.find((p) => Array.isArray(p.references));
    expect((refPatch?.references as Array<{ id: string }>).some((r) => r.id === 'a1')).toBe(true);
    const promptPatch = patches.find((p) => typeof p.imagePrompt === 'string');
    expect(promptPatch?.imagePrompt).toContain('@Picture1 ');
  });

  it('池外资产 + 该类型槽位已满 → 拒绝插入（无任何写入）', () => {
    // h3 图片上限 9：先塞满 9 张片段图片
    const fullRefs = Array.from({ length: 9 }, (_, i) => ({
      id: `f${i}`, kind: 'image' as const, title: `图${i}`, url: `data:image/png;base64,${i}`, storageKey: `kf${i}`,
    }));
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({
      shot: makeShot({ references: fullRefs }),
      onShotChange: (p) => patches.push(p),
    });
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    const panel = container.querySelector('[data-director-asset-panel]');
    // 已满徽标出现
    expect(panel?.querySelectorAll('[data-kind-full]').length).toBeGreaterThan(0);
    fireEvent.click(panel?.querySelector('[data-asset-panel-item="a1"]') as Element);
    // 拒绝：无 references 写入、无 prompt 插入
    expect(patches.some((p) => Array.isArray(p.references))).toBe(false);
    expect(patches.some((p) => typeof p.imagePrompt === 'string' && p.imagePrompt.includes('@Picture10'))).toBe(false);
  });

  it('替换槽位：同位置替换为新资产，提示词文本不变（槽位号引用自动跟新资产）', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ shot: shotWithA1(), onShotChange: (p) => patches.push(p) });
    // 点已填槽位 → 替换模式
    fireEvent.click(container.querySelector('[data-slot-filled="a1"]') as Element);
    const panel = container.querySelector('[data-director-asset-panel]');
    expect(panel).toBeTruthy();
    fireEvent.click(panel?.querySelector('[data-asset-panel-item="a2"]') as Element);
    const refPatch = patches.find((p) => Array.isArray(p.references));
    const refs = refPatch?.references as Array<{ id: string }>;
    expect(refs.length).toBe(1);
    expect(refs[0]?.id).toBe('a2');
    // prompt 不被改写（仍是 @Picture1）
    expect(patches.some((p) => typeof p.imagePrompt === 'string')).toBe(false);
  });

  it('主体 Tab：单击一级行 = 整主体占槽（subject:<id>）；chevron 展开后点状态图子行 = 精确插入（subject:<id>:<stateId>）；二级菜单残留 = 0', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ subjects: SUBJECTS, onShotChange: (p) => patches.push(p) });
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    const panel = container.querySelector('[data-director-asset-panel]') as HTMLElement;
    expect(panel.querySelector('[data-asset-panel-tab="asset"]')).toBeTruthy();
    expect(panel.querySelector('[data-asset-panel-tab="subject"]')).toBeTruthy();
    expect(panel.textContent).not.toContain('小工具');
    // 二级菜单残留 = 0（根资源为 0；主体只有 chevron 展开的子行，不是浮层）
    expect(panel.querySelector('[data-director-asset-subpanel]')).toBeNull();
    expect(panel.querySelector('[data-director-subject-subpanel]')).toBeNull();
    expect(panel.querySelector('[data-subpanel-commit]')).toBeNull();
    // 切主体 Tab → 单击主体一级行 = 直接写入整主体引用 subject:sub-1（占一个图片槽位 + 插入 @Picture1）
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    fireEvent.click(panel.querySelector('[data-subject-item="sub-1"]') as Element);
    const refPatch = patches.find((p) => Array.isArray(p.references));
    const refs = refPatch?.references as Array<{ id: string; title?: string }>;
    expect(refs.some((r) => r.id === 'subject:sub-1')).toBe(true);
    expect(refs[0]?.title).toBe('季莹');
    const promptPatch = patches.find((p) => typeof p.imagePrompt === 'string');
    expect(promptPatch?.imagePrompt).toContain('@Picture1 ');
    // chevron 独立命中区：点箭头展开（不写入），子行出现
    // （插入后面板会关闭，重开面板再测展开）
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    const panel2 = container.querySelector('[data-director-asset-panel]') as HTMLElement;
    fireEvent.click(panel2.querySelector('[data-asset-panel-tab="subject"]') as Element);
    const before = patches.length;
    fireEvent.click(panel2.querySelector('[data-subject-chevron="sub-1"]') as Element);
    expect(patches.length).toBe(before); // 点箭头不插入
    const childRow = panel2.querySelector('[data-subject-state-row="sk-1"]');
    expect(childRow).toBeTruthy();
    // 详情面板：状态图集合只读（无插入动作）
    const detail = panel2.querySelector('[data-asset-detail]');
    expect(detail?.querySelector('[data-subject-detail-image="sk-1"]')).toBeTruthy();
    expect(detail?.querySelector('[data-subject-detail-insert]')).toBeNull();
    // 单击子行 = 精确插入 subject:sub-1:sk-1
    fireEvent.click(childRow as Element);
    const refPatch2 = [...patches].reverse().find((p) => Array.isArray(p.references));
    const refs2 = refPatch2?.references as Array<{ id: string; title?: string }>;
    expect(refs2.some((r) => r.id === 'subject:sub-1:sk-1')).toBe(true);
    expect(refs2.find((r) => r.id === 'subject:sub-1:sk-1')?.title).toBe('季莹·基础形象');
  });

  it('主体文件夹语义：chevron 命中区 ≥20px 与行点击互不误触；键盘 → 展开 / ← 收起；无图主体展开给中性提示行（不可点）', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({
      subjects: [...SUBJECTS, ...NOIMG_SUBJECTS],
      onShotChange: (p) => patches.push(p),
    });
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    const panel = container.querySelector('[data-director-asset-panel]') as HTMLElement;
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    // 未展开：无子行
    expect(panel.querySelector('[data-subject-state-row="sk-1"]')).toBeNull();
    // chevron 命中区 ≥20px
    const chevron = panel.querySelector('[data-subject-chevron="sub-1"]') as HTMLElement;
    expect(chevron).toBeTruthy();
    expect(parseInt(chevron.style.width, 10)).toBeGreaterThanOrEqual(20);
    expect(parseInt(chevron.style.height, 10)).toBeGreaterThanOrEqual(20);
    // 键盘 → 展开当前高亮父组（初始高亮 sub-1）
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(panel.querySelector('[data-subject-state-row="sk-1"]')).toBeTruthy();
    // 展开未产生任何写入
    expect(patches.length).toBe(0);
    // 键盘 ← 收起
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(panel.querySelector('[data-subject-state-row="sk-1"]')).toBeNull();
    // 无图主体：一级行仍可直接插入；展开后给中性提示行（不可点 = 无 data-subject-state-row / 无点击写入）
    const chevronEmpty = panel.querySelector('[data-subject-chevron="sub-9"]') as HTMLElement;
    fireEvent.click(chevronEmpty);
    const hint = panel.querySelector('[data-subject-empty-hint="sub-9"]');
    expect(hint).toBeTruthy();
    expect(hint?.textContent).toContain('该主体尚未录入状态图');
    fireEvent.click(hint as Element);
    expect(patches.length).toBe(0); // 提示行不可点
    // 无图主体一级行直接插入 subject:sub-9
    fireEvent.click(panel.querySelector('[data-subject-item="sub-9"]') as Element);
    const refPatch = patches.find((p) => Array.isArray(p.references));
    expect((refPatch?.references as Array<{ id: string }>).some((r) => r.id === 'subject:sub-9')).toBe(true);
  });

  it('搜索命中状态图名 → 自动展开父组并定位子行；搜索框内 ←→ 不触发收起/展开', () => {
    const { container } = renderPanel({ subjects: SUBJECTS });
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    const panel = container.querySelector('[data-director-asset-panel]') as HTMLElement;
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    const search = panel.querySelector('[data-asset-panel-search]') as HTMLInputElement;
    fireEvent.change(search, { target: { value: '基础形象' } });
    // 父组自动展开 + 子行可见
    expect(panel.querySelector('[data-subject-item="sub-1"]')).toBeTruthy();
    expect(panel.querySelector('[data-subject-state-row="sk-1"]')).toBeTruthy();
    // 搜索框内 ←→ 留给光标（不收起）
    fireEvent.keyDown(search, { key: 'ArrowLeft' });
    expect(panel.querySelector('[data-subject-state-row="sk-1"]')).toBeTruthy();
    // 不匹配的主体被过滤
    expect(panel.querySelector('[data-subject-item="sub-2"]')).toBeNull();
  });
});

// ===== 第三条：槽位移除（hover ×；pin 槽号不重排；被引用轻确认 + @ 块降级为纯文本）=====
import { assignAssetSlots, validateRunSelection } from '@/entities/director-params.js';
import { resolveRefVisual } from './director-prompt-panel.jsx';

describe('槽位移除（第三条）', () => {
  const shotPinned = () => makeShot({
    imagePrompt: '',
    references: [
      { id: 'a1', kind: 'image', title: '主角图', storageKey: 'k1', slotNo: 1 },
      { id: 'a2', kind: 'image', title: '场景图', storageKey: 'k2', slotNo: 3 },
    ],
  } as Partial<WorkbenchShot>);
  const shotRefA1 = () => makeShot({
    imagePrompt: '@Picture1 一位老人回头',
    references: [{ id: 'a1', kind: 'image', title: '主角图', storageKey: 'k1' }],
  });

  it('已占用槽位右上角 18px × 移除键存在；CSS = 未 hover/focus 不可见不占位 + 触屏（hover:none）常驻', () => {
    const { container } = renderPanel({ shot: shotPinned() });
    const slot = container.querySelector('[data-slot="Picture1"]') as HTMLElement;
    expect(slot).toBeTruthy();
    // 64×64 格子布局不变（× 绝对定位，不占位）
    expect(slot.style.width).toBe('64px');
    expect(slot.style.height).toBe('64px');
    const x = slot.querySelector('[data-slot-x="a1"]') as HTMLElement;
    expect(x).toBeTruthy();
    expect(x.className).toContain('director-slot-remove');
    expect(x.style.width).toBe('18px');
    expect(x.style.height).toBe('18px');
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('.director-slot-remove');
    expect(css).toContain('[data-slot]:hover .director-slot-remove');
    expect(css).toContain('[data-slot]:focus-within .director-slot-remove');
    expect(css).toContain('@media (hover: none)');
  });

  it('未被引用 → 直接移除不弹确认；槽位空出；只解引用不删资产', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({
      shot: makeShot({
        imagePrompt: '一位老人回头',
        references: [{ id: 'a1', kind: 'image', title: '主角图', storageKey: 'k1', slotNo: 1 }],
      } as Partial<WorkbenchShot>),
      onShotChange: (p) => patches.push(p),
    });
    fireEvent.click(container.querySelector('[data-slot-x="a1"]') as Element);
    // 未被引用 → 无确认弹层
    expect(document.querySelector('.ant-modal-confirm')).toBeNull();
    // 槽位空出
    const refPatch = patches.find((p) => Array.isArray(p.references));
    expect((refPatch?.references as unknown[]).length).toBe(0);
    // 提示词未被引用 → 文本不变
    const promptPatch = patches.find((p) => typeof p.imagePrompt === 'string');
    expect(promptPatch?.imagePrompt).toBe('一位老人回头');
    // 不删资产：资产库 a1/a2 原样
    expect(mockAssets.assets.map((a) => (a as { id: string }).id)).toEqual(['a1', 'a2']);
  });

  it('第十三条：被引用 → 无 Modal、直接移除 + 正文降级 + toast（含撤销）；点撤销一次性恢复槽位与引用', async () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ shot: shotRefA1(), onShotChange: (p) => patches.push(p) });
    fireEvent.click(container.querySelector('[data-slot-x="a1"]') as Element);
    // 无 Modal / 确认框（残留 = 0）
    expect(document.querySelector('.ant-modal-confirm')).toBeNull();
    expect(document.querySelector('.ant-modal')).toBeNull();
    // 立即移除 + @ 块立即降级为纯文本（不等确认）
    const promptPatch = patches.find((p) => typeof p.imagePrompt === 'string');
    expect(promptPatch?.imagePrompt).not.toContain('@Picture1');
    expect(promptPatch?.imagePrompt).toContain('Picture1');
    expect(promptPatch?.imagePrompt).toContain('一位老人回头');
    const refPatch = patches.find((p) => Array.isArray(p.references));
    expect((refPatch?.references as unknown[]).length).toBe(0);
    // toast 出现：一条文案说两件事（已移除 + 已降级）+ 撤销按钮
    const toast = (await waitFor(() => {
      const el = document.querySelector('[data-slot-remove-toast]');
      expect(el).toBeTruthy();
      return el;
    })) as HTMLElement;
    expect(toast.textContent).toContain('已移除 Picture1');
    expect(toast.textContent).toContain('已降级为纯文本');
    const undoBtn = toast.querySelector('[data-slot-remove-undo]') as HTMLElement;
    expect(undoBtn.textContent).toBe('撤销');
    // 点撤销 → 一次性恢复槽位与正文引用（回到移除前状态）
    patches.length = 0;
    fireEvent.click(undoBtn);
    const restoreRef = patches.find((p) => Array.isArray(p.references));
    expect((restoreRef?.references as Array<{ id: string }>).map((r) => r.id)).toEqual(['a1']);
    const restorePrompt = patches.find((p) => typeof p.imagePrompt === 'string');
    expect(restorePrompt?.imagePrompt).toBe('@Picture1 一位老人回头');
    // 撤销后 toast 销毁
    await waitFor(() => {
      expect(document.querySelector('[data-slot-remove-toast]')).toBeNull();
    });
  });

  it('第十三条：未被引用 → 短提示（含撤销）不强调降级；连续快速移除多个槽位只保留一条 toast', async () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({
      shot: makeShot({
        imagePrompt: '一位老人回头',
        references: [
          { id: 'a1', kind: 'image', title: '主角图', storageKey: 'k1', slotNo: 1 },
          { id: 'a2', kind: 'image', title: '配角图', storageKey: 'k2', slotNo: 2 },
        ],
      } as Partial<WorkbenchShot>),
      onShotChange: (p) => patches.push(p),
    });
    // 连续快速移除两个槽位
    fireEvent.click(container.querySelector('[data-slot-x="a1"]') as Element);
    fireEvent.click(container.querySelector('[data-slot-x="a2"]') as Element);
    // 无 Modal
    expect(document.querySelector('.ant-modal-confirm')).toBeNull();
    // 提示合并/替换：同一 key → 只剩一条（最新 Picture2）
    await waitFor(() => {
      expect(document.querySelectorAll('[data-slot-remove-toast]').length).toBe(1);
    });
    const toast = document.querySelector('[data-slot-remove-toast]') as HTMLElement;
    expect(toast.textContent).toContain('已移除 Picture2');
    expect(toast.textContent).not.toContain('降级'); // 未被引用 → 不强调降级
    expect(toast.querySelector('[data-slot-remove-undo]')).toBeTruthy();
  });

  it('槽号不重排：移除 Picture1 后 Picture3 保持原号（pin 随引用持久化）', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ shot: shotPinned(), onShotChange: (p) => patches.push(p) });
    // pin 落位：Picture1 / Picture3（Picture2 空）
    expect(container.querySelector('[data-slot="Picture1"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="Picture2"]')).toBeNull();
    expect(container.querySelector('[data-slot="Picture3"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-slot-x="a1"]') as Element);
    const refPatch = patches.find((p) => Array.isArray(p.references));
    const refs = refPatch?.references as Array<{ id: string; slotNo?: number }>;
    expect(refs.length).toBe(1);
    expect(refs[0]?.id).toBe('a2');
    expect(refs[0]?.slotNo).toBe(3); // 保持原槽号，不重排
  });

  it('assignAssetSlots：pin 落位；新插入取最小空号；无 pin 时与历史逐号一致（公共优先）', () => {
    const pinned = assignAssetSlots({
      shared: [], tier: 'h3',
      segment: [
        { id: 'x', kind: 'image', slotNo: 1 },
        { id: 'y', kind: 'image', slotNo: 3 },
      ],
    });
    expect(pinned.byAssetId.y?.slot).toBe(3);
    // 移除 x（Picture1）后：y 保持 3；新插入 z（无 pin）取最小空号 1
    const afterRemove = assignAssetSlots({
      shared: [], tier: 'h3',
      segment: [{ id: 'y', kind: 'image', slotNo: 3 }, { id: 'z', kind: 'image' }],
    });
    expect(afterRemove.byAssetId.y?.slot).toBe(3);
    expect(afterRemove.byAssetId.z?.slot).toBe(1);
    // 无 pin：公共 1..K → 片段 K+1 续排，与历史一致
    const legacy = assignAssetSlots({
      shared: [{ id: 's1', kind: 'image' }, { id: 's2', kind: 'image' }],
      segment: [{ id: 'a', kind: 'image' }],
      tier: 'h3',
    });
    expect(legacy.byAssetId.s1?.slot).toBe(1);
    expect(legacy.byAssetId.s2?.slot).toBe(2);
    expect(legacy.byAssetId.a?.slot).toBe(3);
    expect(legacy.segmentStartSlot.image).toBe(3);
  });
});

// ===== 第四条：@ 浮层详情面板 + 无图主体占槽/自动解析/pack 校验 =====
const NOIMG_SUBJECTS = [
  { id: 'sub-9', kind: 'character', name: '无图侠', aliases: [], consistency: '', voice: '', note: '', episodeIds: [], images: [] },
] as unknown as ProductionItem[];

describe('@ 浮层详情面板与无图主体（第四条）', () => {
  it('悬停仅更新详情不插入；详情字段 = 名称/类型/范围/槽位/来源；空态给中性提示', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ onShotChange: (p) => patches.push(p) });
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    const panel = container.querySelector('[data-director-asset-panel]') as HTMLElement;
    // 悬停 → 只更新右侧详情，不写入
    fireEvent.mouseEnter(panel.querySelector('[data-asset-panel-item="a2"]') as Element);
    expect(patches.length).toBe(0);
    const detail = panel.querySelector('[data-asset-detail]') as HTMLElement;
    expect(detail).toBeTruthy();
    expect(detail.querySelector('[data-detail-row="name"]')?.textContent).toContain('场景图');
    expect(detail.querySelector('[data-detail-row="kind"]')?.textContent).toContain('图片');
    expect(detail.querySelector('[data-detail-row="scope"]')?.textContent).toContain('公共');
    expect(detail.querySelector('[data-detail-row="slot"]')?.textContent).toContain('未占用');
    expect(detail.querySelector('[data-detail-row="source"]')?.textContent).toContain('k2');
    // 空态：主体库为空 → 中性提示，不留空白砖
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    expect(panel.querySelector('[data-asset-detail]')?.textContent).toContain('悬停或用 ↑↓ 选择条目查看详情');
  });

  it('无图主体可点可占槽（引用 subject:<id>，占一个图片槽位 + 插入 @PictureN；槽位格 = 图标+槽号占位格）', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ subjects: NOIMG_SUBJECTS, onShotChange: (p) => patches.push(p) });
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    const panel = container.querySelector('[data-director-asset-panel]') as HTMLElement;
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    fireEvent.click(panel.querySelector('[data-subject-item="sub-9"]') as Element);
    const refPatch = patches.find((p) => Array.isArray(p.references));
    const refs = refPatch?.references as Array<{ id: string; title?: string; kind?: string }>;
    expect(refs.some((r) => r.id === 'subject:sub-9')).toBe(true);
    expect(refs[0]?.title).toBe('无图侠');
    expect(refs[0]?.kind).toBe('image'); // 占图片槽位（计入 h3=9 上限）
    const promptPatch = patches.find((p) => typeof p.imagePrompt === 'string');
    expect(promptPatch?.imagePrompt).toContain('@Picture1 ');
    // 占位格：图标 + 槽号，无图（名称在 hover 预览卡）
    const { container: c2 } = renderPanel({
      subjects: NOIMG_SUBJECTS,
      shot: makeShot({
        imagePrompt: '@Picture1 无图侠回头',
        references: [{ id: 'subject:sub-9', kind: 'image', title: '无图侠', slotNo: 1 }],
      } as Partial<WorkbenchShot>),
    });
    // 占位格：图标（无图），名称 + 槽号在 hover 预览卡（与既有槽位设计一致：格内只显示图标/缩略图）
    const slot = c2.querySelector('[data-slot="Picture1"]') as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.querySelector('img')).toBeNull();
    expect(slot.querySelector('svg')).toBeTruthy();
    fireEvent.mouseEnter(slot);
    const preview = c2.querySelector('[data-slot-preview]');
    expect(preview?.textContent).toContain('无图侠');
    expect(preview?.textContent).toContain('Picture1');
  });

  it('resolveRefVisual：无图主体补图后自动解析为封面（第一张状态图），手动 coverKey 优先', () => {
    const ref = { id: 'subject:sub-9', kind: 'image', title: '无图侠' } as never;
    expect(resolveRefVisual(ref, NOIMG_SUBJECTS).storageKey).toBeUndefined();
    const withImg = [
      { ...NOIMG_SUBJECTS[0], images: [{ storageKey: 'sk-9', prompt: '', note: '', tags: [] }] },
    ] as unknown as ProductionItem[];
    expect(resolveRefVisual(ref, withImg).storageKey).toBe('sk-9');
    const withCover = [
      {
        ...withImg[0], coverKey: 'sk-cover',
        images: [{ storageKey: 'sk-cover', prompt: '', note: '', tags: [] }, { storageKey: 'sk-9', prompt: '', note: '', tags: [] }],
      },
    ] as unknown as ProductionItem[];
    expect(resolveRefVisual(ref, withCover).storageKey).toBe('sk-cover');
  });

  it('pack 校验：无图主体槽位 → 可读错误（含主体名与槽号）；补图后通过', () => {
    const shots = [{
      id: 'seg-2', number: 2, duration: 10, status: 'pending',
      references: [{ id: 'subject:sub-9', kind: 'image', title: '无图侠', slotNo: 1 }],
    }] as never[];
    const shared = { enabled: false, assets: [], presetId: 'h3', params: {} } as never;
    const issues = validateRunSelection({ shots, shared, tier: 'h3', selectedIds: ['seg-2'], subjectCoverOf: () => null });
    const hit = issues.find((i) => i.code === 'subject-image-missing');
    expect(hit).toBeTruthy();
    expect(hit?.message).toContain('无图侠');
    expect(hit?.message).toContain('Picture1');
    // 补图后（resolver 返回封面 key）→ 无该错误
    const ok = validateRunSelection({ shots, shared, tier: 'h3', selectedIds: ['seg-2'], subjectCoverOf: () => 'sk-9' });
    expect(ok.some((i) => i.code === 'subject-image-missing')).toBe(false);
  });
});

// ===== 轨道注入：绿箭头（overlay 只留箭头）；片段内勾选框已整块移除（第八条B）=====
// 2026-11-04 第八条B：勾选位置改到上方表格行（DirectorBatchTable，见 workbench-director-addons.test），
// clipChecks/ClipCheckState 全链删除；本文件 TimelineClip 被 mock（不再捕获 checkState）。
import { StoryboardTimeline } from '@/features/canvas-nodes/storyboard/storyboard-timeline.jsx';
import type { TimelineClipData } from '@/features/canvas-nodes/storyboard/timeline-constants.js';
import { segmentContinuityEnabled, type RunShotLike } from '@/entities/director-params.js';

vi.mock('@/features/canvas-nodes/storyboard/timeline-clip.js', () => ({
  TimelineClip: (props: { clip?: { id?: string } }) => createElement('div', { 'data-clip-id': props.clip?.id ?? 'clip' }),
  default: (props: { clip?: { id?: string } }) => createElement('div', { 'data-clip-id': props.clip?.id ?? 'clip' }),
}));

function clip(id: string, duration: number, continuation?: { enabled: boolean }): TimelineClipData {
  return { id, duration, imagePrompt: '', status: 'pending', continuation } as unknown as TimelineClipData;
}

/** 复刻 workbench-tab-content 的 overlay 构建（2026-11-04 第三轮起只含绿箭头） */
function buildOverlay(shots: TimelineClipData[], pps: number) {
  const arrows: Array<{ id: string; x: number }> = [];
  let startSec = 0;
  shots.forEach((s, i) => {
    const like = { id: s.id, continuation: (s as unknown as { continuation?: { enabled: boolean } }).continuation } as RunShotLike;
    if (i > 0 && segmentContinuityEnabled(like, i)) arrows.push({ id: s.id, x: startSec * pps });
    startSec += s.duration;
  });
  return (
    <div data-director-continuity-overlay style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {arrows.map((it) => (
        <span key={it.id} data-continuity-arrow={it.id} style={{ position: 'absolute', left: it.x, transform: 'translateX(-50%)' }}>
          <svg width={16} height={12} viewBox="0 0 16 12"><path d="M1.5 6 H14.5 M4.7 3 1.5 6 4.7 9 M11.3 3 14.5 6 11.3 9" stroke="#00c758" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      ))}
    </div>
  );
}

function renderTimeline(
  shots: TimelineClipData[],
  pps: number,
  overlay: ReactNode,
) {
  return render(
    <StoryboardTimeline
      shots={shots}
      activeShotId={null}
      pixelsPerSecond={pps}
      onPixelsPerSecondChange={() => {}}
      onSelectShot={() => {}}
      onInsertAt={() => {}}
      onTrim={() => {}}
      contentOverlay={overlay}
      t={((k: string, fb?: string) => fb ?? k) as never}
      theme={{} as never}
      isDark={true}
    />,
  );
}

describe('轨道段间衔接（绿箭头零渲染语义 + 勾选框零残留）', () => {
  it('勾上且有前序 → 绿箭头渲染在交界处（left = 5×pps = 200px@40）；段1 恒不渲染；容器内勾选框零渲染（第八条B）', () => {
    const shots = [clip('seg-1', 5), clip('seg-2', 5)];
    const { container } = renderTimeline(shots, 40, buildOverlay(shots, 40));
    const arrow = container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement;
    expect(arrow).toBeTruthy();
    expect(arrow.style.left).toBe('200px');
    expect(arrow.querySelector('path')?.getAttribute('stroke')).toBe('#00c758');
    expect(container.querySelector('[data-continuity-arrow="seg-1"]')).toBeNull();
    // 第八条B：导轨片段内勾选框整块移除——整个时间轴容器内零渲染（残留 0）
    expect(container.querySelectorAll('[data-clip-check]').length).toBe(0);
    // 「🔗 22f」文字标记已删
    expect(container.querySelector('[data-continuity-link]')).toBeNull();
  });

  it('未勾（continuation.enabled=false）→ 零渲染（不是灰显）', () => {
    const shots = [clip('seg-1', 5), clip('seg-2', 5, { enabled: false })];
    const { container } = renderTimeline(shots, 40, buildOverlay(shots, 40));
    expect(container.querySelectorAll('[data-continuity-arrow]').length).toBe(0);
  });
});

// ===== 第六条：缩略图单一解析入口（thumb→preview→原图；未就绪占位+事件刷新；失败回退占位）=====

describe('缩略图单一解析（第六条）', () => {
  const shotThumbA1 = () => makeShot({
    imagePrompt: '@Picture1 一位老人回头',
    references: [{ id: 'a1', kind: 'image', title: '主角图', url: 'data:image/png;base64,x', storageKey: 'k1' }],
  });
  const resetThumbMock = () => {
    thumbMock.thumb.mockImplementation(async (k?: string) => (k ? `blob:thumb:${k}` : ''));
    thumbMock.preview.mockImplementation(async (k?: string) => (k ? `blob:preview:${k}` : ''));
    thumbMock.orig.mockImplementation(async (k?: string) => (k ? `blob:orig:${k}` : ''));
  };

  it('三处均按 thumb→preview→原图 顺序解析：槽位格 / @ 列表行（根资源+主体父子行）/ 详情面板', async () => {
    resetThumbMock();
    const { container } = renderPanel({ subjects: SUBJECTS, shot: shotThumbA1() });
    // ① 槽位格 64×64 → thumb 档；且 lazy+async（原图不直接进 64px 格）
    const slot = container.querySelector('[data-slot="Picture1"]') as HTMLElement;
    await waitFor(() => {
      const img = slot.querySelector('[data-thumb="k1"] img') as HTMLImageElement;
      expect(img?.src).toBe('blob:thumb:k1');
      expect(img?.getAttribute('loading')).toBe('lazy');
      expect(img?.getAttribute('decoding')).toBe('async');
    });
    // ② @ 列表行：根资源行（k1）+ 主体父行封面（sk-1）+ 展开后子行（sk-1）
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    const panel = container.querySelector('[data-director-asset-panel]') as HTMLElement;
    await waitFor(() => {
      expect((panel.querySelector('[data-asset-panel-item="a1"] [data-thumb="k1"] img') as HTMLImageElement)?.src).toBe('blob:thumb:k1');
    });
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    await waitFor(() => {
      expect((panel.querySelector('[data-subject-item="sub-1"] [data-thumb="sk-1"] img') as HTMLImageElement)?.src).toBe('blob:thumb:sk-1');
    });
    fireEvent.click(panel.querySelector('[data-subject-chevron="sub-1"]') as Element);
    await waitFor(() => {
      expect((panel.querySelector('[data-subject-state-row="sk-1"] [data-thumb="sk-1"] img') as HTMLImageElement)?.src).toBe('blob:thumb:sk-1');
    });
    // ③ 详情面板：大图优先 preview 档（hover 大图唯一允许更高档位的场景）
    fireEvent.mouseEnter(panel.querySelector('[data-subject-item="sub-1"]') as Element);
    await waitFor(() => {
      const big = panel.querySelector('[data-asset-detail] [data-thumb="sk-1"] img') as HTMLImageElement;
      expect(big?.src).toBe('blob:preview:sk-1');
      const small = panel.querySelector('[data-subject-detail-image="sk-1"] [data-thumb="sk-1"] img') as HTMLImageElement;
      expect(small?.src).toBe('blob:thumb:sk-1');
    });
  });

  it('回落链：thumb 缺失 → preview；thumb+preview 缺失 → 原图（仍在格内限尺寸渲染）', async () => {
    resetThumbMock();
    thumbMock.thumb.mockResolvedValue('');
    const { container } = renderPanel({ shot: shotThumbA1() });
    const slot = container.querySelector('[data-slot="Picture1"]') as HTMLElement;
    await waitFor(() => {
      expect((slot.querySelector('[data-thumb="k1"] img') as HTMLImageElement)?.src).toBe('blob:preview:k1');
    });
    thumbMock.preview.mockResolvedValue('');
    const c2 = renderPanel({ shot: shotThumbA1() });
    const slot2 = c2.container.querySelector('[data-slot="Picture1"]') as HTMLElement;
    await waitFor(() => {
      const img = slot2.querySelector('[data-thumb="k1"] img') as HTMLImageElement;
      expect(img?.src).toBe('blob:orig:k1');
      // 限尺寸：64px 格内 object-fit cover，宽高钉死
      expect(img?.style.objectFit).toBe('cover');
      expect((img?.parentElement as HTMLElement).style.width).toBe('64px');
    });
  });

  it('未就绪 → 占位图标（深色底无白块）；IMAGE_CONTENT_UPDATED_EVENT 到达后同实例刷新为真图', async () => {
    resetThumbMock();
    thumbMock.thumb.mockResolvedValue('');
    thumbMock.preview.mockResolvedValue('');
    thumbMock.orig.mockResolvedValue('');
    const { container } = renderPanel({ shot: shotThumbA1() });
    const slot = container.querySelector('[data-slot="Picture1"]') as HTMLElement;
    await waitFor(() => {
      expect(slot.querySelector('[data-thumb="k1"] img')).toBeNull();
      expect(slot.querySelector('[data-thumb="k1"] svg')).toBeTruthy();
      expect((slot.querySelector('[data-thumb="k1"]') as HTMLElement).style.background).not.toBe('');
    });
    // 派生图就绪事件 → 同一挂载实例自动刷新
    thumbMock.thumb.mockResolvedValue('blob:thumb:k1');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('zeroexo:image-content-updated', { detail: { storageKey: 'k1' } }));
    });
    await waitFor(() => {
      expect((slot.querySelector('[data-thumb="k1"] img') as HTMLImageElement)?.src).toBe('blob:thumb:k1');
    });
  });

  it('加载失败（404/blob 缺失）→ 自动重试一次仍未恢复 → 回退占位图标 + title 悬浮名称，无破图 img 残留', async () => {
    resetThumbMock();
    const { container } = renderPanel({ shot: shotThumbA1() });
    const slot = container.querySelector('[data-slot="Picture1"]') as HTMLElement;
    let img: HTMLImageElement | null = null;
    await waitFor(() => {
      img = slot.querySelector('[data-thumb="k1"] img') as HTMLImageElement;
      expect(img?.src).toBe('blob:thumb:k1');
    });
    // 2026-11-05 媒体层重做：onError → markError 自愈（丢弃坏 URL 重读重试一次）；
    // 第一次错误触发重试（确定性 URL 不变 → 无重渲染），第二次错误才判定失败 → 回退图标
    fireEvent.error(img as unknown as Element);
    fireEvent.error(img as unknown as Element);
    await waitFor(() => {
      expect(slot.querySelector('[data-thumb="k1"] img')).toBeNull();
      expect(slot.querySelector('[data-thumb="k1"] svg')).toBeTruthy();
      expect(slot.querySelector('[data-thumb="k1"]')?.getAttribute('title')).toBe('主角图');
    });
  });

  it('@ 高亮块 16×16 同一入口：未就绪占位 → 事件后同实例真图；加载失败 → 回退图标', async () => {
    resetThumbMock();
    thumbMock.thumb.mockResolvedValue('');
    thumbMock.preview.mockResolvedValue('');
    thumbMock.orig.mockResolvedValue('');
    const { container } = renderPanel({ shot: shotThumbA1() });
    const chip = container.querySelector('[data-mention-label="Picture1"]') as HTMLElement;
    expect(chip).toBeTruthy();
    // 未就绪：占位图标，无 img；块结构不变（contentEditable=false / 高 20）
    await waitFor(() => {
      expect(chip.querySelector('[data-thumb="k1"] img')).toBeNull();
      expect(chip.querySelector('[data-thumb="k1"] svg')).toBeTruthy();
    });
    expect(chip.getAttribute('contenteditable')).toBe('false');
    expect(chip.style.height).toBe('20px');
    // 派生就绪事件 → 同实例刷新为真图（thumb 档）
    thumbMock.thumb.mockResolvedValue('blob:thumb:k1');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('zeroexo:image-content-updated', { detail: { storageKey: 'k1' } }));
    });
    let img: HTMLImageElement | null = null;
    await waitFor(() => {
      img = chip.querySelector('[data-thumb="k1"] img') as HTMLImageElement;
      expect(img?.src).toBe('blob:thumb:k1');
    });
    // 加载失败 → 自动重试一次仍未恢复 → 回退占位图标，无破图（两次错误 = 重试 + 判定失败）
    fireEvent.error(img as unknown as Element);
    fireEvent.error(img as unknown as Element);
    await waitFor(() => {
      expect(chip.querySelector('[data-thumb="k1"] img')).toBeNull();
      expect(chip.querySelector('[data-thumb="k1"] svg')).toBeTruthy();
    });
  });
});

describe('@ 面板：空态导入 + 开源页签（2026-11-05 任务八）', () => {
  const openPanel = (container: HTMLElement): HTMLElement => {
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    return container.querySelector('[data-director-asset-panel]') as HTMLElement;
  };

  it('空态给出口：资产列表为空 → 空态块内「导入资产」按钮 + 隐藏 file input；三个页签（资产/主体/开源）齐备', () => {
    // useAssets mock 的资产数组是可变引用——置空驱动空态（finally 恢复，不污染其他用例）
    const orig = mockAssets.assets;
    mockAssets.assets = [];
    try {
      const { container } = renderPanel({});
      const panel = openPanel(container);
      // 三个页签（开源复用 OpenLibBrowser 嵌入）
      expect(panel.querySelector('[data-asset-panel-tab="asset"]')).toBeTruthy();
      expect(panel.querySelector('[data-asset-panel-tab="subject"]')).toBeTruthy();
      expect(panel.querySelector('[data-asset-panel-tab="openlib"]')).toBeTruthy();
      // 空态块：不只留一句「暂无可引用资产」，直接给导入出口
      const empty = panel.querySelector('[data-asset-panel-import-empty]');
      expect(empty).toBeTruthy();
      expect(empty?.textContent).toContain('暂无可引用资产');
      expect(empty?.querySelector('[data-asset-import]')).toBeTruthy();
      // 隐藏 file input（同一条 useCasUpload 链）
      const input = panel.querySelector('[data-asset-import-input]') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.type).toBe('file');
    } finally {
      mockAssets.assets = orig;
    }
  });

  it('非空态轻量导入入口：列表底行「导入资产」恰 1 个（空态块不渲染，不用退出去导入）', () => {
    const { container } = renderPanel({});
    const panel = openPanel(container);
    expect(panel.querySelector('[data-asset-panel-import-empty]')).toBeNull();
    const imports = panel.querySelectorAll('[data-asset-import]');
    expect(imports.length).toBe(1);
    expect(imports[0]?.textContent).toContain('导入资产');
  });

  it('开源页签：复用 OpenLibBrowser 列出开源库条目（自动选中第一个库；18+ 门控沿用 isAgeConfirmed）', async () => {
    const { container } = renderPanel({});
    const panel = openPanel(container);
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="openlib"]') as Element);
    const openlibPane = panel.querySelector('[data-asset-panel-openlib]') as HTMLElement;
    expect(openlibPane).toBeTruthy();
    // meta（异步）→ 默认选第一个库 hanami → query（异步）→ 条目网格
    await waitFor(() => {
      const card1 = openlibPane.querySelector('[data-openlib-entry="openlib:hanami:s1"]') as HTMLElement;
      expect(card1).toBeTruthy();
      expect(card1.textContent).toContain('开源图1');
    });
    expect(openlibPane.querySelector('[data-openlib-entry="openlib:hanami:s2"]')).toBeTruthy();
    // 18+ 口径未绕开：adultHidden = 0 时不渲染解锁入口；isAgeConfirmed 保持 false
    expect(openlibPane.querySelector('[data-testid="openlib-age-gate-button"]')).toBeNull();
    expect(openLibMock.isAgeConfirmed()).toBe(false);
    // 开源页签不渲染资产搜索框（OpenLibBrowser 自带分类/搜索）
    expect(openlibPane.querySelector('[data-asset-panel-search]')).toBeNull();
  });

  it('点击开源条目 = 入库 + 插入当前片段（importOpenLibEntry → onPickAssetFromOpenLib → 占槽 + @Picture1 + 关面板）', async () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({ onShotChange: (p) => patches.push(p) });
    const panel = openPanel(container);
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="openlib"]') as Element);
    // meta/query 异步落定后才渲染条目——查询必须放进 waitFor 回调（外部一次性查询拿到的是 stale null）
    const card = await waitFor(() => {
      const el = panel.querySelector('[data-openlib-entry="openlib:hanami:s1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(card as Element);
    // 入库：走 importOpenLibEntry（拉进用户 CAS，沿用开源素材入库路径）
    await waitFor(() => {
      expect(openLibMock.importOpenLibEntry).toHaveBeenCalledTimes(1);
      expect(openLibMock.importOpenLibEntry).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openlib:hanami:s1' }),
      );
    });
    // 插入：与资产条目 onPick 同一执行路径——占 Picture1 槽 + 提示词插入引用块
    await waitFor(() => {
      const refPatch = patches.find((p) => Array.isArray(p.references));
      expect(refPatch?.references?.some((r) => r.id === 'openlib:hanami:s1')).toBe(true);
      const promptPatch = patches.find((p) => typeof p.imagePrompt === 'string');
      expect(promptPatch?.imagePrompt).toContain('@Picture1 ');
    });
    // 插入后面板关闭
    await waitFor(() => {
      expect(container.querySelector('[data-director-asset-panel]')).toBeNull();
    });
    // 导演台内部插入不跳转（人已在原地，跳转会打断编辑）
    expect(navMock.navigateToView).not.toHaveBeenCalled();
  });
});

describe('@ 面板放大（2026-11-05 任务三）：尺寸 / 行高 / 缩略图 / 三页签 / 滚动容器 / 视口夹取', () => {
  const openPanel = (container: HTMLElement): HTMLElement => {
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    return container.querySelector('[data-director-asset-panel]') as HTMLElement;
  };

  it('面板宽高 = min(560px, 92vw) / min(440px, 80vh)；行高 44、缩略图 36、详情宽 216、搜索 34', () => {
    const { container } = renderPanel({});
    const panel = openPanel(container);
    const style = panel.getAttribute('style') ?? '';
    // 视口约束写在宽高表达式里（而非另写 max-width/max-height，jsdom 不一定支持该简写）
    expect(style).toContain(ASSET_PICK_PANEL_WIDTH);
    expect(style).toContain(ASSET_PICK_PANEL_HEIGHT);
    expect(ASSET_PICK_PANEL_WIDTH).toBe('min(560px, 92vw)');
    expect(ASSET_PICK_PANEL_HEIGHT).toBe('min(440px, 80vh)');

    // 资产行：行高 44、行内边距 0 10px、缩略图 36×36
    const row = panel.querySelector('[data-asset-panel-item="a1"]') as HTMLElement;
    expect(ASSET_PICK_ROW_HEIGHT).toBe(44);
    expect(row.style.height).toBe('44px');
    expect(row.style.padding).toBe('0px 10px');
    const thumb = row.querySelector('[data-thumb="k1"]') as HTMLElement;
    expect(ASSET_PICK_THUMB_SIZE).toBe(36);
    expect(thumb.style.width).toBe('36px');
    expect(thumb.style.height).toBe('36px');

    // 搜索框同步放大
    const search = panel.querySelector('[data-asset-panel-search]') as HTMLElement;
    expect(search.style.height).toBe('34px');

    // 右侧详情区加宽到 216，不再压窄
    const detail = panel.querySelector('[data-asset-detail]') as HTMLElement;
    expect(ASSET_PICK_DETAIL_WIDTH).toBe(216);
    expect(detail.style.width).toBe('216px');
    expect(detail.style.height).toBe('100%');
    // 字段行距 ≥8
    const rows = detail.querySelectorAll('[data-detail-row]');
    rows.forEach((r) => expect((r as HTMLElement).style.gap).toBe('8px'));
  });

  it('列表为固定高度滚动容器（flex:1 + minHeight:0 + overflowY:auto，无自适应 maxHeight 跳动）', () => {
    const { container } = renderPanel({});
    const panel = openPanel(container);
    const list = panel.querySelector('[data-asset-panel-list]') as HTMLElement;
    expect(list).toBeTruthy();
    expect(list.style.overflowY).toBe('auto');
    expect(list.style.flex).toContain('1');
    expect(list.style.minHeight).toBe('0');
    expect(list.style.maxHeight).toBe('');
  });

  it('放大后三页签仍可完整切换（资产 → 主体 → 开源），底部导入入口保留', () => {
    const { container } = renderPanel({});
    const panel = openPanel(container);
    const tabs = panel.querySelectorAll('[data-asset-panel-tab]');
    expect(tabs.length).toBe(3);
    expect(panel.querySelector('[data-asset-panel-item="a1"]')).toBeTruthy();
    // 主体
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    expect(panel.querySelector('[data-asset-panel-list]')).toBeTruthy();
    // 开源：占满剩余高度（flex:1），不再固定 340
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="openlib"]') as Element);
    const openlib = panel.querySelector('[data-asset-panel-openlib]') as HTMLElement;
    expect(openlib.style.flex).toContain('1');
    expect(openlib.style.height).toBe('');
    // 回到资产：导入入口仍在
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="asset"]') as Element);
    expect(panel.querySelectorAll('[data-asset-import]').length).toBe(1);
  });

  it('视口夹取：实测矩形溢出右下边缘 → transform 平移回视口内（锚点定位不变）', () => {
    const { container } = renderPanel({});
    const panel = openPanel(container);
    expect(panel.style.top).toBe('100%');
    expect(panel.style.left).toBe('0px');
    const rect = { left: 900, top: 600, right: 1460, bottom: 1040, width: 560, height: 440, x: 900, y: 600, toJSON: () => ({}) } as DOMRect;
    const spy = vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect);
    // 切页签触发重新测量（依赖 panelTab）
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    expect(panel.style.transform).toContain('translate(');
    // 1024 - 8 - 1460 = -444；768 - 8 - 1040 = -280
    expect(panel.style.transform).toContain('-444px');
    expect(panel.style.transform).toContain('-280px');
    spy.mockRestore();
  });
});


// ===== 主体状态级媒体（2026-11-05）：@ 候选独立于插槽 =====

const SUBJECT_TREES = [
  {
    rootId: 'root-1', name: '季莹', kind: 'character', aliases: [],
    baseState: { prompt: '', templateType: 'character_lineup', templateReason: '', referenceImages: [], aiStableKey: 'root-1_base' },
    states: [
      { id: 'st-injured', state: '受伤', type: 'image', media: [{ key: 'sk-injured', type: 'image' }], deltaPrompt: '', fullPrompt: '', recognitionTerms: [], source: 'user', baseRef: 'root-1' },
      { id: 'st-voice', state: '音色', type: 'audio', media: [{ key: 'sk-voice', type: 'audio' }], deltaPrompt: '', fullPrompt: '', recognitionTerms: [], source: 'user', baseRef: 'root-1' },
      { id: 'st-empty', state: '幼年', type: 'image', media: [], deltaPrompt: '', fullPrompt: '', recognitionTerms: [], source: 'user', baseRef: 'root-1' },
    ],
  },
] as unknown as SubjectTree[];

describe('主体状态素材候选（@ 面板，2026-11-05）', () => {
  const openPanel = (container: HTMLElement): HTMLElement => {
    fireEvent.click(container.querySelector('[data-asset-add="segment"]') as Element);
    return container.querySelector('[data-director-asset-panel]') as HTMLElement;
  };

  it('层级 = 主体 / 状态 / 素材；无任何插槽分配时也能查到并插入（subject-state:<rootId>/<stateId>）', () => {
    const patches: Array<Partial<WorkbenchShot>> = [];
    // 片段 references 为空 = 没有任何插槽分配，候选仍来自主体树
    const { container } = renderPanel({ subjectTrees: SUBJECT_TREES, onShotChange: (p) => patches.push(p) });
    const panel = openPanel(container);
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    // 主体层
    expect(panel.querySelector('[data-subject-state-tree="root-1"]')?.textContent).toContain('季莹');
    // 状态层：图片状态 / 音频状态都可查到
    const imgRow = panel.querySelector('[data-subject-state-asset="subject-state:root-1/st-injured"]');
    const audioRow = panel.querySelector('[data-subject-state-asset="subject-state:root-1/st-voice"]');
    expect(imgRow?.textContent).toContain('季莹·受伤');
    expect(audioRow?.textContent).toContain('季莹·音色');
    // 无媒体状态：显示但不可插入
    const emptyRow = panel.querySelector('[data-subject-state-empty="root-1/st-empty"]') as HTMLButtonElement;
    expect(emptyRow).toBeTruthy();
    expect(emptyRow.disabled).toBe(true);
    expect(emptyRow.textContent).toContain('无素材');
    // 单击图片状态行 → 插入稳定 id + 占 Picture1
    fireEvent.click(imgRow as Element);
    const refPatch = patches.find((p) => Array.isArray(p.references));
    const refs = refPatch?.references as Array<{ id: string; kind: string; slotNo?: number }>;
    expect(refs?.[0]?.id).toBe('subject-state:root-1/st-injured');
    expect(refs?.[0]?.kind).toBe('image');
    expect(refs?.[0]?.slotNo).toBe(1);
    const promptPatch = patches.find((p) => typeof p.imagePrompt === 'string');
    expect(promptPatch?.imagePrompt).toContain('@Picture1 ');
  });

  it('图片槽位已达上限 → 拒绝插入（无 references 写入、无超位引用）', () => {
    const fullRefs = Array.from({ length: 9 }, (_, i) => ({
      id: `f${i}`, kind: 'image' as const, title: `图${i}`, url: `data:image/png;base64,${i}`, storageKey: `kf${i}`,
    }));
    const patches: Array<Partial<WorkbenchShot>> = [];
    const { container } = renderPanel({
      shot: makeShot({ references: fullRefs }),
      subjectTrees: SUBJECT_TREES,
      onShotChange: (p) => patches.push(p),
    });
    const panel = openPanel(container);
    fireEvent.click(panel.querySelector('[data-asset-panel-tab="subject"]') as Element);
    fireEvent.click(panel.querySelector('[data-subject-state-asset="subject-state:root-1/st-injured"]') as Element);
    expect(patches.some((p) => Array.isArray(p.references))).toBe(false);
    expect(patches.some((p) => typeof p.imagePrompt === 'string' && p.imagePrompt.includes('@Picture10'))).toBe(false);
  });
});

// ===== 2026-11-06 时长滑动条（用户指令：0–30s 滑动 + 滑动过程中提醒是否超推荐时长）=====
describe('导演台时长 = 0–30s 滑动条 + 超推荐实时提醒', () => {
  it('未开段间引导：range 滑块 0.2–30（步长 0.2），推荐上限 = 30s（736 帧 @24fps 取整），数字输入框已下线', () => {
    const { container } = renderPanel({ shot: makeShot({ continuation: { enabled: false } }) });
    fireEvent.click(container.querySelector('[data-meta-duration]') as Element);
    const range = document.querySelector('[data-duration-range]') as HTMLInputElement;
    expect(range).toBeTruthy();
    expect(range.type).toBe('range');
    expect(range.min).toBe('0.2');
    expect(range.max).toBe('30');
    expect(range.step).toBe('0.2');
    expect(range.value).toBe('10');
    expect(document.querySelector('[data-duration-popover] .director-input-number')).toBeNull();
    expect(document.querySelector('[data-duration-cap]')?.textContent).toContain('推荐 ≤30s');
    expect(document.querySelector('[data-duration-warning]')).toBeNull();
    expect((container.querySelector('[data-meta-duration]') as HTMLElement).getAttribute('data-over-cap')).toBeNull();
  });

  it('默认开引导（ctx=22 帧）：推荐上限自动扣到 29s，10s 仍在区内不报警', () => {
    const { container } = renderPanel();
    fireEvent.click(container.querySelector('[data-meta-duration]') as Element);
    expect(document.querySelector('[data-duration-cap]')?.textContent).toContain('推荐 ≤29s');
    expect(document.querySelector('[data-duration-warning]')).toBeNull();
  });

  it('滑动即写回 duration（单一入口，不额外确认弹窗）', () => {
    const onShotChange = vi.fn();
    const { container } = renderPanel({ onShotChange });
    fireEvent.click(container.querySelector('[data-meta-duration]') as Element);
    fireEvent.change(document.querySelector('[data-duration-range]') as Element, { target: { value: '12.4' } });
    expect(onShotChange).toHaveBeenCalledWith({ duration: 12.4 });
  });

  it('超推荐但未超硬上限（30.2s，推荐 29s）：警告实时出现，滑块上限诚实扩到 31', () => {
    const { container } = renderPanel({ shot: makeShot({ duration: 30.2 }) });
    const capsule = container.querySelector('[data-meta-duration]') as HTMLElement;
    expect(capsule.getAttribute('data-over-cap')).toBe('1');
    fireEvent.click(capsule);
    const range = document.querySelector('[data-duration-range]') as HTMLInputElement;
    expect(range.max).toBe('31');
    expect(range.getAttribute('data-over-cap')).toBe('1');
    const warn = document.querySelector('[data-duration-warning]') as HTMLElement;
    expect(warn.textContent).toContain('超出推荐时长 1.2s');
    expect(warn.textContent).toContain('单段建议 ≤29s');
    expect(warn.textContent).not.toContain('frame-overflow');
  });

  it('超单段硬帧上限（34s → >736 帧）：警告升级为 frame-overflow 措辞', () => {
    const { container } = renderPanel({ shot: makeShot({ duration: 34 }) });
    fireEvent.click(container.querySelector('[data-meta-duration]') as Element);
    const warn = document.querySelector('[data-duration-warning]') as HTMLElement;
    expect(warn.textContent).toContain('frame-overflow');
    expect(warn.textContent).toContain('736');
  });

  it('开段间引导时推荐上限按 ctx 帧数扣回（56 帧 → 28s），与 dry-run 同一判据', () => {
    const shared = makeShared({ params: { aspect: '16:9', scaleFactor: 1, continuityOverlapFrames: 56 } });
    const { container } = renderPanel({ shared, shot: makeShot({ duration: 29 }) });
    fireEvent.click(container.querySelector('[data-meta-duration]') as Element);
    expect(document.querySelector('[data-duration-cap]')?.textContent).toContain('推荐 ≤28s');
    const warn = document.querySelector('[data-duration-warning]') as HTMLElement;
    expect(warn.textContent).toContain('超出推荐时长 1s');
    // 29s 本身未超 736 帧硬上限 → 不应升级为 frame-overflow
    expect(warn.textContent).not.toContain('frame-overflow');
  });

  it('引导开启但时长仍在扣回后的上限内（10s ≤ 28s）→ 不报警', () => {
    const shared = makeShared({ params: { aspect: '16:9', scaleFactor: 1, continuityOverlapFrames: 56 } });
    const { container } = renderPanel({ shared, shot: makeShot({ duration: 10 }) });
    fireEvent.click(container.querySelector('[data-meta-duration]') as Element);
    expect(document.querySelector('[data-duration-cap]')?.textContent).toContain('推荐 ≤28s');
    expect(document.querySelector('[data-duration-warning]')).toBeNull();
  });
});
