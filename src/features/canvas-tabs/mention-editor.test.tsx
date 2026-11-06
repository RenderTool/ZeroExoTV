/**
 * MentionEditor — @ 资产行内高亮编辑器单测（2026-11-05 根治重构版）
 *
 * 覆盖：
 * 1. parsePromptSegments / serializeSegments / serializePromptDom roundtrip
 * 2. chip 渲染：contentEditable=false 原子块、16×16 缩略图、@名称文本、高 20 / 圆角 4
 * 3. 占位：CSS `:empty::before` 伪元素——空值时 root 为 :empty 且带 data-placeholder，
 *    编辑区内不再有任何占位 DOM 节点；一输入消失、清空回来
 * 4. 受控编辑（原生 beforeinput 拦截）：打字 / chip 整块删除（前后向）/ 词删除 / 全选删除
 * 5. removeChild 崩溃回归：连续「打字 → @ 引用 → 降级 → 再打字」「全选删除 → 再输入」
 *    与「空态 → 打字 → @ → 选中 mention → 退格删除 → 再打字 → 全选删除 → 再输入」全序列
 * 6. epoch 自愈：浏览器直改 DOM（游离文本节点）后提交 → 重挂新根只含 React 子节点
 * 7. IME：compositionStart 后 input 不调 onChange，compositionEnd 后才调；空编辑器组合输入自愈
 * 8. 粘贴：paste 纯文本 → onChange 收到纯文本（不含 HTML 标签）
 *
 * jsdom 不原生触发 beforeinput，须手工构造 InputEvent dispatchEvent；
 * 派发包在 act() 内使受控 setState 与自愈重挂同步落定。
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';

// @ 高亮块小图与面板共用同一媒体解析入口（2026-11-05 媒体 URL 层重做后：
// useMediaObjectUrl + resolveMediaBlobChain）：mock「按变体读 Blob」与「object URL 提供者」，
// thumbMock 三档可控（'' = 存储无此档），acquire 返回确定性 URL blob:<origin>:<key>
const thumbMock = vi.hoisted(() => ({
  thumb: vi.fn(async (k?: string) => (k ? `blob:thumb:${k}` : '')),
  preview: vi.fn(async (k?: string) => (k ? `blob:preview:${k}` : '')),
  orig: vi.fn(async (k?: string) => (k ? `blob:orig:${k}` : '')),
}));
const mediaUrlSubs = vi.hoisted(() => new Map<string, Set<() => void>>());
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zeroexo/plugin-persistence')>()),
  IMAGE_CONTENT_UPDATED_EVENT: 'zeroexo:image-content-updated',
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
  resolveThumbnailUrl: thumbMock.thumb,
  resolvePreviewUrl: thumbMock.preview,
  resolveImageUrl: thumbMock.orig,
}));

import {
  MentionEditor,
  parsePromptSegments,
  serializePromptDom,
  serializeSegments,
  type MentionSlotView,
} from './mention-editor.jsx';

const noop = () => {};
const resolveNone = () => undefined;

function renderEditor(props?: {
  value?: string;
  onChange?: (text: string, caret: number) => void;
  resolveSlot?: (label: string) => MentionSlotView | undefined;
  placeholder?: string;
}) {
  return render(
    <MentionEditor
      value={props?.value ?? ''}
      onChange={props?.onChange ?? noop}
      resolveSlot={props?.resolveSlot ?? resolveNone}
      placeholder={props?.placeholder}
    />,
  );
}

/** 受控回写宿主（贴近线上用法）：onChange → setState → 重渲染 */
function ControlledEditor(props: {
  initial: string;
  resolveSlot?: (label: string) => MentionSlotView | undefined;
  onChangeSpy?: (text: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <MentionEditor
      value={value}
      onChange={(t) => {
        props.onChangeSpy?.(t);
        setValue(t);
      }}
      resolveSlot={props.resolveSlot ?? resolveNone}
      placeholder={props.placeholder}
    />
  );
}

function getRoot(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-mention-editor]') as HTMLElement;
}

