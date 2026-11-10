/**
 * 数据目录授权面板（挂在设置弹窗内，但与 MCP 服务无关）：目录授权 + 路径登记 + 缓存清理。
 *
 * 浏览器授权来自 `showDirectoryPicker` 的句柄（存在本浏览器 IndexedDB），刷新后需用户
 * 手势重新授权；MCP（8787/stdio）与它的数据根环境变量是另一条独立链路，**不产生授权**。
 * 本面板只回答「数据放哪」：
 * 1. 数据目录：状态一行 + 选择/重新授权（浏览器不支持时降级为一行提示，不报错不白屏）；
 * 2. 目录绝对路径：FSA 拿不到绝对路径，登记一次仅供外部工具参考；
 * 3. 清理浏览器侧缓存（目录句柄与界面缓存），不动磁盘数据。
 * 「给 IDE 的 MCP 配置」只在弹窗首屏出现**一次**，本面板不再重复渲染配置块/复制按钮。
 */

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { App, Button, Input, Space, Tag } from 'antd';
import { FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { pickRoot, restoreRoot, rootName, setRootPathHint, withPermissionPrompt, getRootPathHint } from '@/platform/fs.js';
import { cleanProjectBrowserCache } from './browser-cache.js';

/** FSA 能力检测：不支持时整区降级为一行提示（Chrome/Edge 才有 showDirectoryPicker；类型绕行同 fs.pickRoot） */
function fsaSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

export function LocalServicePanel(): React.ReactElement {
  const { theme } = useTheme();
  const { message, modal } = App.useApp();
  const supported = fsaSupported();
  const [root, setRoot] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [pathHint, setPathHintValue] = useState('');

  useEffect(() => {
    // jsdom/隐私模式无 indexedDB 时静默降级（不产生 unhandled rejection）
    void restoreRoot(false)
      .then(() => setRoot(rootName()))
      .catch(() => setRoot(null));
    void getRootPathHint()
      .then((v) => setPathHintValue(v ?? ''))
      .catch(() => undefined);
  }, []);

  /** 选择目录（用户手势内弹原生选择器）；成功即刷新——localforage 驱动运行中不换目录， */
  const handlePick = useCallback(async (): Promise<void> => {
    setPicking(true);
    try {
      const name = await withPermissionPrompt(() => pickRoot());
      setRoot(name);
      message.success(`已选择目录「${name}」，正在刷新页面…`);
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      // 用户取消原生弹窗（AbortError）不算错误，静默；其余给一句可读提示
      if (!String(err).includes('AbortError')) message.warning('没能打开文件夹，请重试');
    } finally {
      setPicking(false);
    }
  }, [message]);

  /** 重新授权已保存的目录句柄（一次点击按钮触发原生授权弹窗） */
  const handleRestore = useCallback(async (): Promise<void> => {
    setPicking(true);
    try {
      const name = await withPermissionPrompt(() => restoreRoot(true));
      if (name) {
        setRoot(name);
        message.success(`已恢复目录授权：${name}`);
      } else {
        message.warning('没有可恢复的授权记录，请选择目录');
      }
    } catch {
      message.warning('恢复授权未完成，请重试');
    } finally {
      setPicking(false);
    }
  }, [message]);

  /** 登记数据根绝对路径（FSA 拿不到，用户填一次） */
  const handlePathChange = useCallback((v: string): void => {
    setPathHintValue(v);
    void setRootPathHint(v.trim()).catch(() => undefined);
  }, []);

  /** 清理浏览器侧目录句柄与缓存键：二次确认 → 清理 → 统计 → 重载（重选目录） */
  const cleanCache = useCallback((): void => {
    modal.confirm({
      title: '清理浏览器缓存（目录授权与界面缓存）？',
      // 2026-11-05 用户指令：确认弹窗一律屏幕居中
      centered: true,
      content: (
        <div style={{ fontSize: 12 }}>
          只清理浏览器侧的目录句柄与缓存键，<b>不影响磁盘数据</b>；
          清理后需重新选择目录。
        </div>
      ),
      okText: '清理并刷新',
      cancelText: '取消',
      onOk: async () => {
        setCleaning(true);
        try {
          const report = await cleanProjectBrowserCache();
          const total =
            report.localStorageKeys.length + report.idbDatabases.length +
            report.cacheStorages.length + report.serviceWorkers;
          message.success(
            `已清理 ${total} 项（localStorage ${report.localStorageKeys.length} · 数据库 ${report.idbDatabases.length} · 缓存 ${report.cacheStorages.length} · SW ${report.serviceWorkers}），即将刷新…`,
          );
          setTimeout(() => window.location.reload(), 1200);
        } finally {
          setCleaning(false);
        }
      },
    });
  }, [modal, message]);

  const sectionLabelStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    marginBottom: 6,
    marginTop: 14,
    letterSpacing: 0.5,
  };
  const hintStyle: CSSProperties = { fontSize: 12, color: theme.toolbar.textMuted };

  return (
    <div style={{ fontSize: 12 }}>
      <div style={sectionLabelStyle}>数据目录</div>
      <Space size={8} align="center" wrap>
        {root ? (
          <Tag color="success" style={{ marginInlineEnd: 0 }}>已连接 · {root}</Tag>
        ) : (
          <Tag color="warning" style={{ marginInlineEnd: 0 }}>未选择</Tag>
        )}
        <Button
          size="small"
          icon={<FolderOpen size={12} />}
          loading={picking}
          disabled={!supported}
          onClick={() => void handlePick()}
        >
          选择目录
        </Button>
        <Button
          size="small"
          icon={<RefreshCw size={12} />}
          loading={picking}
          disabled={!supported}
          onClick={() => void handleRestore()}
        >
          重新授权
        </Button>
      </Space>
      {!supported && (
        <div style={{ ...hintStyle, marginTop: 6 }}>
          当前浏览器不支持本地目录读写，请使用 Chrome 或 Edge
        </div>
      )}

      {/* 目录绝对路径与状态同属「数据目录」一件事，合并为一块（2026-11-06 去重） */}
      <Input
        size="small"
        style={{ marginTop: 8 }}
        placeholder="数据根的绝对路径，如 D:\Test"
        value={pathHint}
        onChange={(e) => handlePathChange(e.target.value)}
      />
      <div style={{ ...hintStyle, marginTop: 4 }}>
        目录授权由本浏览器保存，与 MCP 服务无关；刷新后如提示未授权，点上方「重新授权」即可。
        这里填的绝对路径只供外部工具参考，填写本身不产生授权，也不影响素材读写。
      </div>

      <div style={{ marginTop: 14 }}>
        <Button size="small" icon={<Trash2 size={12} />} loading={cleaning} danger onClick={cleanCache}>
          清理浏览器缓存（目录授权与界面缓存）
        </Button>
      </div>
    </div>
  );
}
