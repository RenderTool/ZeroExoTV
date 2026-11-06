/**
 * 画布副本接线守卫单测（Plan#84 / 征集#184，2026-11-06）
 *
 * 这层结构只能靠静态断言防回归（运行时要真实目录授权，jsdom 跑不通），而且**必须挡住"退回旧模型"**：
 * 1. 画布是项目的一等挂载物：统一契约 `kind:'canvas'` + `graphRef`，1 号 locked 不可删；
 * 2. 生成语义是**复制**：出现 ReplaceSceneCommand/RemoveNodeCommand/代理节点注册即视为退回旧模型，必红；
 * 3. 副本标签与 1 号**并排在顶层**（第二层页签条文件必须不存在）；
 * 4. 抽屉「画布」分组直接复用主页 `ProjectCard` + `CoverUploadModal`（不许另造卡片）；
 * 5. 旧文件（代理卡/外接桩/孤儿扫描/子页签条/第二 store）已彻底删除，旧命名不得复活。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(resolve(ROOT, 'src', rel), 'utf8');
const readMcp = (rel: string): string => readFileSync(resolve(ROOT, 'mcp-server', rel), 'utf8');
const exists = (rel: string): boolean => existsSync(resolve(ROOT, 'src', rel));

describe('画布 = 项目的一等挂载物（统一契约）', () => {
  const store = read('entities/canvas-store.ts');

  it('契约字段齐备：kind/id/projectId/title/order/locked/coverKey/version/graphRef', () => {
    for (const field of ["kind: 'canvas'", 'order: number', 'locked: boolean', 'coverKey: string | null', 'version: number', 'graphRef: CanvasGraphRef']) {
      expect(store).toContain(field);
    }
  });

  it('1 号 = 虚拟挂载（graphRef=project，图仍在 .lf/graph_data，引擎自动保存不动）', () => {
    expect(store).toContain("export const MAIN_CANVAS_ID = 'main'");
    expect(store).toContain("graphRef: 'project'");
    expect(store).toContain('loadProjectGraph(projectId)');
    expect(store).toContain('saveProjectGraph(projectId, patch.graph)');
  });

  it('1 号不可删；写入一律带 size+lastModified 乐观锁，新建撞名不静默覆盖', () => {
    expect(store).toContain("throw new Error('1 号主画布不可删除')");
    // 新建必须先查存在性（writeJsonIfUnchanged(..., null) 不代表“文件必须不存在”）
    expect(store).toContain('if (existing) throw new ConflictError(path, existing)');
    expect(store).toContain('writeJsonIfUnchanged(path, doc, null)');
    expect(store).toContain('writeJsonIfUnchanged(canvasPath(projectId, canvasId), next, expectedStamp)');
  });

  it('与 slot-containers 同一挂载姿态：幂等 ensure 且只写自己的目录', () => {
    expect(store).toContain('export async function ensureCanvasMounts');
    expect(store).toContain('projects/${projectId}/canvases');
  });
});

describe('生成链是复制，不是搬走', () => {
  it('canvas-copy 只读主 graph 后另存文档，不碰任何场景命令', () => {
    const copy = read('features/sub-canvas/canvas-copy.ts');
    expect(copy).toContain('createCanvasCopyFromSelection');
    expect(copy).toContain('createCanvas(projectId');
    // 旧模型的物理移除/批量命令一旦回来 = 又改成"搬走"，必须红
    expect(copy).not.toContain('ReplaceSceneCommand');
    expect(copy).not.toContain('RemoveNodeCommand');
    expect(copy).not.toContain('BatchCommand');
    // 组选区要连后代一起复制（只搬组壳是坏图）
    expect(copy).toContain('getDescendantIds');
  });

  it('宿主不再把命令队列传给生成器，也不再注册 subcanvas 节点类型', () => {
    const host = read('pages/editor/editor-canvas/use-editor-interactions.ts');
    expect(host).toContain('createCanvasCopyFromSelection({');
    expect(host).not.toContain('createSubCanvasFromSelection');
    expect(host).not.toContain('handleCreateSubCanvas');
    const state = read('pages/editor/editor-canvas/use-editor-state.ts');
    expect(state).not.toContain('createSubCanvasExtension');
    expect(state).not.toContain('subcanvas-extension');
  });
});

describe('入口三处仍接在同一宿主回调上', () => {
  it('组磁贴与组右键共用 getGroupTools 的 toCanvasCopy（多选含组时复制整个选区）', () => {
    const host = read('pages/editor/editor-canvas/use-editor-interactions.ts');
    expect(host).toContain("id: 'toCanvasCopy'");
    expect(host).toContain('handleCreateCanvasCopy(ids.length > 0 ? ids : [n.id])');
    expect(host).toMatch(/return \{[\s\S]*handleCreateCanvasCopy,[\s\S]*\};/);
  });

  it('选中节点后的右键菜单也有「保存为画布副本」，与磁贴走同一执行器', () => {
    const actions = read('pages/editor/editor-canvas/use-editor-interactions/use-node-actions.ts');
    expect(actions).toContain("key: 'toCanvasCopy'");
    expect(actions).toContain('onCreateCanvasCopy(copyIds)');
    expect(actions).toContain('getSelection().selectedNodeIds');
    // 宿主必须把唯一执行器传进右键 hook（少传直接编译报错，这里再钉一层）
    const host = read('pages/editor/editor-canvas/use-editor-interactions.ts');
    expect(host).toContain('onCreateCanvasCopy: handleCreateCanvasCopy');
  });

  it('多选聚合区按钮走同一回调，并由 editor-page 传入（旧命名不得残留）', () => {
    const bar = read('features/tools-dock/node-capsule-toolbar.tsx');
    expect(bar).toContain('onCreateCanvasCopy');
    expect(bar).toContain('data-capsule-action="canvas-copy"');
    expect(bar).not.toContain('onCreateSubCanvas');
    const page = read('pages/editor/editor-canvas/editor-page.tsx');
    expect(page).toContain('onCreateCanvasCopy={() => { void interactions.handleCreateCanvasCopy(); }}');
  });
});

describe('副本标签与 1 号并排在顶层', () => {
  it('CanvasTabBar 渲染 openCanvasTabs（可拖拽、可 ×），key = canvas:<cid>', () => {
    const bar = read('features/canvas-tabs/canvas-tab-bar.tsx');
    expect(bar).toContain('openCanvasTabs');
    expect(bar).toContain('data-canvas-copy-tab');
    expect(bar).toContain('data-canvas-copy-close');
    expect(bar).toContain('CANVAS_COPY_TAB_ICON');
    const tabStore = read('features/canvas-tabs/canvas-tab-store.ts');
    expect(tabStore).toContain("export const CANVAS_TAB_PREFIX = 'canvas:'");
    expect(tabStore).toContain('export function openCanvasTabCid');
    // 关完不自动重开：激活前必须校验"已打开"
    expect(tabStore).toContain('if (!get().openCanvasTabs.some((t) => t.key === key)) return;');
  });

  it('第二层子页签条与 旧文件已删除（不允许两套实现共存）', () => {
    for (const gone of [
      'features/canvas-tabs/sub-canvas-tab-bar.tsx',
      'features/canvas-tabs/sub-canvas-tab.test.tsx',
      'features/sub-canvas/subcanvas-store.ts',
      'features/sub-canvas/subcanvas-types.ts',
      'features/sub-canvas/subcanvas-extension.tsx',
      'features/sub-canvas/subcanvas-node-view.tsx',
      'features/sub-canvas/subcanvas-stubs.ts',
      'features/sub-canvas/SubCanvasExternalStubs.tsx',
      'features/sub-canvas/subcanvas-removal.ts',
      'features/sub-canvas/SubCanvasLayer.tsx',
      'features/sub-canvas/SubCanvasWorkspace.tsx',
    ]) {
      expect(exists(gone), `${gone} 应该已被删除`).toBe(false);
    }
  });

  it('editor-page 渲染 CanvasLayer，且副本激活时不叠渲染剧本/导演台内容层', () => {
    const page = read('pages/editor/editor-canvas/editor-page.tsx');
    expect(page).toContain('<CanvasLayer');
    expect(page).toContain('activeTabKey !== CANVAS_TAB_KEY && !isOpenCanvasTabKey(activeTabKey)');
    expect(page).not.toContain('<SubCanvasLayer');
  });

  it('工作区按 cid 走 canvas-store，并保持 S1 三开关 + 冲突居中确认框 + 新建单一来源', () => {
    const ws = read('features/sub-canvas/CanvasWorkspace.tsx');
    expect(ws).toContain('getCanvas(projectId, cid)');
    expect(ws).toContain('saveCanvas(projectId, cid, { graph }, stampRef.current)');
    expect(ws).toContain('enablePersistence: false');
    expect(ws).toContain('enableKeyboard: false');
    expect(ws).toContain('enableMinimap: false');
    expect(ws).toContain('centered: true');
    expect(ws).toContain("from '@/features/canvas-nodes/new-node.js'");
  });
});

describe('抽屉「画布」分组复用主页卡片', () => {
  it('DRAWER_TAB_DEFS 含 canvases 分组，且渲染分支真实接到组件', () => {
    expect(read('features/canvas-assets/tab-defs.ts')).toContain("{ key: 'canvases', labelKey: 'canvasCopy.drawerTab' }");
    const panel = read('features/canvas-assets/CanvasAssetsPanel.tsx');
    expect(panel).toContain("activeGroup === 'canvases'");
    expect(panel).toContain('<CanvasCopiesGroup');
    // 2026-11-06 分组清单单一来源下放到 tab-defs：store 由 DRAWER_MODULE_GROUPS 派生（不再自带分组字面量）
    expect(read('features/canvas-assets/tab-defs.ts')).toContain('DRAWER_MODULE_GROUPS');
    expect(read('features/canvas-assets/store.ts')).toContain('DRAWER_MODULE_GROUPS');
  });

  it('卡片与封面复用主页同一套组件；1 号不给删除与独立', () => {
    const group = read('features/canvas-assets/groups/CanvasCopiesGroup.tsx');
    expect(group).toContain('ProjectCard');
    expect(group).toContain('CoverUploadModal');
    expect(group).toContain('listCanvases(projectId)');
    expect(group).toContain('promoteCanvasToProject');
    expect(group).toContain('replaceCanvasCover');
    expect(group).toMatch(/if \(isMain\) \{[\s\S]*\} else \{[\s\S]*askPromote/);
  });
});

describe('MCP 面读的是同一目录', () => {
  it('路径与 canvas-store 一致（projects/<pid>/canvases/<cid>.json + .lf 主 graph 只读）', () => {
    const cfg = readMcp('src/config.ts');
    expect(cfg).toContain('"canvases"');
    expect(cfg).toContain('zeroexo:graph:');
    const store = readMcp('src/store/canvases.ts');
    // id 正则与前端同一口径（main 或 sc 前缀），兼作路径穿越防线
    expect(store).toMatch(/assertSafeCanvasId[\s\S]*\^\(main\|sc\[a-z0-9_-\]\{3,63\}\)\$\/i/);
    expect(store).toContain('updateUnversionedJson');
    // 1 号只读（写它会和前端自动保存抢盘）
    expect(store).toContain('1 号主画布对 MCP 只读');
  });

  it('server 入口注册画布域工具，旧 subcanvas 工具名不残留', () => {
    expect(readMcp('src/tools/canvases.ts')).toContain('list_canvases');
    expect(readMcp('src/index.ts')).toContain('registerCanvasTools(server, ctx)');
    expect(readMcp('src/index.ts')).not.toContain('registerSubCanvasTools');
    expect(existsSync(resolve(ROOT, 'mcp-server', 'src', 'tools', 'subcanvases.ts'))).toBe(false);
  });
});
