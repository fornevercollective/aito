import { useEffect, useRef } from "react";
import { useApp } from "@/state/store";

const COLORS = [
  "rgba(255, 91, 46, 0.35)",
  "rgba(74, 222, 128, 0.35)",
  "rgba(96, 165, 250, 0.35)",
  "rgba(250, 204, 21, 0.35)",
  "rgba(192, 132, 252, 0.35)",
  "rgba(244, 114, 182, 0.35)",
];

/** Semi-transparent mask + sticker cutout overlay above WebGL. */
export function MaskOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const segments = useApp((s) => s.segments);
  const activeId = useApp((s) => s.activeSegmentId);
  const showStickers = useApp((s) => s.showStickers);
  const before = useApp((s) => s.before);
  const adjustmentScope = useApp((s) => s.adjustmentScope);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let cancelled = false;
    const draw = async () => {
      const r = wrap.getBoundingClientRect();
      canvas.width = r.width;
      canvas.height = r.height;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, r.width, r.height);

      for (let i = 0; i < segments.length; i++) {
        if (cancelled) return;
        const seg = segments[i]!;
        const maskImg = await load(seg.dataUrl);
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = seg.id === activeId ? 0.55 : 0.3;
        ctx.drawImage(maskImg, 0, 0, r.width, r.height);
        ctx.globalAlpha = 1;

        const bx = seg.bbox.x * r.width;
        const by = seg.bbox.y * r.height;
        const bw = seg.bbox.w * r.width;
        const bh = seg.bbox.h * r.height;
        if (seg.id === activeId) {
          ctx.strokeStyle = COLORS[i % COLORS.length]!.replace("0.35", "0.95");
          ctx.lineWidth = 2;
          ctx.strokeRect(bx, by, bw, bh);

          // Professional hatch visualization for active correction region
          // (directly addresses "hatch for export" + Apple-style subject lift feedback)
          if (adjustmentScope.useActiveMask) {
            const hatch = createHatchPattern(ctx, "#ff5b2e", 6, 0.35) || "#ff5b2e";
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.fillStyle = hatch;
            ctx.fillRect(bx, by, bw, bh);
            ctx.restore();

            // Strong edge for export clarity
            ctx.strokeStyle = "#ff5b2e";
            ctx.lineWidth = 3;
            ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);
          }
        }

        if (showStickers && seg.stickerUrl && seg.selected) {
          const sticker = await load(seg.stickerUrl);
          ctx.shadowColor = "rgba(255,255,255,0.5)";
          ctx.shadowBlur = 10;
          ctx.drawImage(sticker, bx, by, bw * 0.95, bh * 0.95);
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
    };
    void draw();
    return () => {
      cancelled = true;
    };
  }, [segments, activeId, showStickers, before]);

  return (
    <div ref={wrapRef} className="mask-overlay">
      <canvas ref={canvasRef} />
    </div>
  );
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/** Creates a reusable diagonal hatch pattern for pro selection visualization (hatch for export). */
function createHatchPattern(ctx: CanvasRenderingContext2D, color: string, spacing: number, alpha: number): CanvasPattern | null {
  const p = document.createElement("canvas");
  p.width = spacing * 2;
  p.height = spacing * 2;
  const pc = p.getContext("2d", { alpha: true })!;
  pc.strokeStyle = color;
  pc.globalAlpha = alpha;
  pc.lineWidth = 1;
  pc.beginPath();
  pc.moveTo(0, spacing);
  pc.lineTo(spacing, 0);
  pc.moveTo(spacing, spacing * 2);
  pc.lineTo(spacing * 2, spacing);
  pc.stroke();
  return ctx.createPattern(p, "repeat");
}
