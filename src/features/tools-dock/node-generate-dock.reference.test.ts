/**
 * 纯文生图模型的参考素材区（2026-11-10 用户要求）：
 * Krea2 只有文本输入，面板不能再出现「拖入节点连入参考/点击上传素材」这种误导性入口。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, 'node-generate-dock.tsx'), 'utf8');

describe('Krea2 / Moss = 纯文生图，不给参考图假入口', () => {
  it('Krea2 与 Moss 的输入类型只有 text', () => {
    expect(src).toMatch(/currentModelValue === KREA2_MODEL_KEY \|\| currentModelValue === MOSS_MODEL_KEY\)\s*return \['text'\]/);
  });

  it('参考素材区按 supportsReferenceInput 条件渲染，否则显示「不支持参考图」说明', () => {
    expect(src).toContain('const supportsReferenceInput = supportedInputTypes.some((t) => t !== \'text\');');
    expect(src).toContain('{supportsReferenceInput ? (');
    expect(src).toContain('data-no-reference-input');
    expect(src).toContain('textOnlyModel');
  });
});
