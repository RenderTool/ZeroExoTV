/**
 * MCP 图片作业消费者结构契约（2026-11-11）：
 * 必须建节点 → 生成 → 落历史 → 写状态文件，MCP 才能轮询到结果；作业文件处理后要删掉避免重复生成。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
  resolve(process.cwd(), 'src/features/mcp-image-jobs/use-mcp-image-jobs.ts'),
  'utf8',
);

describe('useMcpImageJobs 结构契约', () => {
  it('轮询共享目录并消费作业文件', () => {
    expect(src).toContain("MCP_IMAGE_JOB_DIR = '.lf/zeroexo/app_meta/image-jobs'");
    expect(src).toContain('listDir(MCP_IMAGE_JOB_DIR)');
    expect(src).toContain('removeFile(jobRel)');
    expect(src).toContain('job.projectId !== projectId');
  });

  it('建图片节点、调三种模型、落历史、写状态', () => {
    expect(src).toContain('new AddNodeCommand');
    expect(src).toContain('generateMossImage');
    expect(src).toContain('generateKrea2Image');
    expect(src).toContain('generateLocalQwenImage');
    expect(src).toContain('autoLandGenerationBlob');
    expect(src).toContain('.status.json');
    expect(src).toContain('state: \'running\'');
  });
});
