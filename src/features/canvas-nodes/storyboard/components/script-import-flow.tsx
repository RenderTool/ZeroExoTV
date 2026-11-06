/**
 * ScriptImportFlow - 剧本导入（本地版）
 *
 * SaaS 版的 6 步 Modal 曾被改造成「打开 Agent 面板 + 注入 upload 卡片」的对话式流程。
 * 本地版（Plan#83）前端不含任何 Agent/LLM，因此这里不再注入对话：
 * 导入剧本 = 直接把 .txt/.md 落到 `<dataRoot>/projects/<slug>/scripts/` 并建 novel/script 节点，
 * 该能力由 asset-picker 的本地上传链路与外部 MCP 工具共同承担（Plan#83 Phase 3/4）。
 *
 * 组件签名保持不变（open/onClose/onComplete）以兼容 asset-library-modals.tsx。
 */
import { useEffect, useRef } from 'react';

export interface ScriptImportFlowProps {
  open: boolean;
  onClose: () => void;
  onComplete: (scriptState: import('../script-types.js').ScriptEditorState | null) => void;
}

export function ScriptImportFlow({ open, onClose, onComplete }: ScriptImportFlowProps): React.ReactElement {
  const doneRef = useRef(false);

  useEffect(() => {
    if (!open) {
      doneRef.current = false;
      return;
    }
    if (doneRef.current) return;
    doneRef.current = true;
    // 本地版无对话式导入：不产出脚本状态，交由调用方走本地文件链路
    onComplete(null);
    onClose();
  }, [open, onClose, onComplete]);

  return <></>;
}
