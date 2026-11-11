/**
 * subject-media-preview - 主体状态媒体缩略（主体库页面化 2026-11-05）
 *
 * 取图统一走既有 storageKey 解析链：getResourceUrl(key,'preview') → usePreviewImage(key, fallback)。
 * 取不到时给可读原因（引用已失效 / 媒体无法显示 / 待补媒体），不留空白。
 * 只读展示，不承担任何写入。
 */
import { useEffect, useState } from 'react';
import { AudioLines, Image as ImageIcon } from 'lucide-react';
import { usePreviewImage } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { hasCasEntry, isCasStorageKey, parseCasStorageKey } from '@/entities/cas-store.js';

/** CAS 引用存活探测（只对 CAS 键；其它历史键默认存活，解析失败由 usePreviewImage 兜底） */
export function useSubjectMediaAlive(storageKey?: string): boolean {
  const [alive, setAlive] = useState(true);
  useEffect(() => {
    if (!storageKey || !isCasStorageKey(storageKey)) { setAlive(true); return; }
    let cancelled = false;
    void (async () => {
      try {
        const parsed = parseCasStorageKey(storageKey);
        if (!parsed) { if (!cancelled) setAlive(true); return; }
        const ok = await hasCasEntry(parsed.hash);
        if (!cancelled) setAlive(ok);
      } catch { /* 探测失败按存活处理 */ }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);
  return alive;
}

export interface SubjectMediaThumbProps {
  storageKey?: string | null;
  kind?: 'image' | 'audio' | 'video';
  dark: boolean;
  size?: number;
  /** 铺满父容器（16:9 封面用；不外露圆角，由父级裁切） */
  fill?: boolean;
  /** 图片适配：contain=显示完整图（主体/状态卡），cover=裁切铺满 */
  fit?: 'cover' | 'contain';
  /** 音频/无图占位文案（如「待补媒体」） */
  emptyLabel?: string;
  /**
   * 图片解码完成回调（2026-11-05 与资产卡同一瀑布流规则）：
   * 宿主据此学到真实宽高比，把封面高度从 1:1 占位平滑过渡到真实比例（只过渡一次）。
   */
  onLoaded?: (width: number, height: number) => void;
}

export function SubjectMediaThumb({
  storageKey, kind = 'image', dark, size = 84, fill = false, fit = 'cover', emptyLabel = '待补媒体', onLoaded,
}: SubjectMediaThumbProps): React.ReactElement {
  const alive = useSubjectMediaAlive(storageKey ?? undefined);
  const fallback = storageKey ? (getResourceUrl(storageKey, 'preview') ?? '') : '';
  const hydrated = usePreviewImage(storageKey ?? '', fallback);
  const box: React.CSSProperties = {
    width: fill ? '100%' : size, height: fill ? '100%' : size, borderRadius: fill ? 0 : 8, flexShrink: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
    background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)',
    fontSize: fill ? 11 : 9, textAlign: 'center', padding: fill ? 8 : 4, overflow: 'hidden',
  };
  if (storageKey && kind !== 'audio' && hydrated) {
    // fill=true 由父级 16:9 裁切容器决定尺寸；fill=false 必须尊重 size（状态编辑页素材位 96×96）
    return (
      <img
        data-subject-media-thumb
        data-media-key={storageKey}
        src={hydrated}
        alt=""
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget;
          onLoaded?.(el.naturalWidth, el.naturalHeight);
        }}
        style={{
          width: fill ? '100%' : size,
          height: fill ? '100%' : size,
          borderRadius: fill ? 0 : 8,
          objectFit: fit,
          display: 'block',
          flexShrink: 0,
        }}
      />
    );
  }
  if (storageKey && kind === 'audio') {
    return (
      <div data-subject-media-thumb data-media-kind="audio" style={box} title={alive ? undefined : '引用已失效'}>
        <AudioLines size={size > 60 ? 20 : 14} />
        <span>语音</span>
        {!alive && <span data-media-dead>引用已失效</span>}
      </div>
    );
  }
  return (
    <div data-subject-media-thumb data-media-empty style={box}>
      <ImageIcon size={size > 60 ? 20 : 14} />
      <span>{storageKey ? (alive ? '媒体无法显示' : '引用已失效') : emptyLabel}</span>
    </div>
  );
}
