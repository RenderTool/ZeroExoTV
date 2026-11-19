# 技能：剧本落地（script-import）

> 适用：用户给了剧本原文 / 音频转写稿 / 分镜 Markdown，要进「剧本」页签。

## 0. 先预检，再问人（强制，2026-11-10）

调 preflight_import({ projectId, sourceText })（只读），把它返回的 questions 逐条问用户：

- 来源格式：英文/外部平台原文要不要按 ZeroExo 的「场次 + 动作 + 台词」重排？
- 集数：这次导入成几集（原文检测到哪些分集标记）？
- 主体资产：要不要先把角色/场景/道具和定妆图导进主体库？
- 导演台已有片段：保留、追加还是重建？

用户答复后才继续。真实写入 import_script 必须 userConfirmed:true；英文/外部平台源还要 sourceFormatConfirmed:true（缺了会 CONFIRM_REQUIRED）。

## 1. 先定形态

| 输入 | 处理 |
|---|---|
| 标准剧本（`# 剧名 / ## 第N集：标题 / ### 第M场：场景 · 内|外 · 日|夜 / 动作行 / 角色：台词`） | `normalize_script` 校验 → 用户确认 → `import_script(mode:"standard")` |
| 原始小说/转写稿 | `normalize_script` 出标准稿 + 报告，把 discardedSegments 原样给用户看 |
| 已有分镜 Markdown（`## A-01 段：…（约12秒）`，含 subject_definitions / detailed_description） | 剧本正文按「场」结构整理成标准剧本导入；分镜段不要塞进剧本，走 `shots-prompts` 技能进导演台 |

## 2. 硬规则

1. **不替用户改剧情**：事件链、人物关系、结局、台词一字不改；只做格式整理与 ASR 错字清洗，清洗对照表给用户看。
2. **一问一停**：mode（standard/raw）、strategy（new_episode/append/overwrite）必须由用户选，禁止默认。
3. **HTML 由 MCP 转**：`import_script` 会把纯文本转成编辑器认识的 `<p class="script-scene-heading|script-action|script-character|script-dialogue">`；直接塞 Markdown 会在页面里塌成一段——这是历史事故，别再犯。
4. **导入前给数字**：集数、场数、角色数、动作行数、被丢弃段落，先给用户确认再 confirm。
5. **覆盖前必留备份**：overwrite 会自动备份到 `entities/backups/`，但必须先 dryRun 给用户看 diff。
6. **改一集里的一两句：用块级编辑，不要整篇回传**：`get_script` 返回 `blocks`（index/kind/text），
   用 `patch_episode({ ops:[{op:"replace",index,blocks:[…]}] })` 只传改动块；append/insert/delete 同理。
   `import_script(overwrite)` 是整篇重写，只给「整集重排/重写」用，日常改稿别用（既费 token 又容易覆盖并发改动）。
   多块一起改放同一批 ops（一次写盘、一个版本号）。

## 3. 标准剧本写法（一次写对）

编辑器只有六种块：场次 / 动作 / 角色 / 台词 / 括注 / 转场，**没有「标题」块**。
所以正文里不要写剧名、集名——它们属于元信息：

- 剧名 → `ScriptEntity.title`（导入时从首行 `# 剧名` 提取，写了也不会进正文）
- 集名 → `Episode.title`（`## 第N集：标题` 同样被提取）

```
### 第1场：莱州官道 · 外 · 夜
深夜的官道，冻硬的黄土路面延伸到夜色深处。
张秀才：天黑路杂，又没有旅店，让我如何走得出去？
### 第2场：破庙大殿 · 内 · 夜
供案上一盏油灯昏昏暗暗。
老僧：你快去别处借宿吧，此地不宜久留。
[主体 @张秀才]
```

- 场次标题必须带 `内/外` 与 `日/夜`，引擎按它定光位与时段。
- `角色：台词` 用全角冒号；同一角色名全片逐字一致（别名在主体库归并，不在剧本里换写法）。
- `[主体 @名称]` 是给主体库的绑定线索，每场至少标一次出场主体。
- 旁白不写进「角色：台词」，旁白单独整理成动作行或独立条目（视频不许有人声旁白）。