/** 把光标（折叠选区）设置到指定节点/偏移（jsdom Selection API 可用） */
function setCaret(node: Node, offset: number): void {
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** 光标折叠到 root 内容末尾 */
function caretEnd(root: HTMLElement): void {
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** 全选 root 内容（非折叠选区，Ctrl+A 等价形态） */
function selectAll(root: HTMLElement): void {
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(root);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** 派发原生 beforeinput（jsdom 不原生触发）。返回值：false = 已被拦截（preventDefault）。act 内派发使受控更新/自愈重挂同步落定。 */
function dispatchBeforeInput(root: HTMLElement, inputType: string, data: string | null = null): boolean {
  let notPrevented = true;
  act(() => {
    const ev = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data });
    notPrevented = root.dispatchEvent(ev);
  });
  return notPrevented;
}

describe('parsePromptSegments（纯文本 → 段序列）', () => {
  it('`@Picture1 然后 @Audio2 结束` → mention 与文本交替，label 不带 @', () => {
    const segs = parsePromptSegments('@Picture1 然后 @Audio2 结束');
    expect(segs.map((s) => s.type)).toEqual(['mention', 'text', 'mention', 'text']);
    expect(segs[0]).toEqual({ type: 'mention', label: 'Picture1' });
    expect(segs[2]).toEqual({ type: 'mention', label: 'Audio2' });
    expect(segs[1]).toEqual({ type: 'text', text: '然后 ' });
    expect(segs[3]).toEqual({ type: 'text', text: '结束' });
  });

  it('不识别的 @文本 原样保留为文本段（不产生 mention）', () => {
    const segs = parsePromptSegments('@张三 看向 @Picture9');
    expect(segs[0]).toEqual({ type: 'text', text: '@张三 看向 ' });
    expect(segs[1]).toEqual({ type: 'mention', label: 'Picture9' });
  });
});

describe('serializePromptDom / serializeSegments roundtrip', () => {
  it('渲染 `@Picture1 文字` 后从 DOM 序列化回原样（chip 取 data-mention-label）', () => {
    const { container } = renderEditor({ value: '@Picture1 文字' });
    expect(serializePromptDom(getRoot(container))).toBe('@Picture1 文字');
  });

  it('serializeSegments(parse(x)) 对无尾空格 mention 也与渲染产物一致（epoch 判据不死循环）', () => {
    expect(serializeSegments(parsePromptSegments('@Picture1'))).toBe('@Picture1 ');
    const { container } = renderEditor({ value: '@Picture1' });
    expect(serializePromptDom(getRoot(container))).toBe('@Picture1 ');
  });

  it('空值：root 为 :empty、无占位 DOM 节点、序列化为空串', () => {
    const { container } = renderEditor({ value: '', placeholder: '请输入提示词' });
    const root = getRoot(container);
    expect(root.querySelector('[data-mention-placeholder]')).toBeNull(); // 不再有占位节点
    expect(root.matches(':empty')).toBe(true);
    expect(root.getAttribute('data-placeholder')).toBe('请输入提示词');
    expect(serializePromptDom(root)).toBe('');
  });
});

describe('占位（:empty::before 伪元素，不进编辑区 DOM）', () => {
  it('一输入占位态消失、清空后回来（受控值驱动）', () => {
    const utils = renderEditor({ value: '', placeholder: '片段 1 提示词，@ 引用资产' });
    const root = getRoot(utils.container);
    expect(root.matches(':empty')).toBe(true);
    act(() => {
      utils.rerender(
        <MentionEditor value="文字" onChange={noop} resolveSlot={resolveNone} placeholder="片段 1 提示词，@ 引用资产" />,
      );
    });
    expect(root.matches(':empty')).toBe(false);
    act(() => {
      utils.rerender(
        <MentionEditor value="" onChange={noop} resolveSlot={resolveNone} placeholder="片段 1 提示词，@ 引用资产" />,
      );
    });
    expect(root.matches(':empty')).toBe(true);
  });
});

describe('chip 渲染（原子高亮块）', () => {
  const slot: MentionSlotView = { label: 'Picture1', title: '主角图', kind: 'image', url: 'data:image/png;base64,x' };

  it('contentEditable=false、内含 16×16 缩略图格（url 直连分支）与 @名称 文本、高 20 / 圆角 4', () => {
    const { container } = renderEditor({ value: '@Picture1 回头', resolveSlot: () => slot });
    const chip = container.querySelector('[data-mention-label="Picture1"]') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('contenteditable')).toBe('false');
    expect(chip.style.height).toBe('20px');
    expect(chip.style.borderRadius).toBe('4px');
    const cell = chip.querySelector('[data-thumb]') as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.style.width).toBe('16px');
    expect(cell.style.height).toBe('16px');
    const img = cell.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.style.objectFit).toBe('cover');
    expect(chip.textContent).toContain('@主角图');
  });

  it('无 url 有 storageKey 时走 useResolvedThumb 派生链（与面板同一入口），同样 16×16', async () => {
    const { container } = renderEditor({
      value: '@Picture1 回头',
      resolveSlot: () => ({ label: 'Picture1', title: '状态图', kind: 'image', storageKey: 'sk-1' }),
    });
    const chip = container.querySelector('[data-mention-label="Picture1"]') as HTMLElement;
    const cell = chip.querySelector('[data-thumb="sk-1"]') as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.style.width).toBe('16px');
    expect(cell.style.height).toBe('16px');
    expect(chip.querySelector('[data-auth-img]')).toBeNull();
    await waitFor(() => {
      expect((cell.querySelector('img') as HTMLImageElement)?.src).toBe('blob:thumb:sk-1');
    });
  });

  it('槽位无法解析时回落类型图标，文本为 @槽位号', () => {
    const { container } = renderEditor({ value: '@Audio2 背景音乐' });
    const chip = container.querySelector('[data-mention-label="Audio2"]') as HTMLElement;
    expect(chip.querySelector('img')).toBeNull();
    expect(chip.querySelector('svg')).toBeTruthy();
    expect(chip.textContent).toContain('@Audio2');
  });
});

