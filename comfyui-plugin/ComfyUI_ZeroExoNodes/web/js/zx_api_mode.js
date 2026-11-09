// ZeroExo Director Bridge — API-mode UX for the MiniMaxH3DirectorZX node.
//
// The ZX node is a Python subclass of MiniMaxH3Director with a real
// `api_mode` BOOLEAN widget (registered by the bridge's NODE_CLASS_MAPPINGS),
// so the toggle serializes into the workflow and the prompt graph with no
// upstream edits. This extension only adds the lock/clear UX:
//
//   api_mode ON  -> timeline_data (导轨) is cleared and read-only-locked,
//                   a red banner is drawn on the node:
//                   "API 模式：时间轴由 ZeroExo 下发".
//   api_mode OFF -> timeline_data is editable again; banner removed.
//
// The hard gate lives in Python: api_mode + empty timeline_data raises
// "API 模式已开启，但未收到 timeline_data…" before any sampling happens.

import { app } from "../../../scripts/app.js";

const ZX_CLASS = "MiniMaxH3DirectorZX";
const BANNER_TEXT = "API 模式：时间轴由 ZeroExo 下发（本地导轨已清零并锁定）";

function findWidget(node, name) {
    return node.widgets?.find((w) => w.name === name) || null;
}

function setTextWidgetLocked(widget, locked) {
    const el = widget?.inputEl || widget?.element;
    if (!el) return;
    if ("readOnly" in el) el.readOnly = locked;
    el.disabled = false; // keep text selectable/copyable; readOnly does the lock
    el.style.opacity = locked ? "0.55" : "";
    el.style.pointerEvents = locked ? "none" : "";
    el.title = locked ? BANNER_TEXT : "";
}

function applyApiMode(node) {
    const apiWidget = findWidget(node, "api_mode");
    const timelineWidget = findWidget(node, "timeline_data");
    if (!apiWidget) return;
    const on = !!apiWidget.value;
    node._zxApiMode = on;

    if (timelineWidget) {
        if (on && !node._zxApplying) {
            node._zxApplying = true;
            try {
                // 导轨清零：本地时间轴不再是真相来源。
                if (String(timelineWidget.value || "").trim() !== "") {
                    timelineWidget.value = "";
                }
            } finally {
                node._zxApplying = false;
            }
        }
        setTextWidgetLocked(timelineWidget, on);
    }
    node.setDirtyCanvas?.(true, true);
}

function wireNode(node) {
    const apiWidget = findWidget(node, "api_mode");
    const timelineWidget = findWidget(node, "timeline_data");
    if (apiWidget && !apiWidget._zxWired) {
        apiWidget._zxWired = true;
        const prev = apiWidget.callback;
        apiWidget.callback = function () {
            prev?.apply(this, arguments);
            applyApiMode(node);
        };
    }
    if (timelineWidget && !timelineWidget._zxWired) {
        timelineWidget._zxWired = true;
        const prevT = timelineWidget.callback;
        timelineWidget.callback = function () {
            if (node._zxApiMode && !node._zxApplying) {
                // 锁死：API 模式下拒绝任何本地写回。
                this.value = "";
                node.setDirtyCanvas?.(true, true);
                return;
            }
            prevT?.apply(this, arguments);
        };
    }
    applyApiMode(node);
}

function drawBanner(node, ctx) {
    if (!node._zxApiMode) return;
    ctx.save();
    ctx.font = "bold 12px sans-serif";
    const pad = 6;
    const w = ctx.measureText(BANNER_TEXT).width + pad * 2;
    const x = 8;
    const y = -(LiteGraph?.NODE_TITLE_HEIGHT || 30) - 22;
    ctx.fillStyle = "rgba(140, 20, 20, 0.92)";
    ctx.fillRect(x, y, Math.min(w, (node.size?.[0] || 300) - 16), 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(BANNER_TEXT, x + pad, y + 14, (node.size?.[0] || 300) - 28);
    ctx.restore();
}

app.registerExtension({
    name: "ZeroExo.DirectorBridge.ApiMode",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== ZX_CLASS) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            wireNode(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            // Re-apply lock state when a workflow is loaded.
            wireNode(this);
        };

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            onDrawForeground?.apply(this, arguments);
            drawBanner(this, ctx);
        };
    },
});
