/**
 * GeneratorPromptEditor - 生成器提示词编辑器
 *
 * 基于 contentEditable 实现的内联提示词输入框，支持：
 *   1. 普通多行文本输入
 *   2. @ 提及参考素材（图片/视频/文本/音频），将素材作为 badge 内联插入
 *   3. badge 删除（点击 × 或在 backspace 时移除整段）
 *   4. 支持视频缩略图
 *
 * 实现参考: PromptEditor.tsx
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';

/** 参考素材类型 */
export interface ReferenceItem {
  id: string;
  type: 'image' | 'video' | 'text' | 'audio' | 'script' | 'storyboard' | 'generator';
  name: string;
  url?: string; // 缩略图URL（图片/视频）
  title?: string;
  /** 原始资产信息(生成时作为 API 资产源输入;缩略图 url 与原始内容分离) */
  asset?: { content?: string; storageKey?: string };
}

/** 暴露给父组件的命令式 API */
export interface GeneratorPromptEditorHandle {
  /** 通过 @ 选择素材后，插入 badge 到当前光标位置（item 可直接传入，不必先出现在 references 里） */
  insertReference: (refId: string, item?: ReferenceItem) => void;
  /** 全量同步 DOM：将文本中的 @name 替换为 badge HTML */
  syncDOM: (text: string, refs: { id: string; name: string; url?: string; type: string }[]) => void;
  /** 将指定素材对应的 badge 降级为纯文本 */
  downgradeReferenceToText: (ref: { id: string; name: string }) => string | null;
  /** 标记引用是否仍关联：不删除 badge，只把失效的标成待关联（重新连入同一素材即自动恢复） */
  markInvalidReferences: (validIds: string[]) => void;
  /** 提取输入框纯文本（badge span 转换为 @name） */
  getPlainText: () => string | null;
  /** 关闭 @ 弹层状态（外部面板自关时同步编辑器内部状态） */
  closeMentionPanel: () => void;
}


/**
 * 读取编辑器纯文本：只认显式换行（顶层 <br> / <div> 块），不把「软换行」写进值。
 * 旧实现用 innerText：badge 是 inline-flex，窄面板里被浏览器换行后 innerText 会插入 \n，
 * 导致「@ 引用后下次打开多一个换行」。导演台编辑器就是 DOM 序列化，这里与之对齐。
 */
function readEditorText(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node, insideBlock = false): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === 'BR') {
      if (!insideBlock) out += '\n';
      return;
    }
    const block = el.tagName === 'DIV' || el.tagName === 'P';
    if (block) {
      el.childNodes.forEach((child) => walk(child, true));
      if (out && !out.endsWith('\n')) out += '\n';
      return;
    }
    el.childNodes.forEach((child) => walk(child, insideBlock));
  };
  root.childNodes.forEach((child) => walk(child));
  return out;
}

export interface GeneratorPromptEditorProps {
  /** 提示词文本（受控） */
  value: string;
  /** 提示词变化回调 */
  onChange: (value: string) => void;
  /** 当前参考素材列表（用于 @ 提及过滤） */
  references: ReferenceItem[];
  /** 是否只读（非编辑态） */
  readOnly: boolean;
  /** placeholder 文本 */
  placeholder?: string;
  /** 最大长度 */
  maxLength?: number;
  /** 字数变化回调 */
  onLengthChange?: (length: number) => void;
  /** 主题色 */
  accentColor?: string;
  /** 文本颜色 */
  textColor?: string;
  /** 字体大小 */
  fontSize?: number;
  /** 行高 */
  lineHeight?: number;
  /** 最小高度 */
  minHeight?: number;
  /** 最大高度(超出后出现滚动条) */
  maxHeight?: number;
  /** @ 弹窗类型过滤(先按类型过滤,再做名称匹配;参考区展示不受影响) */
  mentionTypeFilter?: (ref: ReferenceItem) => boolean;
  /** 外部接管 @ 弹层（画布 dock 复用分镜同款选择面板）：true 时不渲染内置弹层，仅回调开关 */
  externalMentionPanel?: boolean;
  /** @ 弹层开关变化（外部面板模式）：open + 当前过滤词 */
  onMentionPanelChange?: (open: boolean, filter: string) => void;
  /** @ 弹窗背景色/边框色(不传时按 textColor 亮度自动推断;明暗主题下应由宿主传入主题色) */
  popupBackground?: string;
  popupBorderColor?: string;
  /**
   * 解析参考素材的缩略图/预览 URL（宿主注入，与「参考槽位缩略图」同一条 storageKey 链路）。
   * 传了才会补齐 badge 缩略图与悬停大图预览；不传则只按 item.url 渲染。
   */
  resolvePreviewUrl?: (item: ReferenceItem) => Promise<string | null>;
}

