/**
 * 运行期数据根恢复框（2026-11-18 拆成两种模式）。
 *
 * - auth：`dataRootState()` 明确为 unauthorized 时弹，只做「重新授权 / 选择文件夹」；
 * - offline：数据权威在本地服务（8790）却掉线时弹，只提示服务离线并给「重新连接」，
 *   绝不把服务掉线说成目录授权问题，也不让用户去重新选目录。
 * 文件真丢失 / 其它读取失败：两种模式都不弹，由调用方显示可读原因。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Typography } from 'antd';
import { activateRoot } from './root-flow.js';
import { restoreRoot, withPermissionPrompt } from './fs.js';
import { probeHttpFs } from './http-fs.js';
import { DATA_ROOT_AUTH_NEEDED_EVENT, DATA_ROOT_SERVICE_OFFLINE_EVENT } from './data-root-events.js';
import { invalidateAllMediaObjectUrls } from '@zeroexo/plugin-persistence';

const { Text } = Typography;

export function DataRootRecoverGate(): React.ReactElement | null {
  const [mode, setMode] = useState<'auth' | 'offline' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onAuth = (): void => {
      setError(null);
      setMode('auth');
    };
    const onOffline = (): void => {
      setError(null);
      setMode('offline');
    };
    window.addEventListener(DATA_ROOT_AUTH_NEEDED_EVENT, onAuth);
    window.addEventListener(DATA_ROOT_SERVICE_OFFLINE_EVENT, onOffline);
    return () => {
      window.removeEventListener(DATA_ROOT_AUTH_NEEDED_EVENT, onAuth);
      window.removeEventListener(DATA_ROOT_SERVICE_OFFLINE_EVENT, onOffline);
    };
  }, []);

  const done = useCallback((): void => {
    invalidateAllMediaObjectUrls();
    setMode(null);
    setBusy(false);
    setError(null);
  }, []);

  const handleRestore = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const restored = await withPermissionPrompt(() => restoreRoot(true));
      if (restored) {
        done();
        return;
      }
      setError('上次的目录句柄不可用，请点「选择文件夹」重新授权');
    } catch {
      setError('重新授权失败，请点「选择文件夹」重新授权');
    } finally {
      setBusy(false);
    }
  }, [done]);

  const handlePick = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await activateRoot({ migrate: false });
      if (outcome.status === 'ok') {
        done();
        return;
      }
      if (outcome.status === 'cancelled') {
        setError(null);
        return;
      }
      setError(outcome.message || '没能打开文件夹，请重试');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [done]);

  /** 重新连接：探测 8790；通了必须整页刷新（localforage 驱动运行中不换） */
  const handleReconnect = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const info = await probeHttpFs();
      if (info) {
        window.location.reload();
        return;
      }
      setError('本地数据服务仍未响应：请在项目目录执行 pnpm fs（或 pnpm dev）后重试');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const offline = mode === 'offline';
  return (
    <Modal
      open={mode !== null}
      title={offline ? '本地数据服务离线' : '数据目录需要重新授权'}
      centered
      mask={{ closable: false }}
      onCancel={() => setMode(null)}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => setMode(null)} type="text" disabled={busy}>
            取消
          </Button>
          {offline ? (
            <Button type="primary" onClick={() => void handleReconnect()} loading={busy}>
              重新连接
            </Button>
          ) : (
            <>
              <Button onClick={() => void handlePick()} disabled={busy}>
                选择文件夹
              </Button>
              <Button type="primary" onClick={() => void handleRestore()} loading={busy}>
                重新授权
              </Button>
            </>
          )}
        </div>
      }
    >
      {offline ? (
        <>
          <Text>素材读不出来是因为本地数据服务（端口 8790）不在线，不是目录授权问题——不用重新选目录。</Text>
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              还没启动就在项目目录执行 pnpm fs（或 pnpm dev）；服务起来后点「重新连接」，页面会自动刷新。
            </Text>
          </div>
        </>
      ) : (
        <Text>浏览器需要你点一次，把数据目录的读写权限重新交给网页。</Text>
      )}
      {error ? <div style={{ marginTop: 10, color: '#c5221f', fontSize: 13 }}>{error}</div> : null}
    </Modal>
  );
}
