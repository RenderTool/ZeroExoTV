// 给 12 个分镜片段挂上主体引用（角色×3 + 对应场景），再重写提示词。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs/promises";

const projectId = "7QhO8_hi9PcV";
const client = new Client({ name: "zeroexo-link", version: "0.0.1" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8787/mcp"), {
  requestInit: { headers: { Authorization: "Bearer zxp_e2e_20261119" } },
}));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
  if (r.isError) throw new Error(name + ": " + t.slice(0, 200));
  return JSON.parse(t);
};

const subs = (await call("list_subjects", { projectId })).subjects;
const byName = (n) => subs.find((s) => s.name.includes(n));
const chars = ["米拉", "布布", "老钟"].map(byName).filter(Boolean);
const sceneNames = ["钟楼广场", "钟表铺", "雨棚小巷", "地下齿轮室", "蘑菇集市", "磨坊", "河桥", "山坡灯塔", "钟楼内部", "星夜码头"];

const wb = JSON.parse(await fs.readFile("D:/ZeroExoFinTest/projects/7QhO8_hi9PcV/entities/workbench.json", "utf8"));
let version = wb.version;
for (const shot of wb.shots) {
  const scene = sceneNames.map(byName).find((s) => s && shot.description.includes(s.name.replace("内部", "")));
  const targets = [...chars, ...(scene ? [scene] : [])].filter((t) => (t.images?.length ?? 0) > 0);
  for (const t of targets) {
    try {
      const res = await call("link_subject_to_shot", { projectId, baseVersion: version, shotId: shot.id, subjectId: t.id, state: t.kind === "character" ? "定妆" : "概念图", skipExisting: true });
      if (res.version) version = res.version;
    } catch (e) {
      console.log("SKIP", shot.id, t.name, String(e).slice(0, 90));
    }
  }
  console.log("LINKED", shot.id, targets.map((t) => t.name).join("/"), "v" + version);
}
await client.close();
