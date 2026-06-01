import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { BeforeAfter } from "./components/BeforeAfter";
import { ControlPanel } from "./components/ui/ControlPanel";
import { BatchPanel, SegmentPanel } from "./components/ui/SegmentPanel";
import { Inspector } from "./components/ui/Inspector";
import { AIStatus } from "./components/ui/AIStatus";
import { connectAiChannel } from "./ai/channel";
import { useApp } from "./state/store";
import { loadFile } from "./lib/image";
import { callGrokForEdits, askGrokForPlan, captureCurrentImageBase64, executeGrokPlan } from "./lib/grok";
import { extractExif } from "./lib/exif";
const WS_URL = import.meta.env.VITE_AI_WS ?? "";
export default function App() {
    const [tab, setTabState] = useState("segment");
    const slider = useApp((s) => s.slider);
    const sliderDragging = useApp((s) => s.sliderDragging);
    const setSlider = useApp((s) => s.setSlider);
    const ai = useApp((s) => s.ai);
    const channel = useApp((s) => s.channel);
    const loadImage = useApp((s) => s.loadImage);
    const before = useApp((s) => s.before);
    const adjustmentScope = useApp((s) => s.adjustmentScope);
    const activeSegmentId = useApp((s) => s.activeSegmentId);
    const setAdjustment = useApp((s) => s.setAdjustment);
    const isTethered = useApp((s) => s.isTethered);
    const setIsTethered = useApp((s) => s.setIsTethered);
    const showInspector = useApp((s) => s.showInspector);
    const setShowInspector = useApp((s) => s.setShowInspector);
    const sliderAutoAnimation = useApp((s) => s.sliderAutoAnimation);
    const setSliderAutoAnimation = useApp((s) => s.setSliderAutoAnimation);
    // Mobile sheet state — enables the clean, image-first "start of the concept" experience on phones/tablets
    // while the desktop keeps the full powerful 3-column pro layout
    const [mobileSheet, setMobileSheet] = useState(null);
    // PWA Install prompt handling
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [isInstallable, setIsInstallable] = useState(false);
    useEffect(() => {
        const handler = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setIsInstallable(true);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);
    const handleInstallClick = async () => {
        if (!deferredPrompt)
            return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setIsInstallable(false);
        }
        setDeferredPrompt(null);
    };
    const fileInputRef = useRef(null);
    const openFile = () => fileInputRef.current?.click();
    const onFileChosen = async (e) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                // When user manually loads an image, exit any live tether mode
                // and clear stale AI animation state
                const ws = window.__aitoTether;
                if (ws) {
                    ws.close();
                    window.__aitoTether = null;
                }
                setIsTethered(false);
                useApp.getState().setAi({ busy: false, progress: 0 });
                useApp.getState().setSlider(0.5);
                const loaded = await loadFile(file);
                loadImage("both", loaded);
                // Extract EXIF for the inspector metadata panel
                const exifData = await extractExif(file);
                useApp.getState().setExif(exifData);
                // Make SAM central immediately
                setTabState("segment");
            }
            catch (err) {
                console.error(err);
            }
        }
        // allow re-selecting the same file
        e.target.value = "";
    };
    // Grok AI Command Handler — now supports agentic plans
    const handleGrokCommand = async (command, mode = 'direct') => {
        console.log('[Grok Command]', command, 'mode:', mode);
        const apiKey = localStorage.getItem('grok_api_key') || prompt('Enter your xAI Grok API key (stored in browser):');
        if (!apiKey)
            return;
        localStorage.setItem('grok_api_key', apiKey);
        try {
            const imageBase64 = captureCurrentImageBase64();
            const currentAdj = useApp.getState().adjustments;
            const activeRefs = useApp.getState().references
                .filter(r => useApp.getState().activeReferenceIds.includes(r.id))
                .map(r => r.url);
            if (mode === 'plan') {
                // High-quality mode: ask Grok to create a full plan first
                const planResult = await askGrokForPlan(apiKey, command, imageBase64, currentAdj, activeRefs);
                if (planResult?.plan) {
                    console.log('[Grok Plan]', planResult);
                    // For now we auto-execute the plan. In future we can show UI for approval.
                    executeGrokPlan(planResult.plan, {
                        setAdjustment: (key, value) => setAdjustment(key, value),
                        applyLut: (preset, intensity = 0.85) => {
                            setAdjustment('lutIntensity', intensity);
                            console.log(`Grok applied LUT: ${preset}`);
                        },
                        createMaskFromPrompt: (desc) => {
                            // Trigger SAM with description (best effort)
                            console.log('Grok wants mask:', desc);
                            useApp.getState().setSegmentTool('auto'); // crude but works for demo
                        },
                        setMaskScope: (scope) => {
                            useApp.getState().setAdjustmentScope({
                                useActiveMask: scope !== 'all',
                                invert: scope === 'background'
                            });
                        },
                        captureTether: () => {
                            const ws = window.__aitoTether;
                            if (ws)
                                ws.send(JSON.stringify({ type: 'capture' }));
                        }
                    });
                }
            }
            else {
                // Fast direct mode (original behavior, improved)
                const result = await callGrokForEdits(apiKey, command, imageBase64, currentAdj, activeRefs);
                if (result.plan) {
                    executeGrokPlan(result.plan, {
                        setAdjustment: (key, value) => setAdjustment(key, value),
                        applyLut: (_preset, intensity = 0.85) => setAdjustment('lutIntensity', intensity),
                        createMaskFromPrompt: (desc) => console.log('Grok mask request:', desc),
                        setMaskScope: (scope) => useApp.getState().setAdjustmentScope({
                            useActiveMask: scope !== 'all'
                        }),
                    });
                }
                else {
                    // Legacy single response path
                    if (result.adjustments) {
                        Object.entries(result.adjustments).forEach(([key, value]) => {
                            if (typeof value === 'number')
                                setAdjustment(key, value);
                        });
                    }
                    if (result.lutName) {
                        setAdjustment('lutIntensity', result.intensity ?? 0.8);
                    }
                }
            }
        }
        catch (err) {
            console.error('Grok call failed:', err);
            alert('Grok API error. Check key and console.');
        }
    };
    // Live Tether to local devices (inspired by fornevercollective/overview live lab tools)
    // Typical pattern: Browser connects to a local WebSocket companion (Python/Node)
    // that talks to camera PTP/IP, Blackmagic, etc. and streams preview frames.
    const connectTether = () => {
        const wsUrl = prompt('Enter local tether WebSocket URL (e.g. ws://localhost:8766/tether)', 'ws://localhost:8766/tether');
        if (!wsUrl)
            return;
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
            setIsTethered(true);
            useApp.getState().setTetherCamera("Connected camera");
            // Force slider to center so live preview is clearly visible
            setSlider(0.5);
            console.log('[Tether] Connected to local device companion');
            ws.send(JSON.stringify({ type: 'connect', client: 'aito' }));
        };
        ws.onmessage = (event) => {
            // Expect either:
            // - base64 JPEG preview
            // - binary frame
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'preview' && data.image) {
                    // Reset AI signals so the old easing animation doesn't fight the new live frame
                    useApp.getState().setAi({ busy: false, progress: 0 });
                    // Set live preview as current 'before' image
                    loadImage('both', {
                        url: data.image,
                        width: data.width || 1920,
                        height: data.height || 1080
                    });
                    // Companion can push camera model + EXIF for the current frame
                    if (data.camera) {
                        useApp.getState().setTetherCamera(data.camera);
                    }
                    if (data.exif) {
                        useApp.getState().setExif(data.exif);
                    }
                }
            }
            catch (e) {
                // Could be binary blob - handle as needed
            }
        };
        ws.onclose = () => {
            setIsTethered(false);
            console.log('[Tether] Disconnected');
        };
        // Store ws for later control (capture, etc.)
        window.__aitoTether = ws;
    };
    // One-time auto subject lift when user opens a fresh photo (immediate "it just works")
    const didAutoSegmentRef = useRef("");
    useEffect(() => {
        if (!before || didAutoSegmentRef.current === before)
            return;
        // Only auto for user-loaded images (object URLs), not the initial demo
        if (before.startsWith("blob:")) {
            didAutoSegmentRef.current = before;
            // Small delay so the image is ready in textures/SAM cache
            const id = window.setTimeout(() => {
                // Trigger the existing auto flow by switching tool if user is on segment tab
                const st = useApp.getState();
                if (st.segmentTool !== "auto" && !st.segmentBusy) {
                    st.setSegmentTool("auto");
                    // reset back to tap after it fires (the effect in BeforeAfter runs once)
                    window.setTimeout(() => st.setSegmentTool("tap"), 1200);
                }
            }, 420);
            return () => clearTimeout(id);
        }
    }, [before]);
    // Basic "what you see on the right side" export. Good enough for Phase 0;
    // later versions will do full-resolution bake of after + corrections + layers.
    const exportCurrent = async () => {
        const stage = document.querySelector(".stage");
        const glCanvas = stage?.querySelector("canvas");
        if (!glCanvas)
            return;
        // Briefly drive slider to full "after" for a clean export of the right side
        const prevSlider = useApp.getState().slider;
        const setSlider = useApp.getState().setSlider;
        setSlider(1);
        // Wait two frames for the GL render to settle (slider clip + any easing)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rect = glCanvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const out = document.createElement("canvas");
        out.width = Math.floor(rect.width * dpr);
        out.height = Math.floor(rect.height * dpr);
        const ctx = out.getContext("2d", { alpha: false });
        ctx.scale(dpr, dpr);
        ctx.drawImage(glCanvas, 0, 0, rect.width, rect.height);
        // Restore slider
        setSlider(prevSlider);
        const a = document.createElement("a");
        const name = useApp.getState().afterMeta?.name?.replace(/\.[^.]+$/, "") || "aito-edit";
        a.href = out.toDataURL("image/png");
        a.download = `${name}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    };
    // Mask-aware "hatch for export" variants — Apple-style subject lift with treatments.
    // Uses the active SAM mask + current corrected view for clean pixel output.
    const exportMasked = async (mode) => {
        const stage = document.querySelector(".stage");
        const glCanvas = stage?.querySelector("canvas");
        const s = useApp.getState();
        const activeMask = s.segments.find((m) => m.id === s.activeSegmentId);
        if (!glCanvas || !activeMask)
            return;
        // Capture the corrected "after" view (full right side)
        const prevSlider = s.slider;
        const setSlider = s.setSlider;
        setSlider(1);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rect = glCanvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const capture = document.createElement("canvas");
        capture.width = Math.floor(rect.width * dpr);
        capture.height = Math.floor(rect.height * dpr);
        const cctx = capture.getContext("2d", { alpha: true });
        cctx.scale(dpr, dpr);
        cctx.drawImage(glCanvas, 0, 0, rect.width, rect.height);
        setSlider(prevSlider);
        // Load the high-res mask and composite
        const maskImg = await new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = activeMask.dataUrl;
        });
        const out = document.createElement("canvas");
        out.width = capture.width;
        out.height = capture.height;
        const octx = out.getContext("2d", { alpha: true });
        // Draw base corrected image
        octx.drawImage(capture, 0, 0);
        // Use mask as alpha mask for the desired region
        octx.globalCompositeOperation = "destination-in";
        // Scale the mask to the capture size (masks are stored at native image res)
        const mw = maskImg.width;
        const mh = maskImg.height;
        const scaleX = capture.width / mw;
        const scaleY = capture.height / mh;
        octx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
        if (mode === "subject") {
            octx.drawImage(maskImg, 0, 0);
        }
        else {
            // background = invert mask
            octx.fillStyle = "#fff";
            octx.fillRect(0, 0, mw, mh);
            octx.globalCompositeOperation = "destination-out";
            octx.drawImage(maskImg, 0, 0);
        }
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.globalCompositeOperation = "source-over";
        const a = document.createElement("a");
        const name = s.afterMeta?.name?.replace(/\.[^.]+$/, "") || "aito-edit";
        const suffix = mode === "subject" ? "-subject" : "-background";
        a.href = out.toDataURL("image/png");
        a.download = `${name}${suffix}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    };
    useEffect(() => {
        const handle = connectAiChannel(WS_URL || undefined);
        return () => handle.close();
    }, []);
    useEffect(() => {
        // In live tether mode we control the slider manually — disable AI takeover animation
        // to prevent it from sliding back and forth with stale preview frames
        const before = useApp.getState().before;
        if (!before || sliderDragging || !ai.busy || isTethered || !sliderAutoAnimation)
            return;
        const target = 1 - ai.progress * 0.5;
        const id = requestAnimationFrame(() => {
            setSlider(slider + (target - slider) * 0.08);
        });
        return () => cancelAnimationFrame(id);
    }, [ai.busy, ai.progress, slider, sliderDragging, setSlider, isTethered, before, sliderAutoAnimation]);
    return (_jsxs("div", { className: `app ${!showInspector ? 'inspector-collapsed' : ''}`, children: [_jsxs("div", { className: "top", children: [_jsx("span", { className: "brand", children: "aito" }), _jsx("span", { style: { fontSize: '10px', color: '#444', marginLeft: '4px' }, children: "live" }), _jsx("a", { href: "/aito/hub/", className: "version-link", style: { color: '#888', marginLeft: '8px' }, children: "hub" }), _jsx("span", { className: "version-badge", children: "main" }), isTethered && (_jsxs("button", { className: "live-indicator live-view-btn", onClick: () => {
                            // Desktop: scroll hint (inspector always visible on right)
                            // Mobile: open the beautiful clean inspector sheet
                            if (window.innerWidth < 920) {
                                setMobileSheet('inspector');
                            }
                            else {
                                const insp = document.querySelector('.inspector');
                                insp?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }
                        }, title: "Live tethered view \u2014 controls & EXIF", children: [_jsx("div", { className: "live-dot" }), "LIVE VIEW"] })), !isTethered && (_jsx("button", { className: "tether-btn", onClick: connectTether, title: "Connect to local camera companion (supports all major camera systems)", children: "Tether" })), isInstallable && (_jsx("button", { className: "top-btn", onClick: handleInstallClick, title: "Install aito as an app (PWA)", children: "Install" })), _jsxs("div", { className: "ai-command-bar-inline", children: [_jsx("input", { type: "text", placeholder: "Ask Grok\u2026 (e.g. cinematic teal orange blockbuster, mask the subject, subtle film grain)", className: "ai-input", onKeyDown: (e) => {
                                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                        handleGrokCommand(e.currentTarget.value, 'direct');
                                        e.currentTarget.value = '';
                                    }
                                } }), _jsx("button", { className: "ai-btn", onClick: (e) => {
                                    const input = e.currentTarget.parentElement?.querySelector('input');
                                    if (input?.value.trim()) {
                                        handleGrokCommand(input.value, 'direct');
                                        input.value = '';
                                    }
                                }, children: "Apply" }), _jsx("button", { className: "ai-btn", style: { background: '#333', color: '#ff9f1c' }, title: "Let Grok create a full multi-step plan first (higher quality for complex requests)", onClick: (e) => {
                                    const input = e.currentTarget.parentElement?.querySelector('input');
                                    if (input?.value.trim()) {
                                        handleGrokCommand(input.value, 'plan');
                                        input.value = '';
                                    }
                                }, children: "Plan" })] }), _jsx("button", { type: "button", className: "open-btn", onClick: openFile, children: "Open" }), _jsx("button", { type: "button", className: "top-btn", onClick: () => {
                            const b = useApp.getState().before;
                            const bm = useApp.getState().beforeMeta;
                            useApp.getState().setSources(b, b, bm, bm);
                        }, children: "Reset" }), _jsx("button", { type: "button", className: "top-btn", onClick: () => {
                            const s = useApp.getState();
                            s.setSources(s.after, s.before, s.afterMeta, s.beforeMeta);
                        }, children: "Swap" }), _jsx("button", { type: "button", className: "top-btn primary", onClick: () => void exportCurrent(), children: "Export Full" }), adjustmentScope.useActiveMask && activeSegmentId && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "top-btn", onClick: () => void exportMasked("subject"), children: "Export Subject" }), _jsx("button", { type: "button", className: "top-btn", onClick: () => void exportMasked("background"), children: "Export BG" })] })), _jsx("span", { className: "muted", children: "SAM \u00B7 corrections \u00B7 before/after" }), _jsx("button", { className: `top-btn ${sliderAutoAnimation ? '' : 'muted'}`, onClick: () => setSliderAutoAnimation(!sliderAutoAnimation), title: sliderAutoAnimation ? "Disable AI slider animation (slider stays where you put it)" : "Enable AI slider animation", children: sliderAutoAnimation ? "Auto-Slider" : "Manual Slider" }), _jsx("button", { className: "top-btn", onClick: () => setShowInspector(!showInspector), title: showInspector ? "Collapse right panel (refs, tether, EXIF)" : "Show right panel (refs, tether, EXIF)", children: showInspector ? "Hide Board" : "Refs + Info" }), _jsx("div", { className: "spacer" }), _jsxs("span", { className: "muted", children: ["ws: ", _jsx("code", { children: WS_URL || "(mock)" }), " \u00B7 ", channel] }), _jsx("input", { ref: fileInputRef, type: "file", accept: "image/*", hidden: true, onChange: onFileChosen })] }), _jsx(BeforeAfter, {}), _jsxs("aside", { className: "panel", children: [_jsx("div", { className: "tabs", children: ["segment", "batch", "effects"].map((t) => (_jsx("button", { type: "button", className: tab === t ? "active" : "", onClick: () => setTabState(t), children: t }, t))) }), tab === "effects" && _jsx(ControlPanel, {}), tab === "segment" && _jsx(SegmentPanel, {}), tab === "batch" && _jsx(BatchPanel, {})] }), showInspector && _jsx(Inspector, {}), _jsx(AIStatus, {}), _jsxs("div", { className: "mobile-bottom-bar", children: [_jsxs("button", { onClick: () => setMobileSheet('ai'), title: "AI / Grok", children: [_jsx("span", { className: "icon", children: "\u2726" }), _jsx("span", { children: "AI" })] }), _jsxs("button", { onClick: () => setMobileSheet('tools'), title: "Tools & masks", children: [_jsx("span", { className: "icon", children: "\u25D0" }), _jsx("span", { children: "Tools" })] }), _jsxs("button", { onClick: () => setMobileSheet('inspector'), className: isTethered ? 'active' : '', title: "Tether + Metadata", children: [_jsx("span", { className: "icon", children: "\u2B21" }), _jsx("span", { children: isTethered ? 'LIVE' : 'Info' })] }), _jsxs("button", { onClick: () => void exportCurrent(), title: "Export", children: [_jsx("span", { className: "icon", children: "\u2193" }), _jsx("span", { children: "Export" })] })] }), mobileSheet && (_jsxs("div", { className: `mobile-sheet ${mobileSheet ? 'open' : ''}`, children: [_jsxs("div", { className: "mobile-sheet-header", children: [_jsxs("div", { className: "title", children: [mobileSheet === 'ai' && 'AI Command', mobileSheet === 'tools' && 'Tools & Masking', mobileSheet === 'inspector' && (isTethered ? 'Live Tether + Metadata' : 'Metadata')] }), _jsx("button", { className: "close", onClick: () => setMobileSheet(null), children: "\u00D7" })] }), _jsxs("div", { className: "mobile-sheet-content", children: [mobileSheet === 'ai' && (_jsxs(_Fragment, { children: [_jsx("input", { type: "text", className: "mobile-ai-input", placeholder: "Describe the look for Grok (film, exposure, mask, LUT...)", onKeyDown: (e) => {
                                            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                handleGrokCommand(e.currentTarget.value, 'plan'); // default to plan on mobile
                                                e.currentTarget.value = '';
                                                setMobileSheet(null);
                                            }
                                        }, autoFocus: true }), _jsxs("div", { style: { display: 'flex', gap: '8px', marginTop: '8px' }, children: [_jsx("button", { onClick: () => {
                                                    const input = document.querySelector('.mobile-ai-input');
                                                    if (input?.value.trim()) {
                                                        handleGrokCommand(input.value, 'direct');
                                                        input.value = '';
                                                        setMobileSheet(null);
                                                    }
                                                }, style: { flex: 1, padding: '10px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '6px' }, children: "Quick Apply" }), _jsx("button", { onClick: () => {
                                                    const input = document.querySelector('.mobile-ai-input');
                                                    if (input?.value.trim()) {
                                                        handleGrokCommand(input.value, 'plan');
                                                        input.value = '';
                                                        setMobileSheet(null);
                                                    }
                                                }, style: { flex: 1, padding: '10px', background: '#ff5b2e', color: '#000', border: 'none', borderRadius: '6px', fontWeight: 600 }, children: "Plan with Grok" })] }), _jsx("div", { style: { color: '#555', fontSize: '12px', marginTop: '8px' }, children: "\"Plan with Grok\" creates a thoughtful multi-step edit sequence." })] })), mobileSheet === 'tools' && (_jsxs(_Fragment, { children: [_jsx("div", { className: "tabs", style: { marginBottom: 12 }, children: ["segment", "batch", "effects"].map((t) => (_jsx("button", { type: "button", className: tab === t ? "active" : "", onClick: () => setTabState(t), children: t }, t))) }), tab === "effects" && _jsx(ControlPanel, {}), tab === "segment" && _jsx(SegmentPanel, {}), tab === "batch" && _jsx(BatchPanel, {})] })), mobileSheet === 'inspector' && (_jsx(Inspector, {}))] })] }))] }));
}
