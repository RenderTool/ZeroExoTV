/**
 * 一次性脚本（Plan#83 改名）：把 zh.json 中「画布」实体称谓改为「项目」
 * 范围严格限定命名空间：nav / home / projectCard / canvasMenu
 * （编辑器内部的「画布样式 / 清空画布 / 无限画布」等指画布表面本身，不动）
 * 用法：node scripts/rename-canvas-to-project.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'i18n', 'zh.json');
const raw = fs.readFileSync(file, 'utf8');
const indentMatch = raw.match(/^[{\n]\s{1,8}/m);
const indent = indentMatch ? (indentMatch[0].match(/\s+$/)?.[0] ?? '  ') : '  ';
const json = JSON.parse(raw);

const NAMESPACES = ['nav', 'home', 'projectCard', 'canvasMenu'];
let changed = 0;

function walk(obj, ns) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      if (v.includes('画布')) {
        const next = v.replace(/画布/g, '项目');
        obj[k] = next;
        changed += 1;
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'string' && item.includes('画布')) {
          v[i] = item.replace(/画布/g, '项目');
          changed += 1;
        }
      });
    } else if (v && typeof v === 'object') {
      walk(v, ns ? `${ns}.${k}` : k);
    }
  }
}

for (const ns of NAMESPACES) {
  if (json[ns]) {
    walk(json[ns], ns);
  } else {
    console.warn(`缺少命名空间：${ns}`);
  }
}

// 补上本次新增的键（canvas-page 侧边栏标题与新建按钮 tooltip 用）
json.nav = json.nav ?? {};
json.nav.projects = json.nav.projects || '项目';
json.home = json.home ?? {};
json.home.newProject = json.home.newProject || '新建项目';

// 第二批：实体称谓的精确值映射（仅改完全匹配的值，避免误伤“无限画布/只读画布/画布样式”这类表面词）
const EXACT = {
  '新建画布': '新建项目',
  '拷贝画布': '拷贝项目',
  '拷贝画布副本并打开': '拷贝项目副本并打开',
  '删除本画布': '删除本项目',
  '打开画布菜单': '打开项目菜单',
  '双击修改画布名称': '双击修改项目名称',
  '画布': '项目',
  '画布操作的常用快捷键': '项目操作的常用快捷键',
  '删除画布': '删除项目',
  '清空画布': '清空项目',
  '选择要恢复的版本,恢复后当前画布将被覆盖': '选择要恢复的版本，恢复后当前项目将被覆盖',
  '确定删除当前画布吗?画布内的所有节点、连线和素材引用将被清除,此操作不可撤销。': '确定删除当前项目吗？项目内的所有节点、连线和素材引用将被清除，此操作不可撤销。',
  '确定清空当前画布的所有节点和连线吗？': '确定清空当前项目的所有节点和连线吗？',
  '未命名画布': '未命名项目',
  '画布结构': '项目结构',
  '画布为空': '项目为空',
  '画布资产': '项目资产',
  '当前画布': '当前项目',
};
let exactHit = 0;
function walkAll(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXACT, v)) {
      obj[k] = EXACT[v];
      exactHit += 1;
    } else if (v && typeof v === 'object') {
      walkAll(v);
    }
  }
}
// changelog 是历史版本描述，不参与改名
for (const [ns, val] of Object.entries(json)) {
  if (ns === 'changelog') continue;
  walkAll(val);
}

fs.writeFileSync(file, JSON.stringify(json, null, indent) + '\n', 'utf8');
console.log(`已替换 ${changed} 处「画布」→「项目」（限定 ${NAMESPACES.join('/')}）+ 全局精确值映射 ${exactHit} 处`);
