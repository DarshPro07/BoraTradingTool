"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, TrendingUp } from "lucide-react";
import { MarketSelector } from "./MarketSelector";
import { ModeBadge } from "./ModeBadge";
import { SystemPulse } from "@/components/system/SystemPulse";
import { InstrumentCombobox } from "@/components/market/InstrumentCombobox";
import { NAV_SECTIONS, UTILITY_LINKS, activeSection } from "@/lib/nav";
import type { Exchange, Instrument } from "@/lib/market/types";

type InstrumentSearchResult = Instrument & { isin?: string; securityId?: string };

/**
 * `fixtureData` is threaded from the root layout because this is a client component and a
 * non-NEXT_PUBLIC_ env var reads as undefined here — the badge would report REAL on a fixture
 * server, which is precisely the confusion it exists to remove.
 */
export function TopNav({ fixtureData = false }: { fixtureData?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const section = activeSection(pathname);
  const selectedExchange: Exchange | undefined = searchParams.get("market") === "NSE"
    ? "XNSE"
    : searchParams.get("market") === "BSE"
      ? "XBOM"
      : undefined;

  /**
   * Whether the submit handler is actually attached yet.
   *
   * Until React hydrates, this form renders fully — visible, focusable, apparently ready — and
   * does nothing at all, because `onSubmit` calls the router and the router is not there. A user
   * on a slow connection who types a symbol and presses OPEN gets silence and no explanation.
   *
   * Found by Playwright: the first test against a cold page failed reproducibly while every later
   * test, hitting a warm one, passed. Disabling the control until it works turns an invisible
   * no-op into visible, momentary unavailability, which is the honest state.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    const requested = query.trim();
    if (!requested || opening) return;

    setOpening(true);
    setSubmitError("");
    try {
      const parameters = new URLSearchParams({ q: requested, limit: "25" });
      if (selectedExchange) parameters.set("exchange", selectedExchange);
      const response = await fetch(
        `/api/market/instruments?${parameters}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        instruments?: InstrumentSearchResult[];
        pagination?: { total?: number };
        message?: string;
      };
      if (!response.ok) {
        setSubmitError(data.message ?? "Instrument search is unavailable.");
        return;
      }

      const normalized = requested.toUpperCase();
      const instruments = data.instruments ?? [];
      const exact = instruments.find((instrument) =>
        [instrument.id, instrument.symbol, instrument.providerSymbol, instrument.isin, instrument.securityId]
          .some((identity) => identity?.toUpperCase() === normalized),
      );
      const instrument = exact ?? (data.pagination?.total === 1 ? instruments[0] : undefined);
      if (!instrument) {
        setSubmitError(instruments.length === 0
          ? "No matching instrument found."
          : "Select an instrument from the matching results.");
        return;
      }

      router.push(`/analyze/${encodeURIComponent(instrument.id)}`);
      setQuery("");
    } catch {
      setSubmitError("Instrument search is unavailable.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <header className="top-nav">
      <div className="top-nav-primary">
        <Link href="/command" className="brand-mark">
          <TrendingUp className="w-5 h-5" />
          <span>MARKETPULSE</span>
        </Link>
        <MarketSelector />
        <ModeBadge fixtureData={fixtureData} />
        <SystemPulse />

        <form
          onSubmit={handleSearch}
          className="market-search"
          role="search"
          data-hydrated={hydrated ? "1" : "0"}
        >
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
          <InstrumentCombobox
            id="instrument-search"
            label="Search instrument"
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setSubmitError("");
            }}
            placeholder="Symbol, company, or ISIN"
            className=""
            exchange={selectedExchange}
          />
          <span role="alert" aria-live="polite" className="sr-only">{submitError}</span>
          <button type="submit" disabled={!hydrated || opening} aria-disabled={!hydrated || opening}>
            {opening ? "OPENING..." : "OPEN"}
          </button>
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
