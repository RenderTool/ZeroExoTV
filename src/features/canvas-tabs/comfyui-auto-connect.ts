/**
 * comfyui-auto-connect — 自动连接（静默）+ 频率纪律（2026-11-05）
 *
 * 用户要求：「ComfyUI 连接要自动尝试，不要每次打开都手动重连；但频率要克制」。
 *
 * - 触发源仅三类 + 手动：mount / visibility（≥60s）/ panel（≥60s）/ manual；
 * - 成功静默更新状态点与短词，不弹 toast；失败只在面板留一行原因 + 「重试」；
 * - 失败指数退避 30s→60s→120s（上限 300s），连续 3 次失败停止自动探测；
 * - 手动成功重置退避与计数；隐藏标签页 / 生成中一律不探；in-flight 去重。
 *
 * 真正的纪律实现见 auto-probe-scheduler.ts（纯类，假计时器可测）。
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { fetchBridgeModels } from './comfyui-bridge-client.js';
import { pickDefaultModels, useComfyuiConnectionStore } from './comfyui-connection.js';
import {
  testEndpointConnection,
  useComfyuiEndpointStore,
  type EndpointTestResult,
} from './comfyui-endpoint.js';
import { AutoProbeScheduler, type AutoProbeSnapshot } from './auto-probe-scheduler.js';

const IDLE_SNAPSHOT: AutoProbeSnapshot = {
  status: 'idle',
  failureMessage: null,
  consecutiveFailures: 0,
  autoStopped: false,
  nextAllowedAt: 0,
  lastProbeAt: 0,
};

/** 面板用：订阅自动连接状态（失败原因行 / 是否在探测 / 是否已停用自动） */
export const useComfyuiAutoConnectStore = create<AutoProbeSnapshot>(() => ({ ...IDLE_SNAPSHOT }));

/**
 * 把一次探测结果静默落到连接状态（不弹 toast、不打断操作）。
 * 返回 bridgeMissing：直连成功但桥接 /zeroexo/h3/models 抓不到（面板一行短提示用）。
 */
export async function applyConnectionResult(
  result: EndpointTestResult,
): Promise<{ bridgeMissing: boolean }> {
  const ep = useComfyuiEndpointStore.getState();
  const prefs = useComfyuiConnectionStore.getState();
  if (result.kind === 'fail') {
    ep.disconnect();
    prefs.setConnected(false);
    return { bridgeMissing: false };
  }
  ep.markTested(result.address, result.backend, result.models, result.machine);
  if (result.backend === 'zeroexo') {
    // 重写版插件（/zeroexo/v1/jobs）：不依赖桥接模型四件套，直接视为可运行
    prefs.setConnected(true);
    return { bridgeMissing: false };
  }
  if (result.backend !== 'direct') {
    prefs.setConnected(false); // 兼容口模式不启用直连运行态
    return { bridgeMissing: false };
  }
  try {
    const models = await fetchBridgeModels(result.address, prefs.token || undefined);
    const defaults = pickDefaultModels(models, prefs.models);
    prefs.setConnected(true, { unet: models.unet, vae: models.vae, clip: models.clip });
    for (const slot of ['unet', 'videoVae', 'audioVae', 'clip'] as const) {
      prefs.setModel(slot, defaults[slot]);
    }
    return { bridgeMissing: false };
  } catch {
    prefs.setConnected(true);
    return { bridgeMissing: true };
  }
}

let scheduler: AutoProbeScheduler<EndpointTestResult> | null = null;

/** 真实探测：读已保存地址 → 三态探测 → 静默落连接状态 */
async function probeSavedAddress(): Promise<EndpointTestResult | null> {
  const address = useComfyuiEndpointStore.getState().address;
  if (!address) return null;
  const result = await testEndpointConnection(address);
  await applyConnectionResult(result);
  return result;
}

function getScheduler(): AutoProbeScheduler<EndpointTestResult> {
  if (!scheduler) {
    scheduler = new AutoProbeScheduler<EndpointTestResult>({
      probe: probeSavedAddress,
      onChange: (snapshot) => useComfyuiAutoConnectStore.setState(snapshot),
    });
  }
  return scheduler;
}

/** 面板打开时自动探一次（受 60s 门槛 / 退避 / 停用约束） */
export function requestComfyuiAutoProbe(reason: 'mount' | 'visibility' | 'panel' | 'manual'): void {
  void getScheduler().request(reason);
}

/** 「重试」入口：手动探测（无视退避；成功即重置退避与失败计数） */
export function retryComfyuiConnection(): void {
  void getScheduler().request('manual');
}

/** 面板自己用草稿地址做的手动测试，回报结果以更新退避/计数 */
export function notifyManualConnectionResult(result: EndpointTestResult | null): void {
  getScheduler().notifyManualResult(result);
}

/**
 * 挂载 Hook：进入导演台/画布页时自动探一次；监听 visibilitychange 回到前台。
 * disabled=true（生成进行中）不探测，并暂停退避定时器的自动重试。
 */
export function useComfyuiAutoConnect(options: { disabled?: boolean } = {}): void {
  const disabled = options.disabled ?? false;
  useEffect(() => {
    const s = getScheduler();
    s.setPaused(disabled);
    if (disabled) return;
    s.request('mount');
    const onVisibility = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      s.request('visibility');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [disabled]);
}

/** 测试用：重置调度器与状态 */
export function __resetComfyuiAutoConnectForTests(): void {
  scheduler?.dispose();
  scheduler = null;
  useComfyuiAutoConnectStore.setState({ ...IDLE_SNAPSHOT });
}
