/**
 * 拖拽光标 CSS 注入(模块级单次)
 *
 * [data-canvas-dragging] 和 [data-canvas-space] 属性选择器优先级高于 React 内联样式,
 * 保证平移/拖拽期间光标一致为 grab/grabbing。
 */

/** 标记是否已注入 cursor CSS(模块级,只注入一次) */
let cursorStylesInjected = false;

/** 注入拖拽光标 CSS: [data-canvas-dragging] 和 [data-canvas-space] 优先级高于 React 内联样式 */
export function ensureCursorStyles(): void {
  if (cursorStylesInjected) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-zeroexo-interaction-cursor', '');
  style.textContent = `
    [data-canvas-viewport][data-canvas-dragging="pan"] { cursor: grabbing !important; }
    [data-canvas-viewport][data-canvas-dragging="node"] { cursor: grabbing !important; }
    [data-canvas-viewport][data-canvas-space="true"] { cursor: grab !important; }
    /* 连线拖拽期间:全局十字 cursor */
    [data-canvas-viewport][data-connection-pending="true"] { cursor: crosshair !important; }
    /* 源 pin 正在连线:优雅微光(不改变 pin 本身尺寸,仅外发光) */
    [data-pin-dot][data-pin-connecting="true"] {
      box-shadow: 0 0 6px 1px currentColor;
      transition: box-shadow 0.2s ease;
    }
    /* 目标 snap pin:脉冲光环(细发光,不粗边框) */
    [data-pin-dot][data-pin-snap="true"] {
      box-shadow: 0 0 8px 2px currentColor, 0 0 20px 4px rgba(233,69,96,0.3);
      animation: pinSnapSubtle 0.8s ease-in-out infinite alternate;
    }
    @keyframes pinSnapSubtle {
      from { box-shadow: 0 0 6px 1px currentColor, 0 0 14px 3px rgba(233,69,96,0.2); }
      to   { box-shadow: 0 0 10px 3px currentColor, 0 0 24px 5px rgba(233,69,96,0.35); }
    }
  `;
  document.head.appendChild(style);
  cursorStylesInjected = true;
}
