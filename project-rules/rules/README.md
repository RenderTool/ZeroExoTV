# 开发经验规则库 — 使用说明

一个轻量级的开发助手经验记忆系统：把踩过的坑记下来，下次自动规避。
本目录属于 **zeroexo-comfyui**；外部 `zeroexo/.project-rules/*/rules/` 属于前端线上项目，不要混用。

## 目录结构（2026-11-06 整理后）

```
zeroexo-comfyui/project-rules/
├── README.md              ← 规则库总入口与 Plan 落点
├── 00-SUMMARY.md          ← 总索引（Plan 看板 / 征集 / 文档清单 / 经验）
├── plans/                 ← Plan
├── suggestion-board/      ← 需求征集
├── docs/                  ← 交接与设计记录
└── rules/                 ← 本目录
    ├── README.md          ← 使用说明（本文件）
    ├── 00-SUMMARY.md      ← 经验索引（每次对话只读这个）
    ├── api-patterns.md
    ├── css-layout.md
    ├── i18n.md
    └── smtp.md
```

> 原双层嵌套 `project-rules/project-rules/` 已消除，6 个文件整体提升到 `rules/`。

## 每次对话操作流程

1. 读 `../00-SUMMARY.md`（总索引）与 `rules/00-SUMMARY.md`（经验索引）
2. 描述开发任务
3. 命中经验 → 询问是否读详情 → 检查冲突 + 给修正建议 → 写代码
4. 未命中 → 直接开发

## 如何添加新经验

踩坑后给出：领域 / 触发场景 / 错误写法 / 正确写法 / 边界情况，然后：
1. 在 `rules/00-SUMMARY.md` 表格加一行
2. 在 `rules/` 新建对应详情文件（沿用现有格式）
3. 若属于 UI/数据规范，同步项目根 `DESIGN.md`

## 配合 Cursor / Claude Code

| 工具 | 操作 |
|------|------|
| Cursor | 把 `../00-SUMMARY.md` 放进 `.cursor/rules/` 下 `alwaysApply: true` 的 `.mdc` |
| Claude Code | 把 `../00-SUMMARY.md` 内容放进项目根 `CLAUDE.md` |
