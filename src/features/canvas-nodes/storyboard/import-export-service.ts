/**
 * import-export-service — 自定义导入/导出接口
 *
 * 2026-08-31 全量改造：用户可绕过 Agent 自行导入/导出/编辑数据
 * 支持格式：
 * - 导入：剧本（markdown/txt/JSON）、圣经（JSON）、分镜序列（JSON）
 * - 导出：分镜序列（JSON/CSV）
 *
 * 设计原则：所有输入和输出都允许用户手动编辑，不锁死在 Agent 内部。
 */

export interface ImportScriptInput {
  /** 原始文本内容 */
  content: string;
  /** 来源格式 */
  format: 'markdown' | 'text' | 'json';
  /** 可选标题 */
  title?: string;
}

export interface ImportBibleInput {
  /** 圣经 JSON 数据 */
  characters: Array<{
    name: string;
    description: string;
    anchorSentence?: string;
    states?: Array<{ name: string; note?: string }>;
  }>;
  scenes?: Array<{
    name: string;
    description: string;
    atmosphere?: string;
  }>;
  props?: Array<{
    name: string;
    description: string;
  }>;
  /** 来源格式 */
  format: 'json';
}

export interface ImportShotsInput {
  /** 分镜序列 JSON */
  shots: Array<{
    number: number;
    shotType: string;
    cameraMovement: string;
    duration: number;
    description: string;
    imagePrompt: string;
    videoPrompt: string;
    negativePrompt?: string;
  }>;
  format: 'json';
}

export interface ExportShotsOptions {
  format: 'json' | 'csv';
  /** 文件名（不含扩展名） */
  filename?: string;
}

/**
 * 解析导入的剧本文本
 * 支持 markdown 分章、纯文本分段、JSON 结构化
 */
export function parseScriptInput(input: ImportScriptInput): {
  chapters: Array<{ title: string; content: string }>;
  rawText: string;
} {
  const { content, format } = input;

  if (format === 'json') {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return {
          chapters: parsed.map((c: any) => ({
            title: c.title ?? c.head ?? `第 ${parsed.indexOf(c) + 1} 章`,
            content: c.content ?? c.text ?? JSON.stringify(c),
          })),
          rawText: content,
        };
      }
      if (parsed.chapters) {
        return {
          chapters: parsed.chapters.map((c: any) => ({
            title: c.title ?? `第 ${parsed.chapters.indexOf(c) + 1} 章`,
            content: c.content ?? c.text ?? '',
          })),
          rawText: content,
        };
      }
      return {
        chapters: [{ title: input.title ?? '剧本', content: parsed.content ?? JSON.stringify(parsed) }],
        rawText: content,
      };
    } catch {
      // JSON 解析失败，降级为纯文本
      return { chapters: [{ title: input.title ?? '剧本', content }], rawText: content };
    }
  }

  // markdown 或纯文本：按章节分割
  const chapterRegex = /^#{1,3}\s+(.+)$|^第[\d一二三四五六七八九十百]+[集章回]\s*(.*)$/gm;
  const chapters: Array<{ title: string; content: string }> = [];
  let lastIndex = 0;
  let lastTitle = '开篇';
  let match: RegExpExecArray | null;

  while ((match = chapterRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      chapters.push({
        title: lastTitle,
        content: content.slice(lastIndex, match.index).trim(),
      });
    }
    lastTitle = match[1] ?? match[2] ?? '章节';
    lastIndex = match.index + match[0].length;
  }

  // 剩余内容
  if (lastIndex < content.length) {
    chapters.push({
      title: lastTitle,
      content: content.slice(lastIndex).trim(),
    });
  }

  if (chapters.length === 0) {
    chapters.push({ title: input.title ?? '剧本', content });
  }

  return { chapters, rawText: content };
}

/**
 * 解析导入的圣经 JSON
 */
export function parseBibleInput(input: ImportBibleInput): {
  characters: ImportBibleInput['characters'];
  scenes: NonNullable<ImportBibleInput['scenes']>;
  props: NonNullable<ImportBibleInput['props']>;
} {
  return {
    characters: input.characters ?? [],
    scenes: input.scenes ?? [],
    props: input.props ?? [],
  };
}

/**
 * 解析导入的分镜 JSON
 */
export function parseShotsInput(input: ImportShotsInput): ImportShotsInput['shots'] {
  if (!Array.isArray(input.shots)) {
    throw new Error('分镜数据必须是数组');
  }
  return input.shots.map((shot, index) => ({
    number: shot.number ?? index + 1,
    shotType: shot.shotType ?? '中景',
    cameraMovement: shot.cameraMovement ?? '固定',
    duration: shot.duration ?? 5,
    description: shot.description ?? '',
    imagePrompt: shot.imagePrompt ?? '',
    videoPrompt: shot.videoPrompt ?? '',
    negativePrompt: shot.negativePrompt ?? '',
  }));
}

/**
 * 导出分镜序列
 */
export function exportShots(
  shots: ExportShotsOptions['format'] extends 'csv' ? any[] : any[],
  options: ExportShotsOptions,
): string {
  const { format } = options;

  if (format === 'csv') {
    // CSV 导出（带 BOM 头，兼容 Excel）
    const headers = ['#', '景别', '运镜', '时长(秒)', '画面描述', '图片提示词', '视频提示词', '负面提示词'];
    const rows = shots.map((s) => [
      s.number ?? '',
      s.shotType ?? '',
      s.cameraMovement ?? '',
      s.duration ?? '',
      `"${(s.description ?? '').replace(/"/g, '""')}"`,
      `"${(s.imagePrompt ?? '').replace(/"/g, '""')}"`,
      `"${(s.videoPrompt ?? '').replace(/"/g, '""')}"`,
      `"${(s.negativePrompt ?? '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    return '\uFEFF' + csvContent; // BOM for Excel
  }

  // JSON 导出
  return JSON.stringify(shots, null, 2);
}

/**
 * 下载文件（浏览器）
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 读文件为文本（浏览器 FileReader）
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}