describe('受控编辑（原生 beforeinput 拦截 → 文本模型 → React 重渲染）', () => {
  it('insertText：空编辑器首字 → onChange 收到新文本，且事件被拦截（浏览器不改 DOM）', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="" onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    setCaret(root, 0);
    expect(dispatchBeforeInput(root, 'insertText', '一位老人')).toBe(false); // preventDefault 生效
    expect(calls).toEqual(['一位老人']);
    expect(serializePromptDom(root)).toBe('一位老人');
  });

  it('insertText：光标在 chip 后文本末尾续打 → 模型与 DOM 一致', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="@Picture1 文字" onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    const textNode = root.querySelector('[data-mention-label]')!.nextElementSibling!.firstChild!;
    setCaret(textNode, (textNode.nodeValue ?? '').length);
    expect(dispatchBeforeInput(root, 'insertText', '继续')).toBe(false);
    expect(calls).toEqual(['@Picture1 文字继续']);
    expect(serializePromptDom(root)).toBe('@Picture1 文字继续');
  });

  it('historyUndo 被拦截且不改模型（原生撤销会结构性回滚 React 节点）', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="@Picture1 文字" onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    expect(dispatchBeforeInput(root, 'historyUndo')).toBe(false);
    expect(calls).toEqual([]);
    expect(serializePromptDom(root)).toBe('@Picture1 文字');
  });
});

