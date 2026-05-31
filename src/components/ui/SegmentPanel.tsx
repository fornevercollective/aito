import { useEffect, useState } from "react";
import { useApp } from "@/state/store";
import {
  ensureSam,
  getSamState,
  onSamState,
  processBatchItem,
} from "@/segmentation/segmentService";
import type { SegmentBackend } from "@/segmentation/types";

export function SegmentPanel() {
  const segmentTool = useApp((s) => s.segmentTool);
  const segmentBackend = useApp((s) => s.segmentBackend);
  const segments = useApp((s) => s.segments);
  const activeId = useApp((s) => s.activeSegmentId);
  const showStickers = useApp((s) => s.showStickers);
  const samReady = useApp((s) => s.samReady);
  const segmentBusy = useApp((s) => s.segmentBusy);
  const before = useApp((s) => s.before);
  const channel = useApp((s) => s.channel);

  const setSegmentTool = useApp((s) => s.setSegmentTool);
  const setSegmentBackend = useApp((s) => s.setSegmentBackend);
  const setShowStickers = useApp((s) => s.setShowStickers);
  const selectSegment = useApp((s) => s.selectSegment);
  const removeSegment = useApp((s) => s.removeSegment);
  const clearSegments = useApp((s) => s.clearSegments);
  const setSegmentBusy = useApp((s) => s.setSegmentBusy);
  const setSegments = useApp((s) => s.setSegments);

  const [samState, setSamState] = useState(getSamState().state);

  useEffect(() => {
    const unsub = onSamState(setSamState);
    return unsub;
  }, []);

  const backend: SegmentBackend =
    channel === "live" ? "server" : segmentBackend;

  const loadSam = async () => {
    setSegmentBusy(true);
    await ensureSam();
    setSegmentBusy(false);
  };

  const tapAuto = async () => {
    setSegmentBusy(true);
    try {
      if (backend === "sam") await ensureSam();
      const { segmentAuto } = await import("@/segmentation/segmentService");
      const masks = await segmentAuto(before, backend);
      if (masks.length) setSegments(masks);
    } finally {
      setSegmentBusy(false);
    }
  };

  return (
    <div className="segment-panel">
      <h3>Segment (SAM)</h3>
      <div className="pill-row">
        {(["slider", "tap", "auto"] as const).map((t) => (
          <span
            key={t}
            className={`pill ${segmentTool === t ? "active" : ""}`}
            onClick={() => setSegmentTool(t)}
          >
            {t}
          </span>
        ))}
      </div>

      <div className="pill-row">
        {(["sam", "mock"] as const).map((b) => (
          <span
            key={b}
            className={`pill side ${segmentBackend === b && channel !== "live" ? "active" : ""}`}
            onClick={() => setSegmentBackend(b)}
          >
            {b}
          </span>
        ))}
        {channel === "live" && (
          <span className="pill side active">server</span>
        )}
      </div>

      <div className="row-actions">
        <button type="button" onClick={() => void loadSam()} disabled={segmentBusy}>
          {samState === "ready" || samReady ? "SAM ready" : "Load SAM"}
        </button>
        <button type="button" onClick={() => void tapAuto()} disabled={segmentBusy}>
          Auto subjects
        </button>
        <button type="button" onClick={() => clearSegments()}>
          Clear
        </button>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={showStickers}
          onChange={(e) => setShowStickers(e.target.checked)}
        />
        Sticker preview
      </label>

      <p className="hint">
        Tap mode: click subject to lift (Meta SAM). Auto mode: grid probe
        like Apple sticker batch. Server backend when WS is live.
      </p>

      <h3>Masks ({segments.length})</h3>
      <ul className="mask-list">
        {segments.map((m) => (
          <li
            key={m.id}
            className={m.id === activeId ? "active" : ""}
            onClick={() => selectSegment(m.id)}
          >
            <span>{m.label ?? m.id}</span>
            <span className="score">{(m.score * 100).toFixed(0)}%</span>
            <button
              type="button"
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                removeSegment(m.id);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BatchPanel() {
  const batch = useApp((s) => s.batch);
  const batchRunning = useApp((s) => s.batchRunning);
  const segmentBackend = useApp((s) => s.segmentBackend);
  const channel = useApp((s) => s.channel);
  const addBatchFiles = useApp((s) => s.addBatchFiles);
  const removeBatchItem = useApp((s) => s.removeBatchItem);
  const updateBatchItem = useApp((s) => s.updateBatchItem);
  const setBatchRunning = useApp((s) => s.setBatchRunning);
  const setSources = useApp((s) => s.setSources);

  const backend: SegmentBackend =
    channel === "live" ? "server" : segmentBackend;

  const runBatch = async () => {
    if (batchRunning || !batch.length) return;
    setBatchRunning(true);
    if (backend === "sam") await ensureSam();

    for (const item of batch) {
      if (item.status === "done") continue;
      try {
        const result = await processBatchItem(item, backend, (p, status) => {
          updateBatchItem(item.id, { progress: p, status });
        });
        updateBatchItem(item.id, {
          segments: result.segments,
          after: result.after,
          status: "done",
          progress: 1,
        });
        setSources(item.before, result.after ?? item.before);
      } catch (e) {
        updateBatchItem(item.id, {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    setBatchRunning(false);
  };

  return (
    <div className="batch-panel">
      <h3>Batch retouch</h3>
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => e.target.files && addBatchFiles(e.target.files)}
      />
      <div className="row-actions">
        <button
          type="button"
          onClick={() => void runBatch()}
          disabled={batchRunning || batch.length === 0}
        >
          {batchRunning ? "Running…" : `Run ${batch.length} items`}
        </button>
      </div>
      <ul className="batch-list">
        {batch.map((b) => (
          <li key={b.id}>
            <span className="name">{b.name}</span>
            <span className="status">{b.status}</span>
            <span className="prog">{(b.progress * 100).toFixed(0)}%</span>
            <button type="button" onClick={() => removeBatchItem(b.id)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
