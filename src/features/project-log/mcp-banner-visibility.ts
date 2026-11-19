/**
 * MCP 工作浮层开关（2026-11-19 用户指令）：
 * 浮层不再是无处可关的常驻挂件——开关统一挂在「任务队列」标题旁，
 * 这里只存一个可见性事实源（localStorage + 同页订阅），浮层与开关都读它。
 */
import { useEffect, useState } from 'react';

const KEY = 'zeroexo.mcp-banner.visible';
const EVENT = 'zeroexo:mcp-banner-visibility';

export function readMcpBannerVisible(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function writeMcpBannerVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(KEY, visible ? '1' : '0');
  } catch { /* 隐私模式忽略 */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: visible }));
}

export function useMcpBannerVisible(): [boolean, (v: boolean) => void] {
  const [visible, setVisible] = useState<boolean>(readMcpBannerVisible);
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setVisible(typeof detail === 'boolean' ? detail : readMcpBannerVisible());
    };
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setVisible(readMcpBannerVisible()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return [visible, (v: boolean) => { writeMcpBannerVisible(v); setVisible(v); }];
}
