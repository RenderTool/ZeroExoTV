/**
 * 本地数据服务离线门（2026-11-18 用户报障：已授权成功，页面仍反复要求重新选目录）。
 *
 * 数据权威在 8790 数据根、而服务掉线时，绝不能落到「选择文件夹」首启门——
 * 那个门解决不了问题，还会让用户以为授权丢了。这里只做两件事：
 * 「重新连接」（探测成功即整页刷新，让 localforage 重新绑磁盘驱动）
 * 「改用浏览器目录」（确实要脱离服务时，才退回首启门的目录授权）。
 */
import { useCallback, useState } from 'react';
import { Button, Typography } from 'antd';
import { probeHttpFs } from './http-fs.js';
import { reloadWithDisk } from './boot.js';

const { Text } = Typography;

export interface ServiceOfflineGateProps {
  /** 用户选择改用浏览器目录授权：交给首启门 */
  onUseBrowserRoot: () => void;
}

export function ServiceOfflineGate({ onUseBrowserRoot }: ServiceOfflineGateProps): React.ReactElement {
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
      setError('本地数据服务仍未响应：请在项目目录执行 pnpm fs（或 pnpm dev）后点「重新连接」');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, minHeight: '60vh', padding: 24, textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 15 }}>本地数据服务离线</div>
      <Text type="secondary" style={{ maxWidth: 460, lineHeight: 1.8 }}>
        项目数据都在本地数据服务（8790）的数据根里，服务不在线就打不开——这不是目录授权问题，不用重新选目录。
      </Text>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button onClick={onUseBrowserRoot} disabled={busy}>
          改用浏览器目录
        </Button>
        <Button type="primary" loading={busy} onClick={() => void reconnect()}>
          重新连接
        </Button>
      </div>
      {error ? <div style={{ color: '#c5221f', fontSize: 13, maxWidth: 460 }}>{error}</div> : null}
    </div>
  );
}
