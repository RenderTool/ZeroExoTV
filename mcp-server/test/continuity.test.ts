/**
 * 延续法（H3 段间衔接）计划器与准入闸门（2026-11-11 用户事故后加）
 *
 * 事故：别的 Agent 把 30 段按原稿段长直接塞进导演台、不接尾帧、跳段生成，
 * 交付物看起来「导进去了」但实际上完全不是延续法处理过的片子。
 *
 * 这里验证三件事：
 * 1. 段长吸附 17k+5、可见帧+22 ≤ 736、第 2 段起标记吃上一段尾帧；
 * 2. 计划只认「用户确认过」的写入（userConfirmed）；
 * 3. run_generation 对未计划/跳段/从中间开始三种情况有硬拒绝。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTEXT_FRAMES,
  MAX_VISIBLE_FRAMES,
  estimateSecondsFromText,
  hasContinuityPlan,
  planContinuitySegments,
} from "../src/lib/continuity.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(path.join(here, rel), "utf8");

const is17kPlus5 = (frames: number): boolean => frames >= 5 && (frames - 5) % 17 === 0;

describe("planContinuitySegments", () => {
  it("30 段默认 5s：每段帧数都是 17k+5，第 2 段起吃上一段尾帧（22 帧）", () => {
    const sources = Array.from({ length: 30 }, (_, i) => ({ id: `s${i + 1}`, text: `第 ${i + 1} 段动作描述` }));
    const plan = planContinuitySegments(sources);
    expect(plan.segments).toHaveLength(30);
    for (const seg of plan.segments) {
      expect(is17kPlus5(seg.frames)).toBe(true);
      expect(seg.frames + plan.ctxFrames).toBeLessThanOrEqual(plan.maxFrames);
      expect(seg.durationSec).toBeCloseTo(seg.frames / 24, 2);
    }
    expect(plan.segments[0]!.guideFromPrev).toBe(false);
    expect(plan.segments[0]!.guideFrames).toBe(0);
    for (const seg of plan.segments.slice(1)) {
      expect(seg.guideFromPrev).toBe(true);
      expect(seg.guideFrames).toBe(CONTEXT_FRAMES);
    }
  });

  it("超长段压到预算内（可见帧 ≤ 736-22 = 702）", () => {
    const plan = planContinuitySegments([{ durationSec: 60 }, { durationSec: 60 }]);
    for (const seg of plan.segments) {
      expect(seg.frames).toBeLessThanOrEqual(MAX_VISIBLE_FRAMES);
      expect(is17kPlus5(seg.frames)).toBe(true);
    }
    expect(plan.warnings.some((w) => w.includes("超出预算"))).toBe(true);
  });

  it("只有 1 段时提示延续法没有意义", () => {
    const plan = planContinuitySegments([{ text: "单独一段" }]);
    expect(plan.segments[0]!.guideFromPrev).toBe(false);
    expect(plan.warnings.some((w) => w.includes("只有 1 段"))).toBe(true);
  });

  it("文本估算时长：空文本给 5s，长文本不越界", () => {
    expect(estimateSecondsFromText("")).toBe(5);
    expect(estimateSecondsFromText("字".repeat(500))).toBeLessThanOrEqual(MAX_VISIBLE_FRAMES / 24);
  });
});

describe("hasContinuityPlan", () => {
  it("只有带 planId 的片段才算做过延续法计划", () => {
    expect(hasContinuityPlan({ paramValues: { continuityPlan: { planId: "cp_1" } } })).toBe(true);
    expect(hasContinuityPlan({ paramValues: {} })).toBe(false);
    expect(hasContinuityPlan({ paramValues: null })).toBe(false);
  });
});

describe("MCP 闸门（源码契约）", () => {
  const ops = read("../src/tools/director-ops.ts");
  const tool = read("../src/tools/continuity.ts");

  it("plan_continuity_edit：真实写入必须 userConfirmed，且写入计划标记与 continuityEnabled", () => {
    expect(tool).toContain('name: "plan_continuity_edit"');
    expect(tool).toContain("guardUserConfirmed");
    expect(tool).toContain("continuityPlan");
    expect(tool).toContain("continuityEnabled: true");
  });

  it("run_generation：未计划 / 跳段 / 从中间开始 三类硬拒绝 + 串行等待", () => {
    expect(ops).toContain("CONTINUITY_NOT_PLANNED");
    expect(ops).toContain("CONTINUITY_ORDER");
    expect(ops).toContain("waitForJobTerminal");
    expect(ops).toMatch(/if \(continuityOn\) \{\s*\n\s*const ordered/);
  });

  it("说明文档写明「禁止照搬原稿段长/跳段/只做一半」", () => {
    const instructions = read("../src/guides/instructions.ts");
    expect(instructions).toContain("导演台 = 延续法");
    expect(instructions).toContain("17k+5");
    expect(instructions).toContain("禁止");
  });
});
