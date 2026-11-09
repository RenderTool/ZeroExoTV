/**
 * comfyui-ws-client — ComfyUI /ws 实时预览帧客户端（导演台专用，直连模式）
 *
 * 协议（读本机 ComfyUI 源码确认，非猜测）：
 * - 端点：`ws(s)://{host}/ws?clientId={id}`（server.py websocket_handler，clientId 即 sid）；
 * - 文本帧：`{ type, data, sid? }`（send_json, server.py L1492-1500）。实际线上键名以本机
 *   progress.py 为准（snake_case，已逐行核对，勿按 camelCase 猜）：
 *   - `minimax_director_preview`（report_director_segment_preview）：data = {
 *     node_id, segment_index(0基), image_b64, width, height, live, mime?, frames?, fps?,
 *     step?(1基), total_steps? } → base64 帧图（mime 可为 image/webp）；
 *   - `minimax_director_progress`（report_director_progress）：data = {
 *     node_id, segment(1基), segment_total, timeline_segment(1基), timeline_segment_total,
 *     partial_run, phase, phase_label, phase_value, phase_max, overall_value, overall_max,
 *     remaining_segments, frames_label, task_key } → 无步进字段，步进只随 preview 事件来；
 * - 二进制帧（标准 ComfyUI latent 预览, BinaryEventTypes）与导演台无关，忽略。
 *
 * 定向性：H3 节点经 send_sync(..., srv.client_id) 定向发送；桥接 /run 现已把前端 clientId
 * 透传进 POST /prompt（server.py L1209-1210 → execution.py 写 server.client_id），
 * 因此本客户端连接用的 clientId 必须与提交时传入的 clientId 一致。
 *
 * 节流：帧推送按 ≤10fps 合并（pending 只留最新一帧，100ms 定时 flush），不逐帧 setState。
 */

export interface DirectorPreviewFrame {
  /** dataURL（`data:image/jpeg;base64,...`）；progress-only 事件无图时为 null */
  image: string | null;
  step: number | null;
  totalSteps: number | null;
  /** 1 基段号 */
  segmentIndex: number | null;
}

export interface DirectorProgressInfo {
  /** 1 基段号（report_director_progress 的 segment 字段） */
  segment: number | null;
  segmentTotal?: number;
  /** 上游 DIRECTOR_PHASES：prepare/context_encode/sample/upscale/refine/decode/plan/finish */
  phase?: string;
  phaseLabel?: string;
  /** overall_value/overall_max：全时间轴总进度（段数×每段阶段数） */
  overallValue?: number;
  overallMax?: number;
  framesLabel?: string;
  remainingSegments?: number;
}

interface DirectorPreviewSocketHandlers {
  onFrame: (frame: DirectorPreviewFrame) => void;
  onProgress?: (info: DirectorProgressInfo) => void;
}

function toWsUrl(baseUrl: string, clientId: string): string {
  const url = new URL(baseUrl);
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${url.host}/ws?clientId=${encodeURIComponent(clientId)}`;
}

export function createPreviewClientId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `zx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class DirectorPreviewSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectTimer: number | null = null;
  /** 节流：待 flush 的最新帧（100ms 一次，≤10fps） */
  private pendingFrame: DirectorPreviewFrame | null = null;
  private flushTimer: number | null = null;
  /** progress-only 携带的 step 信息可与帧合并展示 */
  private lastProgress: DirectorProgressInfo | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly handlers: DirectorPreviewSocketHandlers,
    /** 帧节流间隔，默认 100ms（10fps 上限）；测试可注入小值 */
    private readonly throttleMs = 100,
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(toWsUrl(this.baseUrl, this.clientId));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = () => {
      this.ws = null;
      if (!this.closedByUser) this.scheduleReconnect(); // 断线自动重连（作业仍在跑时帧不中断）
    };
    // onerror 交给 onclose 兜底重连
    ws.onerror = () => undefined;
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, 2000);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return; // 二进制帧（标准 latent 预览）忽略
    let msg: { type?: unknown; data?: unknown };
    try {
      msg = JSON.parse(raw) as { type?: unknown; data?: unknown };
    } catch {
      return;
    }
    if (msg.type === 'minimax_director_preview') {
      const d = (msg.data ?? {}) as Record<string, unknown>;
      const imageB64 = typeof d.image_b64 === 'string' ? d.image_b64 : '';
      const mime = typeof d.mime === 'string' ? d.mime : 'image/jpeg';
      const frame: DirectorPreviewFrame = {
        image: imageB64 ? `data:${mime};base64,${imageB64}` : null,
        step: typeof d.step === 'number' ? d.step : null,
        totalSteps: typeof d.total_steps === 'number' ? d.total_steps : null,
        segmentIndex:
          typeof d.segment_index === 'number'
            ? d.segment_index + 1 // 线上是 0 基（seg.timeline_index），展示用 1 基
            : this.lastProgress?.segment ?? null,
      };
      this.enqueueFrame(frame);
    } else if (msg.type === 'minimax_director_progress') {
      const d = (msg.data ?? {}) as Record<string, unknown>;
      const info: DirectorProgressInfo = {
        segment: typeof d.segment === 'number' ? d.segment : null,
        segmentTotal: typeof d.segment_total === 'number' ? d.segment_total : undefined,
        phase: typeof d.phase === 'string' ? d.phase : undefined,
        phaseLabel: typeof d.phase_label === 'string' ? d.phase_label : undefined,
        overallValue: typeof d.overall_value === 'number' ? d.overall_value : undefined,
        overallMax: typeof d.overall_max === 'number' ? d.overall_max : undefined,
        framesLabel: typeof d.frames_label === 'string' ? d.frames_label : undefined,
        remainingSegments:
          typeof d.remaining_segments === 'number' ? d.remaining_segments : undefined,
      };
      this.lastProgress = info;
      this.handlers.onProgress?.(info);
      // 无帧期间也把段号刷给 UI（image=null 的 progress-only 帧；step 只随 preview 事件来）
      this.enqueueFrame({
        image: null,
        step: null,
        totalSteps: null,
        segmentIndex: info.segment,
      });
    }
  }

  private enqueueFrame(frame: DirectorPreviewFrame): void {
    // 最新帧语义：预览只关心当前画面，旧帧直接丢弃（不排队、不积压）
    const prev = this.pendingFrame;
    this.pendingFrame = frame.image
      ? frame
      : {
          // 2026-11-07：progress-only 事件只有同一段才沿用上一张图；跨段必须清空，
          // 否则「帧属于第 1 段、段号已是第 2 段」会把上一段画面串到下一段。
          image: prev?.image && frame.segmentIndex === prev.segmentIndex ? prev.image : null,
          step: frame.step,
          totalSteps: frame.totalSteps,
          segmentIndex: frame.segmentIndex,
        };
    if (this.flushTimer === null) {
      this.flushTimer = window.setTimeout(() => this.flush(), this.throttleMs);
    }
  }

  private flush(): void {
    this.flushTimer = null;
    const frame = this.pendingFrame;
    this.pendingFrame = null;
    if (frame && (frame.image !== null || frame.step !== null || frame.segmentIndex !== null)) {
      this.handlers.onFrame(frame);
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingFrame = null;
    this.ws?.close();
    this.ws = null;
  }
}
