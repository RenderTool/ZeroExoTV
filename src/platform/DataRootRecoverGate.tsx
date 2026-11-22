/**
 * 运行期数据根恢复框（2026-11-22 收敛为单一模式）。
 *
 * `dataRootState()` 明确为 unauthorized 时弹，只做「重新授权 / 选择文件夹」。
 * 文件真丢失 / 其它读取失败：不弹，由调用方显示可读原因。
 *
 * 旧的 offline 模式（8790 本地数据服务掉线）随服务一并移除：
 * 网页读写本地文件只认浏览器目录授权，不再有第二种数据来源。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Typography } from 'antd';
import { activateRoot } from './root-flow.js';
import { restoreRoot, withPermissionPrompt } from './fs.js';
import { DATA_ROOT_AUTH_NEEDED_EVENT } from './data-root-events.js';
import { invalidateAllMediaObjectUrls } from '@zeroexo/plugin-persistence';

const { Text } = Typography;

export function DataRootRecoverGate(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onAuth = (): void => {
      setError(null);
      setOpen(true);
    };
    window.addEventListener(DATA_ROOT_AUTH_NEEDED_EVENT, onAuth);
    return () => {
      window.removeEventListener(DATA_ROOT_AUTH_NEEDED_EVENT, onAuth);
    };
  }, []);

  const done = useCallback((): void => {
    invalidateAllMediaObjectUrls();
    setOpen(false);
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

  return (
    <Modal
      open={open}
      title="数据目录需要重新授权"
      centered
      mask={{ closable: false }}
      onCancel={() => setOpen(false)}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => setOpen(false)} type="text" disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void handlePick()} disabled={busy}>
            选择文件夹
          </Button>
          <Button type="primary" onClick={() => void handleRestore()} loading={busy}>
            重新授权
          </Button>
        </div>
      }
    >
      <Text>浏览器需要你点一次，把数据目录的读写权限重新交给网页。</Text>
      {error ? <div style={{ marginTop: 10, color: '#c5221f', fontSize: 13 }}>{error}</div> : null}
    </Modal>
  );
}
