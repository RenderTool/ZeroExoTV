/**
 * 工作区外框圆角单一来源：画布容器与导演台提示词输入区共用。
 */
import { describe, expect, it } from 'vitest';
import { WORKSPACE_SURFACE_RADIUS, WORKSPACE_SURFACE_STYLE } from './LAYOUT_CONSTANTS.js';

describe('WORKSPACE_SURFACE_RADIUS', () => {
  it('画布外框样式直接由同一常量取值', () => {
    expect(WORKSPACE_SURFACE_RADIUS).toBe(12);
    expect(WORKSPACE_SURFACE_STYLE.borderRadius).toBe(WORKSPACE_SURFACE_RADIUS);
  });
});
