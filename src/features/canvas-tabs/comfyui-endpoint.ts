/**
 * comfyui-endpoint — ComfyUI 单地址连接（2026-11-05 极简化：一个地址 + 自动判定后端类型）
 *
 * 约定：无论线上还是线下的 ComfyUI 都只填一个地址。旧的面板概念（多渠道、API Key、
 * 模型标识、Base URL 区分）全部废弃，界面只剩「ComfyUI 地址」一个输入框。
 *
 * 存储与迁移（幂等，规则写在代码里）：
 * - 新键 `zeroexo.comfyuiEndpoint`（envelope { schemaVersion, data:{ address } }）一旦写入，
 *   旧键 `zeroexo.genChannels` / `zeroexo.comfyuiBridge` 就不再被读取 → 迁移只可能发生一次；
 * - 首次迁移取值优先级：旧 genChannels 的 activeChannel.baseURL → channels[0].baseURL
 *   → 旧 comfyuiBridge 的 baseUrl；其余字段（渠道名 / API Key / 模型标识）按要求丢弃；
 * - load 时即把迁移结果写回新键（幂等：下次 load 读到新键，直接返回，不再碰旧键）。
 *
 * 后端判定（testEndpointConnection，只读探测）：
 * 1) no-cors 探测 TCP 层（probeTcp 复用自 comfyui-bridge-client）→ 失败 = 不可达；
 * 2) GET {base}/zeroexo/h3/health（桥接插件自带 CORS，优先用它判定 direct）→ 合法 = 直连；
 * 3) 不通再 GET {base}/system_stats（ComfyUI 原生；旧插件/无 CORS 时可能被拦）→ 合法 = 直连；
 * 4) 不通再 GET {base}/v1/models（OpenAI 兼容口）→ 200 = 兼容口（openai）；
 * 5) TCP 通但两个真实请求都被浏览器拦截（未见到任何 HTTP 响应）= 跨域被拒（cors）；
 * 6) 有 HTTP 响应但两个探测口都不认 = rejected（附原因，如 401 需密钥）。
 *
 * 运行态（不持久化）：connected / backend / models（兼容口的 /v1/models 清单，运行时自动
 * 取第一个作为 model，界面不再暴露模型标识字段）。直连（direct）的模型四件套仍由
 * comfyui-connection 存取（测试通过后自动抓取 /zeroexo/h3/models 并按 minimax_h3 规则挑选）。
 */

import { create } from 'zustand';
import { DEFAULT_COMFYUI_BASE_URL, normalizeBaseUrl, probeTcp } from './comfyui-bridge-client.js';
import { pickDefaultModels, useComfyuiConnectionStore } from './comfyui-connection.js';
import type { DirectorBridgeConfig } from './use-director-run.js';

export const COMFYUI_ENDPOINT_STORAGE_KEY = 'zeroexo.comfyuiEndpoint';
export const COMFYUI_ENDPOINT_SCHEMA_VERSION = 1;
export const DEFAULT_COMFYUI_ENDPOINT_ADDRESS = DEFAULT_COMFYUI_BASE_URL;

export interface ComfyuiEndpointPrefs {
  /** 唯一地址：本机 ComfyUI（http://127.0.0.1:8188）或线上地址都填这里 */
  address: string;
}

// ===== 旧数据迁移（幂等） =====

/** 读旧 `zeroexo.genChannels`（渠道时代结构）：只取 baseURL，其余字段丢弃 */
function migrateAddressFromGenChannels(): string | null {
  try {
    const rawText = localStorage.getItem('zeroexo.genChannels');
    if (!rawText) return null;
    const parsed = JSON.parse(rawText) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const data = (parsed as Record<string, unknown>).data;
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Record<string, unknown>;
    const channels = Array.isArray(d.channels) ? d.channels : [];
    const activeId = typeof d.activeChannelId === 'string' ? d.activeChannelId : null;
    const active = channels.find(
      (c): c is Record<string, unknown> =>
        typeof c === 'object' && c !== null && (c as Record<string, unknown>).id === activeId,
    );
    const pick = (c: unknown): string | null => {
      if (typeof c !== 'object' || c === null) return null;
      const u = (c as Record<string, unknown>).baseURL;
      return typeof u === 'string' && u.trim() ? u.trim() : null;
    };
    return pick(active) ?? pick(channels[0]);
  } catch {
    return null;
  }
}

