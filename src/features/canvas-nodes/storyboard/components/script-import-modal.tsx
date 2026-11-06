/**
 * ScriptImportModal — 剧本导入弹窗
 *
 * 职责边界：软件只提供规范模板，不做审查；把原稿整理成规范剧本属于 MCP 流程。
 * 流程：选择文件 / 粘贴文本（二选一）→ 导入 → 选择落位方式。
 * 任何非空纯文本都能导入：主按钮只有「导入」，不因格式禁用或降级，
 * 两处入口共用同一条 commitScriptImport（落位/备份/版本链路不变）。
 *
 * 保存方式三选一（单选，默认「新建一集」最保守）：
 * - 新建一集：序号 nextEpisodeNumber、标题 autoEpisodeTitle、切 activeEpisodeId 到新集；
 * - 追加到当前集：加入当前选中集，可选放到最后或放到开头，不动已有内容；
 * - 替换当前集：先二次确认（写明替换对象与现有字数），保存前自动备份到
 *   entities/backups/，备份失败则中止导入。
 *
 * 幂等：按钮 loading 锁 + importingRef 同步闸 + service 层在途去重，连点只保存一次。
 * 冲突：ScriptConflictError → 提示「剧本刚被别处改过，请重新导入」，不重试不强写。
 */
import { useCallback, useRef, useState } from 'react';
import { App, Button, Drawer, Input, Modal, Radio } from 'antd';
import { FileUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { ScriptConflictError } from '@/entities/script-store.js';
import {
  decodeScriptBuffer, parseScriptImport,
  ScriptImportEmptyError, type ParsedScriptImport,
} from '../script-import-parser.js';
import {
  commitScriptImport, ScriptImportBackupError, type ScriptImportStrategy,
} from '../script-import-service.js';

export interface ScriptImportModalProps {
  open: boolean;
  projectId: string;
  /** 当前选中集（追加/替换的目标；无则禁用这两种方式） */
  activeEpisode: { id: string; number: number; title: string; chars: number } | null;
  onClose: () => void;
  /** 保存成功后回调（调用方重读实体刷新） */
  onImported: () => void;
}

/** 单文件上限 5MB（超大文件请拆分后导入） */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 粘贴文本的伪文件名（用来和选文件区分） */
const PASTED_NAME = 'pasted.txt';

/** 推荐模板（可复制，仅作格式参考，不参与校验） */
const SCRIPT_TEMPLATE = [
  '# 雨夜',
  '## 第1集：来客',
  '### 第1场：杂货铺 · 内 · 夜',
  '雨点敲着铁皮檐。',
  '老张：今天这么晚？',
].join('\n');

export function ScriptImportModal({
  open, projectId, activeEpisode, onClose, onImported,
}: ScriptImportModalProps): React.ReactElement {
  const { message, modal } = App.useApp();
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedScriptImport | null>(null);
  /** 粘贴文本（与选文件二选一：以最后一次操作为准） */
  const [pastedText, setPastedText] = useState('');
  const [parseError, setParseError] = useState('');
  const [specOpen, setSpecOpen] = useState(false);
  const [strategy, setStrategy] = useState<ScriptImportStrategy>('new-episode');
  const [position, setPosition] = useState<'end' | 'start'>('end');
  const [committing, setCommitting] = useState(false);
  // 同步闸：loading 状态刷帧之前拦住连点
  const importingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback((): void => {
    setFileName('');
    setParsed(null);
    setPastedText('');
    setParseError('');
    setSpecOpen(false);
    setStrategy('new-episode');
    setPosition('end');
    setCommitting(false);
    importingRef.current = false;
  }, []);

  const handleClose = useCallback((): void => {
    if (importingRef.current) return; // 写入途中禁止关闭，避免状态悬挂
    reset();
    onClose();
  }, [onClose, reset]);

  const handleFile = useCallback((file: File): void => {
    setParseError('');
    setParsed(null);
    setPastedText(''); // 二选一：以最后一次操作为准，清掉粘贴内容
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setParseError(t('scriptImportModal.fileTooLarge', '超过 5MB'));
      return;
    }
    void file.arrayBuffer().then((buf) => {
      try {
        const decoded = decodeScriptBuffer(buf);
        setParsed(parseScriptImport({ filename: file.name, text: decoded.text, encoding: decoded.encoding }));
      } catch (err) {
        if (err instanceof ScriptImportEmptyError) {
          setParseError(t('scriptImportModal.fileEmpty', '文件是空的'));
        } else {
          setParseError(t('scriptImportModal.fileUnreadable', '这个文件读不出来，换一个试试'));
        }
      }
    }).catch(() => setParseError(t('scriptImportModal.fileUnreadable', '这个文件读不出来，换一个试试')));
  }, [t]);

  const doCommit = useCallback((): void => {
    if (!parsed || importingRef.current) return;
    importingRef.current = true;
    setCommitting(true);
    void commitScriptImport({
      projectId,
      parsed,
      strategy,
      targetEpisodeId: activeEpisode?.id,
      position,
    }).then((result) => {
      const targetNumber = result.targetEpisodeId
        ? result.entity.episodes.find((e) => e.id === result.targetEpisodeId)?.number ?? ''
        : '';
      if (result.strategy === 'new-episode') {
        message.success(t('scriptImportModal.successNewEpisode', {
          defaultValue: '已新建 {{n}} 集',
          n: result.createdEpisodeIds.length,
        }));
      } else if (result.strategy === 'append') {
        message.success(t('scriptImportModal.successAppend', {
          defaultValue: '已加到第 {{n}} 集',
          n: targetNumber,
        }));
      } else {
        message.success(t('scriptImportModal.successOverwrite', {
          defaultValue: '已替换第 {{n}} 集',
          n: targetNumber,
        }));
      }
      importingRef.current = false;
      setCommitting(false);
      reset();
      onImported();
      onClose();
    }).catch((err: unknown) => {
      importingRef.current = false;
      setCommitting(false);
      if (err instanceof ScriptConflictError) {
        message.error(t('scriptImportModal.conflict', '剧本已被改过，请重新导入'));
      } else if (err instanceof ScriptImportBackupError) {
        message.error(t('scriptImportModal.backupFailed', '备份失败，已取消'));
      } else {
        message.error(t('scriptImportModal.importFailed', '导入失败，请重试'));
      }
    });
  }, [parsed, projectId, strategy, activeEpisode, position, message, t, reset, onImported, onClose]);

  const handleConfirm = useCallback((): void => {
    if (!parsed || importingRef.current) return;
    if (strategy === 'overwrite' && activeEpisode) {
      // 替换必须二次确认，写清替换对象与现有字数
      modal.confirm({
        title: t('scriptImportModal.confirmReplaceTitle', '确认替换'),
        centered: true,
        content: t('scriptImportModal.confirmReplaceContent', {
          defaultValue: '第 {{n}} 集现有 {{chars}} 字将被替换',
          n: activeEpisode.number, chars: activeEpisode.chars,
        }),
        okText: t('scriptImportModal.confirmReplaceOk', '替换'),
        cancelText: t('scriptImportModal.cancel', '取消'),
        okButtonProps: { danger: true },
        onOk: () => doCommit(),
      });
      return;
    }
    doCommit();
  }, [parsed, strategy, activeEpisode, modal, doCommit, t]);

  const copyExample = useCallback((): void => {
    const pending = navigator.clipboard?.writeText(SCRIPT_TEMPLATE);
    if (!pending) return;
    void pending
      .then(() => message.success(t('scriptImportModal.specCopied', '已复制')))
      .catch(() => undefined);
  }, [message, t]);

  /** 规范字段：格式行 + 一行说明 */
  const specRows = [
    [t('scriptImportModal.specFieldTitleLine', '# 剧名'), t('scriptImportModal.specFieldTitleNote', '必填')],
    [t('scriptImportModal.specFieldEpisodeLine', '## 第N集：集名'), t('scriptImportModal.specFieldEpisodeNote', '每集一行')],
    [t('scriptImportModal.specFieldSceneLine', '### 第M场：场景名 · 内 · 夜'), t('scriptImportModal.specFieldSceneNote', '每场一行')],
    [t('scriptImportModal.specFieldDialogueLine', '角色名：台词'), t('scriptImportModal.specFieldDialogueNote', '每句一行')],
    [t('scriptImportModal.specFieldSubjectLine', '[主体 @名称]'), t('scriptImportModal.specFieldSubjectNote', '可选')],
  ];
  const codeBlockStyle: React.CSSProperties = {
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    borderRadius: 4, padding: '8px 10px', fontFamily: 'monospace', fontSize: 12,
    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  };

  return (
    <>
      <Modal
        open={open}
        title={t('scriptImportModal.title', '导入剧本')}
        centered
        width={560}
        onCancel={handleClose}
        footer={[
          <Button key="cancel" onClick={handleClose} disabled={committing}>
            {t('scriptImportModal.cancel', '取消')}
          </Button>,
          // 无格式门槛：只有「导入」，不因格式禁用或降级
          <Button
            key="ok"
            type="primary"
            disabled={!parsed || committing || (strategy !== 'new-episode' && !activeEpisode)}
            loading={committing}
            onClick={handleConfirm}
          >
            {t('scriptImportModal.startImport', '导入')}
          </Button>,
        ]}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 文件选择 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button icon={<FileUp size={14} />} onClick={() => fileInputRef.current?.click()}>
              {t('scriptImportModal.chooseFile', '选择文件')}
            </Button>
            <span style={{ fontSize: 12, color: theme.toolbar.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName && fileName !== PASTED_NAME ? fileName : t('scriptImportModal.fileHint', '支持 .md / .txt')}
            </span>
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setSpecOpen(true)}>
              {t('scriptImportModal.viewSpec', '推荐模板')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.text,.fountain"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
          </div>

          {parseError && (
            <div style={{ fontSize: 12, color: '#d4380d' }}>{parseError}</div>
          )}

          {/* 粘贴文本入口：与选文件二选一（以最后一次操作为准） */}
          <Input.TextArea
            value={pastedText}
            onChange={(e) => {
              const text = e.target.value;
              setPastedText(text);
              setParseError('');
              if (!text.trim()) {
                setParsed(null);
                return;
              }
              setFileName(PASTED_NAME);
              try {
                setParsed(parseScriptImport({ filename: PASTED_NAME, text }));
              } catch (err) {
                setParsed(null);
                setParseError(err instanceof ScriptImportEmptyError
                  ? t('scriptImportModal.pasteEmpty', '还没有内容')
                  : t('scriptImportModal.pasteUnreadable', '内容读不出来'));
              }
            }}
            placeholder={t('scriptImportModal.pastePlaceholder', '或粘贴文本')}
            autoSize={{ minRows: 3, maxRows: 8 }}
            disabled={committing}
          />

          {/* 只给帮助：一句说明，不列问题、不拦截 */}
          <div style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
            {t('scriptImportModal.mcpNote', '只提供格式规范，转换由 MCP 模型处理')}
          </div>

          {/* 落位方式（单选，默认新建一集） */}
          <Radio.Group
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as ScriptImportStrategy)}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <Radio value="new-episode">
              <span style={{ fontSize: 13 }}>{t('scriptImportModal.modeNewEpisode', '新建一集')}</span>
              <div style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
                {t('scriptImportModal.modeNewEpisodeDesc', '不影响现有的集')}
              </div>
            </Radio>
            <Radio value="append" disabled={!activeEpisode}>
              <span style={{ fontSize: 13 }}>{t('scriptImportModal.modeAppend', '追加到当前集')}</span>
              <div style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
                {activeEpisode
                  ? t('scriptImportModal.modeAppendDesc', {
                    defaultValue: '加到第 {{n}} 集，顺序不变',
                    n: activeEpisode.number,
                  })
                  : t('scriptImportModal.noActiveEpisode', '没有选中的集')}
              </div>
              {strategy === 'append' && (
                <Radio.Group
                  value={position}
                  onChange={(e) => setPosition(e.target.value as 'end' | 'start')}
                  style={{ marginTop: 4, display: 'flex', gap: 12 }}
                >
                  <Radio value="end" style={{ fontSize: 12 }}>
                    {t('scriptImportModal.modeAppendEnd', '放到最后')}
                  </Radio>
                  <Radio value="start" style={{ fontSize: 12 }}>
                    {t('scriptImportModal.modeAppendStart', '放到开头')}
                  </Radio>
                </Radio.Group>
              )}
            </Radio>
            <Radio value="overwrite" disabled={!activeEpisode}>
              <span style={{ fontSize: 13, color: '#d4380d' }}>{t('scriptImportModal.modeOverwrite', '替换当前集')}</span>
              <div style={{ fontSize: 12, color: '#d4380d' }}>
                {activeEpisode
                  ? t('scriptImportModal.modeOverwriteDesc', {
                    defaultValue: '清空第 {{n}} 集，原内容有备份',
                    n: activeEpisode.number,
                  })
                  : t('scriptImportModal.noActiveEpisode', '没有选中的集')}
              </div>
            </Radio>
          </Radio.Group>
        </div>
      </Modal>

      {/* 推荐模板：格式字段 + 一份可复制的标准样例 */}
      <Drawer
        open={specOpen}
        onClose={() => setSpecOpen(false)}
        title={t('scriptImportModal.specTitle', '推荐模板')}
        width={420}
        zIndex={1100}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {specRows.map(([line, note]) => (
          <div key={line} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{line}</span>
            <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>{note}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, flex: 1 }}>{t('scriptImportModal.specExample', '示例')}</span>
          <Button size="small" onClick={copyExample}>{t('scriptImportModal.specCopy', '复制')}</Button>
        </div>
        <div style={codeBlockStyle}>{SCRIPT_TEMPLATE}</div>
        </div>
      </Drawer>
    </>
  );
}
