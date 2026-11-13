---
编号: S-26
状态: merged
创建: 2026-11-13
来源: 用户反馈
归属: 独立热修（全剧风格画廊 + 主体提示词继承）
---

# 全剧风格：可视化风格画廊（23 套电影美学 + 配图）

## 一、需求 / 问题描述（用户原话）

> 新建主体的模板默认值也写死了（写实电影定妆 / 自然柔光 / 现代自然 / 写实电影质感）……风格这种应该是全局设定啊！！

> 你自己看看人家的风格！！！（附风格画廊截图：我的风格 / 全部 / 收藏 / 真人 / 3D / 2D，卡片带缩略图）

> 另外提示词模板你自己看看人家的 https://www.uisdc.com/ai-cinema-prompts 别总是自己闭门造车

> 你应该把这个网站的提示词加配图拿下来！！！做成一个可视化面板！

结论：四个抽象下拉是错误形态；应该是**全剧选一套命名风格（带缩略图）**，所有主体提示词继承。

## 二、数据来源与产物

- 来源：优设文章《23 套电影美学提示词模板》<https://www.uisdc.com/ai-cinema-prompts>
- 抓取产物：
  - `src/shared/style-presets.ts`：23 套（9 导演 / 6 主流 / 8 动画），含名称/英文名/简介/中文提示词/英文提示词/缩略图路径；
  - `public/style-presets/*.webp`：每套第一张示例图（仅作风格预览，23 张）。
- 文章给的是「命名风格 + 具体风格片段」：`[主体] + 风格名 + 构图/色彩/光影/质感/参考作品`，不是抽象参数。

## 三、最终形态（用户拍板：只做全剧统一）

```
剧本 meta.visualStyle { presetId, name, prompt, image }   ← 本剧信息里选一次
        │
        ├─ 所有主体/状态提示词：删掉旧风格行，追加「风格：<该套片段>」
        └─ 单主体不覆盖（用户选「只做全剧统一」）
```

- **本剧信息**：新增「全剧风格（所有主体继承）」区块，显示已选缩略图/名称/风格片段 + 「选择风格」按钮；
- **风格画廊 Modal**：分类（全部/导演/主流/动画）、搜索、收藏（localStorage）、23 张缩略图卡片、
  选中高亮 + 「使用此风格」；双击卡片直接用；
- **保存全剧风格**：写 `meta.visualStyle`，并把现有主体/状态提示词里的风格块统一改写
  （删 `风格/灯光/色彩/质感` 旧行，追加一行 `风格：<片段>`；空提示词不动）；
- **主体状态编辑面板**：不再有每状态四个下拉，只读显示「全剧风格：<名称> · <片段>」；
  提交提示词时自动对齐全剧风格；
- **新建主体**：基础提示词用全剧风格片段（`buildBaseStatePrompt({ stylePrompt })`）；
- **MCP `set_subject_profile`**：读 `script.meta.visualStyle.prompt` 生成风格块，不再写「按剧本…定」。

## 四、影响面

`src/shared/style-presets.ts`（新增）、`public/style-presets/`（新增 23 图）、
`style-gallery-dialog.tsx`（新增）、`ScriptMetaGroup.tsx`（全剧风格区块 + 保存后重写提示词）、
`script-store.ts`（`ScriptMeta.visualStyle`）、`subject-library-pages.tsx`（只读显示 + 提交对齐 + 模板传风格）、
`subject-prompt-templates.ts`（styleBlock）、`mcp-server` 的 `store/script.ts` / `lib/subject-profile.ts` / `tools/subjects.ts`。

## 五、边界

- 缩略图来自文章示例图，仅作风格预览；上线前如需替换为自有图，直接替换 `public/style-presets/*.webp` 即可。
- 全剧风格保存后，已打开的主体库页面需重新进入/刷新才看到改写后的提示词（容器外部变更刷新机制既有）。
- 单主体覆盖不做（用户明确「只做全剧统一」）。
