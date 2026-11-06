---
状态: in-progress
负责人: ai
创建: 2026-09-02
最后更新: 2026-09-02
关联经验: <无>
---

# Plan#65 色卡节点（ColorCard Node）

> 征集文档：`.project-rules/suggestion-board/2026-09-02-color-card-node.md`

## 目标

新建画布「色卡」节点类型：非编辑态渲染调色盘卡片（色条 hover 展开 + 底部色值 + 顶部圆形调色盘图标，参考用户提供的 CSS 样式）；双击进入编辑态按需增删改颜色（上限 12）；点击色块复制色值。

## 影响文件清单（并行门必填）

- 新增 `zeroexo-front/src/features/canvas-nodes/color-card/color-card-types.ts`
- 新增 `zeroexo-front/src/features/canvas-nodes/color-card/color-card-extension.tsx`
- 新增 `zeroexo-front/src/features/canvas-nodes/color-card/color-card-node-view.tsx`
- 修改 `zeroexo-front/src/shared/components/node-create-menu.tsx`
- 修改 `zeroexo-front/src/pages/editor/editor-canvas/use-editor-interactions.ts`
- 修改 `zeroexo-front/src/pages/editor/editor-canvas/use-editor-state.ts`
- 修改 `zeroexo-front/src/shared/connection-rules.ts`
- 修改 `zeroexo-front/src/i18n/zh.json`、`en.json`、`ja.json`
- 修改 `.project-rules/suggestion-board/README.md`、`00-SUMMARY.md`（索引登记，🅰 域）

## 子任务

- [x] T1 需求征集 + Plan 立项（completed）
- [x] T2 色卡类型/常量文件（completed）
- [x] T3 色卡扩展定义（completed）
- [x] T4 色卡节点视图 + 双击编辑（completed）
- [x] T5 创建菜单/创建逻辑/注册/连线矩阵接入（completed）
- [x] T6 i18n 三语（completed）
- [x] T7 typecheck 验证（completed；浏览器实测待用户验收）
- [x] T8 验收反馈轮（2026-09-02）：去掉顶部圆形色盘图标；底部色值条点击复制经用户确认**回退**（保留纯展示）

### 子任务执行明细

#### T2 色卡类型/常量文件
1. 目标文件：`src/features/canvas-nodes/color-card/color-card-types.ts`（新建）
2. 修改点：`ColorCardColor { value: string; name?: string }`；`ColorCardData { title; status; colors: ColorCardColor[] }`；`COLOR_CARD_MAX_COLORS = 12`；`COLOR_CARD_DEFAULT_COLORS`（参考用户 4 色默认：#0E3746/#EAE8DC/#F4F2EC/#BE2623）；`COLOR_CARD_DEFAULT_SIZE = { width: 340, height: 220 }`；`COLOR_CARD_MIN_SIZE = { width: 160, height: 120 }`
3. 复用形态：无复用，纯类型常量
4. 验收断言：tsc 无类型错误

#### T3 色卡扩展定义
1. 目标文件：`src/features/canvas-nodes/color-card/color-card-extension.tsx`（新建）
2. 修改点：`createColorCardExtension(controller)` 返回 `NodeTypeExtension`：
   - `type: 'color-card'`，`category: 'Basic'`，`color: '#f59e0b'`
   - `defaultSize`/`minSize`/`resizable: true`/`runtime`（uniform shell 契约，参照 `createCreationRuntime` 结构）
   - `capabilities: { stackable: false, capabilities: ['color-card'] }`
   - `viewContract` 与 text 节点一致（`useShellChrome: true`）
   - `getPins: () => []`（无引脚）
   - `createDefaultData` 返回 `{ title: '', status: 'idle', colors: DEFAULT_COLORS }`
   - `getTools`：`edit` 工具 → `nodeActionBus.emit('color-card:edit', { nodeId })`
   - `renderNode` → `<ColorCardNodeView ...>`
3. 复用形态：复用 `BaseNodeView` 外壳（`@zeroexo/plugin-nodes`，**内嵌式节点外壳**，标题栏+内容区，非悬浮）；复用 `nodeActionBus` 事件总线广播编辑事件（与剧创节点同款）
4. 验收断言：注册后创建菜单出现色卡节点，选中后胶囊出现「编辑」按钮

