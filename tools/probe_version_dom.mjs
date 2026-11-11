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
    await new Promise((r) => setTimeout(r, 1200));
    const expr = `(() => {
      const bodyText = (document.body.innerText || '').slice(0, 300);
      const hits = [...document.querySelectorAll('*')].filter(el => /v\\d+\\.\\d+/.test((el.textContent||'').trim()) && el.children.length <= 2).slice(0,10);
      return { url: location.href, bodyText, hits: hits.map(el => ({ tag: el.tagName, cls: typeof el.className==='string'?el.className.slice(0,80):'', text: (el.textContent||'').trim().slice(0,60), html: el.outerHTML.slice(0,300), rect: (()=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})() })) };
    })()`;
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
  } catch (e) { console.error(e.message); }
  ws.close(); process.exit(0);
};
