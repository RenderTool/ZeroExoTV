/**
 * send-to-workbench - 抽屉/开源库「发送到导演台当前片段」执行器单测
 *
 * 2026-11-05 回归（线上出现「加入当前片段成功提示但槽位无变化」）：
 * 开源库导入资产 scope='library' 且无 projectId，事件若按资产归属发 '' 会被宿主
 * projectId 过滤静默丢弃（dispatchEvent 仍返回 true → 提示成功但槽位无变化）。
 * 修复后事件 projectId 一律取宿主快照（workbench-send.ts WorkbenchSendContext.projectId）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncWorkbenchSendContext } from './workbench-send.js';
import { sendAssetToWorkbench } from './send-to-workbench.js';
import { WORKBENCH_ADD_REF_EVENT, WORKBENCH_SET_GUIDE_EVENT } from '@/features/canvas-tabs/workbench-slot-bus.js';
import type { Asset } from '@/features/asset-picker/index.js';

// 统一导航入口 mock：发送到导演台 = 跳转导演台并聚焦当前片段（2026-11-05 约定：
// 发送目标即跳转目标）。跳转实现属 navigate-to-view 线（canvas-tab-restore.test.ts
// 覆盖入口本身），这里只断言执行器调用了正确参数。
const navMock = vi.hoisted(() => ({ navigateToView: vi.fn() }));
vi.mock('@/features/canvas-tabs/navigate-to-view.js', () => navMock);

const t = ((_key: string, fallback: string) => fallback) as unknown as Parameters<typeof sendAssetToWorkbench>[2];

function messageSpy() {
  return {
    success: vi.fn(), warning: vi.fn(), info: vi.fn(),
  };
}

/** 开源库导入形态的资产（scope='library'，无 projectId） */
function openLibAsset(): Asset {
  return {
    id: 'asset-open-1',
    title: '开源素材',
    projectId: undefined,
    scope: 'library',
    data: { kind: 'image', dataUrl: 'data:image/png;base64,x', storageKey: 'open-1' },
  } as unknown as Asset;
}

/** 生成产物形态：视频 + 自带引导数据 */
function videoWithGuide(): Asset {
  return {
    id: 'asset-video-1',
    title: '片段 1 · 5s',
    scope: 'project',
    projectId: 'proj-1',
    data: {
      kind: 'video',
      url: '',
      storageKey: 'cas:abc.mp4',
      guide: { id: 'gd_abc12345', frames: 22, sha256: 'ff' },
    },
  } as unknown as Asset;
}

