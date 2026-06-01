import { useApp } from "@/state/store";
import { useRef } from "react";

export function ReferenceBoard() {
  const references = useApp((s) => s.references);
  const activeIds = useApp((s) => s.activeReferenceIds);
  const addReference = useApp((s) => s.addReference);
  const removeReference = useApp((s) => s.removeReference);
  const toggleActive = useApp((s) => s.toggleActiveReference);
  const clear = useApp((s) => s.clearReferences);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const doodleCanvasRef = useRef<HTMLCanvasElement>(null);
  const doodleActiveRef = useRef(false);

  const captureFromCanvas = () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const url = canvas.toDataURL('image/jpeg', 0.9);
    addReference({
      url,
      label: 'Current Frame',
      source: 'canvas'
    });
  };

  const captureFromTether = () => {
    // In real usage the tether frame is often the current 'before'
    const before = useApp.getState().before;
    if (!before) return;

    addReference({
      url: before,
      label: 'Live Tether',
      source: 'tether'
    });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      addReference({
        url: ev.target?.result as string,
        label: file.name.split('.')[0] || 'Reference',
        source: 'upload'
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Simple doodle capture
  const startDoodle = () => {
    const canvas = doodleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ff5b2e';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    doodleActiveRef.current = true;
  };

  const handleDoodleMove = (e: React.PointerEvent) => {
    if (!doodleActiveRef.current) return;
    const canvas = doodleCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const endDoodle = () => {
    doodleActiveRef.current = false;
  };

  const captureDoodle = () => {
    const canvas = doodleCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    addReference({
      url,
      label: 'Doodle / Sketch',
      source: 'doodle'
    });
    // reset doodle
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="reference-board">
      <div className="ref-header">
        <div>
          <strong>Reference Board</strong>
          <span className="ref-subtitle">For commercial direction</span>
        </div>
        <button onClick={clear} className="ref-clear">Clear</button>
      </div>

      <div className="ref-actions">
        <button onClick={captureFromCanvas}>Capture Current</button>
        <button onClick={captureFromTether} disabled={!useApp.getState().isTethered}>
          From Tether
        </button>
        <button onClick={() => fileInputRef.current?.click()}>Upload Ref</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleUpload}
        />
      </div>

      {/* Quick doodle area */}
      <div className="doodle-area">
        <canvas
          ref={doodleCanvasRef}
          width={280}
          height={120}
          onPointerDown={startDoodle}
          onPointerMove={handleDoodleMove}
          onPointerUp={endDoodle}
          onPointerLeave={endDoodle}
          style={{ background: '#111', borderRadius: 4, cursor: 'crosshair' }}
        />
        <button onClick={captureDoodle} className="capture-doodle">Add Doodle as Ref</button>
      </div>

      {/* Reference thumbnails */}
      <div className="ref-grid">
        {references.length === 0 && (
          <div className="ref-empty">Add references from camera, canvas, upload, or doodle</div>
        )}
        {references.map((ref) => {
          const isActive = activeIds.includes(ref.id);
          return (
            <div
              key={ref.id}
              className={`ref-item ${isActive ? 'active' : ''}`}
              onClick={() => toggleActive(ref.id)}
            >
              <img src={ref.url} alt={ref.label} />
              <div className="ref-label">{ref.label}</div>
              <div className="ref-source">{ref.source}</div>
              <button
                className="ref-remove"
                onClick={(e) => { e.stopPropagation(); removeReference(ref.id); }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="ref-hint">
        Active references are sent to Grok for commercial direction
      </div>
    </div>
  );
}
