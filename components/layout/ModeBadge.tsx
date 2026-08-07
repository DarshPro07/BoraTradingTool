import { FlaskConical } from "lucide-react";

export function ModeBadge() {
  return (
    <span className="mode-badge" title="Paper Research Mode. Broker execution is disabled.">
      <FlaskConical className="w-3 h-3" /> PAPER
    </span>
  );
}
