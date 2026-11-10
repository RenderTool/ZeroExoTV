/**
 * 导入预检与「用户确认」闸门（2026-11-10 弱模型事故后加）
 *
 * 事故：弱 Agent 拿到英文旧平台源数据，不问集数、不导主体，直接写剧本 + 拆导演台。
 * 对策：
 * - analyzeSource 识别英文/外部平台格式与分集标记；
 * - buildPreflight 产出必须逐条问用户的问题；
 * - import_script / split_script_to_shots 真实写入必须 userConfirmed:true，
 *   英文源还必须 sourceFormatConfirmed:true。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bootstrapToken } from "../src/auth.js";
import { registerScriptTools } from "../src/tools/script.js";
import { analyzeSource, buildPreflight } from "../src/lib/preflight.js";
import { guardForeignSource, guardUserConfirmed } from "../src/tools/_register.js";
import { createEpisode, readScript } from "../src/store/script.js";

const PROJECT_ID = "p-preflight";
const TOKEN = "zxp_preflight_test";
const EMPTY_LIBRARY = { episodes: 0, subjects: 0, subjectImages: 0, shots: 0 };

const EN_SOURCE = `# The Night Guest

## Episode 1: The Arrival

INT. GROCERY STORE - NIGHT

The rain hammers the roof. An old man shakes off his umbrella and looks around the empty store.

OLD ZHANG
(subtly)
You're late tonight. I was about to close.

The stranger says nothing, only places a wet envelope on the counter and slides it forward.

CUT TO:

EXT. STREET - CONTINUOUS

A motorcycle waits at the curb, engine idling, headlight cutting through the rain.
`;

const ZH_SOURCE = `# 雨夜
## 第1集：来客
### 第1场：杂货铺 · 内 · 夜
老张：今天这么晚？
## 第2集：旧信
### 第1场：街口 · 外 · 夜
雨还在下。`;

let root: string;
let client: Client;
let close: () => Promise<void>;

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zeroexo-preflight-test-"));
  process.env.ZEROEXO_DATA_ROOT = root;
  process.env.ZEROEXO_MCP_TOKEN = TOKEN;
  await bootstrapToken(root);

  const server = new McpServer({ name: "preflight-test", version: "0.0.1" });
  registerScriptTools(server, { getToken: () => TOKEN });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "preflight-test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  close = async () => { await client.close(); await server.close(); };

  await createEpisode(root, PROJECT_ID, { baseVersion: 0, title: "第1集", content: "<p>旧内容</p>" });
});

afterAll(async () => {
  await close();
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.ZEROEXO_DATA_ROOT;
  delete process.env.ZEROEXO_MCP_TOKEN;
});

describe("analyzeSource", () => {
  it("英文长文判定为 en + foreign，并识别 Episode/INT./CUT TO", () => {
    const a = analyzeSource(EN_SOURCE);
    expect(a.language).toBe("en");
    expect(a.foreignLikely).toBe(true);
    expect(a.looksLikeScript).toBe(true);
    expect(a.episodeMarkers.some((m) => m.pattern === "Episode n")).toBe(true);
  });

  it("中文剧本识别第N集标记与最大集号", () => {
    const a = analyzeSource(ZH_SOURCE);
    expect(a.language).toBe("zh");
    expect(a.foreignLikely).toBe(false);
    expect(a.detectedEpisodeCount).toBe(2);
    expect(a.episodeMarkers.some((m) => m.pattern === "第N集")).toBe(true);
  });

  it("空文本不瞎判语言，也不编集数", () => {
    const a = analyzeSource("");
    expect(a.language).toBe("unknown");
    expect(a.foreignLikely).toBe(false);
    expect(a.detectedEpisodeCount).toBeNull();
  });
});

describe("buildPreflight", () => {
  it("主体库为空 → 必须问主体导入；英文源 → 必须问来源格式；导演台有片段 → 必须问保留/重建", () => {
    const res = buildPreflight({
      projectTitle: "ZV-008_hpz",
      analysis: analyzeSource(EN_SOURCE),
      library: { episodes: 1, subjects: 0, subjectImages: 0, shots: 12 },
    });
    expect(res.canWrite).toBe(false);
    expect(res.blockers).toEqual(
      expect.arrayContaining(["foreign_source", "episode_plan_unconfirmed", "subjects_missing", "director_conflict"]),
    );
    const keys = res.questions.map((q) => q.key);
    expect(keys).toEqual(expect.arrayContaining(["sourceFormat", "episodeCount", "subjects", "directorImpact"]));
    // 问题里要给出可回答的具体信息，不能只有一句「请确认」
    expect(res.questions.find((q) => q.key === "episodeCount")?.question).toContain("Episode");
    expect(res.questions.find((q) => q.key === "subjects")?.question).toContain("空的");
  });

  it("中文单集 + 已有主体 + 无片段 → 只问集数与主体沿用", () => {
    const res = buildPreflight({
      projectTitle: "项目",
      analysis: analyzeSource(ZH_SOURCE),
      library: { episodes: 1, subjects: 3, subjectImages: 6, shots: 0 },
    });
    expect(res.blockers).toContain("episode_plan_unconfirmed");
    expect(res.blockers).not.toContain("foreign_source");
    expect(res.questions.map((q) => q.key)).not.toContain("directorImpact");
    expect(res.questions.find((q) => q.key === "episodeCount")?.question).toContain("第 2 集");
  });
});

describe("确认闸门", () => {
  it("guardUserConfirmed：缺 userConfirmed 直接 CONFIRM_REQUIRED", () => {
    expect(() => guardUserConfirmed({}, "导入剧本")).toThrowError(expect.objectContaining({ code: "CONFIRM_REQUIRED" }));
    expect(() => guardUserConfirmed({ userConfirmed: true }, "导入剧本")).not.toThrow();
  });

  it("guardForeignSource：英文源缺 sourceFormatConfirmed 直接拒绝", () => {
    expect(() => guardForeignSource({ foreignLikely: true, language: "en" }, {})).toThrowError(
      expect.objectContaining({ code: "CONFIRM_REQUIRED" }),
    );
    expect(() => guardForeignSource({ foreignLikely: true, language: "en" }, { sourceFormatConfirmed: true })).not.toThrow();
    expect(() => guardForeignSource({ foreignLikely: false, language: "zh" }, {})).not.toThrow();
  });
});

describe("import_script 工具闸门", () => {
  it("只有 confirm:true、没有 userConfirmed → 拒绝写入并提示先 preflight", async () => {
    const res = await client.callTool({
      name: "import_script",
      arguments: {
        projectId: PROJECT_ID, baseVersion: 1, content: ZH_SOURCE,
        mode: "standard", strategy: "new_episode", confirm: true,
      },
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("userConfirmed");
    expect(text).toContain("preflight_import");
    expect((await readScript(root, PROJECT_ID))?.version).toBe(1);
  });

  it("英文源：有 userConfirmed 但没 sourceFormatConfirmed → 仍然拒绝", async () => {
    const res = await client.callTool({
      name: "import_script",
      arguments: {
        projectId: PROJECT_ID, baseVersion: 1, content: EN_SOURCE,
        mode: "standard", strategy: "new_episode", confirm: true, userConfirmed: true,
      },
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(textOf(res)).toContain("sourceFormatConfirmed");
    expect((await readScript(root, PROJECT_ID))?.version).toBe(1);
  });

  it("用户确认齐了（userConfirmed + sourceFormatConfirmed）→ 正常写入", async () => {
    const res = await client.callTool({
      name: "import_script",
      arguments: {
        projectId: PROJECT_ID, baseVersion: 1, content: EN_SOURCE,
        mode: "standard", strategy: "new_episode", confirm: true,
        userConfirmed: true, sourceFormatConfirmed: true,
      },
    });
    expect((res as { isError?: boolean }).isError, textOf(res)).toBeFalsy();
    expect((await readScript(root, PROJECT_ID))?.version).toBe(2);
  });

  it("dryRun 不需要 userConfirmed（预览不写盘）", async () => {
    const res = await client.callTool({
      name: "import_script",
      arguments: {
        projectId: PROJECT_ID, baseVersion: 2, content: ZH_SOURCE,
        mode: "standard", strategy: "new_episode", dryRun: true,
      },
    });
    expect((res as { isError?: boolean }).isError, textOf(res)).toBeFalsy();
  });
});