describe('sendAssetToWorkbench：发送引导数据（2026-11-07 独立引导槽）', () => {
  it('mode=guide → 发引导槽事件（id/帧数/来源资产），不占参考槽、不重复发入槽事件', () => {
    syncWorkbenchSendContext({ projectId: 'proj-1', activeShotId: 'shot-1', segmentAssets: [], tier: 'h3' });
    const msg = messageSpy();
    const guides: Array<{ projectId: string; guide: { id: string; frames?: number; fromAssetId?: string } }> = [];
    const refs = vi.fn();
    const onGuide = (e: Event) => guides.push((e as CustomEvent<typeof guides[number]>).detail);
    window.addEventListener(WORKBENCH_SET_GUIDE_EVENT, onGuide);
    window.addEventListener(WORKBENCH_ADD_REF_EVENT, refs);
    try {
      sendAssetToWorkbench(videoWithGuide(), msg, t, { mode: 'guide' });
    } finally {
      window.removeEventListener(WORKBENCH_SET_GUIDE_EVENT, onGuide);
      window.removeEventListener(WORKBENCH_ADD_REF_EVENT, refs);
    }
    expect(guides).toHaveLength(1);
    expect(guides[0]!.projectId).toBe('proj-1');
    expect(guides[0]!.guide.id).toBe('gd_abc12345');
    expect(guides[0]!.guide.frames).toBe(22);
    expect(guides[0]!.guide.fromAssetId).toBe('asset-video-1');
    expect(refs).not.toHaveBeenCalled();
    expect(msg.success).toHaveBeenCalledTimes(1);
    expect(navMock.navigateToView).toHaveBeenCalledWith('director', { shotId: 'shot-1', projectId: 'proj-1' });
  });

  it('素材没有引导数据 → 明确提示，不发事件', async () => {
    syncWorkbenchSendContext({ projectId: 'proj-1', activeShotId: 'shot-1', segmentAssets: [], tier: 'h3' });
    const msg = messageSpy();
    const listener = vi.fn();
    window.addEventListener(WORKBENCH_SET_GUIDE_EVENT, listener);
    try {
      sendAssetToWorkbench(openLibAsset(), msg, t, { mode: 'guide' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      window.removeEventListener(WORKBENCH_SET_GUIDE_EVENT, listener);
    }
    expect(listener).not.toHaveBeenCalled();
    expect(msg.warning).toHaveBeenCalledWith('该素材没有引导');
  });

  it('无选中片段 → 先提示，不写引导槽', () => {
    const listener = vi.fn();
    window.addEventListener(WORKBENCH_SET_GUIDE_EVENT, listener);
    try {
      sendAssetToWorkbench(videoWithGuide(), messageSpy(), t, { mode: 'guide' });
    } finally {
      window.removeEventListener(WORKBENCH_SET_GUIDE_EVENT, listener);
    }
    expect(listener).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  syncWorkbenchSendContext(null);
  navMock.navigateToView.mockClear();
});

describe('sendAssetToWorkbench：事件目标 = 宿主快照（projectId 修复回归）', () => {
  it('开源库导入资产（无 projectId）→ 事件 projectId 取宿主快照，不被宿主过滤静默丢弃', () => {
    syncWorkbenchSendContext({
      projectId: 'proj-1',
      activeShotId: 'shot-1',
      segmentAssets: [],
      tier: 'h3',
    });
    const msg = messageSpy();
    const events: Array<{ projectId: string; assetId: string; ref: { slotNo?: number } }> = [];
    const listener = (e: Event) => {
      const d = (e as CustomEvent<{ projectId: string; assetId: string; ref: { slotNo?: number } }>).detail;
      events.push(d);
    };
    window.addEventListener(WORKBENCH_ADD_REF_EVENT, listener);
    try {
      sendAssetToWorkbench(openLibAsset(), msg, t);
    } finally {
      window.removeEventListener(WORKBENCH_ADD_REF_EVENT, listener);
    }
    // 修复点：projectId 是宿主快照的 'proj-1'（修复前为 '' → 宿主过滤丢弃）
    expect(events.length).toBe(1);
    expect(events[0]!.projectId).toBe('proj-1');
    expect(events[0]!.assetId).toBe('asset-open-1');
    expect(events[0]!.ref.slotNo).toBe(1);
    expect(msg.success).toHaveBeenCalledTimes(1);
  });

  it('宿主未打开（快照为 null）→ 不发事件，明确提示不静默', () => {
    const msg = messageSpy();
    const listener = vi.fn();
    window.addEventListener(WORKBENCH_ADD_REF_EVENT, listener);
    try {
      sendAssetToWorkbench(openLibAsset(), msg, t);
    } finally {
      window.removeEventListener(WORKBENCH_ADD_REF_EVENT, listener);
    }
    expect(listener).not.toHaveBeenCalled();
    expect(msg.warning).toHaveBeenCalledWith('请先在导演台选中一个片段');
  });

  it('已在当前片段池 → 不发事件，提示复用原槽位', () => {
    syncWorkbenchSendContext({
      projectId: 'proj-1',
      activeShotId: 'shot-1',
      segmentAssets: [{ id: 'asset-open-1', kind: 'image', title: '开源素材', storageKey: 'open-1', slotNo: 1 }],
      tier: 'h3',
    });
    const msg = messageSpy();
    const listener = vi.fn();
    window.addEventListener(WORKBENCH_ADD_REF_EVENT, listener);
    try {
      sendAssetToWorkbench(openLibAsset(), msg, t);
    } finally {
      window.removeEventListener(WORKBENCH_ADD_REF_EVENT, listener);
    }
    expect(listener).not.toHaveBeenCalled();
    expect(msg.info).toHaveBeenCalledWith('已在导演台，无需重复发送');
  });
});

describe('sendAssetToWorkbench：发送到导演台 = 跳转导演台并聚焦当前片段（2026-11-05）', () => {
  it('非导演台来源（开源库/资产库/抽屉）插入成功后 → navigateToView("director", { shotId }) 且 shotId 正确', () => {
    syncWorkbenchSendContext({
      projectId: 'proj-1',
      activeShotId: 'shot-1',
      segmentAssets: [],
      tier: 'h3',
    });
    const msg = messageSpy();
    sendAssetToWorkbench(openLibAsset(), msg, t);
    expect(msg.success).toHaveBeenCalledTimes(1);
    // 跳转并聚焦宿主快照里的当前片段（不是资产归属——开源资产无 projectId）
    expect(navMock.navigateToView).toHaveBeenCalledTimes(1);
    expect(navMock.navigateToView).toHaveBeenCalledWith('director', { shotId: 'shot-1', projectId: 'proj-1' });
  });

  it('已在池中（复用原槽位语义上等于已送达）→ 同样跳转聚焦', () => {
    syncWorkbenchSendContext({
      projectId: 'proj-1',
      activeShotId: 'shot-1',
      segmentAssets: [{ id: 'asset-open-1', kind: 'image', title: '开源素材', storageKey: 'open-1', slotNo: 1 }],
      tier: 'h3',
    });
    sendAssetToWorkbench(openLibAsset(), messageSpy(), t);
    expect(navMock.navigateToView).toHaveBeenCalledTimes(1);
    expect(navMock.navigateToView).toHaveBeenCalledWith('director', { shotId: 'shot-1', projectId: 'proj-1' });
  });

  it('被拒绝（宿主未打开）→ 不跳转（人停在原地无意义，先给明确提示）', () => {
    sendAssetToWorkbench(openLibAsset(), messageSpy(), t);
    expect(navMock.navigateToView).not.toHaveBeenCalled();
  });
});
