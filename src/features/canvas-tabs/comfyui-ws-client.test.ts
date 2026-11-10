/**
 * 标准 ComfyUI 预览通道：图片作业的步进（文本 progress）与采样预览（二进制 PREVIEW_IMAGE）。
 * 导演台事件不走这里（那条链路由 minimax_director_* 覆盖），所以这里只断言原生事件。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComfyuiPreviewSocket } from './comfyui-ws-client.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  binaryType = '';
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    /* noop */
  }
}

function installFakeSocket(): void {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ComfyuiPreviewSocket', () => {
  it('连到同一 clientId 的 /ws（与提交时透传的一致才能收到进度）', () => {
    installFakeSocket();
    const socket = new ComfyuiPreviewSocket('http://127.0.0.1:8188', 'cid-1', {});
    socket.connect();
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://127.0.0.1:8188/ws?clientId=cid-1');
    socket.close();
  });

  it('文本 progress → step/totalSteps，并夹住越界值', () => {
    installFakeSocket();
    const onStep = vi.fn();
    const socket = new ComfyuiPreviewSocket('http://127.0.0.1:8188', 'cid-1', { onStep });
    socket.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.onmessage?.({ data: JSON.stringify({ type: 'progress', data: { value: 3, max: 25 } }) });
    expect(onStep).toHaveBeenLastCalledWith({ step: 3, totalSteps: 25 });
    ws.onmessage?.({ data: JSON.stringify({ type: 'progress', data: { value: 99, max: 25 } }) });
    expect(onStep).toHaveBeenLastCalledWith({ step: 25, totalSteps: 25 });
    // 其它事件（executing/executed 等）不产生步进
    ws.onmessage?.({ data: JSON.stringify({ type: 'executing', data: { node: '3' } }) });
    expect(onStep).toHaveBeenCalledTimes(2);
    socket.close();
  });

  it('二进制 PREVIEW_IMAGE → dataURL（4 字节事件类型 + 4 字节格式 + 图像字节）', () => {
    installFakeSocket();
    const onPreviewImage = vi.fn();
    const socket = new ComfyuiPreviewSocket('http://127.0.0.1:8188', 'cid-1', { onPreviewImage });
    socket.connect();
    const ws = FakeWebSocket.instances[0]!;
    // 事件类型 1（PREVIEW_IMAGE）+ 格式 2（PNG）+ PNG magic
    const bytes = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 2, 0x89, 0x50, 0x4e, 0x47]);
    ws.onmessage?.({ data: bytes.buffer });
    expect(onPreviewImage).toHaveBeenCalledTimes(1);
    expect(onPreviewImage.mock.calls[0]![0]).toBe('data:image/png;base64,iVBORw==');
    socket.close();
  });

  it('非预览二进制（其它 BinaryEventTypes）忽略', () => {
    installFakeSocket();
    const onPreviewImage = vi.fn();
    const socket = new ComfyuiPreviewSocket('http://127.0.0.1:8188', 'cid-1', { onPreviewImage });
    socket.connect();
    const bytes = new Uint8Array([0, 0, 0, 4, 0, 0, 0, 2, 1, 2, 3]);
    FakeWebSocket.instances[0]!.onmessage?.({ data: bytes.buffer });
    expect(onPreviewImage).not.toHaveBeenCalled();
    socket.close();
  });

  it('max 不是步数（Qwen 缓存节点按 token 报 4096）→ 折算回请求的 25 步', () => {
    installFakeSocket();
    const onStep = vi.fn();
    const socket = new ComfyuiPreviewSocket('http://127.0.0.1:8188', 'cid-1', { onStep, expectedSteps: 25 });
    socket.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.onmessage?.({ data: JSON.stringify({ type: 'progress', data: { value: 4096, max: 4096 } }) });
    expect(onStep).toHaveBeenLastCalledWith({ step: 25, totalSteps: 25 });
    ws.onmessage?.({ data: JSON.stringify({ type: 'progress', data: { value: 2048, max: 4096 } }) });
    expect(onStep).toHaveBeenLastCalledWith({ step: 13, totalSteps: 25 });
    // 真·步数事件仍按原值显示（25 步 KSampler 的 progress 不会被折半）
    ws.onmessage?.({ data: JSON.stringify({ type: 'progress', data: { value: 7, max: 25 } }) });
    expect(onStep).toHaveBeenLastCalledWith({ step: 7, totalSteps: 25 });
    socket.close();
  });
});
