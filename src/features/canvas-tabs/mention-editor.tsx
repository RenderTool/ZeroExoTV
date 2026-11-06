/**
 * MentionEditor — 导演台提示词行内高亮编辑器（2026-11-05 根治重构：受控内容 + 伪元素占位）
 *
 * 架构铁律（removeChild NotFoundError 根治）：编辑区内容只由 React 渲染，
 * 所有变更统一走 onChange 回写文本模型，组件内不再有任何直接摘/插 DOM 节点的操作。
 *
 * 1. beforeinput 全拦截（原生 addEventListener；React 18 的 onBeforeInput 是合成 polyfill，
 *    拿不到原生 inputType，不可用）：insert* / delete* / format* / history* 一律 preventDefault，
 *    由文本模型计算结果后 onChange，React 重渲染落地；IME（insertCompositionText /
 *    deleteComposition / composing 期间）不拦截，compositionEnd 统一提交。
 *    historyUndo/Redo 拦截后禁用——浏览器原生撤销会结构性回滚 React 拥有的节点。
 * 2. DOM 损伤自愈（epoch 重挂）：浏览器唯一能绕过拦截的路径是 IME（会在 root 直建文本节点）。
 *    useLayoutEffect 检测「序列化 ≠ 期望」或「根级存在 React 未渲染的游离子节点」时 bump key
 *    强制重挂整个 contentEditable 根：旧根由 React 从父级摘除（父级从未被浏览器编辑，
 *    removeChild 必然成功），新根只含 React 子节点，损伤一轮收敛。
 *    判据用 serializeSegments(parse(value)) 而非 value 原文——`@Picture1` 无尾空格时
 *    parse/serialize 往返会补空格，用原文比对恒不相等 → 死循环。
 * 3. 占位文字用 CSS `:empty::before`（content: attr(data-placeholder)）：伪元素不在 DOM 中，
 *    一输入立刻消失、清空立刻回来、不参与光标/选区/复制/mention 解析。
 * 4. chip 整块删除在文本模型上判断（光标邻接 `@Label ` 的边界正则），不做 DOM 爬树。
 *
 * 模型：value 是纯文本，槽位引用序列化为 `@PictureN ` / `@AudioN ` / `@VideoN`
 * （与 assignAssetSlots 的 label、pack.py 文件名正则一致）——落库/导出仍是纯文本，
 * 替换槽位后所有 @ 自动指向新资产（文本不动，渲染层按 label 解析当前资产）。
 * 粘贴：拦截 paste，仅插入纯文本（不丢字、不带格式）。无第三方富文本依赖。
 */
import {
  forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ReactElement, type ClipboardEvent as ReactClipboardEvent,
  type CompositionEvent as ReactCompositionEvent, type DragEvent as ReactDragEvent,
} from 'react';
import { Film, Image as ImageIcon, Music } from 'lucide-react';
import { ThumbImage } from './thumb-image.js';

// ===== 解析 / 序列化（纯函数，可单测） =====

export type MentionSegment = { type: 'text'; text: string } | { type: 'mention'; label: string };

// mention 序列化形态为 `@Label `（尾空格归入 mention）：parse 必须消耗这个空格，
// 否则 serialize(parse(x)) 每轮多漏一个空格（chip 后每次输入空格递增，2026-11-04 单测暴露）。
const MENTION_RE = /@(Picture|Audio|Video)(\d+) ?/g;

/** 纯文本 → 段序列（`@Picture1 ` 形态识别为 mention 段；不认识的 @文本 原样保留） */
export function parsePromptSegments(text: string): MentionSegment[] {
  const segs: MentionSegment[] = [];
  let last = 0;
  MENTION_RE.lastIndex = 0;
  for (let m = MENTION_RE.exec(text); m; m = MENTION_RE.exec(text)) {
    if (m.index > last) segs.push({ type: 'text', text: text.slice(last, m.index) });
    segs.push({ type: 'mention', label: `${m[1]}${m[2]}` });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ type: 'text', text: text.slice(last) });
  return segs;
}

/** 段序列 → 纯文本（epoch 自愈判据的「期望值」：渲染产物序列化后必然等于它） */
export function serializeSegments(segs: MentionSegment[]): string {
  let out = '';
  for (const s of segs) out += s.type === 'text' ? s.text : `@${s.label} `;
  return out;
}

/** DOM → 纯文本（chip 元素取 data-mention-label 还原 `@Label `，文本节点取 nodeValue；只读，不改 DOM） */
export function serializePromptDom(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue ?? ''; return; }
    if (node instanceof HTMLElement) {
      const label = node.dataset?.mentionLabel;
      if (label) { out += `@${label} `; return; }
      if (node.tagName === 'BR') { out += '\n'; return; }
      node.childNodes.forEach(walk);
    }
  };
  root.childNodes.forEach(walk);
  return out;
}

