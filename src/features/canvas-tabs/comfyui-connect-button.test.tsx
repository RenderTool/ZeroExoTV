/**
 * comfyui-connect-button 极简面板单测（2026-11-05 约定：一个地址 + 两个按钮，其余全删）。
 * 验收：
 * ① 面板只剩一个输入框 + 测试连接/保存两个按钮（旧字段的 label/输入框/下拉均不存在）；
 * ② 测试连接三态：连通（直连/兼容口）/ 不可达 / 跨域被拒（CORS 一行短提示，不常驻）；
 * ③ 保存 → 地址持久化到 zeroexo.comfyuiEndpoint。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { ComfyuiConnectButton } from './comfyui-connect-button.js';
import { COMFYUI_ENDPOINT_STORAGE_KEY, useComfyuiEndpointStore } from './comfyui-endpoint.js';
import { useComfyuiConnectionStore } from './comfyui-connection.js';

const LOCAL = 'http://127.0.0.1:8188';

interface FakeRoute {
  match: (url: string) => boolean;
  status?: number;
  body?: unknown;
  reject?: boolean;
}

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockFetch(routes: FakeRoute[]) {
  const fn = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    for (const r of routes) {
      if (r.match(url)) {
        if (r.reject) throw new TypeError('Failed to fetch');
        return fakeResponse(r.status ?? 200, r.body);
      }
    }
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function openPanel(): void {
  fireEvent.click(screen.getByTestId('comfyui-connect-trigger'));
}

beforeEach(() => {
  localStorage.clear();
  useComfyuiEndpointStore.setState({ address: LOCAL, connected: false, backend: null, models: [] });
  useComfyuiConnectionStore.setState({
    token: '',
    models: { unet: '', videoVae: '', audioVae: '', clip: '' },
    connected: false,
    availableModels: { unet: [], vae: [], clip: [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('极简面板形态', () => {
  it('入口为 32×32 图标按钮（无文字），状态点存在', () => {
    render(<ComfyuiConnectButton />);
    const trigger = screen.getByTestId('comfyui-connect-trigger');
    expect(trigger.textContent?.trim()).toBe('');
    expect(trigger.style.width).toBe('32px');
    expect(trigger.style.height).toBe('32px');
    expect(trigger.style.padding).toBe('0px');
    expect(screen.getByTestId('comfyui-connect-dot')).toBeTruthy();
  });

  it('只有一个输入框 + 测试连接/保存两个按钮，旧字段全部不存在', async () => {
    render(<ComfyuiConnectButton />);
    openPanel();
    await waitFor(() => expect(screen.getByTestId('comfyui-endpoint-panel')).toBeTruthy());

    // 唯一输入框（地址），placeholder 示例本机地址
    expect(screen.getByTestId('comfyui-address-input')).toBeTruthy();
    expect(screen.queryAllByRole('textbox')).toHaveLength(1);
    expect((screen.getByTestId('comfyui-address-input') as HTMLInputElement).placeholder).toBe(LOCAL);

    // 两个按钮
    expect(screen.getByTestId('comfyui-test-btn').textContent).toContain('director.comfyTest');
    expect(screen.getByTestId('comfyui-save-btn').textContent).toContain('director.endpointSave');

    // 旧字段（label / 输入框 / 下拉 / 密码框 / 常驻 CORS 说明）全部不存在
    expect(screen.queryByText('director.channelName')).toBeNull();
    expect(screen.queryByText('director.channelBaseURL')).toBeNull();
    expect(screen.queryByText('director.channelApiKey')).toBeNull();
    expect(screen.queryByText('director.channelVideoModel')).toBeNull();
    expect(screen.queryByText('director.channelImageModel')).toBeNull();
    expect(screen.queryByText('director.channelSelect')).toBeNull();
    expect(screen.queryByText('director.channelCorsNote')).toBeNull();
    expect(screen.queryByText('director.comfyToken')).toBeNull();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0); // 渠道/模型下拉不存在
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0); // API Key 密码框不存在
  });
});

describe('测试连接三态', () => {
  it('连通 · 直连：状态短词出现，运行态连接成立', async () => {
    mockFetch([
      { match: (u) => u.endsWith('/favicon.ico'), body: {} },
      { match: (u) => u.endsWith('/system_stats'), body: { system: { comfyui_version: '0.3.50' }, devices: [] } },
      { match: (u) => u.endsWith('/zeroexo/h3/models'), body: { ok: true, unet: ['minimax_h3_v1.safetensors'], vae: ['video_vae.safetensors', 'audio_vae.safetensors'], clip: ['clip.safetensors'], clipTypes: ['minimax'] } },
    ]);
    render(<ComfyuiConnectButton />);
    openPanel();
    await waitFor(() => expect(screen.getByTestId('comfyui-endpoint-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('comfyui-test-btn'));
    await waitFor(() => expect(screen.getByTestId('comfyui-test-ok').textContent).toContain('director.endpointStatusDirect'));
    await waitFor(() =>
      expect(useComfyuiEndpointStore.getState()).toMatchObject({ connected: true, backend: 'direct' }),
    );
    expect(screen.getByTestId('comfyui-connect-trigger').getAttribute('data-connection-state')).toBe('connected');
    // 连接机器信息 + 显存策略手动兜底
    expect(screen.getByTestId('comfyui-machine-info')).toBeTruthy();
    expect(screen.getByTestId('comfyui-vram-mode')).toBeTruthy();
    expect(screen.getByTestId('comfyui-vram-summary')).toBeTruthy();
    // 直连自动抓模型四件套（界面不暴露下拉）
    expect(useComfyuiConnectionStore.getState().models.unet).toBe('minimax_h3_v1.safetensors');
  });

  it('连通 · 兼容口：/system_stats 不通走 /v1/models，状态短词为兼容口', async () => {
    mockFetch([
      { match: (u) => u.endsWith('/favicon.ico'), body: {} },
      { match: (u) => u.endsWith('/system_stats'), status: 404, body: {} },
      { match: (u) => u.endsWith('/v1/models'), body: { data: [{ id: 'video-1' }] } },
    ]);
    render(<ComfyuiConnectButton />);
    openPanel();
    await waitFor(() => expect(screen.getByTestId('comfyui-endpoint-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('comfyui-test-btn'));
    await waitFor(() => expect(screen.getByTestId('comfyui-test-ok').textContent).toContain('director.endpointStatusOpenai'));
    expect(useComfyuiEndpointStore.getState()).toMatchObject({ connected: true, backend: 'openai', models: ['video-1'] });
  });

  it('不可达：给出明确失败结果，不静默', async () => {
    mockFetch([{ match: (u) => u.endsWith('/favicon.ico'), reject: true }]);
    render(<ComfyuiConnectButton />);
    openPanel();
    await waitFor(() => expect(screen.getByTestId('comfyui-endpoint-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('comfyui-test-btn'));
    await waitFor(() => expect(screen.getByTestId('comfyui-test-fail').textContent).toContain('不可达'));
    expect(useComfyuiEndpointStore.getState().connected).toBe(false);
    expect(screen.getByTestId('comfyui-connect-trigger').getAttribute('data-connection-state')).toBe('failed');
  });

  it('跨域被拒：仅在失败处出现一行 --enable-cors-header 提示，未测试时面板无此文案', async () => {
    // 未测试 → 无 CORS 提示（不常驻）
    mockFetch([{ match: () => true, body: {} }]);
    render(<ComfyuiConnectButton />);
    openPanel();
    await waitFor(() => expect(screen.getByTestId('comfyui-endpoint-panel')).toBeTruthy());
    expect(screen.queryByText(/enable-cors-header/)).toBeNull();

    // 测试失败且判定为跨域 → 出现一行短提示
    mockFetch([
      { match: (u) => u.endsWith('/favicon.ico'), body: {} },
      { match: (u) => u.endsWith('/system_stats'), reject: true },
      { match: (u) => u.endsWith('/v1/models'), reject: true },
    ]);
    fireEvent.click(screen.getByTestId('comfyui-test-btn'));
    await waitFor(() => expect(screen.getByTestId('comfyui-test-fail').textContent).toContain('--enable-cors-header'));
    // 不能只在文案里出现参数名就算通过：必须明确是「要加」，而不是「无需」
    expect(screen.getByTestId('comfyui-test-fail').textContent).not.toContain('无需 --enable-cors-header');
  });
});

describe('地址持久化', () => {
  it('修改地址 → 保存 → zeroexo.comfyuiEndpoint 更新；地址改动后连接态失效', async () => {
    useComfyuiEndpointStore.setState({ address: LOCAL, connected: true, backend: 'direct', models: [] });
    render(<ComfyuiConnectButton />);
    openPanel();
    await waitFor(() => expect(screen.getByTestId('comfyui-endpoint-panel')).toBeTruthy());
    const input = screen.getByTestId('comfyui-address-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://cloud.example.com' } });
    fireEvent.click(screen.getByTestId('comfyui-save-btn'));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(COMFYUI_ENDPOINT_STORAGE_KEY) ?? '{}') as { data?: { address?: string } };
      expect(stored.data?.address).toBe('https://cloud.example.com');
    });
    // 地址变了 → 上次的连接态作废（需重新测试）
    expect(useComfyuiEndpointStore.getState()).toMatchObject({ connected: false, backend: null });
  });
});
