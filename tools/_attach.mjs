// 挂主体图：同一 MCP 会话内先 read_asset 再看图，再 set_subject_image（服务端只认本会话读过的图）。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs/promises";

const token = process.env.MCP_TOKEN ?? "zxp_e2e_20261119";
const client = new Client({ name: "zeroexo-attach", version: "0.0.1" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8787/mcp"), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
}));

const projectId = "7QhO8_hi9PcV";
const items = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
let version = items.baseVersion;

for (const it of items.subjects) {
  const read = await client.callTool({ name: "read_asset", arguments: { projectId, storageKey: it.storageKey } });
  if (read.isError) { console.log("READ_FAIL", it.name, read.content?.[0]?.text); continue; }
  const res = await client.callTool({
    name: "set_subject_image",
    arguments: {
      projectId,
      baseVersion: version,
      subjectId: it.id,
      storageKey: it.storageKey,
      stateTag: it.stateTag ?? "定妆",
      prompt: it.prompt,
    },
  });
  const text = res.content?.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n") ?? "";
  if (res.isError) { console.log("SET_FAIL", it.name, text.slice(0, 300)); continue; }
  try { const j = JSON.parse(text); if (j.version) version = j.version; console.log("OK", it.name, "v" + version); }
  catch { console.log("OK?", it.name, text.slice(0, 120)); }
}
await client.close();
