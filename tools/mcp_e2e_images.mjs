/**
 * MCP 画布生图 E2E（2026-11-11）：
 * 通过真实 MCP stdio 会话调用 generate_canvas_images，投递 10 张不同尺寸/风格/参数的图，
 * 轮询 get_canvas_image_job，最后用 get_canvas 核对节点是否真的写进了当前画布。
 *
 * 运行：node tools/mcp_e2e_images.mjs
 */
import { Client } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import path from 'node:path';

const DATA_ROOT = process.env.ZEROEXO_DATA_ROOT || 'D:\\Test';
const serverEntry = path.resolve('mcp-server/dist/index.js');

const client = new Client({ name: 'zeroexo-e2e', version: '0.0.0' }, { capabilities: {} });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, ZEROEXO_DATA_ROOT: DATA_ROOT },
}));

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  return text ? JSON.parse(text) : null;
};

const current = await call('get_current_project');
const projectId = current?.project?.projectId;
if (!projectId) throw new Error(`网页没有打开中的项目: ${JSON.stringify(current)}`);
console.log('current project:', projectId, current.project.title ?? '');

const requests = [
  { prompt: 'A cinematic portrait photograph of a young Chinese woman in a deep emerald silk qipao, standing in a rain-soaked neon alley at night, three-quarter framing, wet asphalt reflections, warm tungsten and cold cyan light, 85mm lens, shallow depth of field, fine film grain.', model: 'moss', title: '霓虹旗袍', aspect: '9:16', megapixels: 1, steps: 25, seed: 101 },
  { prompt: 'A golden retriever sprinting across a sunlit meadow at golden hour, fur backlit, motion blur in the grass, low camera angle, warm rim light, shallow depth of field, natural documentary photography.', model: 'moss', title: '金毛奔跑', aspect: '16:9', megapixels: 2, steps: 25, seed: 202 },
  { prompt: 'Studio portrait of a silver tabby cat on a matte black seamless backdrop, dramatic single softbox from upper left, detailed whiskers and fur texture, centered composition, editorial pet photography.', model: 'krea2', title: '猫棚拍', aspect: '1:1', megapixels: 3, steps: 10, seed: 303 },
  { prompt: 'Cinematic wide shot of a lone grey wolf standing on a snow ridge under aurora borealis, teal and violet sky, breath vapor, ultra-wide anamorphic framing, epic scale, cold color palette.', model: 'krea2', title: '极光狼', aspect: '21:9', megapixels: 2, steps: 10, seed: 404 },
  { prompt: '一位穿明制汉服的年轻女子站在古建筑回廊下，侧光勾出发丝与衣料纹理，背景虚化的朱红廊柱，清冷典雅的东方美学，中景构图，胶片颗粒。', model: 'qwen', title: '汉服回廊', aspect: '3:4', width: 1152, height: 1536, steps: 25, seed: 505 },
  { prompt: 'A minimal movie poster with the title "MOSS" in tall thin white capital letters centered in the upper third, a lone figure in a long black coat walking through fog below, deep teal background, huge negative space, subtle paper grain, graphic design layout.', model: 'qwen', title: 'MOSS 海报', aspect: '16:9', width: 1536, height: 864, steps: 25, seed: 606 },
  { prompt: 'A great horned owl perched on a moss-covered branch in a misty old-growth forest at dawn, soft diffused light, every feather detail, moss textures, muted green palette, wildlife photography, 4:3 framing.', model: 'moss', title: '雾林猫头鹰', aspect: '4:3', megapixels: 3, steps: 25, seed: 707 },
  { prompt: 'A young woman in a translucent raincoat standing under a streetlamp in heavy rain, face half lit, droplets frozen mid-air, bokeh city lights behind, moody cyan and amber, vertical editorial cover, 50mm lens.', model: 'krea2', title: '雨夜路灯', aspect: '9:16', megapixels: 3, steps: 10, seed: 808 },
  { prompt: 'A red fox curled asleep on a fallen log covered in fresh snow, soft winter morning light, minimal composition, warm orange fur against cool white and blue, telephoto compression, serene mood.', model: 'moss', title: '雪地赤狐', aspect: '21:9', megapixels: 1, steps: 25, seed: 909 },
  { prompt: '一只大熊猫坐在竹林里啃竹子，晨雾中的柔光，毛发与竹叶细节清晰，浅景深，自然生态摄影，正方形构图。', model: 'qwen', title: '竹林熊猫', aspect: '1:1', width: 1024, height: 1024, steps: 25, seed: 1010 },
];

const job = await call('generate_canvas_images', { projectId, requests });
console.log('submitted', job.jobId, 'queued', job.queued);

let last = '';
const started = Date.now();
for (;;) {
  const st = await call('get_canvas_image_job', { projectId, jobId: job.jobId });
  const line = `${st.state} ${st.completed ?? 0}/${st.total ?? requests.length}`;
  if (line !== last) { last = line; console.log(`[${Math.round((Date.now() - started) / 1000)}s]`, line); }
  if (st.state === 'done' || st.state === 'error') {
    console.log(JSON.stringify(st, null, 2));
    break;
  }
  if (Date.now() - started > 40 * 60 * 1000) { console.log('timeout'); break; }
  await new Promise((r) => setTimeout(r, 4000));
}

const canvas = await call('get_canvas', { projectId, canvasId: 'main', includeGraph: true });
const nodes = (canvas.graph?.nodes ?? []).filter((n) => String(n.id).startsWith('mcp_'));
console.log('canvas nodes (mcp_*):', nodes.length);
console.log(nodes.map((n) => ({ id: n.id, status: n.data?.status, key: n.data?.storageKey, size: `${n.data?.naturalWidth}x${n.data?.naturalHeight}` })));
await client.close();
process.exit(0);
