/**
 * 首启门：必须先选一个本地文件夹，否则不进主界面。
 *
 * 本版本不用浏览器存储（避免"以为在文件夹、其实在浏览器"的双轨事故），
 * 所以这里没有"跳过"按钮，也不可关闭。
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Modal, Typography } from 'antd';
import { countBrowserItems } from './migrate.js';
import { activateRoot } from './root-flow.js';
import { restoreRoot, withPermissionPrompt } from './fs.js';

const { Text } = Typography;

export interface RootGateProps {
  open: boolean;
  /** 目录授权成功：直接把当前页面切到主界面，不再整页刷新（刷新会丢 FSA 权限） */
  onActivated: () => void;
}

/** FSA 能力检测：不支持时按钮禁用 + 一行提示（不白屏不报错）。类型绕行同 fs.pickRoot（dom lib 无该 API） */
function fsaSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

export function RootGate({ open, onActivated }: RootGateProps): React.ReactElement {
  const [items, setItems] = useState(0);
  const [migrate, setMigrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = fsaSupported();

  useEffect(() => {
    if (!open) return;
    void countBrowserItems().then((n) => {
      setItems(n);
      setMigrate(n > 0);
    }).catch(() => {
      // 目录未授权 / 浏览器存储不可用时统计失败：忽略，按「无旧数据」处理
      setItems(0);
      setMigrate(false);
    });
  }, [open]);

  /**
   * 「使用上次目录」：只走已保存句柄的权限恢复。
   * 与「选择文件夹」拆成两个按钮——恢复失败时不能再顺手调 picker，
   * 否则 requestPermission 已经吃掉用户手势，picker 会静默不弹。
   */
  const handleRestore = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const restored = await withPermissionPrompt(() => restoreRoot(true));
      if (restored) {
        onActivated();
        return;
      }
      setError('没有可恢复的上次目录，请点「选择文件夹」重新选择');
    } catch {
      setError('恢复上次目录失败，请点「选择文件夹」重新选择');
    } finally {
      setBusy(false);
    }
  }, []);

  /** 「选择文件夹」：必须直接调系统选择器，前面不能有 await（会吃掉用户手势） */
  const handlePick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      console.info('[root] pick start');
      const outcome = await activateRoot({ migrate: migrate && items > 0 });
      console.info('[root] pick outcome', outcome);
      if (outcome.status === 'error') {
        const msg = outcome.message || '没能打开文件夹，请重试';
        setError(/security|gesture|not allowed|denied/i.test(msg)
          ? '浏览器拦截了目录选择：请用独立的 Chrome / Edge 标签页打开本站（不要在内嵌浏览器或 iframe 里）'
          : msg);
      } else if (outcome.status === 'cancelled') {
        setError(null);
      } else if (outcome.status === 'ok') {
        onActivated();
      }
    } catch (err) {
      console.error('[root] pick failed', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || '没能打开文件夹，请重试');
    } finally {
      setBusy(false);
    }
  }, [migrate, items]);

  return (
    <Modal
      open={open}
      title="选择数据目录"
      closable={false}
      // antd 6：maskClosable 已废弃，改用 mask.closable
      mask={{ closable: false }}
      keyboard={false}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => void handleRestore()} loading={busy}>
            使用上次目录
          </Button>
          <Button type="primary" onClick={() => void handlePick()} loading={busy} disabled={!supported}>
            选择文件夹
          </Button>
        </div>
      }
      centered
    >
      <Text>项目文件都保存在你选的文件夹里，方便备份和迁移。</Text>
      <div style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          建议新建一个空文件夹，例如 D:\ZeroExoData（不要放在网盘同步目录里）。
        </Text>
      </div>
      {!supported ? (
        <div style={{ marginTop: 10, color: '#c5221f', fontSize: 13 }}>
          当前浏览器不支持本地目录读写，请使用 Chrome 或 Edge
        </div>
      ) : null}
      {items > 0 ? (
        <div style={{ marginTop: 12 }}>
          <Checkbox checked={migrate} onChange={(e) => setMigrate(e.target.checked)}>
            把浏览器里的 {items} 条旧数据搬过来
          </Checkbox>
        </div>
      ) : null}
      {error ? (
        <div style={{ marginTop: 10, color: '#c5221f', fontSize: 13 }}>{error}</div>
      ) : null}
    </Modal>
  );
}
