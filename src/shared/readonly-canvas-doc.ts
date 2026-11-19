/**
 * readonly-canvas-doc — 当前打开的画布文档是不是「只读历史链路」
 *
 * 口径（2026-11-18 用户）：查看提示词打开的子画布是**历史快照**，历史改了就不叫历史，
 * 因此这类子画布只读：不能删、不能替换、不能连线；想改就点「生成同款」回主画布重新生成。
 * 普通子画布（用户自己新建/另存）不在此列，照常可编辑。
 *
 * 只按当前文档 id 记录，切换文档时由 useCanvasDocumentSwitch 写入。
 */
import { create } from 'zustand';

interface ReadOnlyCanvasDocState {
  /** 当前只读文档的 cid；null = 当前文档可写 */
  readOnlyCid: string | null;
  setReadOnlyCid: (cid: string | null) => void;
}

export const useReadOnlyCanvasDocStore = create<ReadOnlyCanvasDocState>((set) => ({
  readOnlyCid: null,
  setReadOnlyCid: (readOnlyCid) => set({ readOnlyCid }),
}));
