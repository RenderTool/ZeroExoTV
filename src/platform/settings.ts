/**
 * 本地渠道配置（Plan#83 D7）
 *
 * - 渠道结构沿用现 Admin/`ai-config` 的 ModelChannel 形状，未来与 SaaS 版合流免费；
 * - 落盘文件 = `<dataRoot>/settings.json`（可迁移、可 git、MCP 可直接编辑）；
 * - **apiKey 一律不写进 settings.json**（授权目录常被放网盘/仓库），只存浏览器 storage，
 *   文件里保留 `apiKeyRef` 指向该存储键。
 */

import type { ModelChannel } from '@/features/ai-config/use-ai-config-store.js';
import { readJson, writeJson } from './fs.js';

const SETTINGS_PATH = 'settings.json';
const KEY_STORE = 'zeroexo:channel-keys';

export interface LocalSettings {
  version: number;
  channels: Array<Omit<ModelChannel, 'apiKey'> & { apiKeyRef?: string }>;
  /** 默认生成渠道（channelId::model） */
  imageModel?: string;
  videoModel?: string;
  audioModel?: string;
}

const EMPTY: LocalSettings = { version: 1, channels: [] };

const withSlash = (p: string) => (p ? `${p.replace(/\.\w+$/, '')}.json` : SETTINGS_PATH);

export async function loadSettings(rootFile?: string): Promise<LocalSettings> {
  const raw = await readJson<LocalSettings>(withSlash(rootFile ?? SETTINGS_PATH));
  return raw ?? EMPTY;
}

function readKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY_STORE) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeKeys(map: Record<string, string>): void {
  try {
    localStorage.setItem(KEY_STORE, JSON.stringify(map));
  } catch {
    /* 隐私模式下静默失败：此时 key 只活在内存，刷新即失，符合“不落盘”优先级 */
  }
}

export function getChannelKey(channelId: string): string {
  return readKeys()[channelId] ?? '';
}

export function setChannelKey(channelId: string, key: string): void {
  const map = readKeys();
  if (key) map[channelId] = key;
  else delete map[channelId];
  writeKeys(map);
}

/** 保存渠道列表：自动把 apiKey 摘出去，并保留原有其它字段 */
export async function saveChannels(channels: ModelChannel[], rootFile?: string): Promise<void> {
  const next: LocalSettings = { ...(await loadSettings(rootFile)), version: 1 };
  next.channels = channels.map((c) => {
    if (c.apiKey) setChannelKey(c.id, c.apiKey);
    const { apiKey: _drop, ...rest } = c;
    return { ...rest, apiKeyRef: KEY_STORE };
  });
  await writeJson(withSlash(rootFile ?? SETTINGS_PATH), next);
}

/** 读出渠道（把 key 从浏览器 storage 注回内存对象） */
export async function loadChannels(rootFile?: string): Promise<ModelChannel[]> {
  const s = await loadSettings(rootFile);
  const keys = readKeys();
  return s.channels.map((c) => ({ ...(c as ModelChannel), apiKey: keys[c.id] ?? '' }));
}
