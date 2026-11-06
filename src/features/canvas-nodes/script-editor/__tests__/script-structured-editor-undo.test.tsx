/**
 * script-structured-editor 撤销/重做单测（2026-11-04 删除丢内容修复）
 *
 * 断言：
 * ① 删除段落后 Ctrl+Z 恢复为删除前内容，且底部字数统计同步回滚；
 * ② 连续输入合并为一步（一个字一步不允许）；Enter×10 步可逐步撤销到底、再逐步重做回顶；
 * ③ 粘贴为独立一步（breakMerge），可一次撤销；
 * ④ historyRef 句柄（工具栏按钮路径）与 onHistoryChange 可用态翻转。
 *
 * （断言「撤销后落盘内容与界面一致」在全链路测试 script-tab-content-undo-write.test.tsx。）
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';

const theme = {
  mode: 'dark',
  toolbar: {
    text: '#e5e5e5',
    textMuted: '#888888',
    accent: '#e94560',
    border: '#333',
    editorSurface: '#1b1b1b',
    editorPaper: '#141414',
  },
} as any;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: unknown) => (typeof opts === 'string' ? opts : key) }),
}));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
vi.mock('i18next', () => ({
  default: {
    t: (key: string) => key,
    use: () => ({ init: () => Promise.resolve() }),
  },
  createInstance: () => ({ use: () => ({ init: () => Promise.resolve() }) }),
}));
vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));
vi.mock('@/shared/components/index.js', () => ({
  SimpleSelect: (): React.ReactElement => <div data-mock="simple-select" />,
}));

import { ScriptStructuredEditor } from '../script-structured-editor';
import type { ScriptHistoryControls } from '../script-history';
import { countScriptChars } from '@/shared/utils/script-count';

const INITIAL_HTML =
  '<p class="script-action">第一段</p>'
  + '<p class="script-action">第二段</p>'
  + '<p class="script-action">第三段</p>';

interface HarnessProps {
  initial: string;
  onEmitted?: (html: string) => void;
}

function Harness({ initial, onEmitted }: HarnessProps) {
  const [value, setValue] = useState(initial);
  const historyRef = useRef<ScriptHistoryControls | null>(null);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  return (
    <>
      <ScriptStructuredEditor
        value={value}
        onChange={(html) => { setValue(html); onEmitted?.(html); }}
        accent="#e94560"
        border="#333"
        text="#e5e5e5"
        textMuted="#888888"
        isDark
        historyRef={historyRef}
        onHistoryChange={(canUndo, canRedo) => setHist((p) => (p.canUndo === canUndo && p.canRedo === canRedo ? p : { canUndo, canRedo }))}
      />
      <button type="button" data-testid="ctrl-undo" onClick={() => historyRef.current?.undo()} />
      <button type="button" data-testid="ctrl-redo" onClick={() => historyRef.current?.redo()} />
      <span data-testid="hist-state">{`${hist.canUndo}:${hist.canRedo}`}</span>
    </>
  );
}

function textareas(container: HTMLElement): HTMLTextAreaElement[] {
  return Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[];
}

function charCountText(container: HTMLElement): string {
  // 底部字数统计：「N 字」
  const divs = Array.from(container.querySelectorAll('div'));
  const found = divs.map((d) => d.textContent ?? '').find((t) => /^\d+ 字$/.test(t.trim()));
  expect(found).toBeDefined();
  return (found as string).trim();
}

describe('script-structured-editor 撤销/重做（①②③④）', () => {
  it('① 删除段落后 Ctrl+Z 恢复为删除前内容，字数统计同步回滚', () => {
    const { container } = render(<Harness initial={INITIAL_HTML} />);
    const before = textareas(container);
    expect(before).toHaveLength(3);
    const countBefore = charCountText(container);
    expect(countBefore).toBe(`${countScriptChars('第一段\n第二段\n第三段')} 字`);

    // 删除第 2 段（行内删除按钮）
    const delBtns = Array.from(container.querySelectorAll('button'))
      .filter((b) => b.title === 'scriptEditor.deleteParagraph');
    expect(delBtns).toHaveLength(3);
    fireEvent.click(delBtns[1]!);
    expect(textareas(container)).toHaveLength(2);
    const countAfter = charCountText(container);
    expect(countAfter).toBe(`${countScriptChars('第一段\n第三段')} 字`);

    // Ctrl+Z（在 textarea 上按下，冒泡到容器）
    fireEvent.keyDown(textareas(container)[0]!, { key: 'z', ctrlKey: true });
    const restored = textareas(container);
    expect(restored).toHaveLength(3);
    expect(restored.map((t) => t.value)).toEqual(['第一段', '第二段', '第三段']);
    expect(charCountText(container)).toBe(countBefore);
  });

  it('② 连续输入合并为一步；Enter×10 可逐步撤销到底、再逐步重做回顶', () => {
    const { container } = render(<Harness initial={INITIAL_HTML} />);
    const ta = textareas(container)[0]!;

    // 连续输入 3 个字符（同 ms 级时间窗内）→ 一步
    fireEvent.change(ta, { target: { value: '第一段a' } });
    fireEvent.change(ta, { target: { value: '第一段ab' } });
    fireEvent.change(ta, { target: { value: '第一段abc' } });
    expect(ta.value).toBe('第一段abc');
    fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    expect(textareas(container)[0]!.value).toBe('第一段'); // 一次撤销回到输入前

    // Enter×10：每按一次新建一行 = 独立步骤
    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(textareas(container)[0]!, { key: 'Enter' });
    }
    expect(textareas(container)).toHaveLength(13);

    // Ctrl+Z×10 逐步撤销到底（回到初始 3 行）
    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(textareas(container)[0]!, { key: 'z', ctrlKey: true });
    }
    expect(textareas(container)).toHaveLength(3);
    expect(textareas(container).map((t) => t.value)).toEqual(['第一段', '第二段', '第三段']);

    // Ctrl+Shift+Z×10 逐步重做回顶（13 行）
    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(textareas(container)[0]!, { key: 'z', ctrlKey: true, shiftKey: true });
    }
    expect(textareas(container)).toHaveLength(13);
  });

  it('③ 粘贴为独立一步：粘贴后一次 Ctrl+Z 恢复粘贴前内容', () => {
    const { container } = render(<Harness initial={INITIAL_HTML} />);
    const ta = textareas(container)[0]!;
    // 先有一步普通输入（老内容），再粘贴大段文本 → 粘贴不得与输入合并
    fireEvent.change(ta, { target: { value: '第一段x' } });
    fireEvent.paste(ta); // onPaste → breakMerge
    fireEvent.change(ta, { target: { value: '第一段x粘贴进来的大段内容' } });
    expect(ta.value).toBe('第一段x粘贴进来的大段内容');
    fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    expect(ta.value).toBe('第一段x'); // 一次撤销只回退粘贴
  });

  it('④ 工具栏句柄可撤销/重做，onHistoryChange 可用态正确翻转', () => {
    const { container, getByTestId } = render(<Harness initial={INITIAL_HTML} />);
    expect(getByTestId('hist-state').textContent).toBe('false:false'); // 初始无可撤销

    const delBtns = Array.from(container.querySelectorAll('button'))
      .filter((b) => b.title === 'scriptEditor.deleteParagraph');
    fireEvent.click(delBtns[0]!);
    expect(getByTestId('hist-state').textContent).toBe('true:false'); // 有步可撤销、无可重做

    // 工具栏句柄撤销（与快捷键同一栈）
    fireEvent.click(getByTestId('ctrl-undo'));
    expect(textareas(container)).toHaveLength(3);
    expect(getByTestId('hist-state').textContent).toBe('false:true'); // 撤销到底 → 可重做

    fireEvent.click(getByTestId('ctrl-redo'));
    expect(textareas(container)).toHaveLength(2);
    expect(getByTestId('hist-state').textContent).toBe('true:false');
  });
});
