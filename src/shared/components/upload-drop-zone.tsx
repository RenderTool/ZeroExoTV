/**
 * UploadDropZone - 全站统一「拖拽上传落区」（2026-11-05 用户定稿）
 *
 * 三处共用（同一组件、同一 data 属性、同一视觉 token）：
 * 1) 首页 / 我的资产库列表（asset-library-page.tsx）
 * 2) 画布素材抽屉（canvas-assets/groups/MaterialGroup.tsx）
 * 3) 素材面板 @ 面板导入区（asset-picker/components/asset-picker.tsx）
 * 禁止各页再各写一份虚线框/高亮样式。
 *
 * 行为：只接管「外部文件」拖拽（dataTransfer 含 Files）；站内卡片拖拽
 * （x-testlib-item / x-canvas-asset 等自定义 MIME）不拦截、不冒泡上传，
 * 画布节点/卡片手势不受影响。上传动作由调用方传入（与导入按钮同一函数）。
 *
 * 视觉 token：theme.toolbar.accent / border / textMuted（与软件现有设计语言一致）。
 */

import { useRef, useState } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import { UploadCloud } from 'lucide-react';

export interface UploadDropZoneProps {
  /** 接收到的文件（与「点击导入」同一 CAS 上传链） */
  onFiles: (files: FileList) => void;
  children?: React.ReactNode;
  /** 允许的文件后缀/类型（如 'image/*' / '.txt'）；留空 = 全部放行 */
  accept?: string[];
  /** 不支持格式的可读原因（不传则用落区内联错误条） */
  onReject?: (message: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  theme?: ThemeConfig;
  /** overlay=有内容时叠加高亮（抽屉/列表）；tile=本身就是虚线落区（@ 面板导入） */
  variant?: 'overlay' | 'tile';
}

function fileAccepted(file: File, accept: string[]): boolean {
  if (accept.length === 0) return true;
  const name = file.name.toLowerCase();
  return accept.some((rule) => {
    const r = rule.toLowerCase();
    if (r.endsWith('/*')) return file.type.toLowerCase().startsWith(r.slice(0, -1));
    if (r.startsWith('.')) return name.endsWith(r);
    return file.type.toLowerCase() === r;
  });
}

export function UploadDropZone({
  onFiles, children, accept = [], onReject, disabled, style, theme, variant = 'overlay',
}: UploadDropZoneProps): React.ReactElement {
  const depth = useRef(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');

  const accent = theme?.toolbar?.accent ?? 'var(--zeroexo-accent, #1677ff)';
  const border = theme?.toolbar?.border ?? 'rgba(127,127,127,0.35)';

  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const reject = (names: string[]): void => {
    const msg = `不支持的格式：${names.slice(0, 3).join('、')}${names.length > 3 ? ` 等 ${names.length} 个文件` : ''}`;
    if (onReject) onReject(msg);
    else {
      setError(msg);
      window.setTimeout(() => setError(''), 3000);
    }
  };

  const handleDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return; // 站内卡片拖拽：放行给原有逻辑
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setActive(false);
    if (disabled) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const bad = all.filter((f) => !fileAccepted(f, accept));
    if (bad.length > 0) reject(bad.map((f) => f.name));
    if (bad.length === all.length) return;
    setError('');
    onFiles(files);
  };

  return (
    <div
      data-upload-dropzone=""
      data-upload-dropzone-active={active || undefined}
      data-upload-dropzone-variant={variant}
      style={{
        position: 'relative',
        ...(variant === 'tile'
          ? {
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 8, minHeight: 88, padding: '14px 16px',
              borderRadius: 10, border: `1.5px dashed ${active ? accent : border}`,
            }
          : null),
        ...style,
      }}
      onDragEnter={(e) => {
        if (!hasFiles(e) || disabled) return;
        e.preventDefault();
        depth.current += 1;
        setActive(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e) || disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={handleDrop}
    >
      {children}

      {/*
        拖拽高亮落区（2026-11-05 样式改进）：
        旧样式 = 2px 大虚线红框 + 居中大图标 + 三行文案，盖在卡片上像报错，且硬编码了蓝色。
        现设：整区淡染（accent + opacity，跟随任意主题强调色）+ 1px 内描边（单独一层控透明度，
        兼容 accent 为 hex / var 两种写法）+ 中心单行胶囊提示；不再讲“支持多文件”这类冗余提示。
      */}
      {active && (
        <div
          data-upload-dropzone-overlay=""
          style={{
            position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 12, overflow: 'hidden', backdropFilter: 'blur(1.5px)',
            animation: 'zeroexo-dropzone-in 0.16s ease-out',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, background: accent, opacity: 0.07 }} />
          <div style={{ position: 'absolute', inset: 0, border: `1px solid ${accent}`, opacity: 0.4 }} />
          <div style={{
            position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '6px 12px', borderRadius: 999,
            background: 'rgba(0,0,0,0.62)', color: '#fff',
            fontSize: 12.5, fontWeight: 500, letterSpacing: 0.2,
            boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
          }}>
            <UploadCloud size={14} />
            松开即可上传
          </div>
        </div>
      )}

      {error && (
        <div
          data-upload-dropzone-error=""
          style={{
            position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 21,
            padding: '8px 10px', borderRadius: 8, fontSize: 12,
            color: '#fff', background: 'rgba(200,40,40,0.9)',
          }}
        >
          {error}
        </div>
      )}

      {/* 共享样式占位：描边 token + 淡入动画（非拖拽态也保持设计一致性） */}
      <style>{`[data-upload-dropzone]{--zeroexo-drop-border:${border};--zeroexo-drop-accent:${accent};}@keyframes zeroexo-dropzone-in{from{opacity:0;transform:scale(0.995)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