#### T4 色卡节点视图 + 双击编辑
1. 目标文件：`src/features/canvas-nodes/color-card/color-card-node-view.tsx`（新建）
2. 修改点：`ColorCardNodeView` 组件：
   - 非编辑态：`BaseNodeView` 包裹；内容区 = 顶部圆形调色盘图标 + 水平色条组（`flex: 1` 均分，hover 时 `flexGrow` 增大 + z-index 提升）+ 底部色值条；色条 hover 中央浮现 palette 圆钮；点击色块 `navigator.clipboard.writeText(value)` + `message.success`
   - 编辑态（双击 / 胶囊 edit 事件触发）：内容区变为颜色编辑器——每行 = 原生 `<input type="color">` + hex 文本输入 + 删除按钮；底部「+ 添加颜色」按钮（≥12 禁用）；顶部「完成」按钮；退出时经 `commandQueue.execute(UpdateNodeDataCommand)` 提交
   - 编辑态隔离：拦截 pointerdown/click 防止拖动节点，对齐 text 节点编辑交互
3. 复用形态：复用 `BaseNodeView`（内嵌外壳）+ antd `App.useApp()` message + 原生 color input（与 `config-dialog.tsx` 同款，非 antd ColorPicker）；编辑提交用既有 `UpdateNodeDataCommand`
4. 验收断言：创建色卡节点 → 显示 4 色条；hover 色条展开；点击色块复制成功提示；双击进入编辑增删颜色至 12 上限；完成后画布刷新

#### T5 创建入口 + 注册 + 连线矩阵
1. 目标文件：`src/shared/components/node-create-menu.tsx`、`src/pages/editor/editor-canvas/use-editor-interactions.ts`、`use-editor-state.ts`、`src/shared/connection-rules.ts`
2. 修改点：
   - `node-create-menu.tsx`：`AddNodeType` 加 `'color-card'`；`createNodeTypeDefs` 加 `{ type: 'color-card', icon: <Palette size={14} />, labelKey: 'toolbar.colorCard', category: 'media' }`
   - `use-editor-interactions.ts` `handleNodeCreateMenuSelect`：type 联合加 `'color-card'`；baseNameKey 加分支（`nodes.colorCardTitle`）；data 构造加 `{ title, status: 'idle', colors: DEFAULT_COLORS }`（创建路径不调用 createDefaultData，须显式构造）
   - `use-editor-state.ts`：注册 `createColorCardExtension`（并入 registerAll 数组）
   - `connection-rules.ts`：`ALL_NODE_TYPES` 加 `'color-card'`；`COMPATIBILITY_MATRIX` 加 `'color-card': []`（终端节点）
3. 复用形态：复用 `NodeCreateMenu`（悬浮菜单组件）新增菜单项；复用 `AddNodeCommand` 创建命令
4. 验收断言：空白处右键/加号菜单出现「色卡」项 → 创建成功

#### T6 i18n 三语
1. 目标文件：`src/i18n/{zh,en,ja}.json`
2. 修改点：`toolbar.colorCard`（创建菜单 label）、`nodes.colorCardTitle`（displayName）、`colorCard` 段（addColor/done/delete/copySuccess/colorLimit/doubleClickToEdit/emptyHint/value 等）
3. 复用形态：无复用
4. 验收断言：三语切花下菜单/编辑文案显示正常

#### T7 typecheck + 收尾
1. 目标文件：无（验证）
2. 修改点：`pnpm --filter zeroexo-front typecheck` 零错误；建议基线提交
3. 验收断言：typecheck 通过

## 替代方案
<无>

## 参考追踪 & 测试工具（references）
| 文件 | 类型（参考/测试工具） | 状态 | 过期条件 |
|------|------|------|---------|
| 用户提供的调色盘 HTML/CSS | 参考 | active | T4 验收通过 |

## 测试四件套（自动化优先）

- **测试方案**：tsc 静态检查 + 浏览器实测（创建/编辑/复制/上限）
- **测试计划**：
  1. 空白右键/加号菜单 → 「色卡」创建
  2. 默认 4 色条渲染，hover 展开
  3. 点击色块复制色值 + toast
  4. 双击进编辑：增色/删色/改色，达到 12 上限禁用
  5. 完成后节点刷新 + 数据经 Yjs 持久化
- **测试报告**：收尾时填写
- **测试风险**：clipboard API 需安全上下文；浏览器实测为主

## 检查单

### 前置
- [ ] 二次复审通过（设计原则 / 影响面 / 风险 / 基线提交）

### 执行
- [x] T1 完成
- [ ] T2-T6 完成

### 验证
- [ ] typecheck 零错误
- [ ] 功能验证通过（浏览器实测）
- [ ] 回归检查：新节点类型不影响既有节点

### 交付
- [ ] diff + 改动前后对比
- [ ] 代码质量审核 + 复盘
- [ ] 验收通过后提交基线（一个 Plan 一个基线提交）
