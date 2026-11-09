/**
 * 引导数据 E2E 回归（2026-11-09，SPEC project-rules/specs/mcp-e2e-guide/spec.md）。
 *
 * 全部操作经 MCP StreamableHTTP tools/call 完成，不直连 ComfyUI、不点网页。
 * 运行前置：MCP `--http` 已启动（单进程 8787 + 8790）、ComfyUI 8188 纯 API 模式在线。
 *
 *   node e2e-guide.mjs               # 完整 S0-S4（默认 4 段）
 *   node e2e-guide.mjs --smoke       # 只跑 1 段做通路验证
 *   node e2e-guide.mjs --segments 2  # 指定段数
 *
 * 输出：e2e-guide-report.json（机器可读），失败时 exit 1。
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_URL = process.env.ZEROEXO_MCP_URL ?? "http://127.0.0.1:8787/mcp";
const TOKEN = process.env.ZEROEXO_MCP_TOKEN ?? "zxp_e2e_smoke_token";
const COMFY = process.env.ZEROEXO_COMFY_BASE ?? "http://127.0.0.1:8188";
const SMOKE = process.argv.includes("--smoke");
const segArgIdx = process.argv.indexOf("--segments");
const SEGMENTS = SMOKE ? 1 : (segArgIdx >= 0 ? Number(process.argv[segArgIdx + 1]) : 4);
const POLL_MS = 5000;
const MAX_WAIT_MS = 20 * 60 * 1000;

let sessionId = null;
let rpcId = 0;
const report = { startedAt: new Date().toISOString(), smoke: SMOKE, segments: SEGMENTS, steps: [], ok: false };

async function rpc(method, params = {}) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(MCP_URL, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const text = await res.text();
  const m = /data:\s*(\{[\s\S]*?\})\s*(?:\n\n|$)/.exec(text);
  const payload = m ? JSON.parse(m[1]) : JSON.parse(text);
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function tool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r.isError) throw new Error(`${name} 失败: ${r.content?.[0]?.text ?? "unknown"}`);
  const text = r.content?.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function step(name, data) {
  report.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log(`[${name}] ${JSON.stringify(data).slice(0, 400)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitJobs(jobIds) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < MAX_WAIT_MS) {
    last = await tool("list_jobs", { jobIds, baseUrl: COMFY });
    const states = last.jobs.map((j) => j.state).join(",");
    console.log(`  poll: ${last.doneCount}/${jobIds.length} success, failed=${last.failedCount} [${states}]`);
    if (last.allDone) return last;
    await sleep(POLL_MS);
  }
  throw new Error(`作业等待超时：${JSON.stringify(last)}`);
}

async function runBatch(projectId, selectedIds, label) {
  const out = await tool("run_generation", {
    projectId, episode: "1", confirm: true, baseUrl: COMFY,
    ...(selectedIds ? { selectedIds } : {}),
  });
  assert(out.jobs?.length > 0, `${label}: 未提交任何作业`);
  step(`${label}:submit`, {
    jobIds: out.jobs.map((j) => j.jobId), width: out.width, height: out.height,
    steps: out.steps, guideFrames: out.guideFrames,
    params: out.jobs.map((j) => ({ shotId: j.shotId, guide_id: j.params.guide_id, use_prev_guide: j.params.use_prev_guide, frames: j.params.frames, steps: j.params.steps })),
  });
  const status = await waitJobs(out.jobs.map((j) => j.jobId));
  for (const j of status.jobs) {
    assert(j.state === "success", `${label}: 作业 ${j.jobId} 失败 ${j.error ?? ""}`);
    assert(j.guide?.id, `${label}: 作业 ${j.jobId} 没有回传 guide`);
  }
  step(`${label}:done`, { jobs: status.jobs.map((j) => ({ jobId: j.jobId, state: j.state, guideId: j.guide?.id, guideSource: j.guideSource, guideInPath: j.guideInPath })) });
  return { out, status };
}

async function syncResults(projectId, jobs) {
  const wb = await tool("get_workbench", { projectId });
  const r = await tool("sync_job_results", {
    projectId, baseVersion: wb.version, confirm: true, baseUrl: COMFY,
    jobs: jobs.map((j) => ({ jobId: j.jobId, shotId: j.shotId })),
  });
  step("sync_job_results", { version: r.version, historyWritten: r.historyWritten, rows: r.rows.map((x) => ({ shotId: x.shotId, guideId: x.guide?.id })) });
  return r;
}

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "zx-e2e-guide", version: "1.0" },
  });

  // ---- S0：项目 / 片段 / 参数 ----
  const created = await tool("create_project", { title: `ZX_E2E_GUIDE_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}` });
  const projectId = created.projectId ?? created.project?.id ?? created.id;
  assert(typeof projectId === "string" && projectId.length > 0, `create_project 未返回 projectId: ${JSON.stringify(created)}`);
  step("S0:create_project", { projectId });

  const readWb = async () => {
    const cur = await tool("get_workbench", { projectId });
    return { version: cur.version ?? 0, ids: Array.isArray(cur.shots) ? cur.shots.map((s) => s.id) : [] };
  };
  let wb = await tool("get_workbench", { projectId });
  let st = await readWb();
  // 新建项目首次 add_segment 会用 emptyWorkbench() 建容器（自带 1 个占位段），
  // 所以每次 add 后重读实际段数，避免「占位 + 新增」多出一段。
  let guard = 0;
  while (st.ids.length < SEGMENTS && guard < 10) {
    await tool("add_segment", {
      projectId, baseVersion: st.version, description: `E2E 片段 ${st.ids.length + 1}`,
      shotType: "medium", duration: 5,
    });
    st = await readWb();
    guard += 1;
  }
  let version = st.version;
  const shotIds = st.ids.slice(0, SEGMENTS);
  const sp = await tool("set_shared_params", {
    projectId, baseVersion: version, presetId: "h3",
    params: { steps: 3, scaleFactor: 0.1, refImageSize: "match", continuityOverlapFrames: 22, continuityEnabled: true },
  });
  version = sp.version;
  const dur = await tool("set_segment_duration", {
    projectId, baseVersion: version, all: true, duration: 4, confirm: true,
  });
  version = dur.version;
  wb = await tool("get_workbench", { projectId });
  assert(dur.changed.length === wb.shots.length, `批量时长应覆盖全部 ${wb.shots.length} 段，实际 ${dur.changed.length}`);
  assert(wb.shots.every((s) => s.duration === 4), "不是所有片段都是 4s");
  assert(wb.sharedParams.params.steps === 3, "steps 未生效");
  assert(wb.sharedParams.params.scaleFactor === 0.1, "scaleFactor 未生效");
  assert(wb.sharedParams.params.refImageSize === "match", "refImageSize 未生效");
  assert(wb.sharedParams.params.continuityEnabled === true, "段间引导未开启");
  step("S0:params", { version, shotIds, steps: 3, scaleFactor: 0.1, refImageSize: "match", duration: 4, continuityEnabled: true });

  // ---- S1：批量正常运行 ----
  const s1 = await runBatch(projectId, shotIds, "S1");
  assert(s1.out.width === 86 && s1.out.height === 64, `派生分辨率应为 86×64（钳到插件 min=64），实际 ${s1.out.width}×${s1.out.height}`);
  assert(s1.out.jobs.every((j) => j.params.frames === 107), `4s 应吸附为 107 帧`);
  assert(s1.out.jobs.every((j) => j.params.steps === 3), "steps 未透传到作业");
  await syncResults(projectId, s1.out.jobs);
  const v1 = await tool("verify_output", { projectId, jobIds: s1.out.jobs.map((j) => j.jobId), baseUrl: COMFY });
  assert(v1.allPass, `S1 产物验收失败: ${JSON.stringify(v1.checks)}`);
  step("S1:verify", { allPass: v1.allPass, shotsWithGuide: v1.shotsWithGuide, historyWithGuide: v1.historyWithGuide.length });

  if (SMOKE) { report.ok = true; return; }

  // ---- S2：单独重跑第 3 段，应沿用第 2 段产物 guide ----
  wb = await tool("get_workbench", { projectId });
  const seg2 = wb.shots.find((s) => s.id === shotIds[1]);
  assert(seg2?.media?.guide?.id, "第 2 段没有 media.guide（sync 未回写）");
  const s2 = await runBatch(projectId, [shotIds[2]], "S2");
  assert(s2.out.jobs[0].params.guide_id === seg2.media.guide.id,
    `S2 应传第 2 段 guide_id=${seg2.media.guide.id}，实际 ${s2.out.jobs[0].params.guide_id}`);
  assert(s2.out.jobs[0].params.use_prev_guide === false, "有显式 guide_id 时 use_prev_guide 必须为 false");
  assert(s2.status.jobs[0].guideSource === "explicit", `插件 guideSource 应为 explicit，实际 ${s2.status.jobs[0].guideSource}`);
  await syncResults(projectId, s2.out.jobs);
  step("S2:verify", { guideId: seg2.media.guide.id, guideSource: s2.status.jobs[0].guideSource });

  // ---- S3：从历史以引导数据插入后单独跑 ----
  const hist = await tool("list_history", { projectId, source: "director", withGuideOnly: true });
  assert(hist.items.length > 0, "历史中没有带 guide 的导演台产物");
  const picked = hist.items.find((a) => a.guide?.id && a.guide.id !== seg2.media.guide.id) ?? hist.items[0];
  wb = await tool("get_workbench", { projectId });
  const gs = await tool("set_shot_guide", {
    projectId, baseVersion: wb.version, shotId: shotIds[3],
    guide: { id: picked.guide.id, title: picked.title, frames: picked.guide.frames, fromAssetId: picked.id },
  });
  assert(gs.guide?.id === picked.guide.id, "引导槽未写入");
  const s3 = await runBatch(projectId, [shotIds[3]], "S3");
  assert(s3.out.jobs[0].params.guide_id === picked.guide.id,
    `S3 显式引导槽应优先，实际 ${s3.out.jobs[0].params.guide_id}`);
  assert(s3.status.jobs[0].guideSource === "explicit", "S3 guideSource 应为 explicit");
  await syncResults(projectId, s3.out.jobs);
  step("S3:verify", { pickedGuideId: picked.guide.id, guideInPath: s3.status.jobs[0].guideInPath, references: gs.references });

  // ---- S4：全局验收 ----
  wb = await tool("get_workbench", { projectId });
  assert(wb.shots.every((s) => s.duration === 4), "S4 时长被改动");
  assert(wb.shots[3].guide?.id === picked.guide.id, "S4 显式引导槽丢失");
  const allJobIds = [...s1.out.jobs, ...s2.out.jobs, ...s3.out.jobs].map((j) => j.jobId);
  const v4 = await tool("verify_output", { projectId, jobIds: allJobIds, baseUrl: COMFY });
  assert(v4.allPass, `S4 全局验收失败: ${JSON.stringify(v4.checks)}`);
  step("S4:verify", { allPass: v4.allPass, jobs: allJobIds.length, shotsWithGuide: v4.shotsWithGuide.length, historyWithGuide: v4.historyWithGuide.length });
  report.ok = true;
}

main()
  .catch((err) => { report.error = err.message; console.error("E2E FAILED:", err.message); })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    writeFileSync(path.join(__dirname, "e2e-guide-report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`REPORT: e2e-guide-report.json  ok=${report.ok}`);
    if (!report.ok) process.exitCode = 1;
  });
