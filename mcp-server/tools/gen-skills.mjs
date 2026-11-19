/**
 * gen-skills — 把 guides/skills-md/*.md 生成 guides/skills.generated.ts
 *
 * Skill 正文的唯一事实源是 skills-md 下的 Markdown（方便改、方便审、可被外部引用）；
 * 构建前运行本脚本内联成 TS 常量，dist 仍然自包含（不需要打包 .md）。
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const MD_DIR = path.join(ROOT, "src", "guides", "skills-md");
const OUT = path.join(ROOT, "src", "guides", "skills.generated.ts");

const FILES = [
  ["script-import", "SCRIPT_IMPORT"],
  ["subjects", "SUBJECTS"],
  ["shots-prompts", "SHOTS_PROMPTS"],
  ["image-prompts", "IMAGE_PROMPTS"],
  ["params", "PARAMS"],
  ["pipeline", "PIPELINE"],
];

async function main() {
  const parts = [
    "/** 由 tools/gen-skills.mjs 从 skills-md/*.md 生成；不要手改，改 .md 后重跑 `npm run gen:skills`。 */",
    "",
  ];
  for (const [file, name] of FILES) {
    const md = await fs.readFile(path.join(MD_DIR, `${file}.md`), "utf8");
    parts.push(`export const ${name} = ${JSON.stringify(md)};`, "");
  }
  await fs.writeFile(OUT, parts.join("\n"), "utf8");
  console.log(`skills.generated.ts ← ${FILES.length} md files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
