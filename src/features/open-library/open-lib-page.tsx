/**
 * open-lib-page - 独立开源资产库整页（#/openlib，2026-11-05 需求定稿）
 *
 * 页头约束：入口在 sidebar；不显示返回箭头与地球图标——本页头部只留
 * 纯文字标题「开源资产库」+ 极简一句副标题（次要色小字），高度与抽屉/资产库页对齐，
 * 不做装饰横幅。主体与画布抽屉「开源库」段复用同一 OpenLibBrowser（同分类展示、
 * 同卡片）。本页无打开中的画布 → 不渲染「发送到画布 / 发送到导演台」按钮与右键菜单，
 * 独立页只做浏览；发送动作统一留在画布内素材抽屉。
 */

import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { OpenLibBrowser } from './open-lib-browser.js';

export function OpenLibraryPage(): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <div style={{
      // 2026-11-05 任务E（右侧大片空白修复）：AppLayout Content 是 row 向 flex 容器，
      // 子页必须显式占满主轴（width:100% + flex:1 + minWidth:0），否则宽度收缩为内容宽，
      // 右侧留白且滚动条"半途"结束；网格 auto-fill 由此才能吃到全宽（1024→7 列、1920→更多）
      height: '100%', width: '100%', flex: 1, minWidth: 0,
      display: 'flex', flexDirection: 'column', minHeight: 0,
      padding: '8px 0 0',
    }}>
      {/* 头部：纯文字标题（任务G：无返回按钮、无装饰图标、不做横幅、无来源/只读说明） */}
      <div style={{ padding: '6px 20px 8px', flexShrink: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: theme.toolbar.text, whiteSpace: 'nowrap' }}>
          {t('openLib.sectionTitle')}
        </span>
      </div>
      {/* 主体：与抽屉同一浏览器组件（单一定义源） */}
      <OpenLibBrowser theme={theme} />
    </div>
  );
}