describe('chip 整块删除（beforeinput 受控路径，文本模型边界正则）', () => {
  it('光标在 root 层、紧邻 chip 右侧 → deleteContentBackward 整块移除 chip', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="@Picture1 文字" onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    const chip = root.querySelector('[data-mention-label]') as HTMLElement;
    const chipIndex = Array.prototype.indexOf.call(root.childNodes, chip);
    expect(chipIndex).toBeGreaterThanOrEqual(0);
    setCaret(root, chipIndex + 1);
    expect(dispatchBeforeInput(root, 'deleteContentBackward')).toBe(false);
    expect(calls).toEqual(['文字']);
    expect(root.querySelector('[data-mention-label]')).toBeNull();
    expect(serializePromptDom(root)).toBe('文字');
  });

  it('光标在 chip 后文本节点 offset 0（浏览器常见形态）→ 同样整块移除', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="@Picture1 文字" onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    const textSpan = root.querySelector('[data-mention-label]')!.nextElementSibling!;
    const textNode = textSpan.firstChild!;
    expect(textNode.nodeType).toBe(Node.TEXT_NODE);
    setCaret(textNode, 0);
    expect(dispatchBeforeInput(root, 'deleteContentBackward')).toBe(false);
    expect(calls).toEqual(['文字']);
    expect(root.querySelector('[data-mention-label]')).toBeNull();
  });

  it('光标在 chip 前文本节点末尾 → deleteContentForward 整块移除后方 chip（含无尾空格形态）', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="前缀 @Picture1" onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    const textNode = root.querySelector('span')!.firstChild!;
    setCaret(textNode, (textNode.nodeValue ?? '').length);
    expect(dispatchBeforeInput(root, 'deleteContentForward')).toBe(false);
    expect(calls).toEqual(['前缀 ']);
    expect(root.querySelector('[data-mention-label]')).toBeNull();
  });

  it('deleteWordBackward：光标紧贴 mention 右侧时整块删除（chip 原子性）', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="看 @Picture1 " onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    caretEnd(root);
    expect(dispatchBeforeInput(root, 'deleteWordBackward')).toBe(false);
    expect(calls).toEqual(['看 ']);
    expect(root.querySelector('[data-mention-label]')).toBeNull();
  });
});

describe('removeChild 崩溃回归（受控内容根治）', () => {
  it('连续「打字 → @ 引用 → 降级为纯文本 → 再打字」不抛错，且每步序列化与文本模型一致', () => {
    const resolve = (label: string): MentionSlotView => ({
      label, title: label, kind: 'image', url: 'data:image/png;base64,x',
    });
    let value = '一位老人回头 ';
    const onChange = (t: string) => { value = t; };
    const utils = render(<MentionEditor value={value} onChange={onChange} resolveSlot={resolve} />);
    // 受控回写等价物：父级 setState 后重渲染（rerender 即 React reconcile 的触发点）
    const sync = () => utils.rerender(<MentionEditor value={value} onChange={onChange} resolveSlot={resolve} />);
    const root = getRoot(utils.container);

    // 1) 打字（beforeinput 受控路径：DOM 不被浏览器改动）
    const textNode = root.querySelector('span')!.firstChild as Text;
    setCaret(textNode, (textNode.nodeValue ?? '').length);
    expect(dispatchBeforeInput(root, 'insertText', '快步走 ')).toBe(false);
    expect(value).toBe('一位老人回头 快步走 ');
    expect(() => sync()).not.toThrow();
    expect(serializePromptDom(root)).toBe('一位老人回头 快步走 ');

    // 2) @ 引用：父级把 `@Picture1 ` 拼入提示词（资产面板插入后受控回写）→ 重渲染出 chip
    act(() => { value = '一位老人回头 快步走 @Picture1 '; });
    expect(() => sync()).not.toThrow();
    expect(root.querySelectorAll('[data-mention-label]').length).toBe(1);
    expect(serializePromptDom(root)).toBe('一位老人回头 快步走 @Picture1 ');

    // 3) 槽位移除 → 父级把正文 @Picture1 降级为纯文本（受控 value 变更，无树外 DOM 操作）
    act(() => { value = '一位老人回头 快步走 Picture1 '; });
    expect(() => sync()).not.toThrow();
    expect(root.querySelectorAll('[data-mention-label]').length).toBe(0);
    expect(serializePromptDom(root)).toBe('一位老人回头 快步走 Picture1 ');

    // 4) 继续打字（线上崩溃原触发点：reconcile 对已非子节点的引用执行 removeChild）
    const textNode2 = root.querySelector('span')!.firstChild as Text;
    setCaret(textNode2, (textNode2.nodeValue ?? '').length);
    expect(dispatchBeforeInput(root, 'insertText', '望向远方')).toBe(false);
    expect(() => sync()).not.toThrow();
    expect(serializePromptDom(root)).toBe('一位老人回头 快步走 Picture1 望向远方');
  });

  it('全选删除 → 再输入 → 再全选删，全程不抛错、序列化与文本模型一致', () => {
    const calls: string[] = [];
    const { container } = render(
      <ControlledEditor initial="一位老人 @Picture1 回头 @Picture2 走远" onChangeSpy={(t) => calls.push(t)} />,
    );
    const root = getRoot(container);
    expect(root.querySelectorAll('[data-mention-label]').length).toBe(2);

    // 1) 全选删除（非折叠选区，Backspace 形态）
    selectAll(root);
    expect(dispatchBeforeInput(root, 'deleteContentBackward')).toBe(false);
    expect(calls[calls.length - 1]).toBe('');
    expect(root.querySelectorAll('[data-mention-label]').length).toBe(0);
    expect(serializePromptDom(root)).toBe('');

    // 2) 再输入：空编辑器首字（受控路径，浏览器不再直建文本节点）
    setCaret(root, 0);
    expect(dispatchBeforeInput(root, 'insertText', '新提示词')).toBe(false);
    expect(calls[calls.length - 1]).toBe('新提示词');
    expect(serializePromptDom(root)).toBe('新提示词');

    // 3) 再全选删（Delete 键形态）
    selectAll(root);
    expect(dispatchBeforeInput(root, 'deleteContentForward')).toBe(false);
    expect(calls[calls.length - 1]).toBe('');
    expect(serializePromptDom(root)).toBe('');
  });

  it('受控退格删 chip：重渲染后 chip 消失是 React reconcile 的结果，序列化与模型一致', () => {
    const { container } = render(<ControlledEditor initial="@Picture1 文字" />);
    const root = getRoot(container);
    const chip = root.querySelector('[data-mention-label]') as HTMLElement;
    const chipIndex = Array.prototype.indexOf.call(root.childNodes, chip);
    setCaret(root, chipIndex + 1);
    expect(dispatchBeforeInput(root, 'deleteContentBackward')).toBe(false);
    expect(root.querySelectorAll('[data-mention-label]').length).toBe(0);
    expect(serializePromptDom(root)).toBe('文字');
  });
});

