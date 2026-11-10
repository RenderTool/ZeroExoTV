/**
 * PromptLibraryMenu - 图片节点参数旁「提示词库」下拉（只读预设）
 */
import { Dropdown, Button, type MenuProps } from 'antd';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePromptEntries } from './prompt-store.js';

export function PromptLibraryMenu({
  onPick,
  size = 'small',
}: {
  onPick: (body: string) => void;
  size?: 'small' | 'middle';
}): React.ReactElement {
  const { t } = useTranslation();
  const entries = usePromptEntries();
  const items: MenuProps['items'] = entries.map((p) => ({
    key: p.id,
    label: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0', maxWidth: 260 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{p.title}</span>
        <span style={{ fontSize: 10, opacity: 0.65, whiteSpace: 'normal', lineHeight: 1.4 }}>{p.description}</span>
      </div>
    ),
  }));
  return (
    <Dropdown
      trigger={['click']}
      placement="topRight"
      menu={{
        items,
        onClick: ({ key }) => {
          const preset = entries.find((p) => p.id === key);
          if (preset) onPick(preset.body);
        },
      }}
    >
      <Button
        type="text"
        size={size}
        icon={<BookOpen size={15} />}
        aria-label={t('promptLibrary.title', '提示词')}
        title={t('promptLibrary.title', '提示词')}
        data-testid="prompt-library-menu"
      >
        {/* 2026-11-10 用户要求：按钮必须带「提示词」文本，不能只有一个书本图标 */}
        {t('promptLibrary.title', '提示词')}
      </Button>
    </Dropdown>
  );
}
