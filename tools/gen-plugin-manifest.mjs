// 生成 comfyui-plugin/ComfyUI_ZeroExoNodes/manifest.json（云端插件自更新清单）。
// 由 version:bump 自动调用：version 取根 package.json，files 覆盖插件全部文件（跳过缓存/标记/清单自身）。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const pluginDir = join(root, "comfyui-plugin", "ComfyUI_ZeroExoNodes");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const SKIP = new Set(["__pycache__", ".update_state.json", "manifest.json", ".update-tmp"]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else {
      out.push({
        path: relative(pluginDir, p).split(sep).join("/"),
        sha256: createHash("sha256").update(readFileSync(p)).digest("hex"),
      });
    }
  }
  return out;
}

const files = walk(pluginDir).sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(
  join(pluginDir, "manifest.json"),
  JSON.stringify({ version, files }, null, 2) + "\n",
);
console.log(`[manifest] v${version}，${files.length} 个文件`);
