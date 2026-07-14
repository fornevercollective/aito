import { useApp } from "@/state/store";

export function AIStatus() {
  const channel = useApp((s) => s.channel);
  const ai = useApp((s) => s.ai);
  const cls = channel === "live" ? "ai-status live" : "ai-status mock";
  return (
    <div className={cls}>
      <span className="dot" />
      <span>{channel}</span>
      <code>
        prog {ai.progress.toFixed(2)} · conf {ai.confidence.toFixed(2)}{" "}
        · tiles {ai.tilesReady.toFixed(2)} · {ai.status}
      </code>
    </div>
  );
}