/** 读旧 `zeroexo.comfyuiBridge`（直连时代的 baseUrl） */
function migrateAddressFromComfyuiBridge(): string | null {
  try {
    const rawText = localStorage.getItem('zeroexo.comfyuiBridge');
    if (!rawText) return null;
    const parsed = JSON.parse(rawText) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const data = (parsed as Record<string, unknown>).data;
    if (typeof data !== 'object' || data === null) return null;
    const u = (data as Record<string, unknown>).baseUrl;
    return typeof u === 'string' && u.trim() ? u.trim() : null;
  } catch {
    return null;
  }
}

/** 首次迁移：渠道 activeChannel.baseURL → channels[0].baseURL → 直连 baseUrl → 默认本机 */
function migrateLegacyAddress(): string {
  return (
    migrateAddressFromGenChannels() ??
    migrateAddressFromComfyuiBridge() ??
    DEFAULT_COMFYUI_ENDPOINT_ADDRESS
  );
}

export function loadComfyuiEndpoint(): ComfyuiEndpointPrefs {
  try {
    const rawText = localStorage.getItem(COMFYUI_ENDPOINT_STORAGE_KEY);
    if (rawText) {
      const parsed = JSON.parse(rawText) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        const envelope = parsed as Record<string, unknown>;
        if (envelope.schemaVersion === COMFYUI_ENDPOINT_SCHEMA_VERSION) {
          const data = envelope.data;
          const address =
            typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).address === 'string'
              ? ((data as Record<string, unknown>).address as string)
              : '';
          return { address: address || DEFAULT_COMFYUI_ENDPOINT_ADDRESS };
        }
      }
    }
  } catch {
    /* 新键损坏 → 走迁移重建 */
  }
  // 新键不存在/损坏：从旧结构迁移一次，并立刻写回新键（下次 load 直接命中，不再读旧键 → 幂等）
  const migrated: ComfyuiEndpointPrefs = { address: migrateLegacyAddress() };
  saveComfyuiEndpoint(migrated);
  return migrated;
}

export function saveComfyuiEndpoint(prefs: ComfyuiEndpointPrefs): void {
  try {
    localStorage.setItem(
      COMFYUI_ENDPOINT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: COMFYUI_ENDPOINT_SCHEMA_VERSION, data: prefs }),
    );
  } catch { /* 隐私模式 / QuotaExceeded 忽略 */ }
}

// ===== 测试连接（自动判定后端类型；三态：连通 / 不可达 / 跨域被拒，其余归入 rejected 附原因） =====

export type EndpointBackend = 'direct' | 'openai' | 'zeroexo';

export type EndpointTestResult =
  | { kind: 'ok'; backend: EndpointBackend; address: string; version?: string; models: string[] }
  | { kind: 'fail'; failure: 'unreachable' | 'cors' | 'rejected'; message: string };

export async function testEndpointConnection(rawAddress: string): Promise<EndpointTestResult> {
  const base = normalizeBaseUrl(rawAddress);
  // 1) TCP 层探测（no-cors）：连不上 = 服务未启动 / 地址不可达
  try {
    await probeTcp(base);
  } catch {
    return {
      kind: 'fail',
      failure: 'unreachable',
      message: `不可达：无法连接 ${base}（服务未启动或地址错误）`,
    };
  }
  let sawResponse = false; // 是否见到过任何真实 HTTP 响应（区分「跨域被拦」与「地址不对」）
  // 2) 桥接健康检查（/zeroexo/h3/health）：完整的导演包流程（多参考图 / 延续 / 引导预览），优先
  try {
    const res = await fetch(`${base}/zeroexo/h3/health`);
    sawResponse = true;
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body && body.ok === true) {
        const version = typeof body.version === 'string' ? body.version : undefined;
        return { kind: 'ok', backend: 'direct', address: base, version, models: [] };
      }
    }
  } catch { /* 桥接未装/旧版未开 CORS → 继续探测 */ }
  // 3) ZeroExo 插件作业协议（/zeroexo/v1/health）：只装了重写版插件时的回退通道
  try {
    const res = await fetch(`${base}/zeroexo/v1/health`);
    sawResponse = true;
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body && body.ok === true && typeof body.plugin === 'string') {
        const version = typeof body.version === 'string' ? body.version : undefined;
        return { kind: 'ok', backend: 'zeroexo', address: base, version, models: [] };
      }
    }
  } catch { /* 未装插件 / 未开 CORS → 继续探测 */ }
  // 4) 直连探测：ComfyUI 原生 /system_stats（旧插件或同源场景）
  try {
    const res = await fetch(`${base}/system_stats`);
    sawResponse = true;
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body && typeof body === 'object' && ('system' in body || 'devices' in body)) {
        const version =
          'system' in body && typeof (body.system as Record<string, unknown> | undefined)?.comfyui_version === 'string'
            ? ((body.system as Record<string, unknown>).comfyui_version as string)
            : undefined;
        return { kind: 'ok', backend: 'direct', address: base, version, models: [] };
      }
    }
  } catch { /* CORS 拦截或解析失败 → 继续探测兼容口 */ }
  // 3) OpenAI 兼容口探测：GET /v1/models（界面已无密钥栏，不带鉴权头）
  try {
    const res = await fetch(`${base}/v1/models`);
    sawResponse = true;
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
      const models = Array.isArray(body?.data)
        ? body.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
        : [];
      return { kind: 'ok', backend: 'openai', address: base, models };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        kind: 'fail',
        failure: 'rejected',
        message: `该地址要求 API Key 鉴权（HTTP ${res.status}）：极简面板已移除密钥栏，请改用免钥地址`,
      };
    }
  } catch { /* 同上 */ }
  // 4) TCP 通但没见到任何响应 → 浏览器跨域拦截（服务在线，只是被浏览器挡了）
  if (!sawResponse) {
    return {
      kind: 'fail',
      failure: 'cors',
      message: `服务在线但被浏览器拦截（跨域）：${base} 可达，请求未返回任何响应。重启 ComfyUI 即可——桥接插件已自带 CORS，无需 --enable-cors-header 参数`,
    };
  }
  // 5) 有响应但既非 ComfyUI 也非兼容口
  return {
    kind: 'fail',
    failure: 'rejected',
    message: `${base} 有响应，但既不是 ComfyUI（/zeroexo/h3/health、/system_stats）也不是 OpenAI 兼容口（/v1/models）`,
  };
}

