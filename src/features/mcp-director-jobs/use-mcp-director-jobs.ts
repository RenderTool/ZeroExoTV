import { useEffect, useRef } from 'react';
import { listDir, readJson, removeFile } from '@/platform/fs.js';

/** MCP 只投递「导演台运行请求」；真正提交/预览/落库由打开项目的网页执行 */
export const MCP_DIRECTOR_JOB_DIR = '.lf/zeroexo/app_meta/director-jobs';

export interface McpDirectorRequest {
  schemaVersion?: number;
  requestId: string;
  projectId: string;
  selectedIds: string[];
  requestedAt?: string;
}

export function useMcpDirectorJobs(opts: {
  projectId: string | null | undefined;
  onRequest: (req: McpDirectorRequest) => void;
}): void {
  const { projectId, onRequest } = opts;
  const cbRef = useRef(onRequest);
  cbRef.current = onRequest;
  const busyRef = useRef(false);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    const timer = window.setInterval(() => { void tick(); }, 2000);
    void tick();

    async function tick(): Promise<void> {
      if (disposed || busyRef.current) return;
      busyRef.current = true;
      try {
        const entries = await listDir(MCP_DIRECTOR_JOB_DIR).catch(() => []);
        for (const entry of entries) {
          if (disposed) return;
          if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
          const rel = `${MCP_DIRECTOR_JOB_DIR}/${entry.name}`;
          const req = await readJson<McpDirectorRequest>(rel).catch(() => null);
          if (!req?.requestId || req.projectId !== projectId) continue;
          // 先删请求再启动：避免 2 秒轮询重复触发同一次运行
          await removeFile(rel).catch(() => undefined);
          cbRef.current(req);
        }
      } finally {
        busyRef.current = false;
      }
    }

    return () => { disposed = true; window.clearInterval(timer); };
  }, [projectId]);
}
