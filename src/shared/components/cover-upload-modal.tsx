/**
 * CoverUploadModal - 项目封面上传弹窗
 *
 * 参考: references/动效参考/封面.jsx
 * - 支持 JPG/PNG; 超过 5MB 不拒绝 —— 自动压缩(缩边 3840 + JPEG 质量阶梯,目标 ≤3MB)并可见反馈
 * - 入场动画: scale(0.96) → scale(1) bouncy 曲线
 * - 取景(2026-11-04 改向): 预览区 = 固定 16:9 取景视口(CoverViewportEditor),比例不可改,
 *   用户只平移/缩放;「保存封面」时按可视区真裁剪出 1920×1080 写入封面存储,
 *   取景参数 { sourceKey, scale, tx, ty } 存 platform/cover.ts 侧车供再次打开回填;
 *   旧封面无记录 → 居中铺满,不报错;
 *   原图(sourceKey)缺失 → 回退当前封面当底图并提示「原图不可用」,不白屏不死错。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, X } from 'lucide-react';
import { Modal, Button, App } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { uploadImage } from '@zeroexo/plugin-persistence';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { useAuthImageUrl } from '@/shared/hooks/use-auth-image.js';
import {
  DEFAULT_VIEW,
  cropToCoverFile,
  isDefaultView,
  type CoverView,
  type CoverViewRecord,
} from '@/shared/utils/cover-viewport.js';
import { getCoverView } from '@/platform/cover.js';
import { compressForCover } from '@/shared/utils/image-compress.js';
import { CoverViewportEditor } from '@/shared/components/cover-viewport-editor.js';

export interface CoverUploadModalProps {
  open: boolean;
  onCancel: () => void;
  /** 确认: file = 裁剪好的 16:9 封面图; view = 取景记录(含原图 sourceKey,供再次调整回填) */
  onConfirm: (file: File, view?: CoverViewRecord) => void;
  initialCover?: string;
}

