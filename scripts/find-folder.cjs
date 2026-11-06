const fs = require("fs");
const p = "src/features/asset-library/use-asset-library.tsx";
let c = fs.readFileSync(p, "utf8");
const idx = c.indexOf("group: 'folder'");
if (idx >= 0) {
  const start = c.lastIndexOf("    {", idx);
  const end = c.indexOf("    },", idx) + 6;
  console.log("FOUND:", JSON.stringify(c.substring(start, end)));
}
