import type { NewsItem } from "@/lib/providers/types";
import { ExternalLink } from "lucide-react";

interface Props {
  news: NewsItem[];
}

function sentimentColor(s: number) {
  if (s > 0.3) return "bg-gain";
  if (s < -0.3) return "bg-loss";
  return "bg-amber";
}

function timeAgo(date: Date) {
  const diff = Date.now() - new Date(date).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MarketNewsFeed({ news }: Props) {
  return (
    <div className="terminal-panel rise-4 p-4">
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Market News</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {news.map((item) => (
          <div key={item.id} className="border border-panel rounded p-3 hover:border-terminal/20 transition-colors">
            <div className="flex items-start gap-2">
              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${sentimentColor(item.sentiment)}`} />
              <div>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold hover:text-terminal transition-colors leading-snug flex items-start gap-1"
                >
                  <span>{item.headline}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-40" />
                </a>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                  <span>{item.source}</span>
                  <span>·</span>
                  <span>{timeAgo(item.publishedAt)}</span>
                </div>
                {item.summary && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{item.summary}</p>
                )}
              </div>
            </div>
          </div>
        ))}
        {!news.length && (
          <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
            No verified market news is available from the configured providers.
          </p>
        )}
      </div>
    </div>
  );
}
