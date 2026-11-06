/**
 * script-import-modal 文案与交互单测
 *
 * 弹窗只做导入：任何纯文本都放行，不列问题、不拦截、不降级；
 * 格式规范只以「推荐模板」形式提供。依赖（主题/翻译/保存服务）mock，parser 用真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { App } from 'antd';

const { commitScriptImport } = vi.hoisted(() => ({ commitScriptImport: vi.fn() }));

const theme = {
  mode: 'dark',
  toolbar: { text: '#e5e5e5', textMuted: '#888888', border: '#333333' },
} as unknown as Record<string, unknown>;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      opts?: string | ({ defaultValue?: string } & Record<string, unknown>),
    ): string => {
      const raw = typeof opts === 'string' ? opts : (opts?.defaultValue ?? key);
      const values = typeof opts === 'object' && opts !== null ? opts as Record<string, unknown> : {};
      return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match: string, name: string) => String(values[name] ?? ''));
    },
  }),
}));
vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));
vi.mock('@/entities/script-store.js', () => ({
  ScriptConflictError: class ScriptConflictError extends Error {},
}));
vi.mock('../script-import-service.js', () => ({
  commitScriptImport: (...args: unknown[]) => commitScriptImport(...args),
  ScriptImportBackupError: class ScriptImportBackupError extends Error {},
}));

import zh from '@/i18n/zh.json';
import en from '@/i18n/en.json';
import ja from '@/i18n/ja.json';
import { ScriptImportModal } from './script-import-modal';

/** 开发/实现词：弹窗与三语文案一律不得出现 */
const BANNED_TERMS = [
  '落盘', '写盘', 'UTF-8', 'GBK', '编码', '规范化', '重排',
  '互斥', '后操作者生效', '归入任何场', '自动识别',
];

interface Rendered {
  onClose: ReturnType<typeof vi.fn>;
  onImported: ReturnType<typeof vi.fn>;
}

async function renderModal(): Promise<Rendered> {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(
    <App>
      <ScriptImportModal
        open
        projectId="p1"
        activeEpisode={{ id: 'e1', number: 1, title: '第1集', chars: 120 }}
        onClose={onClose}
        onImported={onImported}
      />
    </App>,
  );
  await waitFor(() => expect(document.querySelector('.ant-modal')).not.toBeNull());
  return { onClose, onImported };
}

function modalText(): string {
  const modal = document.querySelector('.ant-modal') as HTMLElement | null;
  return modal?.textContent ?? '';
}

function typeScript(text: string): void {
  const textarea = Array.from(document.querySelectorAll('textarea'))
    .find((el) => el.getAttribute('aria-hidden') !== 'true');
  expect(textarea).not.toBeUndefined();
  fireEvent.change(textarea!, { target: { value: text } });
}

function primaryButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('.ant-modal button')) as HTMLButtonElement[];
  // antd 会在两个汉字间自动加空格（「导 入」），比对时先归一化
  const target = buttons.find((b) => (b.textContent ?? '').replace(/\s+/g, '') === '导入');
  expect(target, '找不到「导入」按钮').toBeTruthy();
  return target!;
}

function clickRadio(label: string): void {
  const wrapper = Array.from(document.querySelectorAll('.ant-modal .ant-radio-wrapper'))
    .find((w) => (w.textContent ?? '').includes(label));
  expect(wrapper, `找不到单选「${label}」`).toBeTruthy();
  fireEvent.click(wrapper!);
}

beforeEach(() => {
  commitScriptImport.mockReset();
  commitScriptImport.mockResolvedValue({
    strategy: 'new-episode',
    createdEpisodeIds: ['e2'],
    episodeCount: 2,
    targetEpisodeId: undefined,
    entity: { episodes: [] },
    charAfter: 10,
  });
});

