// MCP 全链路测试客户端：连接已运行的 8787（StreamableHTTP），调用真实工具。
// 用法：node mcp-server/scripts/mcp-call.mjs tools.list
//       node mcp-server/scripts/mcp-call.mjs call <tool> '<jsonArgs>'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL ?? "http://127.0.0.1:8787/mcp";
const token = process.env.MCP_TOKEN ?? "zxp_e2e_20261119";
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "zeroexo-e2e", version: "0.0.1" });
await client.connect(transport);

const [, , cmd, name, rawArgs] = process.argv;
if (cmd === "tools.list") {
  const res = await client.listTools();
  console.log(JSON.stringify(res.tools.map((t) => ({ name: t.name, description: t.description })), null, 1));
} else if (cmd === "schema") {
  const res = await client.listTools();
  const t = res.tools.find((x) => x.name === name);
  console.log(JSON.stringify(t ?? null, null, 1));
} else if (cmd === "call") {
  // 参数既可以是一段 JSON，也可以是 @文件路径（Windows shell 引号更稳）
  const fs = await import("node:fs/promises");
  const args = rawArgs
    ? JSON.parse(rawArgs.startsWith("@") ? await fs.readFile(rawArgs.slice(1), "utf8") : rawArgs)
    : {};
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n") ?? "";
  console.log(res.isError ? `ERROR:\n${text}` : text);
}
await client.close();