export function CoverUploadModal({
  open,
  onCancel,
  onConfirm,
  initialCover,
}: CoverUploadModalProps): React.ReactElement {
  const { theme } = useTheme();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => initialCover ? (getResourceUrl(initialCover, 'full') ?? initialCover) : null);
  /** 当前取景(受控) */
  const [view, setView] = useState<CoverView>(DEFAULT_VIEW);
  /** 再次调整时的原图 key(无记录 = 封面本身即原图) */
  const sourceKeyRef = useRef<string | null>(null);
  /** 本次会话是否动过取景;未动过且无新图则不写盘 */
  const viewTouchedRef = useRef(false);
  /** 已加载的原图元素(取景渲染 + 确认裁剪共用) */
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** 大图自动压缩处理中(不卡 UI,给可见状态) */
  const [compressing, setCompressing] = useState(false);
  /** 原图缺失兜底只回退一次(防循环) */
  const fallbackDoneRef = useRef(false);
  // 后端私有封面不拼接 token,经 useAuthImageUrl 认证(fetch + Authorization header → blob URL)
  const authPreviewUrl = useAuthImageUrl(previewUrl ?? undefined);

  /** 将 storageKey 转成可显示 URL(不拼接 token) */
  const resolveCover = useCallback((key: string | null | undefined): string | null => {
    if (!key) return null;
    return getResourceUrl(key, 'full') ?? key;
  }, []);

  // 打开弹窗: 回填上次取景记录 —— 预览图换成原图(sourceKey),取景回填 scale/tx/ty;
  // 旧封面无记录 → 封面即原图,居中铺满
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setView(DEFAULT_VIEW);
    viewTouchedRef.current = false;
    fallbackDoneRef.current = false;
    void getCoverView(initialCover).then((saved) => {
      if (!alive) return;
      if (saved) {
        sourceKeyRef.current = saved.sourceKey;
        setView({ scale: saved.scale, tx: saved.tx, ty: saved.ty });
        setPreviewUrl(resolveCover(saved.sourceKey));
      } else {
        sourceKeyRef.current = initialCover ?? null;
        setPreviewUrl(resolveCover(initialCover));
      }
    });
    return () => { alive = false; };
  }, [open, initialCover, resolveCover]);

  // 加载原图元素(取 naturalWidth/Height 供取景几何;确认时供 canvas 裁剪)
  // 原图(sourceKey)缺失/损坏 → 回退当前封面当底图并提示,不白屏不死错(只回退一次)
  const editorSrc = authPreviewUrl ?? previewUrl;
  useEffect(() => {
    if (!editorSrc) { setImgEl(null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgEl(img); };
    img.onerror = () => {
      if (!alive) return;
      setImgEl(null);
      const src = sourceKeyRef.current;
      if (!fallbackDoneRef.current && src && initialCover && src !== initialCover) {
        fallbackDoneRef.current = true;
        sourceKeyRef.current = initialCover;
        setView(DEFAULT_VIEW);
        setPreviewUrl(resolveCover(initialCover));
        message.warning(t('coverUpload.sourceMissing'));
      }
    };
    img.src = editorSrc;
    return () => { alive = false; };
  }, [editorSrc, initialCover, resolveCover, message, t]);

  // 弹窗关闭时清理 blob URL，避免内存泄漏
  useEffect(() => {
    if (!open) {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(resolveCover(initialCover));
      fileRef.current = null;
      sourceKeyRef.current = null;
      setView(DEFAULT_VIEW);
      viewTouchedRef.current = false;
      fallbackDoneRef.current = false;
      setConfirming(false);
      setCompressing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCover]);

  const triggerUpload = useCallback(() => {
    if (compressing) return; // 压缩处理中不响应重复点击
    fileInputRef.current?.click();
  }, [compressing]);

  /** 超过 5MB 不拒绝 —— 自动压缩(缩边 + 质量阶梯),压缩完成才进取景(视口用压缩后的源) */
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!raw) return;

    if (!['image/jpeg', 'image/png'].includes(raw.type)) {
      message.error(t('coverUpload.unsupportedFormat'));
      return;
    }

    setCompressing(true);
    void (async () => {
      try {
        const { file, info } = await compressForCover(raw);
        // 可见反馈: 发生了重编码/缩边就明确告知,不静默
        if (info.outBytes !== info.origBytes || info.outW !== info.origW || info.outH !== info.origH) {
          message.success(t('coverUpload.compressedInfo', {
            from: `${(info.origBytes / 1048576).toFixed(1)} MB`,
            to: `${(info.outBytes / 1048576).toFixed(1)} MB`,
            fromDim: `${info.origW}×${info.origH}`,
            toDim: `${info.outW}×${info.outH}`,
          }));
          if (info.convertedToJpeg) {
            message.warning(t('coverUpload.compressedPngToJpeg'));
          }
        }
        fileRef.current = file;
        // 换了新图 → 原图待定(确认时上传入库),取景回居中铺满
        sourceKeyRef.current = null;
        fallbackDoneRef.current = true; // 本地新图不存在"原图缺失"
        setView(DEFAULT_VIEW);
        viewTouchedRef.current = false;
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      } catch (err) {
        console.error('[cover] compress failed:', err);
        message.error(t('coverUpload.compressFailed'));
      } finally {
        setCompressing(false);
      }
    })();
  }, [message, t]);

  const removeCover = useCallback(() => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    fileRef.current = null;
    setPreviewUrl(null);
    setView(DEFAULT_VIEW);
  }, [previewUrl]);

  /** 取景变更(拖拽/滚轮/滑块提交) */
  const handleViewChange = useCallback((v: CoverView) => {
    viewTouchedRef.current = true;
    setView(v);
  }, []);

  /** 重置为居中铺满 */
  const resetView = useCallback(() => {
    viewTouchedRef.current = true;
    setView(DEFAULT_VIEW);
  }, []);

  const handleConfirm = useCallback(async () => {
    // 未做任何变更: 有旧封面直接关窗,否则提示上传
    if (!fileRef.current && !viewTouchedRef.current) {
      if (initialCover) { onCancel(); return; }
      message.error(t('coverUpload.pleaseUpload'));
      return;
    }
    if (!imgEl) {
      message.error(t('coverUpload.pleaseUpload'));
      return;
    }
    setConfirming(true);
    try {
      // 1) 新上传的图: 先把原图入库拿 sourceKey(供再次调整);沿用旧封面则复用既有 sourceKey
      let sourceKey = sourceKeyRef.current;
      if (fileRef.current) {
        const uploaded = await uploadImage(fileRef.current);
        sourceKey = uploaded.storageKey;
      }
      if (!sourceKey) throw new Error('missing sourceKey');
      // 2) 按可视区真裁剪出 1920×1080
      const cropped = await cropToCoverFile(imgEl, imgEl.naturalWidth, imgEl.naturalHeight, view);
      // 3) 透出: 页面写封面存储,并按新 key 存取景记录(裁剪失败则上方已抛错,原封面不动)
      onConfirm(cropped, { sourceKey, ...view });
    } catch (err) {
      console.error('[cover] crop failed:', err);
      message.error(t('coverUpload.cropFailed'));
    } finally {
      setConfirming(false);
    }
  }, [imgEl, view, initialCover, onConfirm, onCancel, message, t]);

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      centered
      destroyOnHidden
      width={720}
      title={
        <span style={{ fontWeight: 600, fontSize: 16, color: theme.toolbar.text }}>
          {t('coverUpload.title')}
        </span>
      }
      footer={[
        <Button
          key="cancel"
          onClick={onCancel}
          style={{
            background: 'transparent',
            borderColor: theme.toolbar.border,
            color: theme.toolbar.text,
          }}
        >
          {t('common.cancel')}
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={confirming}
          onClick={handleConfirm}
          disabled={!previewUrl || compressing}
          style={{
            background: theme.toolbar.accent,
            borderColor: theme.toolbar.accent,
            color: '#ffffff',
          }}
        >
          {t('coverUpload.saveCover')}
        </Button>,
      ]}
      styles={{
        body: { padding: 0 },
        mask: { background: 'transparent' },
        container: {
          background: theme.canvas.background,
          border: `1px solid ${theme.toolbar.border}`,
          borderRadius: 12,
          boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.4)' : '0 8px 32px rgba(0,0,0,0.12)',
        } as CSSProperties,
        header: {
          marginBottom: 0,
          padding: '16px 20px',
          borderBottom: `1px solid ${theme.toolbar.border}`,
        },
        footer: {
          padding: '12px 20px',
          borderTop: `1px solid ${theme.toolbar.border}`,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12,
        },
      }}
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 上传交互区 */}
        <div
          onClick={triggerUpload}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            border: `2px dashed ${previewUrl ? theme.toolbar.border : theme.toolbar.accent}`,
            borderRadius: 12,
            cursor: 'pointer',
            background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            transition: 'border-color 0.2s',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Upload size={20} style={{ marginBottom: 8, color: theme.toolbar.textMuted }} />
          <p style={{ fontSize: 13, fontWeight: 500, color: theme.toolbar.text, margin: 0 }}>
            {t('coverUpload.dragHint')}
          </p>
          <p style={{ fontSize: 12, marginTop: 4, color: theme.toolbar.textMuted, margin: '4px 0 0' }}>
            {t('coverUpload.formatHint')}
          </p>
          <p style={{ fontSize: 11, marginTop: 2, color: theme.toolbar.textMuted, opacity: 0.6, margin: '2px 0 0' }}>
            {compressing ? t('coverUpload.compressingHint') : t('coverUpload.compressHint')}
          </p>
        </div>

        {/* 取景预览区: 固定 16:9 视口,所见即所得 */}
        {previewUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              {imgEl && editorSrc && (
                <CoverViewportEditor
                  src={editorSrc}
                  imgW={imgEl.naturalWidth}
                  imgH={imgEl.naturalHeight}
                  view={view}
                  onViewChange={handleViewChange}
                  borderColor={theme.toolbar.border}
                />
              )}
              <button
                type="button"
                onClick={removeCover}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 32,
                  height: 32,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.4)',
                  color: '#fff',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  zIndex: 2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
                aria-label={t('coverUpload.removeCover')}
              >
                <X size={16} />
              </button>
            </div>
            {/* 取景操作行 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button size="small" onClick={resetView} disabled={isDefaultView(view)}>
                {t('coverUpload.resetView')}
              </Button>
              <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
                {t('coverUpload.viewHint')}
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
