/**
 * StoryboardReportTab - 分镜生成报告 Tab（Plan#57 全量改造）
 *
 * 展示 production_agent 生成分镜后的完整报告，包括：
 * - 推理过程（剧本分析/圣经匹配/镜头推理/质量门）
 * - 质量报告（评分原因、失分项、修复建议）
 * - 缺失项分析
 * - 改进建议
 *
 * 用户可一键导出为 .md 文件。
 */

import { memo, useCallback, type ReactElement } from 'react';
import { Download, FileText, AlertTriangle, Lightbulb, CheckCircle, FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { downloadFile } from './import-export-service';
import type { WorkbenchNodeData } from './workbench-types';

export interface StoryboardReportTabProps {
  report: NonNullable<WorkbenchNodeData['report']>;
  theme: any;
  isDark: boolean;
}

export const StoryboardReportTab = memo(function StoryboardReportTab({
  report,
  theme,
  isDark,
}: StoryboardReportTabProps): ReactElement {
  const { t } = useTranslation();

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = '#3b82f6';
  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const success = '#22c55e';
  const warning = '#f59e0b';
  const error = '#ef4444';

  // 导出 Markdown 报告
  const handleExportMarkdown = useCallback(() => {
    const filename = `${report.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.md`;
    downloadFile(report.markdownContent, filename, 'text/markdown;charset=utf-8');
  }, [report]);

  // 导出 JSON 格式（结构化数据）
  const handleExportJSON = useCallback(() => {
    const jsonContent = JSON.stringify({
      title: report.title,
      createdAt: report.createdAt,
      scriptSummary: report.scriptSummary,
      bibleSummary: report.bibleSummary,
      qualitySummary: report.qualitySummary,
      missingItems: report.missingItems,
      improvements: report.improvements,
    }, null, 2);
    const filename = `${report.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.json`;
    downloadFile(jsonContent, filename, 'application/json;charset=utf-8');
  }, [report]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
      {/* 报告头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: `1px solid ${cardBorder}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} style={{ color: accent }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: textPrimary }}>{report.title}</span>
          <span style={{ fontSize: 11, color: textMuted }}>{new Date(report.createdAt).toLocaleString('zh-CN')}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* 导出 JSON */}
          <button
            type="button"
            onClick={handleExportJSON}
            title={t('report.exportJSON', '导出 JSON')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 28, padding: '0 10px', borderRadius: 6,
              border: `1px solid ${cardBorder}`, background: 'transparent',
              color: textMuted, fontSize: 11, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = cardBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <FileDown size={12} />
            JSON
          </button>
          {/* 导出 Markdown */}
          <button
            type="button"
            onClick={handleExportMarkdown}
            title={t('report.exportMarkdown', '导出 Markdown')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 28, padding: '0 12px', borderRadius: 6,
              border: 'none', background: accent, color: '#fff',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Download size={12} />
            {t('report.export', '导出')}
          </button>
        </div>
      </div>

      {/* 报告内容（可滚动） */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {/* 元数据卡片 */}
        <div style={{
          display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 12px', borderRadius: 8, background: cardBg,
            border: `1px solid ${cardBorder}`,
          }}>
            <span style={{ fontSize: 11, color: textMuted }}>{t('report.script', '剧本')}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>{report.scriptSummary}</span>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 12px', borderRadius: 8, background: cardBg,
            border: `1px solid ${cardBorder}`,
          }}>
            <span style={{ fontSize: 11, color: textMuted }}>{t('report.bible', '圣经')}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>{report.bibleSummary}</span>
          </div>
        </div>

        {/* 质量报告摘要 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
          }}>
            <CheckCircle size={14} style={{ color: report.qualitySummary.averageScore >= 7 ? success : warning }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>
              {t('report.shotQuality', '镜头质量')}
            </span>
          </div>
          <div style={{
            display: 'flex', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 8, background: cardBg,
              border: `1px solid ${cardBorder}`, flex: 1, minWidth: 120,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: report.qualitySummary.averageScore >= 7 ? `${success}18` : `${warning}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: report.qualitySummary.averageScore >= 7 ? success : warning }}>
                  {report.qualitySummary.averageScore}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 10, color: textMuted }}>{t('report.averageScore', '平均分')}</div>
                <div style={{ fontSize: 11, color: textPrimary }}>/10</div>
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 8, background: cardBg,
              border: `1px solid ${cardBorder}`, flex: 1, minWidth: 120,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>
                  {report.qualitySummary.passedCount}/{report.qualitySummary.totalCount}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 10, color: textMuted }}>{t('report.passedRate', '通过率')}</div>
                <div style={{ fontSize: 11, color: textPrimary }}>
                  {report.qualitySummary.totalCount > 0
                    ? `${Math.round((report.qualitySummary.passedCount / report.qualitySummary.totalCount) * 100)}%`
                    : '-'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 缺失项分析 */}
        {report.missingItems.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            }}>
              <AlertTriangle size={14} style={{ color: warning }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>
                {t('report.missingItems', '缺失项分析')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.missingItems.map((item, idx) => (
                <div key={idx} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  padding: '8px 12px', borderRadius: 8, background: cardBg,
                  border: `1px solid ${cardBorder}`,
                }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: warning, marginTop: 6, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: warning, textTransform: 'uppercase' }}>{item.category}</span>
                      <span style={{ fontSize: 11, color: textPrimary }}>{item.item}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: textMuted, marginBottom: 2 }}>{item.impact}</div>
                    <div style={{ fontSize: 10.5, color: accent }}>{t('report.suggestion', '建议')}: {item.suggestion}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 改进建议 */}
        {report.improvements.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            }}>
              <Lightbulb size={14} style={{ color: accent }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>
                {t('report.improvements', '改进建议')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.improvements.map((item, idx) => (
                <div key={idx} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  padding: '8px 12px', borderRadius: 8, background: cardBg,
                  border: `1px solid ${cardBorder}`,
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: item.priority === 'high' ? `${error}18` : item.priority === 'medium' ? `${warning}18` : `${accent}18`,
                    color: item.priority === 'high' ? error : item.priority === 'medium' ? warning : accent,
                    fontSize: 10, fontWeight: 700,
                  }}>
                    {item.priority === 'high' ? '!' : item.priority === 'medium' ? '•' : '·'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
                        padding: '1px 4px', borderRadius: 3,
                        background: item.priority === 'high' ? `${error}18` : item.priority === 'medium' ? `${warning}18` : `${accent}18`,
                        color: item.priority === 'high' ? error : item.priority === 'medium' ? warning : accent,
                      }}>
                        {item.priority}
                      </span>
                      <span style={{ fontSize: 11, color: textPrimary }}>{item.area}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: textMuted }}>{item.suggestion}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Markdown 原文预览 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
          }}>
            <FileText size={14} style={{ color: textMuted }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>
              {t('report.fullReport', '完整报告')}
            </span>
          </div>
          <div style={{
            padding: '12px 16px', borderRadius: 8, background: isDark ? '#0d0d0f' : '#f8f8f6',
            border: `1px solid ${cardBorder}`,
            fontSize: 12, lineHeight: 1.7, color: textPrimary,
            whiteSpace: 'pre-wrap', fontFamily: 'SF Mono, Monaco, Consolas, monospace',
            maxHeight: 400, overflow: 'auto',
          }}>
            {report.markdownContent}
          </div>
        </div>
      </div>
    </div>
  );
});