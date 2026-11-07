/**
 * 剧集正文块级编辑（patch_episode 的存储层）：
 * - 只按块下标改，不要求调用方回传整篇 HTML；
 * - append / insert / replace / delete 的位置语义；
 * - 文本转义、越界报错、dryRun 不写盘、一次调用一次版本自增。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths } from "../src/config.js";
import {
  createEpisode, listScriptBlocks, patchEpisodeBlocks, readScript,
} from "../src/store/script.js";

let root: string;
const projectId = "proj-patch";
const CONTENT = [
  '<p class="script-scene-heading">INT. 客栈 - 夜</p>',
  '<p class="script-action">雨声敲窗。</p>',
  '<p class="script-character">掌柜</p>',
  '<p class="script-dialogue">客官，住店吗？</p>',
].join("");
let episodeId: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-mcp-patch-"));
  await fs.mkdir(paths.entitiesDir(projectId, root), { recursive: true });
  const created = await createEpisode(root, projectId, { baseVersion: 0, content: CONTENT });
  episodeId = created.episode.id;
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("listScriptBlocks", () => {
  it("按 <p class=script-*> 顺序解析出可编辑块（含类型与纯文本）", () => {
    const blocks = listScriptBlocks(CONTENT);
    expect(blocks).toEqual([
      { index: 0, kind: "scene-heading", text: "INT. 客栈 - 夜" },
      { index: 1, kind: "action", text: "雨声敲窗。" },
      { index: 2, kind: "character", text: "掌柜" },
      { index: 3, kind: "dialogue", text: "客官，住店吗？" },
    ]);
  });
});

describe("patchEpisodeBlocks：局部修改", () => {
  it("append：追加块到末尾，其它块原样保留", async () => {
    const res = await patchEpisodeBlocks(root, projectId, {
      baseVersion: 1,
      episodeId,
      ops: [{ op: "append", blocks: [{ kind: "transition", text: "切至" }] }],
    });
    expect(res.written).toBe(true);
    expect(res.after.version).toBe(2);
    const blocks = listScriptBlocks(res.episode.content);
    expect(blocks).toHaveLength(5);
    expect(blocks[4]).toEqual({ index: 4, kind: "transition", text: "切至" });
    // 前 4 块逐字不变
    expect(res.episode.content.startsWith(CONTENT)).toBe(true);
  });

  it("insert：在下标前插入（index = 块数即末尾）", async () => {
    const res = await patchEpisodeBlocks(root, projectId, {
      baseVersion: 1,
      episodeId,
      ops: [{ op: "insert", index: 2, blocks: [{ kind: "parenthetical", text: "（低声）" }] }],
    });
    const blocks = listScriptBlocks(res.episode.content);
    expect(blocks.map((b) => b.text)).toEqual([
      "INT. 客栈 - 夜", "雨声敲窗。", "（低声）", "掌柜", "客官，住店吗？",
    ]);
  });

  it("replace：整块替换（下标保留），一次只改目标块", async () => {
    const res = await patchEpisodeBlocks(root, projectId, {
      baseVersion: 1,
      episodeId,
      ops: [{ op: "replace", index: 1, blocks: [{ kind: "action", text: "灯花爆了一下。" }] }],
    });
    const blocks = listScriptBlocks(res.episode.content);
    expect(blocks[1]).toEqual({ index: 1, kind: "action", text: "灯花爆了一下。" });
    expect(blocks).toHaveLength(4);
  });

  it("delete：按下标删除多块", async () => {
    const res = await patchEpisodeBlocks(root, projectId, {
      baseVersion: 1,
      episodeId,
      ops: [{ op: "delete", index: 2, count: 2 }],
    });
    const blocks = listScriptBlocks(res.episode.content);
    expect(blocks.map((b) => b.text)).toEqual(["INT. 客栈 - 夜", "雨声敲窗。"]);
  });

  it("多个 op 按顺序执行（后一个 index 基于前一个之后）", async () => {
    const res = await patchEpisodeBlocks(root, projectId, {
      baseVersion: 1,
      episodeId,
      ops: [
        { op: "delete", index: 0 },
        { op: "insert", index: 0, blocks: [{ kind: "scene-heading", text: "EXT. 渡口 - 晨" }] },
      ],
    });
    const blocks = listScriptBlocks(res.episode.content);
    expect(blocks[0]).toEqual({ index: 0, kind: "scene-heading", text: "EXT. 渡口 - 晨" });
    expect(blocks.map((b) => b.text)).not.toContain("INT. 客栈 - 夜");
  });

  it("新块文本按 HTML 转义写入（< & 引号不会破坏段落结构）", async () => {
    const res = await patchEpisodeBlocks(root, projectId, {
      baseVersion: 1,
      episodeId,
      ops: [{ op: "append", blocks: [{ kind: "action", text: '他念道：<"天地玄黄"> & 收声' }] }],
    });
    expect(res.episode.content).toContain("&lt;&quot;天地玄黄&quot;&gt; &amp;");
    const blocks = listScriptBlocks(res.episode.content);
    expect(blocks.at(-1)?.text).toBe('他念道：<"天地玄黄"> & 收声');
  });

  it("下标越界 → VALIDATION，不写盘", async () => {
    await expect(patchEpisodeBlocks(root, projectId, {
      baseVersion: 1,
      episodeId,
      ops: [{ op: "replace", index: 99, blocks: [{ kind: "action", text: "x" }] }],
    })).rejects.toMatchObject({ code: "VALIDATION" });
    const disk = await readScript(root, projectId);
    expect(disk?.version).toBe(1);
    expect(disk?.episodes[0].content).toBe(CONTENT);
  });

  it("dryRun：返回预览，磁盘不变", async () => {
    const res = await patchEpisodeBlocks(root, projectId, {
      baseVersion: 1,
      episodeId,
      ops: [{ op: "append", blocks: [{ kind: "action", text: "预览块" }] }],
      dryRun: true,
    });
    expect(res.written).toBe(false);
    expect(res.blocks).toHaveLength(5);
    const disk = await readScript(root, projectId);
    expect(disk?.version).toBe(1);
    expect(disk?.episodes[0].content).toBe(CONTENT);
  });
});