/** 序列化坐标系下的光标偏移（root 内 node/offset → 纯文本偏移；只读） */
function caretToTextOffset(root: HTMLElement, node: Node, offset: number): number {
  let pos = 0;
  let found = 0;
  let done = false;
  const walk = (n: Node) => {
    if (done) return;
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) found = pos + offset;
      else {
        // 元素节点：offset = 子节点下标 → 累加前 offset 个子的长度
        let p = pos;
        for (let i = 0; i < offset && i < n.childNodes.length; i++) p += nodeTextLength(n.childNodes[i]!);
        found = p;
      }
      done = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) { pos += (n.nodeValue ?? '').length; return; }
    if (n instanceof HTMLElement && n.dataset?.mentionLabel) { pos += `@${n.dataset.mentionLabel} `.length; return; }
    n.childNodes.forEach(walk);
  };
  walk(root);
  return done ? found : pos;
}

function nodeTextLength(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) return (n.nodeValue ?? '').length;
  if (n instanceof HTMLElement && n.dataset?.mentionLabel) return `@${n.dataset.mentionLabel} `.length;
  let len = 0;
  n.childNodes.forEach((c) => { len += nodeTextLength(c); });
  return len;
}

/** 纯文本偏移 → 设置光标（只操作 Selection，不动节点树；跨 chip 时落在 chip 边界） */
function setCaretByTextOffset(root: HTMLElement, textOffset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  let pos = 0;
  let placed = false;
  const walk = (n: Node): void => {
    if (placed) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.nodeValue ?? '').length;
      if (pos + len >= textOffset) {
        sel.setBaseAndExtent(n, Math.min(len, textOffset - pos), n, Math.min(len, textOffset - pos));
        placed = true;
        return;
      }
      pos += len;
      return;
    }
    if (n instanceof HTMLElement && n.dataset?.mentionLabel) {
      pos += `@${n.dataset.mentionLabel} `.length;
      return;
    }
    n.childNodes.forEach(walk);
  };
  walk(root);
  if (!placed) {
    // 兜底：末尾
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ===== 受控删除的文本模型工具 =====

// 光标前紧贴的完整 mention（尾空格可缺，兼容文本末尾 `@Picture1` 无空格形态）
const MENTION_BACK_RE = /@(Picture|Audio|Video)\d+ ?$/;
// 光标后紧贴的完整 mention
const MENTION_FWD_RE = /^@(Picture|Audio|Video)\d+ ?/;

/** Ctrl/Cmd+Backspace：向前删一个词（跳过空白再吃一段非空白） */
function wordStartBackward(text: string, caret: number): number {
  let i = caret;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
}

/** Ctrl/Cmd+Delete：向后删一个词 */
function wordEndForward(text: string, caret: number): number {
  let i = caret;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  return i;
}

// ===== 占位样式（编辑区外的一次性样式表；伪元素不进 DOM，不参与序列化/选区/复制） =====

const PLACEHOLDER_STYLE_ID = 'mention-editor-placeholder-style';
function ensurePlaceholderStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PLACEHOLDER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PLACEHOLDER_STYLE_ID;
  style.textContent =
    '[data-mention-editor][data-placeholder]:empty::before{content:attr(data-placeholder);opacity:.45;pointer-events:none;border-radius:inherit;}';
  document.head.appendChild(style);
}

// ===== 组件 =====

export interface MentionSlotView {
  label: string;
  title: string;
  kind: 'image' | 'audio' | 'video';
  url?: string;
  /** 无 dataUrl 时按 storageKey 走缩略图派生链（主体状态图等） */
  storageKey?: string;
}

export interface MentionEditorHandle {
  /** 在光标处插入文本（无光标时追加到末尾），用于资产面板选中后插入 `@PictureN ` */
  insertAtCaret: (text: string) => void;
}

/**
 * 落点坐标 → 正文字符偏移（2026-11-05 插槽拖入正文）。
 * Chromium/Safari = caretRangeFromPoint，Firefox = caretPositionFromPoint；
 * 得不到（落在空白边距/不支持的引擎）返回 null，调用方退回光标或末尾。
 */
function caretOffsetFromPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = root.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node | null; offset: number } | null;
  };
  let container: Node | null = null;
  let offset = 0;
  const pos = typeof doc.caretPositionFromPoint === 'function' ? doc.caretPositionFromPoint(x, y) : null;
  if (pos?.offsetNode) { container = pos.offsetNode; offset = pos.offset; }
  if (!container && typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) { container = range.startContainer; offset = range.startOffset; }
  }
  if (!container || !root.contains(container)) return null;
  return caretToTextOffset(root, container, offset);
}

const KIND_ICON = { image: ImageIcon, video: Film, audio: Music } as const;

export const MentionEditor = memo(forwardRef<MentionEditorHandle, {
  value: string;
  onChange: (text: string, caretOffset: number) => void;
  /** label → 槽位当前资产（替换槽位后 chip 自动跟随，因为渲染按 label 解析） */
  resolveSlot: (label: string) => MentionSlotView | undefined;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  /** 输入 @ 时触发（打开资产面板） */
  onMentionTrigger?: () => void;
  minHeight?: number;
  /** data 属性前缀（测试断言用） */
  dataAttr?: string;
  /** 追加到根节点的内联样式（面板侧控制边框/内边距/滚动等） */
  style?: React.CSSProperties;
  /**
   * 可拖入正文的自定义 MIME（2026-11-05 用户指令：导演台插槽拖进提示词区自动补 @内容）。
   * 不在名单内的拖拽（外部文件、卡片拖到画布等）一律不拦截，保持原有行为。
   */
  dropMimeTypes?: readonly string[];
  /**
   * 解析拖入 payload → 要插入的正文文本（返回 null/'' = 忽略本次拖入）。
   * caretOffset = 落点对应的字符偏移，测不到为 null（宿主可退回光标/末尾）。
   */
  onDropPayload?: (mime: string, raw: string, caretOffset: number | null) => string | null;
}>(function MentionEditor({
  value, onChange, resolveSlot, placeholder, readOnly, className, onMentionTrigger, minHeight, dataAttr, style,
  dropMimeTypes, onDropPayload,
}, ref): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const caretRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // epoch 重挂：key 变 → React 摘旧根（父级完好，必成功）挂新根（只含 React 子节点）
  const [domEpoch, setDomEpoch] = useState(0);
  const skipDetectOnceRef = useRef(false);
  const focusRestoreRef = useRef(false);

  useEffect(() => { ensurePlaceholderStyle(); }, []);

  const commitFromDom = useCallback((): boolean => {
    const root = rootRef.current;
    if (!root) return false;
    const text = serializePromptDom(root);
    let caret = text.length;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
      const r = sel.getRangeAt(0);
      caret = caretToTextOffset(root, r.startContainer, r.startOffset);
    }
    caretRef.current = caret;
    if (text !== valueRef.current) {
      onChange(text, caret);
      if (text.slice(0, caret).endsWith('@')) onMentionTrigger?.();
      return true;
    }
    return false;
  }, [onChange, onMentionTrigger]);

  /**
   * DOM 损伤检测 + epoch 重挂自愈。判据：
   * a) serialize(root) !== serializeSegments(parse(value))（含 IME 直改文本节点后未提交等）；
   * b) 根级存在 React 未渲染的游离子节点（IME 空编辑器直建文本节点等）。
   * 只读检测；修复手段是 bump key 让 React 重挂整根，不做任何手工摘节点。
   */
  const detectAndHeal = useCallback((): boolean => {
    const root = rootRef.current;
    if (!root || composingRef.current) return false;
    if (skipDetectOnceRef.current) { skipDetectOnceRef.current = false; return false; }
    const expected = serializeSegments(parsePromptSegments(valueRef.current));
    const foreign = Array.from(root.childNodes).some(
      (c) => !(c instanceof HTMLElement) || c.dataset.mentionOwned === undefined,
    );
    if (serializePromptDom(root) === expected && !foreign) return false;
    skipDetectOnceRef.current = true;
    focusRestoreRef.current = document.activeElement === root || root.contains(document.activeElement);
    setDomEpoch((n) => n + 1);
    return true;
  }, []);

  // value/domEpoch 变化 → React 重绘段序列 → 恢复焦点与光标（序列化坐标系）；损伤则先自愈重挂
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (skipDetectOnceRef.current) {
      // 刚重挂过：本轮只做焦点/光标恢复（新根必为 React 渲染态，再检测会自触发死循环）
      skipDetectOnceRef.current = false;
    } else if (detectAndHeal()) {
      return; // 已 bump epoch，重挂后的 effect 再恢复焦点/光标
    }
    if (focusRestoreRef.current) {
      focusRestoreRef.current = false;
      if (document.activeElement !== root) root.focus();
    }
    if (caretRef.current == null) return;
    const offset = caretRef.current;
    caretRef.current = null;
    if (document.activeElement !== root && !root.contains(document.activeElement)) return;
    setCaretByTextOffset(root, offset);
  }, [value, domEpoch, detectAndHeal]);

  /** 当前光标在纯文本模型中的偏移（无光标/不在本编辑区 → 末尾） */
  const currentCaretOffset = useCallback((): number => {
    const root = rootRef.current;
    const base = valueRef.current;
    if (!root) return base.length;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)) {
      return caretToTextOffset(root, sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    }
    return base.length;
  }, []);

  /** 在指定偏移插入文本（光标插入与拖入插入共用同一条文本模型路径，不直接动 DOM） */
  const insertAt = useCallback((text: string, caret: number) => {
    const base = valueRef.current;
    const at = Math.max(0, Math.min(base.length, caret));
    const next = `${base.slice(0, at)}${text}${base.slice(at)}`;
    caretRef.current = at + text.length;
    onChange(next, at + text.length);
  }, [onChange]);

  /**
   * 拖拽落区（2026-11-05 用户指令：导演台插槽拖进提示词区自动填入 @内容）：
   * 只接管 dropMimeTypes 名单内的拖拽，其余（外部文件等）一律不拦截。
   * 插入走文本模型（insertAt）→ 不碰 contentEditable DOM，与受控编辑一致。
   */
  const acceptDropMime = (e: ReactDragEvent<HTMLElement>): string | null => {
    if (readOnly || !dropMimeTypes || dropMimeTypes.length === 0) return null;
    const types = Array.from(e.dataTransfer.types ?? []);
    return dropMimeTypes.find((m) => types.includes(m)) ?? null;
  };

  useImperativeHandle(ref, () => ({
    insertAtCaret(text: string) {
      insertAt(text, currentCaretOffset());
    },
  }), [insertAt, currentCaretOffset]);

  /**
   * 受控 beforeinput：所有浏览器原生编辑（insert / delete / format / history 类 inputType）一律拦截，
   * 在文本模型上计算结果后 onChange，由 React 重渲染落地——浏览器永远不改编辑区 DOM。
   * IME（composing 或 Composition 类 inputType）放行，compositionEnd 统一提交 + 自愈检测。
   */
  const handleBeforeInput = useCallback((e: InputEvent) => {
    const type = e.inputType;
    if (!type) return;
    if (composingRef.current) return;
    if (type === 'insertCompositionText' || type === 'deleteComposition') return;
    const isInsert = type.startsWith('insert');
    const isDelete = type.startsWith('delete');
    const isFormat = type.startsWith('format');
    const isHistory = type === 'historyUndo' || type === 'historyRedo';
    if (!isInsert && !isDelete && !isFormat && !isHistory) return;
    e.preventDefault();
    // history（原生撤销/重做会结构性回滚 React 节点）与 format（富文本格式不属于纯文本模型）：
    // 拦截但不产生模型变更
    if (!isInsert && !isDelete) return;
    const root = rootRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    let sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
    // 拼写纠正/拖放：目标区间在 getTargetRanges，不在当前选区
    if (type === 'insertReplacementText' || type === 'insertFromDrop' || type === 'deleteByDrag') {
      const tr = e.getTargetRanges?.()[0];
      if (tr && root.contains(tr.startContainer) && root.contains(tr.endContainer)) {
        sc = tr.startContainer; so = tr.startOffset; ec = tr.endContainer; eo = tr.endOffset;
      }
    }
    if (!root.contains(sc) || !root.contains(ec)) return;
    const text = serializePromptDom(root);
    let start = caretToTextOffset(root, sc, so);
    let end = caretToTextOffset(root, ec, eo);
    if (start > end) { const t = start; start = end; end = t; }
    let next: string;
    let caret: number;
    if (isInsert) {
      let data = e.data;
      if (data == null) {
        if (type === 'insertParagraph' || type === 'insertLineBreak') data = '\n';
        else data = (e as InputEvent & { dataTransfer?: DataTransfer | null }).dataTransfer?.getData('text/plain') ?? '';
      }
      next = text.slice(0, start) + data + text.slice(end);
      caret = start + data.length;
    } else {
      let from = start;
      let to = end;
      if (start === end) {
        if (type === 'deleteContentBackward' || type === 'deleteWordBackward') {
          // chip 原子性：光标紧贴 mention 右侧 → 整块删除（文本模型边界正则，不爬 DOM）
          const mention = MENTION_BACK_RE.exec(text.slice(0, start));
          if (mention) from = start - mention[0].length;
          else if (type === 'deleteContentBackward') from = Math.max(0, start - 1);
          else from = wordStartBackward(text, start);
        } else if (type === 'deleteContentForward' || type === 'deleteWordForward') {
          const mention = MENTION_FWD_RE.exec(text.slice(start));
          if (mention) to = start + mention[0].length;
          else if (type === 'deleteContentForward') to = Math.min(text.length, start + 1);
          else to = wordEndForward(text, start);
        } else {
          return; // deleteByCut/deleteByDrag 折叠态：无可删区间（已 preventDefault，不再改模型）
        }
      }
      next = text.slice(0, from) + text.slice(to);
      caret = from;
    }
    caretRef.current = caret;
    if (next !== valueRef.current) onChange(next, caret);
    if (next.slice(0, caret).endsWith('@')) onMentionTrigger?.();
  }, [onChange, onMentionTrigger]);

  // 原生监听（React 18 合成 onBeforeInput 是 polyfill，不可用）；ref 转发最新 handler，domEpoch 重挂后重绑
  const beforeInputRef = useRef(handleBeforeInput);
  beforeInputRef.current = handleBeforeInput;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const listener = (ev: Event) => beforeInputRef.current(ev as InputEvent);
    root.addEventListener('beforeinput', listener);
    return () => root.removeEventListener('beforeinput', listener);
  }, [domEpoch]);

  const handlePaste = useCallback((e: ReactClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const root = rootRef.current;
    if (!root) return;
    const base = valueRef.current;
    let caret = base.length;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0);
      caret = caretToTextOffset(root, r.startContainer, r.startOffset);
    }
    const next = `${base.slice(0, caret)}${text}${base.slice(caret)}`;
    caretRef.current = caret + text.length;
    onChange(next, caret + text.length);
  }, [onChange]);

  const handleCompositionStart = useCallback((_e: ReactCompositionEvent<HTMLDivElement>) => {
    composingRef.current = true;
  }, []);
  const handleCompositionEnd = useCallback((_e: ReactCompositionEvent<HTMLDivElement>) => {
    composingRef.current = false;
    // 提交组合结果；若组合未改变文本（如输入后又还原），仍需检测自愈（IME 可能留下游离节点）
    if (!commitFromDom()) detectAndHeal();
  }, [commitFromDom, detectAndHeal]);

  const segments = parsePromptSegments(value);

  return (
    <div
      key={domEpoch}
      ref={rootRef}
      data-mention-editor={dataAttr ?? true}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      className={className}
      data-placeholder={placeholder}
      onInput={() => { if (!composingRef.current) commitFromDom(); }}
      onPaste={handlePaste}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onDragOver={(e) => {
        if (!acceptDropMime(e)) return;
        // 必须 preventDefault 才会触发 drop；stopPropagation 防止当成素材拖入画布建节点
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        const mime = acceptDropMime(e);
        if (!mime || !onDropPayload) return;
        e.preventDefault();
        e.stopPropagation();
        const raw = e.dataTransfer.getData(mime);
        if (!raw) return;
        const root = rootRef.current;
        // 落点优先（光标跟随拖拽位置），测不到退回当前光标/末尾
        const at = (root ? caretOffsetFromPoint(root, e.clientX, e.clientY) : null) ?? currentCaretOffset();
        const text = onDropPayload(mime, raw, at);
        if (!text) return;
        root?.focus();
        insertAt(text, at);
      }}
      style={{
        minHeight, outline: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        ...style,
      }}
    >
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i} data-mention-owned="">{seg.text}</span>;
        const slot = resolveSlot(seg.label);
        const Icon = slot ? KIND_ICON[slot.kind] : ImageIcon;
        return (
          <span
            key={i}
            data-mention-owned=""
            data-mention-label={seg.label}
            contentEditable={false}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, height: 20,
              padding: '0 6px 0 2px', margin: '0 1px', borderRadius: 4,
              background: 'rgba(255,255,255,0.08)', verticalAlign: '-4px',
              fontSize: 13, lineHeight: '20px', userSelect: 'none',
            }}
          >
            {slot?.kind === 'image' ? (
              /* 与面板同一 useResolvedThumb 入口（thumb→preview→原图；未就绪占位；失败回退图标）；
                 块高 20 / 圆角 4 / 底色 / 整块删除行为不变，仅替换图片来源 */
              <ThumbImage storageKey={slot.storageKey} url={slot.url} width={16} height={16} radius={3} title={slot.title} icon={<Icon size={12} style={{ opacity: 0.75 }} />} />
            ) : (
              <Icon size={12} style={{ opacity: 0.75 }} />
            )}
            <span>@{slot?.title ?? seg.label}</span>
          </span>
        );
      })}
    </div>
  );
}));