/**
 * 参考素材类型 → 类型文本色(与正文明显区分,加粗显示)
 * 颜色用于 badge 内 "@名称" 文本,而非图标(图标保持主题文字色)
 */
export const REF_TYPE_COLOR: Record<string, string> = {
  image: '#8b5cf6',
  video: '#f59e0b',
  audio: '#10b981',
  text: '#3b82f6',
  script: '#ec4899',
  storyboard: '#06b6d4',
  generator: '#f97316',
};

/**
 * 参考素材类型 → lucide 图标内联 SVG(24 视口,描边风格,随 currentColor)
 * 不用 emoji(项目规范禁止);有缩略图时优先缩略图,无缩略图时用此图标
 */
export const REF_TYPE_ICON_PATH: Record<string, string> = {
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  video: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  text: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  script: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  storyboard: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  generator: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
};

/** 参考素材类型 → 列表副行中文标签(与 Agent MentionPopover 两行行布局一致) */
const REF_TYPE_LABEL: Record<string, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
  audio: '音频',
  script: '剧本',
  storyboard: '分镜',
};

/** 生成 lucide 风格内联 SVG 图标 HTML */
function refTypeIconSvg(type: string, size: number): string {
  const path = REF_TYPE_ICON_PATH[type] ?? REF_TYPE_ICON_PATH.text!;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `style="flex-shrink:0;display:inline-block;vertical-align:middle;opacity:0.75;">${path}</svg>`
  );
}

/**
 * 生成参考素材 badge 的 HTML 字符串
 *
 * 视觉契约(用户反馈):
 * - 无底色/无边框,透明自然融入正文
 * - 有缩略图(图片/视频)用缩略图,无缩略图用 lucide 图标 —— 二者只取其一,不出现双图标
 * - "@名称" 文本按类型着色 + 加粗,与正文明显区分
 */
function buildBadgeHtml(ref: ReferenceItem): string {
  const hasThumb = !!ref.url && (ref.type === 'image' || ref.type === 'video');
  const typeColor = REF_TYPE_COLOR[ref.type] ?? '#3b82f6';
  const iconHtml = hasThumb
    ? `<img src="${ref.url}" alt="" style="width:15px;height:15px;border-radius:3px;object-fit:cover;vertical-align:middle;flex-shrink:0;" />`
    : refTypeIconSvg(ref.type, 13);
  return (
    `<span contenteditable="false" data-ref-id="${ref.id}" data-ref-type="${ref.type}" ` +
    `style="display:inline-flex;align-items:center;gap:3px;margin:0 2px 0 1px;padding:0 2px;border-radius:4px;font-size:12px;line-height:18px;vertical-align:middle;color:inherit;user-select:all;cursor:default;background:transparent;">` +
    iconHtml +
    `<span style="font-weight:700;color:${typeColor};white-space:nowrap;">@${ref.name}</span>` +
    `<span class="badge-delete" style="cursor:pointer;color:#999;margin-left:1px;user-select:none;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;transition:background 0.15s;background:transparent;" title="删除"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>` +
    `</span>`
  );
}

