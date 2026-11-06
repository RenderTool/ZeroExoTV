---
状态: merged
创建: 2026-11-06
来源: 用户需求
关联项目: zeroexo-comfyui（按 Plan#83/84 归属，注册表单列）
归属建议: 独立热修，不建 Plan；归入 Plan#83 画布配置契约默认值微调
---

# 画布节点引脚默认尺寸改到 12

## 一、需求 / 问题描述

用户原话：「画布节点的引脚默认值改到12」。

## 二、背景与现状

画布配置契约（经验 #29）单一事实源 `DEFAULT_CANVAS_CONFIG.pinSize = 14`（`src/features/top-bar/components/config-dialog.tsx`）；渲染端四处兜底同源：
- `packages/plugins/render-react/src/components/pin-view.tsx` 的 `DEFAULT_PIN_SIZE = 14`
- `packages/plugins/render-react/src/components/node-shell.tsx` 磁吸计算三处 `?? 14`
- `packages/plugins/render-react/src/pin-defaults.ts` 接口注释「undefined 用 14」
- 契约表 `.project-rules/zeroexo_front/rules/canvas-config-contract.md` 登记 14

要求把默认值改为 12（配置面板滑杆范围 4–24，12 在合法区间内）。

## 三、归属分析

- **类型**：功能强化（默认值调整，非缺陷）
- **疑似关联 Plan**：Plan#83「zeroexo-comfyui 纯前端剥离版」（同链路：画布配置契约 / 渲染引擎包；Plan#15 契约表为上游约束）
- **倾向性结论**：单值四件套同步，无阶段/无决策点，按「改动琐碎任务不建 Plan」直接热修；归属记入 Plan#83 验收轮，不新建 Plan、不并行。

## 四、影响面预估

4 个代码文件 + 1 份契约文档；`configToPinDefaults` 映射与 Provider 注入链无需改动（自动跟随）。风险：`loadCanvasConfig` 会保留用户已保存的自定义 `pinSize`，老浏览器仍显示旧值，需在设置面板点「恢复默认」才看到 12（属预期，不覆盖用户设置）。

## 五、处理结果（归属确定后填写）

- 归属：独立热修，归入 Plan#83 验收轮
- 结果摘要：`DEFAULT_CANVAS_CONFIG.pinSize` 14→12；`DEFAULT_PIN_SIZE`、磁吸三处兜底、接口注释、契约表同步 12。验证：改动文件 typecheck / lint 零错误；仓库无 pinSize 相关断言单测；`pnpm build` 产出 `index-CAy3I3CQ.js`（系统 TEMP 目录 esbuild 清理被权限拦截，改指工作区内临时目录后成功）；浏览器实测画布节点 `data-pin-size` 全部为 `12`；4173/5180/8790 服务在线。