describe('epoch 自愈（浏览器直改 DOM 后重挂新根）', () => {
  it('root 直建游离文本节点 → input 提交后重挂：新根只含 React 子节点、旧根摘除、序列化与模型一致', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="" onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    // 模拟浏览器绕过拦截直改 DOM（IME 空编辑器组合输入 / 异常路径残留）
    const foreign = document.createTextNode('新提示词');
    root.appendChild(foreign);
    setCaret(foreign, 4);
    expect(() => fireEvent.input(root)).not.toThrow();
    expect(calls).toEqual(['新提示词']);
    // 提交 → 重渲染 → 检测到游离节点 → epoch 重挂
    const healed = getRoot(container);
    expect(healed).not.toBe(root); // 新根
    expect(root.isConnected).toBe(false); // 旧根由 React 从父级摘除（父级未被浏览器动过）
    expect(serializePromptDom(healed)).toBe('新提示词');
    expect(Array.from(healed.childNodes).every((c) => c instanceof HTMLElement)).toBe(true); // 无游离节点
  });

  it('自愈不误伤：正常受控编辑（无游离节点、序列化一致）不触发重挂（root 引用稳定）', () => {
    const { container } = render(<ControlledEditor initial="文字" />);
    const root = getRoot(container);
    caretEnd(root);
    expect(dispatchBeforeInput(root, 'insertText', '追加')).toBe(false);
    expect(getRoot(container)).toBe(root); // 未重挂
    expect(serializePromptDom(root)).toBe('文字追加');
  });
});

