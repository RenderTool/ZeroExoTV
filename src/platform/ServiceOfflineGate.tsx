/**
 * 本地数据服务离线门（2026-11-18 用户报障：已授权成功，页面仍反复要求重新选目录）。
 *
 * 数据权威在 8790 数据根、而服务掉线时，绝不能落到「选择文件夹」首启门——
 * 那个门解决不了问题，还会让用户以为授权丢了。这里只做两件事：
 * 「重新连接」（探测成功即整页刷新，让 localforage 重新绑磁盘驱动）
 * 「改用浏览器目录」（确实要脱离服务时，才退回首启门的目录授权）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Typography } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { httpFsInfo, probeHttpFs } from './http-fs.js';
import { reloadWithDisk } from './boot.js';

const { Text } = Typography;

export interface ServiceOfflineGateProps {
  /** 用户选择改用浏览器目录授权：交给首启门 */
  onUseBrowserRoot: () => void;
}

export function ServiceOfflineGate({ onUseBrowserRoot }: ServiceOfflineGateProps): React.ReactElement {
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconnect = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const info = await probeHttpFs();
      if (info) {
        reloadWithDisk();
        return;
      }
      setError('本地数据服务仍未响应：先确认本项目 MCP 服务在线（8790），再点「重新连接」');
    } finally {
      setBusy(false);
    }
  }, []);

  // 2026-11-19：服务恢复后不该让用户反复手点。每 3 秒静默探一次，连上立刻整页刷新。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void probeHttpFs({ retry: false }).then((next) => {
        if (next) reloadWithDisk();
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  const probeBase = httpFsInfo()?.baseUrl ?? 'http://127.0.0.1:8790';

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, minHeight: '100vh', padding: 24, textAlign: 'center',
        // 2026-11-20 用户报障：这一页之前没跟主题走 —— 背景与文字色都取主题 token，明暗两套都可读
        background: theme.canvas.background,
        color: theme.toolbar.text,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: theme.toolbar.text }}>本地数据服务离线</div>
      <Text style={{ maxWidth: 460, lineHeight: 1.8, color: theme.toolbar.textMuted }}>
        项目数据都在本地数据服务（8790）的数据根里，服务不在线就打不开——这不是目录授权问题，不用重新选目录。
      </Text>
      <Text style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
        探测地址 {probeBase}（每 3 秒自动重连，连上会自己刷新）
      </Text>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button onClick={onUseBrowserRoot} disabled={busy}>
          改用浏览器目录
        </Button>
        <Button type="primary" loading={busy} onClick={() => void reconnect()}>
          重新连接
        </Button>
      </div>
      {error ? <div style={{ color: theme.toolbar.accent, fontSize: 13, maxWidth: 460 }}>{error}</div> : null}
    </div>
  );
}