/** 生成器提示词编辑器 */
const GeneratorPromptEditor = forwardRef<GeneratorPromptEditorHandle, GeneratorPromptEditorProps>(
  function GeneratorPromptEditor(
    {
      value,
      onChange,
      references,
      readOnly,
      placeholder,
      maxLength,
      onLengthChange,
      textColor = '#333',
      fontSize = 12,
      lineHeight: lh = 1.6,
      minHeight = 60,
      maxHeight,
      mentionTypeFilter,
      externalMentionPanel,
      onMentionPanelChange,
      popupBackground,
      popupBorderColor,
      resolvePreviewUrl,
    },
    ref,
  ) {
    const promptInputRef = useRef<HTMLDivElement>(null);
    const mentionPopupRef = useRef<HTMLDivElement>(null);
    const [mentionFilter, setMentionFilter] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    /** @ 块悬停大图预览（fixed + portal，与导演台编辑器同一交互：分镜能看到的缩略图/大图这里也要有） */
    const [badgePreview, setBadgePreview] = useState<{ url: string; title: string; x: number; y: number } | null>(null);
    const resolvePreviewRef = useRef(resolvePreviewUrl);
    resolvePreviewRef.current = resolvePreviewUrl;

    // ref 缓存
    const promptTextRef = useRef('');
    const mentionOpenRef = useRef(false);
    const mentionFilterRef = useRef('');

    /**
     * @ 提及弹层定位（2026-11-11 修复 z-index）：弹层 portal 到 body + fixed 定位，
     * 避免被画布节点 / dock 的层叠上下文盖住；每次打开按编辑器位置重算。
     */
    const positionMentionPopup = useCallback(() => {
      const el = mentionPopupRef.current;
      const host = promptInputRef.current;
      if (!el || !host) return;
      const rect = host.getBoundingClientRect();
      el.style.left = `${Math.round(rect.left)}px`;
      el.style.width = `${Math.round(rect.width)}px`;
      el.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
    }, []);
    const showMentionPopup = useCallback(() => {
      mentionOpenRef.current = true;
      onMentionPanelChangeRef.current?.(true, mentionFilterRef.current);
      const el = mentionPopupRef.current;
      if (!el) return;
      positionMentionPopup();
      el.style.display = 'flex';
    }, [positionMentionPopup]);

    /** 统一关闭：内部状态 + 内置弹层隐藏 + 过滤词清空 + 通知外部面板关闭 */
    const hideMentionPanel = useCallback(() => {
      mentionOpenRef.current = false;
      if (mentionPopupRef.current) mentionPopupRef.current.style.display = 'none';
      mentionFilterRef.current = '';
      setMentionFilter('');
      onMentionPanelChangeRef.current?.(false, '');
    }, []);
    useEffect(() => {
      const reflow = (): void => positionMentionPopup();
      window.addEventListener('resize', reflow);
      window.addEventListener('scroll', reflow, true);
      return () => {
        window.removeEventListener('resize', reflow);
        window.removeEventListener('scroll', reflow, true);
      };
    }, [positionMentionPopup]);

    // ref 追踪最新的 props
    const referencesRef = useRef(references);
    referencesRef.current = references;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    /** 悬停 @ 块 → 弹出素材大图预览（2026-11-17 用户实测：分镜 @ 能看缩略图+大图，画布提示词只剩图标） */
    const handleBadgeHover = useCallback((e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-ref-id]') as HTMLElement | null;
      if (!target) {
        setBadgePreview(null);
        return;
      }
      const id = target.getAttribute('data-ref-id') || '';
      const item = referencesRef.current.find((r) => r.id === id);
      if (!item || item.type === 'text' || item.type === 'script' || item.type === 'storyboard' || item.type === 'generator') {
        setBadgePreview(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      const base = { title: item.name, x: rect.left + rect.width / 2, y: rect.top };
      if (item.url) {
        setBadgePreview({ ...base, url: item.url });
        return;
      }
      const resolver = resolvePreviewRef.current;
      if (!resolver) {
        setBadgePreview(null);
        return;
      }
      void resolver(item)
        .then((url) => { if (url) setBadgePreview({ ...base, url }); })
        .catch(() => setBadgePreview(null));
    }, []);

    /** 补齐 badge 缩略图：引用只有 storageKey 时按同一条媒体档位链解析，替换掉图标 */
    const hydrateBadgeThumbs = useCallback(() => {
      const el = promptInputRef.current;
      const resolver = resolvePreviewRef.current;
      if (!el || !resolver) return;
      el.querySelectorAll<HTMLElement>('span[data-ref-id]').forEach((badge) => {
        if (badge.querySelector('img')) return;
        const id = badge.getAttribute('data-ref-id') || '';
        const item = referencesRef.current.find((r) => r.id === id);
        if (!item || item.type !== 'image' && item.type !== 'video') return;
        void resolver(item).then((url) => {
          if (!url) return;
          const live = promptInputRef.current;
          if (!live) return;
          const badgeNow = live.querySelector<HTMLElement>(`span[data-ref-id="${id}"]`);
          if (!badgeNow || badgeNow.querySelector('img')) return;
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          img.draggable = false;
          img.style.cssText = 'width:15px;height:15px;border-radius:3px;object-fit:cover;vertical-align:middle;flex-shrink:0;';
          // HTML 文档里内联 SVG 的 tagName 是小写 'svg'（不是 'SVG'），只能比较小写，
          // 否则会走 insertBefore 分支 → 图标和缩略图同时出现（用户截图 2026-11-17）
          const icons = Array.from(badgeNow.children).filter((c) => c.tagName.toLowerCase() === 'svg');
          if (icons.length > 0) {
            const iconSvg = icons[0]!;
            iconSvg.replaceWith(img);
            icons.slice(1).forEach((extra) => extra.remove());
          } else if (!badgeNow.querySelector('img')) {
            badgeNow.insertBefore(img, badgeNow.firstChild);
          }
        }).catch(() => { /* 解析失败保持图标 */ });
      });
    }, []);
    // 外部面板模式（ref 模式规避闭包过期）
    const onMentionPanelChangeRef = useRef(onMentionPanelChange);
    onMentionPanelChangeRef.current = onMentionPanelChange;
    const externalMentionPanelRef = useRef(externalMentionPanel);
    externalMentionPanelRef.current = externalMentionPanel;

    // 光标保持在最后
    const keepCursorEnd = useCallback((): Selection | undefined => {
      const curEditor = promptInputRef.current;
      if (window.getSelection && curEditor) {
        curEditor.focus();
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(curEditor);
          sel.collapseToEnd();
        }
        if (sel && sel.rangeCount > 0) return sel;
      }
      return undefined;
    }, []);

    // 删除 @ 内容之前的原始文本
    const removeMentionText = useCallback(
      (editor: HTMLDivElement, atStr: string) => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        for (let i = 0; i < editor.childNodes.length; i++) {
          const curEle = editor.childNodes[i];
          if (!curEle || curEle.nodeName !== '#text') continue;
          const textNode = curEle as Text;
          const nodeValue = textNode.nodeValue || '';
          const toDelete = atStr ? `@${atStr}` : '@';
          const atIdx = nodeValue.lastIndexOf(toDelete);
          if (atIdx !== -1) {
            textNode.deleteData(atIdx, toDelete.length);
            break;
          }
          // 弹窗搜索框独立输入时正文 @ 词可能不一致:兜底删除最后一个 '@' 起始的整段,避免 @ 残留
          const rawAt = nodeValue.lastIndexOf('@');
          if (rawAt !== -1) {
            textNode.deleteData(rawAt, nodeValue.length - rawAt);
            break;
          }
        }
      },
      [],
    );

    // 插入内容
    const insertContent = useCallback(
      (html: string, atStr?: string) => {
        let sel: Selection | null = null;
        let range: Range | null = null;
        const curEditor = promptInputRef.current;
        if (window.getSelection && curEditor) {
          sel = window.getSelection();
          if (sel && sel.rangeCount) range = sel.getRangeAt(0);
          if (!range) {
            range = keepCursorEnd()?.getRangeAt(0) ?? null;
          } else {
            const contentRange = document.createRange();
            contentRange.selectNode(curEditor);
            const compareStart = range?.compareBoundaryPoints(Range.START_TO_START, contentRange);
            const compareEnd = range?.compareBoundaryPoints(Range.END_TO_END, contentRange);
            const compare = compareStart !== -1 && compareEnd !== 1;
            if (!compare) range = keepCursorEnd()?.getRangeAt(0) ?? null;
          }
          if (!range || !sel) return;
          removeMentionText(curEditor, atStr || '');
          const input = range.createContextualFragment(html);
          const lastNode = input.lastChild;
          range.insertNode(input);
          if (lastNode) {
            range = range.cloneRange();
            range.setStartAfter(lastNode);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          const newText = readEditorText(curEditor);
          promptTextRef.current = newText;
          onChangeRef.current(newText);
          onLengthChange?.(newText.length);
        }
      },
      [keepCursorEnd, removeMentionText, onLengthChange],
    );

    /** 通过 @ 选择素材后，插入 badge（item 可直传：外部面板选中的资产不必先进 references） */
    const insertReference = useCallback(
      (refId: string, item?: ReferenceItem) => {
        const target = item ?? referencesRef.current.find((r) => r.id === refId);
        if (!target) return;
        // 先保存当前搜索词再清空:removeMentionText 需要整段删除 "@搜索词",
        // 若清空后传入,只会删 "@" 导致搜索词残留进正文(复现:选完 @ 失焦重开面板出现乱字/空行)
        const searchStr = mentionFilterRef.current;
        hideMentionPanel();
        insertContent(buildBadgeHtml(target), searchStr);
        // 引用只有 storageKey 时补缩略图（buildBadgeHtml 只能同步拿到 url）
        requestAnimationFrame(() => hydrateBadgeThumbs());
      },
      [insertContent, hideMentionPanel, hydrateBadgeThumbs],
    );

    /** 全量同步 contentEditable 内容 */
    const syncDOM = useCallback(
      (
        text: string,
        refs: { id: string; name: string; url?: string; type: string }[],
      ) => {
        const el = promptInputRef.current;
        if (!el) return;
        if (!refs.length) {
          el.innerText = text;
          promptTextRef.current = text;
          onLengthChange?.(text.length);
          return;
        }
        const sorted = [...refs].sort((a, b) => b.name.length - a.name.length);
        let html = text;
        for (const r of sorted) {
          const refItem = referencesRef.current.find((rr) => rr.id === r.id);
          const badgeData = refItem || { ...r, type: 'text' as const };
          const badge = buildBadgeHtml(badgeData);
          html = html.split(`@${r.name}`).join(badge);
        }
        el.innerHTML = html;
        promptTextRef.current = text;
        onLengthChange?.(text.length);
        requestAnimationFrame(() => hydrateBadgeThumbs());
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      },
      [onLengthChange, hydrateBadgeThumbs],
    );

    /** 将指定素材对应的 badge 降级为纯文本 */
    const downgradeReferenceToText = useCallback(
      (target: { id: string; name: string }): string | null => {
        const el = promptInputRef.current;
        if (!el) return null;
        const badges = el.querySelectorAll(`span[data-ref-id="${target.id}"]`);
        badges.forEach((badge) => {
          const textNode = document.createTextNode(`@${target.name} `);
          badge.parentNode?.replaceChild(textNode, badge);
        });
        const newText = readEditorText(el);
        promptTextRef.current = newText;
        onChangeRef.current(newText);
        onLengthChange?.(newText.length);
        return newText;
      },
      [onLengthChange],
    );

    /**
     * 引用失效时**不拆 badge**（2026-11-17 用户要求）：
     * badge 是占位，槽位重新连入同一素材就自动恢复关联；真正发任务时失效引用不参与参考输入，
     * 提示词里留下的 `@名称` 按文本传递（需要时用户可用 IDE 的 `@图片N` 占位写法）。
     */
    const markInvalidReferences = useCallback((validIds: string[]): void => {
      const el = promptInputRef.current;
      if (!el) return;
      const valid = new Set(validIds);
      el.querySelectorAll<HTMLElement>('span[data-ref-id]').forEach((badge) => {
        const id = badge.getAttribute('data-ref-id') || '';
        const invalid = !valid.has(id);
        badge.classList.toggle('ref-pending', invalid);
        badge.style.opacity = invalid ? '0.6' : '';
        badge.style.textDecoration = invalid ? 'line-through' : '';
        if (invalid) badge.title = '该引用当前未关联：重新连入同一素材后自动恢复，直接生成时按 @名称 文本传递';
        else if (badge.title) badge.removeAttribute('title');
      });
    }, []);

    /** 提取输入框纯文本 */
    const getPlainText = useCallback((): string | null => {
      const el = promptInputRef.current;
      if (!el) return null;
      let text = '';
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const span = node as HTMLSpanElement;
          const refId = span.getAttribute('data-ref-id');
          if (refId) {
            // badge span,递归收集文本(排除删除按钮 SVG/伪元素,保留 "@名称")
            const walkBadge = (n: Node) => {
              if (n.nodeType === Node.TEXT_NODE) {
                text += n.textContent;
              } else if (n.nodeType === Node.ELEMENT_NODE) {
                const el = n as HTMLElement;
                if (el.classList && el.classList.contains('badge-delete')) return;
                n.childNodes.forEach(walkBadge);
              }
            };
            span.childNodes.forEach(walkBadge);
          } else {
            node.childNodes.forEach(walk);
          }
        }
      };
      el.childNodes.forEach(walk);
      return text.trim();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        insertReference,
        syncDOM,
        downgradeReferenceToText,
        markInvalidReferences,
        getPlainText,
        closeMentionPanel: hideMentionPanel,
      }),
      [insertReference, syncDOM, downgradeReferenceToText, markInvalidReferences, getPlainText, hideMentionPanel],
    );

    // 初始化内容
    useEffect(() => {
      if (promptTextRef.current !== value && !readOnly) {
        const el = promptInputRef.current;
        if (el) {
          el.innerText = value;
          promptTextRef.current = value;
        }
      }
    }, [value, readOnly]);

    // 挂载 / references 就绪后恢复 badge:重开面板时 value 仅以纯文本形态写入,
    // 需将文本中匹配到的 @name 重建为 badge,避免"下次点开回退成普通文本"。
    // 仅重建尚未以 badge(span[data-ref-id]) 存在的引用,编辑中 references 变化不干扰既有 badge。
    useEffect(() => {
      const el = promptInputRef.current;
      if (!el || readOnly) return;
      if (!references.length) return;
      const plain = readEditorText(el);
      if (!plain.includes('@')) return;
      const missing = references.filter(
        (r) =>
          plain.includes(`@${r.name}`) &&
          !el.querySelector(`span[data-ref-id="${r.id}"]`),
      );
      if (!missing.length) return;
      syncDOM(
        plain,
        missing.map((r) => ({ id: r.id, name: r.name, url: r.url, type: r.type })),
      );
    }, [references, readOnly, syncDOM]);

    // references 就绪后补齐已存在的 badge 缩略图（重开面板时 url 可能尚未解析）
    useEffect(() => {
      if (readOnly) return;
      const t = setTimeout(() => hydrateBadgeThumbs(), 0);
      return () => clearTimeout(t);
    }, [references, readOnly, hydrateBadgeThumbs]);

    // ref 缓存
    const ceStateRef = useRef({
      references,
      setPrompt: onChange,
      setMentionFilter,
    });
    ceStateRef.current = {
      references,
      setPrompt: onChange,
      setMentionFilter,
    };

    const handleBadgeClick = useCallback((e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const deleteBtn = target.closest('.badge-delete');
      if (deleteBtn) {
        const badge = deleteBtn.closest('[data-ref-id]');
        if (badge) {
          badge.remove();
          const el = promptInputRef.current;
          if (el) {
            const newText = readEditorText(el);
            promptTextRef.current = newText;
            onChangeRef.current(newText);
            onLengthChange?.(newText.length);
          }
        }
      }
    }, [onLengthChange]);

    // contentEditable JSX
    const contentEditableEl = useMemo(
      () => (
        <div
          ref={promptInputRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onClick={handleBadgeClick}
          onMouseOver={handleBadgeHover}
          onMouseLeave={() => setBadgePreview(null)}
          onInput={(e: React.FormEvent<HTMLDivElement>) => {
            if (readOnly) return;
            const inputE = e.nativeEvent as InputEvent;
            const inputEle = e.target as HTMLDivElement;
            const s = ceStateRef.current;
            const text = readEditorText(inputEle);
            if (text !== promptTextRef.current) {
              promptTextRef.current = text;
              s.setPrompt(text);
              onLengthChange?.(text.length);
            }
            if (s.references.length === 0) {
              if (mentionOpenRef.current) hideMentionPanel();
              return;
            }
            if (inputE.data !== null && !inputE.data.trim()) {
              if (mentionOpenRef.current) hideMentionPanel();
              return;
            }
            let searchStr = '';
            let range: Range | null = null;
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              range = sel.getRangeAt(0);
            }
            for (let i = 0; i < inputEle.childNodes.length; i++) {
              const curEle = inputEle.childNodes[i];
              if (!curEle || curEle.nodeName !== '#text' || !(curEle as Text).nodeValue?.includes('@')) continue;
              const textNode = curEle as Text;
              const nodeValue = textNode.nodeValue;
              if (!nodeValue?.includes('@')) continue;
              const endOffset =
                range && curEle.contains(range.commonAncestorContainer)
                  ? range.endOffset
                  : textNode.length;
              const splitArr = nodeValue.substring(0, endOffset).split('@');
              searchStr = splitArr[splitArr.length - 1] ?? '';
            }
            if (searchStr !== mentionFilterRef.current) {
              mentionFilterRef.current = searchStr;
              s.setMentionFilter(searchStr);
            }
            if (inputE.inputType === 'insertText' || inputE.inputType === 'insertCompositionText') {
              if (inputE.data === '@') {
                if (!mentionOpenRef.current) {
                  mentionOpenRef.current = true;
                  showMentionPopup();
                }
              } else {
                const filtered = s.references.filter((r) =>
                  r.name.toLowerCase().includes(searchStr.toLowerCase()),
                );
                const shouldOpen = !!searchStr && filtered.length > 0;
                if (shouldOpen !== mentionOpenRef.current) {
                  if (shouldOpen) showMentionPopup();
                  else hideMentionPanel();
                }
              }
            } else if (inputE.inputType === 'deleteContentBackward') {
              if (range) {
                const previousNode = range.startContainer.childNodes[range.startOffset - 1];
                if (previousNode && previousNode.nodeType === Node.ELEMENT_NODE) {
                  const prevEl = previousNode as HTMLElement;
                  if (prevEl.hasAttribute('data-ref-id')) {
                    prevEl.remove();
                    const newText = readEditorText(inputEle);
                    promptTextRef.current = newText;
                    s.setPrompt(newText);
                    onLengthChange?.(newText.length);
                    return;
                  }
                }
              }
              const filtered = s.references.filter((r) =>
                r.name.toLowerCase().includes(searchStr.toLowerCase()),
              );
              const shouldOpen = !!searchStr && filtered.length > 0;
              if (shouldOpen !== mentionOpenRef.current) {
                if (shouldOpen) showMentionPopup(); else hideMentionPanel();
              }
            }
          }}
          onPaste={(e: React.ClipboardEvent<HTMLDivElement>) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            if (text) {
              document.execCommand('insertText', false, text);
            }
          }}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: fontSize,
            lineHeight: lh,
            padding: 0,
            color: textColor,
            fontFamily: 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            minHeight: minHeight,
            maxHeight: maxHeight,
            overflowY: maxHeight ? 'auto' : undefined,
            width: '100%',
            cursor: readOnly ? 'default' : 'text',
          }}
        />
      ),
      [readOnly, fontSize, lh, textColor, minHeight, maxHeight, handleBadgeClick, handleBadgeHover],
    );

    // 主题亮度判定(textColor 深 → 浅色主题 → 弹窗实心白;反之深色实心)
    // 宿主传入 popupBackground/popupBorderColor 时优先使用(暗色主题下 textColor 是亮色,
    // 亮度推断会误判为浅色主题导致白色弹窗,必须由宿主传真实主题色)
    const isLightTheme = useMemo(() => {
      const m = String(textColor).match(/^#?([0-9a-f]{6})$/i);
      if (!m) return true;
      const n = parseInt(m[1]!, 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return (r * 299 + g * 587 + b * 114) / 1000 > 140;
    }, [textColor]);
    const mentionBg = popupBackground ?? (isLightTheme ? '#ffffff' : '#26262b');
    const mentionBorder = popupBorderColor ?? (isLightTheme ? '#e2e2e7' : 'rgba(255,255,255,0.14)');

    const filteredMentions = useMemo(() => {
      if (maxLength && value.length >= maxLength) return [];
      return references.filter((r) =>
        (!mentionTypeFilter || mentionTypeFilter(r)) &&
        r.name.toLowerCase().includes(mentionFilter.toLowerCase()),
      );
    }, [references, mentionTypeFilter, mentionFilter, value.length, maxLength]);

    // 过滤词变化时重置键盘选中索引
    useEffect(() => {
      setSelectedIndex(0);
    }, [mentionFilter]);

    // 键盘导航(@ 弹窗打开时):上下选择、Enter 确认、Esc 关闭(与 Agent MentionPopover 一致)
    // 外部面板模式下不抢键盘(面板有自己的搜索输入),仅保留 Esc 关闭
    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (!mentionOpenRef.current) return;
        if (externalMentionPanelRef.current) {
          if (e.key === 'Escape') hideMentionPanel();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredMentions.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && filteredMentions[selectedIndex]) {
          e.preventDefault();
          insertReference(filteredMentions[selectedIndex]!.id);
        } else if (e.key === 'Escape') {
          hideMentionPanel();
        }
      };
      document.addEventListener('keydown', handleKey);
      return () => document.removeEventListener('keydown', handleKey);
    }, [filteredMentions, selectedIndex, insertReference, hideMentionPanel]);

    // 点击 @ 弹窗/输入框之外关闭
    useEffect(() => {
      const handleClick = (e: MouseEvent) => {
        if (!mentionOpenRef.current) return;
        const popup = mentionPopupRef.current;
        const editor = promptInputRef.current;
        if (!popup || !editor) return;
        if (!popup.contains(e.target as Node) && !editor.contains(e.target as Node)) {
          hideMentionPanel();
        }
      };
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }, [hideMentionPanel]);

    // 弹窗行配色(中性表面,与 Agent MentionPopover 的 surface-2 观感一致)
    const rowHoverBg = isLightTheme ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.08)';
    const thumbFallbackBg = isLightTheme ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.05)';

    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
        }}
      >
        {/* contentEditable placeholder */}
        {!readOnly && !value && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              color: '#999',
              fontSize: fontSize,
              lineHeight: lh,
              fontFamily: 'inherit',
              pointerEvents: 'none',
              userSelect: 'none',
              display: 'block',
            }}
          >
            {placeholder || '输入提示词... (输入 @ 引用素材)'}
          </div>
        )}
        {contentEditableEl}

        {/* @ 提及弹出菜单 — Agent MentionPopover 同款(2026-08-25 用户拍板):投影无边框 + 搜索头 + 两行列表行
            外部面板模式(externalMentionPanel)不渲染:宿主用分镜同款选择面板接管 */}
        {!readOnly && references.length > 0 && !externalMentionPanel && createPortal(
          <div
            ref={mentionPopupRef}
            style={{
              display: 'none',
              flexDirection: 'column',
              // 2026-11-11：portal + fixed + 高层级，避免被 dock / 画布节点/组按层叠上下文盖住（用户反馈 z-index 错）
              position: 'fixed',
              left: 0,
              bottom: 0,
              width: 240,
              background: mentionBg,
              borderRadius: 12,
              boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
              maxHeight: 280,
              overflow: 'hidden',
              zIndex: 4000,
              marginBottom: 6,
              color: textColor,
            }}
          >
            {/* 搜索头(真实输入框:初始同步 @ 后关键词,之后以框内输入为准) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: thumbFallbackBg }}>
              <Search size={13} style={{ color: textColor, opacity: 0.6, flexShrink: 0 }} />
              <input
                type="text"
                value={mentionFilter}
                onChange={(e) => {
                  mentionFilterRef.current = e.target.value;
                  setMentionFilter(e.target.value);
                }}
                placeholder="搜索素材…"
                style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: textColor, fontFamily: 'inherit' }}
              />
            </div>
            {/* 列表:缩略图(有图/类型图标回退) + 名称/类型两行布局 */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {filteredMentions.length === 0 ? (
                <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: `${textColor}99` }}>
                  未找到素材
                </div>
              ) : (
                filteredMentions.map((refItem, i) => (
                  <button
                    key={refItem.id}
                    type="button"
                    onClick={() => insertReference(refItem.id)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: i === selectedIndex ? rowHoverBg : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      transition: 'background 0.1s',
                    }}
                  >
                    {refItem.url && (refItem.type === 'image' || refItem.type === 'video') ? (
                      <img
                        src={refItem.url}
                        alt={refItem.name}
                        draggable={false}
                        style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: `1px solid ${mentionBorder}` }}
                      />
                    ) : (
                      <span style={{ width: 22, height: 22, borderRadius: 6, background: thumbFallbackBg, border: `1px solid ${mentionBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textColor, flexShrink: 0 }}>
                        <svg
                          viewBox="0 0 24 24"
                          width={12}
                          height={12}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ opacity: 0.8 }}
                          dangerouslySetInnerHTML={{ __html: REF_TYPE_ICON_PATH[refItem.type] ?? REF_TYPE_ICON_PATH.text! }}
                        />
                      </span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {refItem.name}
                      </div>
                      <div style={{ fontSize: 10, color: `${textColor}99` }}>
                        {REF_TYPE_LABEL[refItem.type] ?? '素材'}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}

        {/* @ 块悬停大图预览：与导演台编辑器同款（fixed + portal，不参与 contentEditable 布局） */}
        {badgePreview && createPortal(
          <div
            data-badge-preview
            style={{
              position: 'fixed',
              left: Math.max(8, badgePreview.x - 92),
              top: Math.max(8, badgePreview.y - 178),
              zIndex: 4000,
              padding: 6,
              borderRadius: 8,
              background: mentionBg,
              border: `1px solid ${mentionBorder}`,
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              color: textColor,
            }}
          >
            <img
              src={badgePreview.url}
              alt={badgePreview.title}
              draggable={false}
              style={{ width: 184, height: 120, borderRadius: 6, objectFit: 'contain', background: thumbFallbackBg }}
            />
            <div style={{ fontSize: 11, maxWidth: 184, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {badgePreview.title}
            </div>
          </div>,
          document.body,
        )}
      </div>
    );
  },
);

export default GeneratorPromptEditor;