describe('全序列崩溃回归（空态 → 打字 → @ → 选中 mention → 退格删 mention → 再打字 → 全选删除 → 再输入）', () => {
  it('全程不抛 removeChild，每步文本模型与 DOM 一致、占位状态正确', () => {
    const calls: string[] = [];
    let triggerCount = 0;
    const resolve = (label: string): MentionSlotView => ({
      label, title: label, kind: 'image', url: 'data:image/png;base64,x',
    });
    const setExt: { fn?: (t: string) => void } = {};
    function Host() {
      const [value, setValue] = useState('');
      setExt.fn = (t: string) => act(() => setValue(t));
      return (
        <MentionEditor
          value={value}
          onChange={(t) => { calls.push(t); setValue(t); }}
          resolveSlot={resolve}
          placeholder="片段 1 提示词，@ 引用资产"
          onMentionTrigger={() => { triggerCount += 1; }}
        />
      );
    }
    const { container } = render(<Host />);
    let root = getRoot(container);
    const model = () => calls[calls.length - 1] ?? '';

    // 0) 空态：占位生效（:empty + data-placeholder），无 chip
    expect(root.matches(':empty')).toBe(true);
    expect(root.getAttribute('data-placeholder')).toBe('片段 1 提示词，@ 引用资产');
    expect(serializePromptDom(root)).toBe('');

    // 1) 打字（受控 beforeinput，浏览器不改 DOM）
    setCaret(root, 0);
    expect(dispatchBeforeInput(root, 'insertText', '一位老人')).toBe(false);
    expect(model()).toBe('一位老人');
    expect(serializePromptDom(root)).toBe('一位老人');
    expect(root.matches(':empty')).toBe(false); // 占位消失

    // 2) 输入 @ → 触发引用面板
    caretEnd(root);
    expect(dispatchBeforeInput(root, 'insertText', '@')).toBe(false);
    expect(model()).toBe('一位老人@');
    expect(triggerCount).toBe(1);

    // 3) 选中 mention：资产面板插入后父级受控回写 `@Picture1 `
    setExt.fn!('一位老人@Picture1 ');
    root = getRoot(container);
    expect(root.querySelectorAll('[data-mention-label]').length).toBe(1);
    expect(serializePromptDom(root)).toBe('一位老人@Picture1 ');

    // 4) 退格删除 mention（chip 原子整块删除）
    caretEnd(root);
    expect(dispatchBeforeInput(root, 'deleteContentBackward')).toBe(false);
    expect(model()).toBe('一位老人');
    expect(root.querySelectorAll('[data-mention-label]').length).toBe(0);
    expect(serializePromptDom(root)).toBe('一位老人');

    // 5) 再打字
    caretEnd(root);
    expect(dispatchBeforeInput(root, 'insertText', '回头')).toBe(false);
    expect(model()).toBe('一位老人回头');
    expect(serializePromptDom(root)).toBe('一位老人回头');

    // 6) 全选删除 → 清空，占位回来
    selectAll(root);
    expect(dispatchBeforeInput(root, 'deleteContentBackward')).toBe(false);
    expect(model()).toBe('');
    expect(serializePromptDom(root)).toBe('');
    expect(root.matches(':empty')).toBe(true);

    // 7) 再输入（空编辑器首字）
    setCaret(root, 0);
    expect(dispatchBeforeInput(root, 'insertText', '新提示词')).toBe(false);
    expect(model()).toBe('新提示词');
    expect(serializePromptDom(root)).toBe('新提示词');
    expect(root.matches(':empty')).toBe(false);
    // 全程 root 未因损伤重挂（每步都是受控路径）
    expect(getRoot(container)).toBe(root);
  });
});

describe('IME 组合输入', () => {
  it('compositionStart 后 input 不调 onChange；compositionEnd 后才调', () => {
    const calls: string[] = [];
    const { container } = renderEditor({ value: '开始', onChange: (t) => calls.push(t) });
    const root = getRoot(container);
    fireEvent.compositionStart(root);
    // 模拟 IME 直接改写 DOM（React 不感知）
    (root.querySelector('span')!.firstChild as Text).nodeValue = '开始中文';
    fireEvent.input(root);
    expect(calls.length).toBe(0);
    fireEvent.compositionEnd(root);
    expect(calls).toEqual(['开始中文']);
  });

  it('空编辑器 IME 组合（浏览器直建文本节点）→ compositionEnd 提交 + epoch 自愈，模型与 DOM 一致', () => {
    const calls: string[] = [];
    const { container } = render(<ControlledEditor initial="" onChangeSpy={(t) => calls.push(t)} />);
    const root = getRoot(container);
    fireEvent.compositionStart(root);
    const foreign = document.createTextNode('中文输入');
    root.appendChild(foreign);
    setCaret(foreign, 4);
    fireEvent.input(root); // 组合中：不提交
    expect(calls.length).toBe(0);
    expect(() => fireEvent.compositionEnd(root)).not.toThrow(); // 提交 → 受控重渲染 → 自愈重挂
    expect(calls).toEqual(['中文输入']);
    const healed = getRoot(container);
    expect(serializePromptDom(healed)).toBe('中文输入');
    expect(Array.from(healed.childNodes).every((c) => c instanceof HTMLElement)).toBe(true);
    expect(healed.matches(':empty')).toBe(false);
  });
});

