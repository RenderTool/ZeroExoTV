/** 项目档案页签状态：和剧本/分镜/画布同级，点开时占满内容区（不是抽屉）。 */
import { create } from 'zustand';

interface ProjectLogViewState {
  active: boolean;
  setActive: (v: boolean) => void;
}

export const useProjectLogView = create<ProjectLogViewState>((set) => ({
  active: false,
  setActive: (v) => set({ active: v }),
}));
