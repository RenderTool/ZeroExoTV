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
import { reloadWithDisk } from './boot.js';
import { restoreRoot, withPermissionPrompt } from './fs.js';

const { Text } = Typography;

export interface RootGateProps {
  open: boolean;
}

/** FSA 能力检测：不支持时按钮禁用 + 一行提示（不白屏不报错）。类型绕行同 fs.pickRoot（dom lib 无该 API） */
function fsaSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

export function RootGate({ open }: RootGateProps): React.ReactElement {
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
   * 一次点击两条路径（刷新后权限恢复纪律：不允许自动弹 requestPermission）：
   * 1. 有已保存句柄 → requestPermission 一次点击恢复授权 → 整页刷新重绑驱动；
   * 2. 无句柄/恢复被拒 → 走 activateRoot：重选目录（+可选迁移）。
   */
  const handlePick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const restored = await withPermissionPrompt(() => restoreRoot(true));
      if (restored) {
        reloadWithDisk(); // 驱动在实例 ready 时选定，运行中授权必须刷新避免双轨
        return;
      }
    } catch {
      /* 恢复失败（拒绝/异常）→ 落到新选目录路径 */
    }
    const outcome = await activateRoot({ migrate: migrate && items > 0 });
    setBusy(false);
    if (outcome.status === 'error') setError('没能打开文件夹，请重试');
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
        <Button type="primary" onClick={handlePick} loading={busy} disabled={!supported}>
          选择文件夹
        </Button>
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
