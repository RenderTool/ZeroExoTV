/**
 * 剧本纯文本 → 剧本 HTML（前端 script-lines.ts:plainTextToScriptHtml 的 Node 侧实现）。
 *
 * 前端剧本实体 content 是 HTML 段落，class 决定渲染：
 *   <p class="script-scene-heading">  场次标题（INT./EXT. 前缀表示内外景）
 *   <p class="script-action">         动作/旁白
 *   <p class="script-character">      角色名
 *   <p class="script-dialogue">       台词
 * 直接塞 Markdown 原文进 content 会在编辑器里塌成一段（编辑器只认这些 class），
 * 所以导入前必须转换。
 */

const SCENE_PREFIX = /^(INT\.|EXT\.|内景|外景)/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 「第3场：莱州官道 · 外 · 夜」→「EXT. 莱州官道 - 夜」 */
function sceneHeadingText(body: string): string {
  const m = body.match(/^第\s*\S+\s*场\s*[:：]?\s*(.*)$/);
  if (!m) return body;
  const parts = m[1]!.split(/\s*[·・]\s*|\s*[,，]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return body;
  const location = parts.find((p) => /^(内|外|内景|外景)$/.test(p));
  const time = parts.find((p) => /^(日|夜|晨|昏|日间|白天|夜晚|夜间|夜里)$/.test(p));
  const rest = parts.filter((p) => p !== location && p !== time);
  const prefix = location && /^外/.test(location) ? "EXT." : "INT.";
  const tail = [rest.join(" · "), time].filter(Boolean).join(" - ");
  return `${prefix} ${tail}`;
}

export function plainTextToScriptHtml(text: string): string {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const md = line.match(/^#{1,6}\s*(.+)$/);
    const body = (md ? md[1]! : line).trim();

    // 场景标题：第N场 / INT. / EXT. / 内景 / 外景
    if (/^第\s*\S+\s*场\s*[:：]/.test(body) || SCENE_PREFIX.test(body)) {
      out.push(`<p class="script-scene-heading">${escapeHtml(sceneHeadingText(body))}</p>`);
      continue;
    }
    // 集标题：第N集 / EP\d+
    if (/^第\s*\S+\s*集(?=$|[\s:：])/.test(body) || /^EP\s*\d+(?=$|[\s:：])/i.test(body)) {
      out.push(`<p class="script-scene-heading">${escapeHtml(body)}</p>`);
      continue;
    }
    // 其余 Markdown 标题（剧名/章节）→ 场景标题样式（与前端 plainTextToScriptHtml 一致）
    if (md) {
      out.push(`<p class="script-scene-heading">${escapeHtml(body)}</p>`);
      continue;
    }
    // 转场
    if (/^(切至|淡入|淡出|CUT TO|FADE IN|FADE OUT)[:：]?$/i.test(body)) {
      out.push(`<p class="script-transition">${escapeHtml(body.replace(/[:：]$/, ""))}</p>`);
      continue;
    }
    // 独立括注
    const paren = body.match(/^[（(]([^（）()]{1,40})[）)]$/);
    if (paren) {
      out.push(`<p class="script-parenthetical">（${escapeHtml(paren[1]!.trim())}）</p>`);
      continue;
    }
    // 角色：台词
    const dialogue = body.match(/^([^:：]{1,20})[:：]\s*(.+)$/);
    if (dialogue?.[2]) {
      out.push(`<p class="script-character">${escapeHtml(dialogue[1]!.trim())}</p>`);
      out.push(`<p class="script-dialogue">${escapeHtml(dialogue[2]!.trim())}</p>`);
      continue;
    }
    out.push(`<p class="script-action">${escapeHtml(body)}</p>`);
  }
  return out.join("");
}

/** 已是 HTML 段落则原样保留 */
export function toScriptHtml(content: string): string {
  if (!content.trim()) return "";
  return /<p[\s>]/i.test(content) ? content : plainTextToScriptHtml(content);
}

/**
 * 剧本元信息剥离：`# 剧名` 与 `## 第N集：标题` 不是正文块。
 * 编辑器只有 场次/动作/角色/台词/括注/转场 六种块，没有「标题」块——
 * 把剧名、集名塞进正文就会变成两个假的「场景」行（INT. 秀才住破庙）。
 * 正确做法：剧名 → ScriptEntity.title，集名 → Episode.title，正文从第一场开始。
 */
export function splitScriptMeta(text: string): { title?: string; episodeTitle?: string; body: string } {
  const isSceneLine = (t: string): boolean => /^(INT\.|EXT\.|第\s*\S+\s*场\s*[:：])/i.test(t);
  let title: string | undefined;
  let episodeTitle: string | undefined;
  const body: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(#{1,3})\s*(.+)$/);
    const level = m ? m[1]!.length : 0;
    const text2 = (m ? m[2]! : raw).trim();
    if (level === 1 && !isSceneLine(text2)) {
      if (!title) title = text2;
      continue;
    }
    if (level === 2 && /^(第\s*\S+\s*集|EP\s*\d+)/i.test(text2)) {
      if (!episodeTitle) episodeTitle = text2;
      continue;
    }
    body.push(raw);
  }
  return { title, episodeTitle, body: body.join("\n") };
}
