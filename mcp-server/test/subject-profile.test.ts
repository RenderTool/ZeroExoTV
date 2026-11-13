import { describe, expect, it } from "vitest";
import {
  buildSubjectProfile,
  missingProfileFields,
} from "../src/lib/subject-profile.js";

const CHARACTER = {
  时代基底: "架空古代",
  国家朝代: "架空王朝·雷州港",
  物种: "人类",
  族裔: "东亚",
  类型基底: "古风英气女侠",
  显著特征: "斜飞入鬓的英气长眉与极高挺的直鼻梁",
  脸型: "轮廓清晰利落的鹅蛋小脸",
  发型: "漆黑浓密长发紧束成高马尾，暗银色雕纹发环",
  耳饰: "右耳单侧哑光暗银耳圈",
  身材: "高挑修长，肩背平直",
  头身比: "7.9",
  年龄: "21",
  性格: "坚韧沉静、从容无畏、重情守诺",
  变装: "江湖利落劲装",
  上身着装: "黛青色交领窄袖短袄",
  下身着装: "深藏青束口胡裤，暗黑细皮带，半片战裙",
  鞋子: "深棕贴腿软皮长筒快靴",
};

const SCENE = {
  时代基底: "现代",
  地点: "写字楼高级办公区走廊",
  建筑风格: "极简现代办公",
  空间结构: "走廊直通尽头双开玻璃门",
  地面: "深灰簇绒地毯",
  墙面: "白色铝塑板 + 半透明磨砂玻璃",
  门窗: "尽头双开磨砂钢化玻璃门",
  光源: "顶部隐藏式射灯",
  前景: "空旷走廊",
  中景: "办公隔断与空椅",
  远景: "半掩玻璃门透出冷白光",
  氛围: "整洁肃穆、商业压迫力",
  色调: "冷白与浅灰",
  材质与洁净度: "地毯吸音、墙面无装饰、地面光洁如新",
};

const PROP = {
  名称: "一沓两厘米厚纸币",
  尺寸: "约 2cm 厚",
  材质: "纸张",
  颜色: "色泽鲜艳",
  状态: "齐整叠放、被拍在桌面",
  边缘与纹理: "边缘尖锐平直",
  光泽: "半哑光",
  背景: "纯白",
};

describe("主体强制字段模板（2026-11-13）", () => {
  it("角色字段缺失时逐项列出", () => {
    const missing = missingProfileFields("character", { 时代基底: "架空古代" });
    expect(missing).toContain("脸型");
    expect(missing).toContain("上身着装");
    expect(missing).not.toContain("时代基底");
  });

  it("角色：三视图模板写死 3 画面 / 同一张脸，并带人设字段", () => {
    const { missing, built } = buildSubjectProfile("character", CHARACTER);
    expect(missing).toEqual([]);
    expect(built).not.toBeNull();
    expect(built!.prompt).toContain("画面中固定 3 个画面");
    expect(built!.prompt).toContain("同一张脸");
    expect(built!.prompt).toContain("禁止第二个人");
    expect(built!.prompt).toContain(CHARACTER.脸型);
    expect(built!.prompt).toContain(CHARACTER.上身着装);
    expect(built!.anchor).toContain(CHARACTER.显著特征);
  });

  it("场景：2×2 空场景宫格 + 字段", () => {
    const { missing, built } = buildSubjectProfile("scene", SCENE);
    expect(missing).toEqual([]);
    expect(built!.prompt).toContain("2×2 宫格");
    expect(built!.prompt).toContain("空场景");
    expect(built!.prompt).toContain(SCENE.地面);
    expect(built!.prompt).toContain(SCENE.光源);
  });

  it("道具：单品参考图 + 字段", () => {
    const { missing, built } = buildSubjectProfile("prop", PROP);
    expect(missing).toEqual([]);
    expect(built!.prompt).toContain("道具参考图");
    expect(built!.prompt).toContain(PROP.材质);
    expect(built!.prompt).toContain("无手、无人物");
  });

  it("道具 white-bg：纯白底快速主图（不铺场景/细节拼贴）", () => {
    const { built } = buildSubjectProfile("prop", PROP, { renderMode: "white-bg" });
    expect(built!.prompt).toContain("白底快速图");
    expect(built!.prompt).toContain("纯白(#FFFFFF)");
    expect(built!.prompt).toContain("不要多格拼贴");
    expect(built!.renderMode).toBe("white-bg");
  });

  it("角色 single：单张定妆，不再要求三画面", () => {
    const { built } = buildSubjectProfile("character", CHARACTER, { renderMode: "single" });
    expect(built!.prompt).toContain("单人");
    expect(built!.prompt).not.toContain("画面中固定 3 个画面");
  });
});
