/**
 * AI channel — bidirectional WebSocket + mock fallback.
 *
 * Inbound: inference telemetry + masks from SAM server.
 * Outbound: segment / batch_retouch commands via sendWsCommand.
 */
import { useApp } from "@/state/store";
import { nextMaskId } from "@/segmentation/maskUtils";
let activeWs = null;
export function sendWsCommand(cmd) {
    if (activeWs?.readyState === WebSocket.OPEN) {
        activeWs.send(JSON.stringify(cmd));
    }
}
export function connectAiChannel(wsUrl) {
    const store = useApp.getState();
    if (!wsUrl) {
        store.setChannel("mock");
        return runMock();
    }
    store.setChannel("connecting");
    let ws;
    try {
        ws = new WebSocket(wsUrl);
        activeWs = ws;
    }
    catch (e) {
        console.warn("[ai] ws construct failed, falling back to mock", e);
        store.setChannel("mock");
        return runMock();
    }
    const fallback = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            console.warn("[ai] ws connect timed out, falling back to mock");
            try {
                ws.close();
            }
            catch { }
            store.setChannel("mock");
            mockHandle = runMock();
        }
    }, 1500);
    let mockHandle = null;
    ws.onopen = () => {
        window.clearTimeout(fallback);
        useApp.getState().setChannel("live");
    };
    ws.onerror = (e) => console.warn("[ai] ws error", e);
    ws.onclose = () => {
        activeWs = null;
        if (useApp.getState().channel === "live") {
            useApp.getState().setChannel("idle");
        }
    };
    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            applyMessage(msg);
        }
        catch (err) {
            console.warn("[ai] bad message", err);
        }
    };
    return {
        isMock: false,
        send: sendWsCommand,
        close() {
            window.clearTimeout(fallback);
            mockHandle?.close();
            activeWs = null;
            try {
                ws.close();
            }
            catch { }
        },
    };
}
export function applyMessage(msg) {
    const st = useApp.getState();
    const { setAi, addSegment, setSegments, updateBatchItem } = st;
    switch (msg.type) {
        case "status":
            setAi({ status: msg.status, busy: msg.busy });
            break;
        case "progress":
            setAi({ progress: clamp01(msg.progress) });
            break;
        case "confidence":
            setAi({ confidence: clamp01(msg.confidence) });
            break;
        case "tiles":
            setAi({ tilesReady: clamp01(msg.ready / Math.max(msg.total, 1)) });
            break;
        case "focus":
            setAi({ focus: { x: clamp01(msg.x), y: clamp01(msg.y) } });
            break;
        case "result":
            st.setSources(st.before, msg.url);
            break;
        case "error":
            setAi({ status: `error: ${msg.message}`, busy: false });
            break;
        case "hello":
            setAi({ status: `connected ${msg.runId}` });
            break;
        case "mask": {
            const m = {
                id: msg.id ?? nextMaskId(),
                label: msg.label ?? "server",
                dataUrl: msg.dataUrl,
                bbox: msg.bbox,
                centroid: msg.centroid,
                score: msg.score ?? 0.9,
                selected: true,
            };
            addSegment(m);
            st.setSegmentBusy(false);
            break;
        }
        case "segments":
            setSegments(msg.masks.map((m) => ({
                id: m.id ?? nextMaskId(),
                label: m.label ?? "server",
                dataUrl: m.dataUrl,
                bbox: m.bbox,
                centroid: m.centroid,
                score: m.score ?? 0.85,
                selected: false,
                stickerUrl: m.stickerUrl,
            })));
            st.setSegmentBusy(false);
            break;
        case "batch_progress":
            updateBatchItem(msg.itemId, {
                progress: msg.progress,
                status: msg.status,
                ...(msg.after ? { after: msg.after } : {}),
            });
            break;
    }
}
function clamp01(n) {
    return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}
function runMock() {
    let t = 0;
    const tick = 100;
    const cycle = 12_000;
    let stopped = false;
    const step = () => {
        if (stopped)
            return;
        t = (t + tick) % cycle;
        const phase = t / cycle;
        if (phase < 0.05) {
            applyMessage({ type: "status", status: "queuing", busy: true });
            applyMessage({ type: "progress", progress: 0 });
            applyMessage({ type: "tiles", ready: 0, total: 16 });
            applyMessage({ type: "confidence", confidence: 0.2 });
            applyMessage({
                type: "focus",
                x: 0.3 + Math.random() * 0.4,
                y: 0.3 + Math.random() * 0.4,
            });
        }
        else if (phase < 0.75) {
            const p = (phase - 0.05) / 0.7;
            applyMessage({ type: "status", status: "inferring", busy: true });
            applyMessage({ type: "progress", progress: p });
            applyMessage({ type: "tiles", ready: Math.floor(p * 16), total: 16 });
            applyMessage({ type: "confidence", confidence: 0.2 + p * 0.7 });
        }
        else if (phase < 0.85) {
            applyMessage({ type: "status", status: "stitching", busy: true });
            applyMessage({ type: "progress", progress: 1 });
            applyMessage({ type: "tiles", ready: 16, total: 16 });
        }
        else {
            applyMessage({ type: "status", status: "idle", busy: false });
            applyMessage({ type: "confidence", confidence: 1 });
        }
        window.setTimeout(step, tick);
    };
    window.setTimeout(step, tick);
    return {
        isMock: true,
        send() { },
        close() { stopped = true; },
    };
}
