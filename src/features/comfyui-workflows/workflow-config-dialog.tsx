/**
 * workflow-config-dialog — 约定工作流登记面板（从右上角 ComfyUI 弹层进入）
 *
 * 只做三件事：登记清单（名称/用途/API JSON/输入映射/输出映射）、保存前用 /object_info 校验、
 * 用一条最小参数真实试跑并回显结果或原始错误。地址只从 comfyui-endpoint 读，不在此处输入。
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { normalizeBaseUrl } from '@/features/canvas-tabs/comfyui-bridge-client.js';
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import {
  WORKFLOW_PURPOSE_LABELS,
  applyWorkflowInputs,
  createWorkflowId,
  fetchObjectInfo,
  findMappingIssues,
  parseWorkflowApiJson,
  testRunWorkflow,
  useWorkflowRegistryStore,
  validateAgainstObjectInfo,
  type ComfyuiWorkflowEntry,
  type WorkflowFieldRef,
  type WorkflowInputMapping,
  type WorkflowOutputKind,
  type WorkflowPurpose,
  type WorkflowTestOutcome,
} from './workflow-registry.js';

const { Text } = Typography;

const MAPPING_ROWS: Array<{ key: keyof WorkflowInputMapping; label: string }> = [
  { key: 'positivePrompt', label: '正向提示词' },
  { key: 'negativePrompt', label: '负向提示词' },
  { key: 'seed', label: '随机种子' },
  { key: 'width', label: '宽' },
  { key: 'height', label: '高' },
  { key: 'image', label: '图生图输入图像' },
  { key: 'steps', label: '步数（可选）' },
  { key: 'cfg', label: 'CFG（可选）' },
];

const OUTPUT_KIND_OPTIONS: Array<{ value: WorkflowOutputKind; label: string }> = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'gif', label: 'GIF' },
];

interface DraftState {
  id: string;
  name: string;
  purpose: WorkflowPurpose;
  jsonText: string;
  mapping: WorkflowInputMapping;
  outputNodeId: string;
  outputKind: WorkflowOutputKind;
}

function emptyDraft(): DraftState {
  return {
    id: createWorkflowId(),
    name: '',
    purpose: 'text2image',
    jsonText: '',
    mapping: {},
    outputNodeId: '',
    outputKind: 'image',
  };
}

function draftFromEntry(entry: ComfyuiWorkflowEntry): DraftState {
  return {
    id: entry.id,
    name: entry.name,
    purpose: entry.purpose,
    jsonText: JSON.stringify(entry.workflow, null, 2),
    mapping: entry.inputMapping,
    outputNodeId: entry.outputMapping.nodeId,
    outputKind: entry.outputMapping.kind,
  };
}

function refText(ref: WorkflowFieldRef | undefined): string {
  return ref ? ref.nodeId : '';
}

function refInput(ref: WorkflowFieldRef | undefined): string {
  return ref ? ref.input : '';
}

export function WorkflowConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const workflows = useWorkflowRegistryStore((s) => s.workflows);
  const upsert = useWorkflowRegistryStore((s) => s.upsert);
  const remove = useWorkflowRegistryStore((s) => s.remove);
  const address = useComfyuiEndpointStore((s) => s.address);
  const baseUrl = normalizeBaseUrl(address);

  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'idle' | 'validating' | 'testing'>('idle');
  const [errors, setErrors] = useState<string[]>([]);
  const [testOutcome, setTestOutcome] = useState<WorkflowTestOutcome | null>(null);
  const [probeImage, setProbeImage] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setTestOutcome(null);
    setBusy('idle');
  }, [open]);

  const selectEntry = useCallback((entry: ComfyuiWorkflowEntry) => {
    setSelectedId(entry.id);
    setDraft(draftFromEntry(entry));
    setErrors([]);
    setTestOutcome(null);
  }, []);

  const startNew = useCallback(() => {
    setSelectedId(null);
    setDraft(emptyDraft());
    setErrors([]);
    setTestOutcome(null);
  }, []);

  const patchMapping = useCallback((key: keyof WorkflowInputMapping, part: 'nodeId' | 'input', value: string) => {
    setDraft((d) => {
      const current = d.mapping[key];
      const next: WorkflowFieldRef = {
        nodeId: part === 'nodeId' ? value.trim() : (current?.nodeId ?? ''),
        input: part === 'input' ? value.trim() : (current?.input ?? ''),
      };
      const mapping = { ...d.mapping };
      if (!next.nodeId && !next.input) delete mapping[key];
      else mapping[key] = next;
      return { ...d, mapping };
    });
  }, []);

  const parsed = useMemo(() => (draft.jsonText.trim() ? parseWorkflowApiJson(draft.jsonText) : null), [draft.jsonText]);

  const buildEntry = useCallback((): { entry: ComfyuiWorkflowEntry } | { error: string } => {
    if (!draft.name.trim()) return { error: '请填写工作流名称' };
    const p = parseWorkflowApiJson(draft.jsonText);
    if (!p.ok) return { error: p.error };
    const entry: ComfyuiWorkflowEntry = {
      id: draft.id,
      name: draft.name.trim(),
      purpose: draft.purpose,
      workflow: p.workflow,
      inputMapping: draft.mapping,
      outputMapping: { nodeId: draft.outputNodeId.trim(), kind: draft.outputKind },
      updatedAt: new Date().toISOString(),
    };
    const issues = findMappingIssues(entry);
    return issues.length > 0 ? { error: issues.join('；') } : { entry };
  }, [draft]);

  const save = useCallback(async () => {
    const built = buildEntry();
    if ('error' in built) {
      setErrors([built.error]);
      return;
    }
    setBusy('validating');
    setErrors([]);
    try {
      const info = await fetchObjectInfo(baseUrl);
      const problems = validateAgainstObjectInfo(built.entry.workflow, info);
      if (problems.length > 0) {
        setErrors(problems);
        return;
      }
      upsert(built.entry);
      setSelectedId(built.entry.id);
      message.success('工作流已保存并通过校验');
    } catch (err) {
      setErrors([`无法校验（${err instanceof Error ? err.message : String(err)}），未保存`]);
    } finally {
      setBusy('idle');
    }
  }, [baseUrl, buildEntry, message, upsert]);

  const validateOnly = useCallback(async () => {
    const built = buildEntry();
    if ('error' in built) {
      setErrors([built.error]);
      return;
    }
    setBusy('validating');
    setErrors([]);
    try {
      const info = await fetchObjectInfo(baseUrl);
      setErrors(validateAgainstObjectInfo(built.entry.workflow, info));
    } catch (err) {
      setErrors([`无法校验（${err instanceof Error ? err.message : String(err)}）`]);
    } finally {
      setBusy('idle');
    }
  }, [baseUrl, buildEntry]);

  const testRun = useCallback(async () => {
    const built = buildEntry();
    if ('error' in built) {
      setErrors([built.error]);
      return;
    }
    const mapping = built.entry.inputMapping;
    if (mapping.image && !probeImage.trim()) {
      setErrors(['图生图映射已启用：请填写 ComfyUI input 目录下的图片文件名再试跑']);
      return;
    }
    const applied = applyWorkflowInputs(built.entry.workflow, mapping, { positivePrompt: '__zeroexo_probe__' });
    if (!applied.ok) {
      setErrors([applied.error]);
      return;
    }
    setBusy('testing');
    setErrors([]);
    setTestOutcome(null);
    const outcome = await testRunWorkflow(
      baseUrl,
      built.entry.workflow,
      mapping,
      built.entry.outputMapping,
      {
        positivePrompt: '__zeroexo_probe__',
        negativePrompt: mapping.negativePrompt ? '' : undefined,
        seed: mapping.seed ? 0 : undefined,
        width: mapping.width ? 512 : undefined,
        height: mapping.height ? 512 : undefined,
        steps: mapping.steps ? 20 : undefined,
        cfg: mapping.cfg ? 7 : undefined,
        image: mapping.image ? probeImage.trim() : undefined,
      },
    );
    setTestOutcome(outcome);
    setBusy('idle');
  }, [baseUrl, buildEntry, probeImage]);

  const previewUrl = testOutcome?.ok && testOutcome.files[0]?.url ? testOutcome.files[0].url : null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      // 2026-11-05 用户指令：所有弹层屏幕居中（antd Modal 默认 top:100px，必须显式 centered）
      centered
      width={920}
      title="ComfyUI 约定工作流"
      destroyOnHidden
    >
      <div style={{ display: 'flex', gap: 12, height: 560 }}>
        <div style={{ width: 232, display: 'flex', flexDirection: 'column', gap: 8, borderRight: '1px solid rgba(128,128,128,0.25)', paddingRight: 12 }}>
          <Button size="small" type="primary" onClick={startNew} data-testid="workflow-new">
            新建
          </Button>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workflows.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未登记工作流" />
            ) : (
              workflows.map((w) => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Button
                    type={selectedId === w.id ? 'primary' : 'text'}
                    size="small"
                    style={{ flex: 1, justifyContent: 'flex-start', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    onClick={() => selectEntry(w)}
                  >
                    {w.name}
                  </Button>
                  <Tag style={{ marginInlineEnd: 0 }}>{WORKFLOW_PURPOSE_LABELS[w.purpose]}</Tag>
                  <Popconfirm title={`删除「${w.name}」？`} onConfirm={() => remove(w.id)}>
                    <Button size="small" type="text" danger>
                      ×
                    </Button>
                  </Popconfirm>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder="名称（如：Flux 文生图）"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              data-testid="workflow-name"
              style={{ flex: 1 }}
            />
            <Select
              value={draft.purpose}
              style={{ width: 120 }}
              options={(Object.keys(WORKFLOW_PURPOSE_LABELS) as WorkflowPurpose[]).map((p) => ({
                value: p,
                label: WORKFLOW_PURPOSE_LABELS[p],
              }))}
              onChange={(purpose) => setDraft((d) => ({ ...d, purpose }))}
              data-testid="workflow-purpose"
            />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>工作流 JSON（API 格式）</Text>
            <Input.TextArea
              value={draft.jsonText}
              onChange={(e) => setDraft((d) => ({ ...d, jsonText: e.target.value }))}
              rows={7}
              placeholder='{"3":{"class_type":"KSampler","inputs":{...}}}'
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              data-testid="workflow-json"
            />
            {parsed && !parsed.ok && (
              <Text type="danger" style={{ fontSize: 12 }}>{parsed.error}</Text>
            )}
            {parsed?.ok && (
              <Text type="secondary" style={{ fontSize: 12 }}>节点 {Object.keys(parsed.workflow).length} 个</Text>
            )}
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>输入映射（节点 id / 字段名）</Text>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 4, marginTop: 4 }}>
              {MAPPING_ROWS.map(({ key, label }) => (
                <Fragment key={key}>
                  <Text style={{ fontSize: 12, lineHeight: '24px' }}>{label}</Text>
                  <Input
                    size="small"
                    placeholder="节点 id"
                    value={refText(draft.mapping[key])}
                    onChange={(e) => patchMapping(key, 'nodeId', e.target.value)}
                    data-testid={`workflow-map-${key}-node`}
                  />
                  <Input
                    size="small"
                    placeholder="字段名"
                    value={refInput(draft.mapping[key])}
                    onChange={(e) => patchMapping(key, 'input', e.target.value)}
                    data-testid={`workflow-map-${key}-input`}
                  />
                </Fragment>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>输出映射</Text>
            <Input
              size="small"
              style={{ width: 120 }}
              placeholder="节点 id"
              value={draft.outputNodeId}
              onChange={(e) => setDraft((d) => ({ ...d, outputNodeId: e.target.value }))}
              data-testid="workflow-output-node"
            />
            <Select
              size="small"
              style={{ width: 96 }}
              value={draft.outputKind}
              options={OUTPUT_KIND_OPTIONS}
              onChange={(outputKind) => setDraft((d) => ({ ...d, outputKind }))}
              data-testid="workflow-output-kind"
            />
            {draft.mapping.image && (
              <Input
                size="small"
                style={{ width: 200 }}
                placeholder="试跑图片文件名"
                value={probeImage}
                onChange={(e) => setProbeImage(e.target.value)}
                data-testid="workflow-probe-image"
              />
            )}
          </div>

          <Space>
            <Button size="small" onClick={() => void validateOnly()} loading={busy === 'validating'}>
              校验
            </Button>
            <Button size="small" type="primary" onClick={() => void save()} loading={busy === 'validating'}>
              保存
            </Button>
            <Button size="small" onClick={() => void testRun()} loading={busy === 'testing'} data-testid="workflow-test-run">
              试跑
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>地址：{baseUrl}</Text>
          </Space>

          {errors.length > 0 && (
            <div data-testid="workflow-errors" style={{ padding: 8, borderRadius: 6, background: 'rgba(250,173,20,0.12)', border: '1px solid rgba(250,173,20,0.35)' }}>
              {errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12 }}>· {e}</div>
              ))}
            </div>
          )}

          {testOutcome && (
            <div data-testid="workflow-test-result" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {testOutcome.ok ? (
                <Text type="success" style={{ fontSize: 12 }}>
                  试跑成功：{testOutcome.files.length} 个产物（prompt_id {testOutcome.promptId}）
                </Text>
              ) : (
                <Text type="danger" style={{ fontSize: 12 }}>试跑失败（{testOutcome.stage}）：{testOutcome.message}</Text>
              )}
              {previewUrl && <img src={previewUrl} alt="试跑产物" style={{ maxWidth: 240, maxHeight: 160, objectFit: 'contain' }} />}
              <Text type="secondary" style={{ fontSize: 12 }}>原始返回</Text>
              <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', fontSize: 11, background: 'rgba(128,128,128,0.10)', padding: 6, borderRadius: 6 }}>
                {JSON.stringify(testOutcome.ok ? testOutcome.rawHistory : (testOutcome.raw ?? testOutcome), null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