describe('粘贴（仅纯文本）', () => {
  it('paste 后 onChange 收到 text/plain 纯文本（不含 HTML 标签）', () => {
    const calls: string[] = [];
    const { container } = renderEditor({ value: 'abc', onChange: (t) => calls.push(t) });
    const root = getRoot(container);
    fireEvent.paste(root, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? '加粗文字' : '<b>加粗文字</b>'),
      },
    });
    expect(calls).toEqual(['abc加粗文字']);
    expect(calls[0]).not.toMatch(/<\/?[a-z]/i);
  });
});

// 2026-11-05 用户指令：导演台插槽拖进提示词区要自动填入 @内容
describe('拖入正文（dropMimeTypes / onDropPayload）', () => {
  const MIME = 'application/x-director-slot';
  const dtFor = (types: string[], raw: string) => ({
    types,
    getData: (m: string) => (types.includes(m) ? raw : ''),
    dropEffect: '',
    effectAllowed: '',
    files: [],
  });

  /**
   * 手工派发原生 drag/drop 事件（本仓约定手法，同 beforeinput 用例）：
   * testing-library 的 fireEvent 返回 boolean，拿不到 defaultPrevented；
   * 而本用例要验的正就是“是否拦截了默认行为”。
   */
  function dispatchOn(el: HTMLElement, kind: 'dragover' | 'drop', types: string[], raw: string): Event {
    const ev = new Event(kind, { bubbles: true, cancelable: true });
    Object.assign(ev, { dataTransfer: dtFor(types, raw), clientX: 0, clientY: 0 });
    act(() => { el.dispatchEvent(ev); });
    return ev;
  }

  it('名单内 MIME 的 drop → 在落点（jsdom 无 caretRangeFromPoint，退回末尾）插入宿主返回的文本', () => {
    const calls: string[] = [];
    const { container } = render(
      <MentionEditor
        value="一个老人回头"
        onChange={(t) => { calls.push(t); }}
        resolveSlot={resolveNone}
        dropMimeTypes={[MIME]}
        onDropPayload={(mime, raw) => {
          if (mime !== MIME) return null;
          const p = JSON.parse(raw) as { label?: string };
          return p.label ? `@${p.label} ` : null;
        }}
      />,
    );
    const root = getRoot(container);
    const drop = dispatchOn(root, 'drop', [MIME], JSON.stringify({ label: 'Picture1', assetId: 'a1' }));
    expect(drop.defaultPrevented).toBe(true);
    expect(calls).toEqual(['一个老人回头@Picture1 ']);
  });

  it('宿主返回 null（槽位已不在本片段）→ 不拦截插入，正文不变', () => {
    const calls: string[] = [];
    const { container } = render(
      <MentionEditor
        value="正文"
        onChange={(t) => { calls.push(t); }}
        resolveSlot={resolveNone}
        dropMimeTypes={[MIME]}
        onDropPayload={() => null}
      />,
    );
    dispatchOn(getRoot(container), 'drop', [MIME], '{}');
    expect(calls).toEqual([]);
  });

  it('名单外拖拽（外部文件）→ 不接管：不 preventDefault、不回调 onDropPayload', () => {
    const onDropPayload = vi.fn(() => '@Picture1 ');
    const calls: string[] = [];
    const { container } = render(
      <MentionEditor
        value="正文"
        onChange={(t) => { calls.push(t); }}
        resolveSlot={resolveNone}
        dropMimeTypes={[MIME]}
        onDropPayload={onDropPayload}
      />,
    );
    const root = getRoot(container);
    const over = dispatchOn(root, 'dragover', ['Files'], '');
    const drop = dispatchOn(root, 'drop', ['Files'], '');
    expect(over.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(onDropPayload).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
