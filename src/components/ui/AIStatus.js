import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useApp } from "@/state/store";
export function AIStatus() {
    const channel = useApp((s) => s.channel);
    const ai = useApp((s) => s.ai);
    const cls = channel === "live" ? "ai-status live" : "ai-status mock";
    return (_jsxs("div", { className: cls, children: [_jsx("span", { className: "dot" }), _jsx("span", { children: channel }), _jsxs("code", { children: ["prog ", ai.progress.toFixed(2), " \u00B7 conf ", ai.confidence.toFixed(2), " ", "\u00B7 tiles ", ai.tilesReady.toFixed(2), " \u00B7 ", ai.status] })] }));
}
