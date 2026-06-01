import { useApp } from "@/state/store";
import { formatExifForDisplay } from "@/lib/exif";
import { ReferenceBoard } from "./ReferenceBoard";

interface TetherControlsProps {
  onCapture: () => void;
  onDisconnect: () => void;
  onSettingChange: (key: "iso" | "shutter", value: string) => void;
}

function TetherControls({ onCapture, onDisconnect, onSettingChange }: TetherControlsProps) {
  const tetherCamera = useApp((s) => s.tetherCamera);

  return (
    <div className="inspector-section tether">
      <div className="inspector-header">
        <div className="live-dot" />
        LIVE TETHER
      </div>

      <div className="tether-info">
        <div className="tether-camera">
          {tetherCamera || "Camera via companion"}
        </div>
        <div className="tether-note">
          Supports Canon, Sony, Nikon, Phase One, Fujifilm, Blackmagic, and any PTP/IP or SDK camera the local companion can reach.
        </div>
      </div>

      <div className="tether-controls">
        <label>
          ISO
          <input
            type="number"
            defaultValue={400}
            onChange={(e) => onSettingChange("iso", e.target.value)}
          />
        </label>
        <label>
          Shutter
          <select defaultValue="1/125" onChange={(e) => onSettingChange("shutter", e.target.value)}>
            <option>1/1000</option>
            <option>1/500</option>
            <option>1/250</option>
            <option>1/125</option>
            <option>1/60</option>
            <option>1/30</option>
            <option>1/15</option>
          </select>
        </label>

        <button className="capture-btn" onClick={onCapture}>
          CAPTURE
        </button>

        <button className="disconnect-btn" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

export function Inspector() {
  const beforeMeta = useApp((s) => s.beforeMeta);
  const exif = useApp((s) => s.exif);
  const isTethered = useApp((s) => s.isTethered);
  const setIsTethered = useApp((s) => s.setIsTethered);

  const exifRows = formatExifForDisplay(exif);

  const handleCapture = () => {
    const ws = (window as any).__aitoTether as WebSocket | undefined;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "capture" }));
    } else {
      // In mock mode, just nudge the slider or log
      console.log("[Tether] Capture requested (no live WS)");
    }
  };

  const handleDisconnect = () => {
    const ws = (window as any).__aitoTether as WebSocket | undefined;
    if (ws) ws.close();
    setIsTethered(false);
    useApp.getState().setTetherCamera(null);
  };

  const handleSettingChange = (key: "iso" | "shutter", value: string) => {
    const ws = (window as any).__aitoTether as WebSocket | undefined;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "setting", key, value }));
    }
  };

  return (
    <aside className="inspector">
      {isTethered && (
        <TetherControls
          onCapture={handleCapture}
          onDisconnect={handleDisconnect}
          onSettingChange={handleSettingChange}
        />
      )}

      <div className="inspector-section meta">
        <div className="inspector-header">METADATA</div>

        {beforeMeta && (
          <div className="meta-row">
            <span className="meta-label">File</span>
            <span className="meta-value" title={beforeMeta.name}>
              {beforeMeta.name || "untitled"}
            </span>
          </div>
        )}

        {beforeMeta && (
          <div className="meta-row">
            <span className="meta-label">Dimensions</span>
            <span className="meta-value">
              {beforeMeta.width} × {beforeMeta.height}
            </span>
          </div>
        )}

        {exifRows.length > 0 ? (
          exifRows.map((row, i) => (
            <div className="meta-row" key={i}>
              <span className="meta-label">{row.label}</span>
              <span className="meta-value">{row.value}</span>
            </div>
          ))
        ) : (
          <div className="meta-empty">
            {beforeMeta ? "No EXIF data" : "Load an image to see metadata"}
          </div>
        )}
      </div>

      {!isTethered && (
        <div className="inspector-footer">
          <div className="inspector-note">
            Connect a camera via the local companion for live tethering and real-time EXIF.
          </div>
        </div>
      )}

      {/* Reference Board - Krea-style realtime refs for commercial direction */}
      <ReferenceBoard />
    </aside>
  );
}
