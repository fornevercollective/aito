import { useEffect, useRef, useState } from "react";
import { BeforeAfter } from "./components/BeforeAfter";
import { ControlPanel } from "./components/ui/ControlPanel";
import { BatchPanel, SegmentPanel } from "./components/ui/SegmentPanel";
import { Inspector } from "./components/ui/Inspector";
import { AIStatus } from "./components/ui/AIStatus";
import { connectAiChannel } from "./ai/channel";
import { useApp } from "./state/store";
import { loadFile } from "./lib/image";
import { callGrokForEdits, captureCurrentImageBase64 } from "./lib/grok";
import { extractExif } from "./lib/exif";

const WS_URL = import.meta.env.VITE_AI_WS ?? "";

type Tab = "effects" | "segment" | "batch";

export default function App() {
  const [tab, setTabState] = useState<Tab>("segment");
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

  // Mobile sheet state — enables the clean, image-first "start of the concept" experience on phones/tablets
  // while the desktop keeps the full powerful 3-column pro layout
  const [mobileSheet, setMobileSheet] = useState<null | 'tools' | 'inspector' | 'ai'>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFile = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        // When user manually loads an image, exit any live tether mode
        // and clear stale AI animation state
        const ws = (window as any).__aitoTether;
        if (ws) {
          ws.close();
          (window as any).__aitoTether = null;
        }
        setIsTethered(false);
        useApp.getState().setAi({ busy: false, progress: 0 });

        const loaded = await loadFile(file);
        loadImage("both", loaded);

        // Extract EXIF for the inspector metadata panel
        const exifData = await extractExif(file);
        useApp.getState().setExif(exifData);
        // Make SAM central immediately
        setTabState("segment");
      } catch (err) {
        console.error(err);
      }
    }
    // allow re-selecting the same file
    e.target.value = "";
  };

  // Grok AI Command Handler - real integration
  const handleGrokCommand = async (command: string) => {
    console.log('[Grok Command]', command);
    
    const apiKey = localStorage.getItem('grok_api_key') || prompt('Enter your xAI Grok API key (stored in browser):');
    if (!apiKey) return;
    localStorage.setItem('grok_api_key', apiKey);

    try {
      const imageBase64 = captureCurrentImageBase64();
      const currentAdj = useApp.getState().adjustments;

      const result = await callGrokForEdits(apiKey, command, imageBase64, currentAdj);

      // Apply structured response
      if (result.adjustments) {
        Object.entries(result.adjustments).forEach(([key, value]) => {
          if (typeof value === 'number') {
            setAdjustment(key as any, value);
          }
        });
      }

      if (result.lutName) {
        // In future: load specific LUT by name
        setAdjustment('lutIntensity', result.intensity ?? 0.8);
      }

      if (result.maskPrompt && activeSegmentId) {
        // Could trigger new SAM with the prompt (advanced)
        console.log('Grok suggested mask:', result.maskPrompt);
      }

      console.log('[Grok Response]', result);
    } catch (err) {
      console.error('Grok call failed:', err);
      alert('Grok API error. Check key and console.');
    }
  };

  // Live Tether to local devices (inspired by fornevercollective/overview live lab tools)
  // Typical pattern: Browser connects to a local WebSocket companion (Python/Node)
  // that talks to camera PTP/IP, Blackmagic, etc. and streams preview frames.
  const connectTether = () => {
    const wsUrl = prompt('Enter local tether WebSocket URL (e.g. ws://localhost:8766/tether)', 'ws://localhost:8766/tether');
    if (!wsUrl) return;

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
      } catch (e) {
        // Could be binary blob - handle as needed
      }
    };

    ws.onclose = () => {
      setIsTethered(false);
      console.log('[Tether] Disconnected');
    };

    // Store ws for later control (capture, etc.)
    (window as any).__aitoTether = ws;
  };

  // One-time auto subject lift when user opens a fresh photo (immediate "it just works")
  const didAutoSegmentRef = useRef<string>("");
  useEffect(() => {
    if (!before || didAutoSegmentRef.current === before) return;
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
    const stage = document.querySelector(".stage") as HTMLElement | null;
    const glCanvas = stage?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!glCanvas) return;

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
    const ctx = out.getContext("2d", { alpha: false })!;
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
  const exportMasked = async (mode: "subject" | "background") => {
    const stage = document.querySelector(".stage") as HTMLElement | null;
    const glCanvas = stage?.querySelector("canvas") as HTMLCanvasElement | null;
    const s = useApp.getState();
    const activeMask = s.segments.find((m) => m.id === s.activeSegmentId);
    if (!glCanvas || !activeMask) return;

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
    const cctx = capture.getContext("2d", { alpha: true })!;
    cctx.scale(dpr, dpr);
    cctx.drawImage(glCanvas, 0, 0, rect.width, rect.height);
    setSlider(prevSlider);

    // Load the high-res mask and composite
    const maskImg = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = activeMask.dataUrl;
    });

    const out = document.createElement("canvas");
    out.width = capture.width;
    out.height = capture.height;
    const octx = out.getContext("2d", { alpha: true })!;

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
    } else {
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
    if (sliderDragging || !ai.busy || isTethered) return;
    const target = 1 - ai.progress * 0.5;
    const id = requestAnimationFrame(() => {
      setSlider(slider + (target - slider) * 0.08);
    });
    return () => cancelAnimationFrame(id);
  }, [ai.busy, ai.progress, slider, sliderDragging, setSlider, isTethered]);

  return (
    <div className="app">
      <div className="top">
        <span className="brand">aito</span>
        <span style={{fontSize: '10px', color: '#444', marginLeft: '4px'}}>live</span>
        <a href="/aito/hub/" className="version-link" style={{color: '#888', marginLeft: '8px'}}>hub</a>
        <span className="version-badge">main</span>

        {/* Prominent clickable LIVE VIEW indicator */}
        {isTethered && (
          <button 
            className="live-indicator live-view-btn"
            onClick={() => {
              // Desktop: scroll hint (inspector always visible on right)
              // Mobile: open the beautiful clean inspector sheet
              if (window.innerWidth < 920) {
                setMobileSheet('inspector');
              } else {
                const insp = document.querySelector('.inspector');
                insp?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            }}
            title="Live tethered view — controls & EXIF"
          >
            <div className="live-dot" />
            LIVE VIEW
          </button>
        )}

        {/* Tether connect (only when not live) */}
        {!isTethered && (
          <button 
            className="tether-btn"
            onClick={connectTether}
            title="Connect to local camera companion (supports all major camera systems)"
          >
            Tether
          </button>
        )}

        {/* AI Prompt — always visible for power users (matches launch thumbnails) */}
        <div className="ai-command-bar-inline">
          <input 
            type="text" 
            placeholder="Ask Grok… (e.g. teal & orange blockbuster, +0.7 exposure, mask subject)"
            className="ai-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                handleGrokCommand(e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
          <button className="ai-btn" onClick={() => { /* input handles enter */ }}>Send</button>
        </div>
        <button type="button" className="open-btn" onClick={openFile}>
          Open
        </button>
        <button
          type="button"
          className="top-btn"
          onClick={() => {
            const b = useApp.getState().before;
            const bm = useApp.getState().beforeMeta;
            useApp.getState().setSources(b, b, bm, bm);
          }}
        >
          Reset
        </button>
        <button
          type="button"
          className="top-btn"
          onClick={() => {
            const s = useApp.getState();
            s.setSources(s.after, s.before, s.afterMeta, s.beforeMeta);
          }}
        >
          Swap
        </button>
        <button type="button" className="top-btn primary" onClick={() => void exportCurrent()}>
          Export Full
        </button>
        {adjustmentScope.useActiveMask && activeSegmentId && (
          <>
            <button type="button" className="top-btn" onClick={() => void exportMasked("subject")}>
              Export Subject
            </button>
            <button type="button" className="top-btn" onClick={() => void exportMasked("background")}>
              Export BG
            </button>
          </>
        )}
        <span className="muted">SAM · corrections · before/after</span>
        <div className="spacer" />
        <span className="muted">
          ws: <code>{WS_URL || "(mock)"}</code> · {channel}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onFileChosen}
        />
      </div>
      <BeforeAfter />
      <aside className="panel">
        <div className="tabs">
          {(["segment", "batch", "effects"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? "active" : ""}
              onClick={() => setTabState(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "effects" && <ControlPanel />}
        {tab === "segment" && <SegmentPanel />}
        {tab === "batch" && <BatchPanel />}
      </aside>

      {/* Right inspector: Tether controls + EXIF/metadata — matches the launch thumbnails */}
      <Inspector />

      <AIStatus />

      {/* =====================================================
         MOBILE BOTTOM BAR + SHEETS
         This is the "start of the concept" experience on phones
         and tablets: clean, image-first, our exact dark minimal style.
         The full power is one tap away in elegant sheets.
         ===================================================== */}
      <div className="mobile-bottom-bar">
        <button onClick={() => setMobileSheet('ai')} title="AI / Grok">
          <span className="icon">✦</span>
          <span>AI</span>
        </button>
        <button onClick={() => setMobileSheet('tools')} title="Tools & masks">
          <span className="icon">◐</span>
          <span>Tools</span>
        </button>
        <button 
          onClick={() => setMobileSheet('inspector')} 
          className={isTethered ? 'active' : ''}
          title="Tether + Metadata"
        >
          <span className="icon">⬡</span>
          <span>{isTethered ? 'LIVE' : 'Info'}</span>
        </button>
        <button onClick={() => void exportCurrent()} title="Export">
          <span className="icon">↓</span>
          <span>Export</span>
        </button>
      </div>

      {/* Mobile sheets — slide up, same aesthetic as the rest of aito */}
      {mobileSheet && (
        <div className={`mobile-sheet ${mobileSheet ? 'open' : ''}`}>
          <div className="mobile-sheet-header">
            <div className="title">
              {mobileSheet === 'ai' && 'AI Command'}
              {mobileSheet === 'tools' && 'Tools & Masking'}
              {mobileSheet === 'inspector' && (isTethered ? 'Live Tether + Metadata' : 'Metadata')}
            </div>
            <button className="close" onClick={() => setMobileSheet(null)}>×</button>
          </div>

          <div className="mobile-sheet-content">
            {mobileSheet === 'ai' && (
              <>
                <input
                  type="text"
                  className="mobile-ai-input"
                  placeholder="Describe the look for Grok (film, exposure, mask, LUT...)"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      handleGrokCommand(e.currentTarget.value);
                      e.currentTarget.value = '';
                      setMobileSheet(null);
                    }
                  }}
                  autoFocus
                />
                <div style={{ color: '#555', fontSize: '12px', lineHeight: 1.4 }}>
                  Grok sees the current image and applies adjustments, LUTs, or masking instantly.
                </div>
              </>
            )}

            {mobileSheet === 'tools' && (
              <>
                <div className="tabs" style={{ marginBottom: 12 }}>
                  {(["segment", "batch", "effects"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={tab === t ? "active" : ""}
                      onClick={() => setTabState(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {tab === "effects" && <ControlPanel />}
                {tab === "segment" && <SegmentPanel />}
                {tab === "batch" && <BatchPanel />}
              </>
            )}

            {mobileSheet === 'inspector' && (
              <Inspector />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
