/**
 * ScriptMetaGroup - 资产抽屉「本剧信息」分组（2026-11-07 用户指令）
 *
 * 位置：画布左侧资产抽屉新增分组（仅剧本 / 导演台模块挂载）。
 * 内容：**整部剧**的一句话概述 + 推荐标签（不是每集）。保存经唯一写者 writeScript 落盘，
 * 乐观锁冲突 → 提示并重载，不静默覆盖。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Button, Input, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  readScript, watchScript, writeScript, ScriptConflictError,
  type ScriptEntity, type ScriptMeta,
} from '@/entities/script-store.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';

export interface ScriptMetaGroupProps {
  theme: ThemeConfig;
}

export function ScriptMetaGroup({ theme }: ScriptMetaGroupProps): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  // 剧本槽位绑定 = projectId（与剧本页签同一事实源）
  const projectId = useCanvasTabStore((s) => s.slotBindings.script);
  const [entity, setEntity] = useState<ScriptEntity | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<ScriptMeta>({});
  /** 剧名（可编辑；空值保存时回落原标题，不把剧本名写空） */
  const [titleDraft, setTitleDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const entityRef = useRef<ScriptEntity | null>(null);
  entityRef.current = entity;
  /** 用户有未保存编辑时，外部推送（编辑器自动保存等）不得覆盖草稿 */
  const dirtyRef = useRef(false);

  // 载入 + 订阅（本会话写入即时推送；外部 MCP 写入 2s 内推送）
  useEffect(() => {
    if (!projectId) { setEntity(null); return; }
    let cancelled = false;
    setLoading(true);
    void readScript(projectId).then((found) => {
      if (cancelled) return;
      setEntity(found);
      setDraft({ logline: found?.meta?.logline ?? '', tags: [...(found?.meta?.tags ?? [])] });
      setTitleDraft(found?.title ?? '');
      setLoading(false);
    }).catch(() => { if (!cancelled) { setEntity(null); setLoading(false); } });
    const unwatch = watchScript(projectId, (fresh) => {
      if (cancelled || !fresh) return;
      setEntity(fresh);
      // 有未保存编辑时只更新实体（拿最新 baseVersion），不覆盖草稿
      if (dirtyRef.current) return;
      setDraft({ logline: fresh.meta?.logline ?? '', tags: [...(fresh.meta?.tags ?? [])] });
      setTitleDraft(fresh.title ?? '');
    });
    return () => { cancelled = true; unwatch(); };
  }, [projectId]);

  const resetDraft = useCallback(() => {
    const base = entityRef.current;
    setDraft({ logline: base?.meta?.logline ?? '', tags: [...(base?.meta?.tags ?? [])] });
    setTitleDraft(base?.title ?? '');
  }, []);

  const handleSave = useCallback(async () => {
    const base = entityRef.current;
    if (!projectId || !base) return;
    setSaving(true);
    try {
      const next = await writeScript(projectId, {
        baseVersion: base.version,
        title: titleDraft.trim() || base.title,
        meta: {
          logline: draft.logline?.trim() || undefined,
          tags: (draft.tags ?? []).map((x) => x.trim()).filter(Boolean),
        },
      });
      setEntity(next);
      setTitleDraft(next.title);
      message.success(t('episodeList.metaSaved', '本剧信息已保存'));
    } catch (err) {
      if (err instanceof ScriptConflictError) {
        message.warning(t('canvasTab.scriptConflict', '剧本已被外部修改，已重新载入最新版本'));
        const fresh = await readScript(projectId).catch(() => null);
        if (fresh) {
          setEntity(fresh);
          setDraft({ logline: fresh.meta?.logline ?? '', tags: [...(fresh.meta?.tags ?? [])] });
          setTitleDraft(fresh.title ?? '');
        }
      } else {
        message.error(t('canvasTab.scriptSaveFailed', '剧本保存失败，请重试'));
      }
    } finally {
      setSaving(false);
    }
  }, [projectId, draft, titleDraft, message, t]);

  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;

  if (!projectId) {
    return (
      <div data-script-meta-group style={wrapStyle}>
        <div style={{ fontSize: 12, color: textMuted }}>{t('episodeList.metaNoProject', '打开一个剧本页后在此维护本剧信息')}</div>
      </div>
    );
  }

  return (
    <div data-script-meta-group style={wrapStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: text }}>{t('episodeList.scriptMetaTitle', '本剧信息')}</span>
      </div>

      {loading && <div style={{ fontSize: 12, color: textMuted }}>{t('common.loading', '加载中...')}</div>}

      {!loading && !entity && (
        <div data-script-meta-empty style={{ fontSize: 12, color: textMuted, lineHeight: 1.6 }}>
          {t('canvasTab.scriptMissing', '此项目尚无剧本')}
        </div>
      )}

      {entity && (
        <div data-script-meta-card style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 剧名：同样可编辑（2026-11-07 用户指令：所有条目都要能改） */}
          <label style={fieldStyle}>
            <span style={{ fontSize: 11, color: textMuted }}>{t('episodeList.scriptTitleLabel', '剧名')}</span>
            <Input
              data-script-meta-input="title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder={t('episodeList.scriptTitlePlaceholder', '这部剧的名字')}
              maxLength={60}
            />
          </label>
          <label style={fieldStyle}>
            <span style={{ fontSize: 11, color: textMuted }}>{t('episodeList.metaLogline', '一句话概述')}</span>
            <Input.TextArea
              data-script-meta-input="logline"
              value={draft.logline ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, logline: e.target.value }))}
              placeholder={t('episodeList.scriptLoglinePlaceholder', '一句话说清整部剧讲了什么')}
              autoSize={{ minRows: 3, maxRows: 6 }}
              maxLength={300}
              showCount
            />
          </label>
          <label style={fieldStyle}>
            <span style={{ fontSize: 11, color: textMuted }}>{t('episodeList.metaTags', '推荐标签')}</span>
            <Select
              data-script-meta-input="tags"
              mode="tags"
              value={draft.tags ?? []}
              onChange={(tags: string[]) => setDraft((d) => ({ ...d, tags }))}
              placeholder={t('episodeList.metaTagsPlaceholder', '输入后回车，或用逗号分隔')}
              tokenSeparators={[',', '，']}
              style={{ width: '100%' }}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button size="small" onClick={resetDraft}>{t('common.reset', '重置默认')}</Button>
            <Button size="small" type="primary" data-script-meta-save loading={saving} onClick={() => void handleSave()}>
              {t('common.save', '保存')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
};
