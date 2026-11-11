const WS = process.argv[2];
const ws = new WebSocket(WS);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
  }
};
ws.onopen = async () => {
  try {
    await send('Runtime.enable');
    await new Promise((r) => setTimeout(r, 1500));
    const expr = `(() => {
      const hits = [...document.querySelectorAll('*')].filter(el => /v\\d+\\.\\d+\\.\\d+/.test((el.textContent||'').trim()) && el.children.length <= 2);
      return { title: document.title, hits: hits.slice(0,5).map(el => ({
        tag: el.tagName,
        cls: typeof el.className === 'string' ? el.className.slice(0,120) : '',
        text: (el.textContent||'').trim().slice(0,40),
        html: el.outerHTML.slice(0,240),
        parentCls: typeof el.parentElement?.className === 'string' ? el.parentElement.className.slice(0,120) : '',
        grandCls: typeof el.parentElement?.parentElement?.className === 'string' ? el.parentElement.parentElement.className.slice(0,120) : ''
      })) };
    })()`;
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
  } catch (e) { console.error(e.message); }
  ws.close(); process.exit(0);
};
