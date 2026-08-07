"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Search, TrendingUp } from "lucide-react";
import { MarketSelector } from "./MarketSelector";
import { ModeBadge } from "./ModeBadge";
import { SystemPulse } from "@/components/system/SystemPulse";
import { NAV_SECTIONS, UTILITY_LINKS, activeSection } from "@/lib/nav";

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const section = activeSection(pathname);

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    const instrument = query.trim().toUpperCase();
    if (!instrument) return;
    router.push(`/analyze/${encodeURIComponent(instrument)}`);
    setQuery("");
  }

  return (
    <header className="top-nav">
      <div className="top-nav-primary">
        <Link href="/command" className="brand-mark">
          <TrendingUp className="w-5 h-5" />
          <span>MARKETPULSE</span>
        </Link>
        <MarketSelector />
        <ModeBadge />
        <SystemPulse />

        <form onSubmit={handleSearch} className="market-search" role="search">
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
          <label htmlFor="instrument-search" className="sr-only">
            Search instrument
          </label>
          <input
            id="instrument-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="AAPL, RELIANCE.NS, or canonical ID"
          />
          <button type="submit">OPEN</button>
        </form>
      </div>

      {/* Two workspaces, rendered as a switch rather than a row of links — the choice between
          "what is it finding out" and "what do I place" is the primary act of navigation, not
          one option among many. */}
      <nav className="workspace-switch" aria-label="Workspace" data-testid="workspace-switch">
        {NAV_SECTIONS.map((entry) => (
          <Link
            key={entry.id}
            href={entry.href}
            title={entry.question}
            aria-current={section?.id === entry.id ? "page" : undefined}
            data-testid={`workspace-${entry.id}`}
            className={section?.id === entry.id ? "workspace-tab workspace-tab-active" : "workspace-tab"}
          >
            {entry.label}
          </Link>
        ))}

        <span className="workspace-spacer" />

        {UTILITY_LINKS.map((link) => (
          <Link key={link.href} href={link.href} title={link.blurb} className="workspace-utility">
            {link.label}
          </Link>
        ))}
      </nav>

      {section && section.children.length > 1 ? (
        <nav className="sub-nav" aria-label={`${section.label} sections`}>
          <span className="sub-nav-question">{section.question}</span>
          {section.children.map((child) => {
            const active = pathname === child.href || pathname.startsWith(`${child.href}/`);
            return (
              <Link
                key={child.href}
                href={child.href}
                title={child.blurb}
                aria-current={active ? "page" : undefined}
                className={active ? "sub-nav-link-active" : ""}
              >
                {child.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