// ===== zustand store（持久化 address；connected/backend/models 为运行态） =====

export interface ComfyuiEndpointState extends ComfyuiEndpointPrefs {
  /** 运行态：上次测试通过且地址未再改动 */
  connected: boolean;
  /** 运行态：后端类型（direct 直连桥接 / openai 兼容口） */
  backend: EndpointBackend | null;
  /** 运行态：兼容口的模型清单（运行时自动取 models[0] 作 model）；direct 为空数组 */
  models: string[];
  /** 保存：持久化地址；地址与上次测试的不同则断开 */
  applyAddress: (raw: string) => void;
  /** 测试通过：持久化地址 + 置连接态 */
  markTested: (raw: string, backend: EndpointBackend, models: string[]) => void;
  /** 断开（测试失败 / 地址改动） */
  disconnect: () => void;
}

export const useComfyuiEndpointStore = create<ComfyuiEndpointState>()((set, get) => ({
  ...loadComfyuiEndpoint(),
  connected: false,
  backend: null,
  models: [],
  applyAddress: (raw) => {
    const address = normalizeBaseUrl(raw);
    const changed = address !== get().address;
    set({ address });
    saveComfyuiEndpoint({ address });
    if (changed) set({ connected: false, backend: null, models: [] });
  },
  markTested: (raw, backend, models) => {
    const address = normalizeBaseUrl(raw);
    set({ address, connected: true, backend, models });
    saveComfyuiEndpoint({ address });
  },
  disconnect: () => set({ connected: false, backend: null, models: [] }),
}));

// ===== 运行配置推导（导演台运行按钮直接调用，不再有渠道选择环节） =====

/**
 * 由当前连接态推导 use-director-run 的双传输配置：
 * - openai：兼容口清单自动取第一个模型作 model（界面不再暴露模型标识）；
 * - direct：直连桥接，模型四件套取 comfyui-connection（测试通过时已自动抓取并挑选）。
 */
export function getRunConfigFromEndpoint(): DirectorBridgeConfig | null {
  const ep = useComfyuiEndpointStore.getState();
  if (!ep.connected || !ep.backend) return null;
  const base = normalizeBaseUrl(ep.address);
  // ZeroExo 插件（完全重写的作业协议）：不需要桥接插件，也不需要模型四件套
  if (ep.backend === 'zeroexo') return { mode: 'zeroexo', baseUrl: base };
  if (ep.backend === 'openai') {
    const model = ep.models[0] ?? '';
    if (!model) return null; // 兼容口未回模型清单 → 运行不可用（重新测试连接）
    return { mode: 'openai', channel: { baseURL: base, apiKey: '', model } };
  }
  const s = useComfyuiConnectionStore.getState();
  const picked = pickDefaultModels(s.availableModels, s.models);
  if (!picked.unet || !picked.videoVae || !picked.audioVae || !picked.clip) return null;
  return {
    mode: 'direct',
    baseUrl: base,
    token: s.token || undefined,
    models: {
      unet: picked.unet,
      videoVae: picked.videoVae,
      audioVae: picked.audioVae,
      clip: picked.clip,
      clipType: 'minimax',
      weightDtype: 'default',
    },
  };
}