describe('ScriptImportModal 职责与文案', () => {
  it('弹窗不出现转换类选项与开发/实现词', async () => {
    await renderModal();
    const text = modalText();
    for (const term of BANNED_TERMS) {
      expect(text.includes(term), `不应出现「${term}」`).toBe(false);
    }
  });

  it('三语 key 集合完全一致，且均不含禁用词', () => {
    const zhKeys = Object.keys(zh.scriptImportModal).sort();
    expect(Object.keys(en.scriptImportModal).sort()).toEqual(zhKeys);
    expect(Object.keys(ja.scriptImportModal).sort()).toEqual(zhKeys);
    for (const dict of [zh.scriptImportModal, en.scriptImportModal, ja.scriptImportModal]) {
      for (const value of Object.values(dict)) {
        for (const term of BANNED_TERMS) {
          expect(String(value).includes(term), `「${value}」含禁用词「${term}」`).toBe(false);
        }
      }
    }
    // 「只给帮助」的一句说明三语齐备，且已无校验清单类 key
    expect(zh.scriptImportModal.mcpNote).toBe('只提供格式规范，转换由 MCP 模型处理');
    expect(en.scriptImportModal.mcpNote).toBeTruthy();
    expect(ja.scriptImportModal.mcpNote).toBeTruthy();
    expect(zhKeys).not.toContain('invalidCount');
    expect(zhKeys).not.toContain('importRaw');
  });

  it('中文文案逐条 ≤ 18 字；标题/按钮 ≤ 6 字', () => {
    const dict = zh.scriptImportModal as Record<string, string>;
    for (const [key, value] of Object.entries(dict)) {
      const stripped = value
        .replace(/\{\{.*?\}\}/g, '')
        .replace(/[\s，。；：、·/（）()\-—|]/g, '');
      expect(stripped.length, `${key}「${value}」`).toBeLessThanOrEqual(18);
    }
    const labelKeys = [
      'title', 'chooseFile', 'viewSpec', 'startImport', 'cancel',
      'modeNewEpisode', 'modeAppend', 'modeOverwrite', 'confirmReplaceOk',
    ];
    for (const key of labelKeys) {
      expect((dict[key] ?? '').length, key).toBeLessThanOrEqual(6);
    }
  });

  it('任意文本不出现审查：无计数、无逐行清单、无次要出口，主按钮可用', async () => {
    await renderModal();
    typeScript('随便一段文本');
    await waitFor(() => expect(primaryButton().disabled).toBe(false));
    const text = modalText();
    expect(text).not.toContain('不符合规范');
    expect(text).not.toContain('第 1 行');
    expect(text).not.toContain('仍然导入原文');
    expect(text).not.toContain('按规范导入');
    // 只有「取消」「导入」两个 footer 按钮
    const buttons = Array.from(document.querySelectorAll('.ant-modal-footer button'));
    expect(buttons.length).toBe(2);
  });

  it('任意文本（新建一集）：直接导入成功，走 commitScriptImport', async () => {
    const { onImported, onClose } = await renderModal();
    typeScript('随便一段文本');
    await waitFor(() => expect(primaryButton().disabled).toBe(false));
    fireEvent.click(primaryButton());
    await waitFor(() => expect(commitScriptImport).toHaveBeenCalledTimes(1));
    expect((commitScriptImport.mock.calls[0]?.[0] as { strategy: string }).strategy).toBe('new-episode');
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('任意文本（追加到当前集）：落位为 append', async () => {
    await renderModal();
    typeScript('随便一段文本');
    await waitFor(() => expect(primaryButton().disabled).toBe(false));
    clickRadio('追加到当前集');
    fireEvent.click(primaryButton());
    await waitFor(() => expect(commitScriptImport).toHaveBeenCalledTimes(1));
    expect((commitScriptImport.mock.calls[0]?.[0] as { strategy: string }).strategy).toBe('append');
  });

  it('任意文本（替换当前集）：先二次确认再入库，落位为 overwrite', async () => {
    await renderModal();
    typeScript('随便一段文本');
    await waitFor(() => expect(primaryButton().disabled).toBe(false));
    clickRadio('替换当前集');
    fireEvent.click(primaryButton());
    // 二次确认弹层（写明替换对象）→ 点「替换」
    await waitFor(() => {
      const confirm = Array.from(document.querySelectorAll('.ant-modal')).find((m) => (m.textContent ?? '').includes('确认替换'));
      expect(confirm).toBeTruthy();
    });
    const confirmModal = Array.from(document.querySelectorAll('.ant-modal')).find((m) => (m.textContent ?? '').includes('确认替换')) as HTMLElement;
    const ok = Array.from(confirmModal.querySelectorAll('button')).find((b) => (b.textContent ?? '').replace(/\s+/g, '') === '替换') as HTMLButtonElement;
    expect(ok).toBeTruthy();
    fireEvent.click(ok);
    await waitFor(() => expect(commitScriptImport).toHaveBeenCalledTimes(1));
    expect((commitScriptImport.mock.calls[0]?.[0] as { strategy: string }).strategy).toBe('overwrite');
  });

  it('推荐模板：入口可见，打开后能看到并复制标准样例', async () => {
    await renderModal();
    const link = Array.from(document.querySelectorAll('.ant-modal button'))
      .find((b) => (b.textContent ?? '').trim() === '推荐模板') as HTMLButtonElement;
    expect(link).toBeTruthy();
    fireEvent.click(link);
    await waitFor(() => expect(document.querySelector('.ant-drawer')).not.toBeNull());
    const drawerText = document.querySelector('.ant-drawer')?.textContent ?? '';
    expect(drawerText).toContain('# 雨夜');
    expect(drawerText).toContain('## 第1集：来客');
  });
});
