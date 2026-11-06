/**
 * FolderListView - 资产库文件夹树视图
 *
 * 以树形结构展示用户资产文件夹，支持选择文件夹、新建文件夹操作。
 * 2026-09-01 新增：与后端 /api/folders 对接，展示项目文件夹层级。
 */

import { memo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderClosed, FolderOpen, ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { Button, Input, Spin } from 'antd';
import type { FolderNode } from '../folders-api.js';

export interface FolderListViewProps {
  theme: any;
  folderTree: FolderNode[];
  loading: boolean;
  activeFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => Promise<any>;
}

export const FolderListView = memo(function FolderListView({
  theme,
  folderTree,
  loading,
  activeFolderId,
  onSelectFolder,
  onCreateFolder,
}: FolderListViewProps): ReactElement {
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const accentColor = theme.toolbar.accent ?? '#3b82f6';

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(false);
    setNewName('');
    await onCreateFolder(name, null);
  };

  const renderNode = (node: FolderNode, depth: number): ReactElement => {
    const isActive = node.id === activeFolderId;
    const isExpanded = expanded.has(node.id);
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id}>
        <div
          onClick={() => {
            onSelectFolder(isActive ? null : node.id);
            if (hasChildren) toggleExpand(node.id);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 34, padding: '0 8px 0 ' + (16 + depth * 16) + 'px',
            borderRadius: 6, cursor: 'pointer',
            background: isActive ? (isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.08)') : 'transparent',
            color: isActive ? accentColor : textColor,
            fontSize: 12, fontWeight: isActive ? 600 : 400,
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'; }}
          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />
          ) : <span style={{ width: 12 }} />}
          {isExpanded ? <FolderOpen size={14} strokeWidth={1.8} /> : <FolderClosed size={14} strokeWidth={1.8} />}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
          {node.system && (
            <span style={{ fontSize: 10, color: mutedColor, opacity: 0.6 }}>系统</span>
          )}
        </div>
        {isExpanded && hasChildren && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  // 新建文件夹行
  const createRow = creating ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 16px 4px 16px' }}>
      <Input
        size="small"
        placeholder={t('folderListView.namePlaceholder', '文件夹名称')}
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onPressEnter={handleCreate}
        onBlur={() => { if (!newName.trim()) setCreating(false); }}
        autoFocus
        style={{ flex: 1, fontSize: 12 }}
      />
      <Button size="small" type="primary" onClick={handleCreate} disabled={!newName.trim()}>
        {t('folderListView.create', '创建')}
      </Button>
    </div>
  ) : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部操作栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid ' + borderColor,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: textColor }}>
          {t('folderListView.title', '项目文件夹')}
        </span>
        <Button
          size="small"
          type="text"
          icon={<Plus size={14} />}
          onClick={() => setCreating(true)}
          style={{ color: mutedColor, fontSize: 12 }}
        >
          {t('folderListView.newFolder', '新建')}
        </Button>
      </div>

      {/* 文件夹树 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spin size="small" />
          </div>
        ) : folderTree.length === 0 ? (
          <div style={{ textAlign: 'center', color: mutedColor, fontSize: 12, padding: 24 }}>
            {t('folderListView.empty', '暂无文件夹')}
          </div>
        ) : (
          folderTree.map((node) => renderNode(node, 0))
        )}
        {createRow}
      </div>
    </div>
  );
});