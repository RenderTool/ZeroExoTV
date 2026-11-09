/**
 * prompt-store - 提示词库（只读预设 + 本机新建）
 *
 * 预设来自 PROMPT_PRESETS（只读）；用户新建/编辑的提示词存 localStorage，
 * 与预设合并后供页面、图片节点下拉、画布抽屉共用。
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { PROMPT_PRESETS, type PromptPreset } from './presets.js';

const STORAGE_KEY = 'zeroexo.promptLibrary';

export interface PromptEntry extends PromptPreset {
  readOnly?: boolean;
  updatedAt?: string;
}

type UserPrompt = PromptPreset & { updatedAt: string };

interface Persisted {
  schemaVersion: 1;
  prompts: UserPrompt[];
}

export function loadUserPrompts(): UserPrompt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.prompts)) return [];
    return parsed.prompts.filter((p): p is UserPrompt =>
      Boolean(p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.body === 'string'));
  } catch {
    return [];
  }
}

function persist(prompts: UserPrompt[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, prompts } satisfies Persisted));
  } catch { /* 隐私模式/超限忽略 */ }
}

interface PromptLibraryState {
  userPrompts: UserPrompt[];
  addPrompt: (input: Omit<PromptPreset, 'id'> & { id?: string }) => PromptEntry;
  updatePrompt: (id: string, patch: Partial<Omit<PromptPreset, 'id'>>) => void;
  removePrompt: (id: string) => void;
}

export const usePromptLibraryStore = create<PromptLibraryState>()((set, get) => ({
  userPrompts: loadUserPrompts(),
  addPrompt: (input) => {
    const prompt: UserPrompt = {
      ...input,
      id: input.id ?? `user-${nanoid(8)}`,
      updatedAt: new Date().toISOString(),
    };
    const next = [prompt, ...get().userPrompts];
    set({ userPrompts: next });
    persist(next);
    return { ...prompt, readOnly: false };
  },
  updatePrompt: (id, patch) => {
    const next = get().userPrompts.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p);
    set({ userPrompts: next });
    persist(next);
  },
  removePrompt: (id) => {
    const next = get().userPrompts.filter((p) => p.id !== id);
    set({ userPrompts: next });
    persist(next);
  },
}));

/** 预设（只读）+ 用户提示词（可编辑） */
export function usePromptEntries(): PromptEntry[] {
  const userPrompts = usePromptLibraryStore((s) => s.userPrompts);
  return [
    ...PROMPT_PRESETS.map((p) => ({ ...p, readOnly: true as const })),
    ...userPrompts.map((p) => ({ ...p, readOnly: false as const })),
  ];
}
