# 开发经验索引 — zeroexo-comfyui

你是我的开发助手。每次收到本文件后，按以下流程执行：

1. 读下方表格，把本次需求与「触发场景」做关键词匹配
2. 命中 → 告知「命中 XXX 经验，需要读取详情确认冲突吗？」
3. 用户回复「是」后读取对应文件 → 检查冲突 + 告知风险与修正建议 → 再写代码
4. 未命中 → 直接开发，不要再问

| # | 领域 | 触发场景关键词 | 详情文件 |
|---|------|---------------|----------|
| 1 | SMTP 邮箱服务 | SMTP, nodemailer, 邮箱验证码, 邮件配置, enabled, 连通测试 | smtp.md |
| 2 | API 响应解析 | fetch, response.json, axios, Unexpected end of JSON, 接口请求 | api-patterns.md |
| 3 | 国际化 | i18n, t(), useTranslation, 翻译key, locale, passwordReset | i18n.md |
| 4 | CSS 布局/缩放 | flex, resize, 拖拽宽度, textarea高度, flexbox, overflow | css-layout.md |

> 2026-11-06 归档整理：原索引第 5 条 `node-scaling.md`（节点画布坐标）与第 6 条
> `interaction-perf.md`（交互性能优化）**文件本就不存在**，属历史悬空索引，已从表中移除。
> 若后续需要这两类经验，按 `README.md` 的流程新建详情文件并补回索引。

> 本目录只存 comfyui 自己的经验；**不要写外部 `.project-rules/*/rules/`**（那是前端线上项目）。
