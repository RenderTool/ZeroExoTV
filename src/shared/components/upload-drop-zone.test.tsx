/**
 * UploadDropZone 验收（2026-11-05）：抽屉 / 首页 / @ 面板三处共用同一落区组件。
 * data-upload-dropzone 是统一标记；样式 token 来自 theme.toolbar（不新造一套）。
 */
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { UploadDropZone } from './upload-drop-zone.js';

const THEME = { mode: 'light', toolbar: { text: '#111', textMuted: '#888', border: '#ddd', accent: '#1677ff' } } as any;

function file(name: string, type: string): File {
  return new File(['x'], name, { type });
}

describe('UploadDropZone', () => {
  it('外部文件 drop → onFiles 调用一次且文件数正确', () => {
    const onFiles = vi.fn();
    render(
      <UploadDropZone onFiles={onFiles} theme={THEME} accept={['image/*']}>
        <div>内容</div>
      </UploadDropZone>,
    );
    const zone = document.querySelector('[data-upload-dropzone]') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [file('a.png', 'image/png'), file('b.jpg', 'image/jpeg')], types: ['Files'] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect((onFiles.mock.calls[0]![0] as FileList).length).toBe(2);
  });

  it('不支持格式 → 可读错误文案，且不触发上传', () => {
    const onFiles = vi.fn();
    render(<UploadDropZone onFiles={onFiles} theme={THEME} accept={['image/*']} />);
    const zone = document.querySelector('[data-upload-dropzone]') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [file('a.exe', 'application/x-msdownload')], types: ['Files'] } });
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByText(/不支持的格式：a\.exe/)).toBeTruthy();
  });

  it('站内卡片拖拽（非 Files）不拦截、不上传', () => {
    const onFiles = vi.fn();
    render(<UploadDropZone onFiles={onFiles} theme={THEME} />);
    const zone = document.querySelector('[data-upload-dropzone]') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [], types: ['x-testlib-item'] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('拖入外部文件 → 高亮落区出现，离开后消失', () => {
    render(<UploadDropZone onFiles={() => undefined} theme={THEME} />);
    const zone = document.querySelector('[data-upload-dropzone]') as HTMLElement;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(document.querySelector('[data-upload-dropzone-overlay]')).toBeTruthy();
    fireEvent.dragLeave(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(document.querySelector('[data-upload-dropzone-overlay]')).toBeNull();
  });
});
