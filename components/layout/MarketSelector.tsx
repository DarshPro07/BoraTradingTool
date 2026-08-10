"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MARKETS = [
  { value: "US", label: "US" },
  { value: "NSE", label: "NSE" },
  { value: "BSE", label: "BSE" },
] as const;

const STORAGE_KEY = "marketpulse-market";

function isMarket(value: string | null): value is (typeof MARKETS)[number]["value"] {
  return MARKETS.some((market) => market.value === value);
}

/**
 * Market selection, held in state rather than round-tripped through the URL.
 *
 * ## The bug this shape removes
 *
 * The previous version derived the pressed state straight from `searchParams`, and restored the
 * stored market from an effect that listed `searchParams` in its dependency array while calling
 * `router.replace`. That is a feedback loop: `replace` changes the params, the params object gets
 * a new identity, the effect runs again and replaces again.
 *
 * While that loop was turning, a click's `router.push` could be overwritten by an in-flight
 * `replace` carrying the *previous* market — so the button the user pressed stayed
 * `aria-pressed="false"` and the selection silently did not happen. It only misbehaved once
 * `localStorage` held a value, which is why it passed in isolation and failed after any earlier
 * visit had written one. Order-dependent, and invisible to a test that never clicked twice.
 *
 * ## Why state, not the URL, drives what the user sees
 *
 * Pressing a button should show the result immediately. Deriving `aria-pressed` from the URL made
 * the visible state depend on a server round-trip completing, so any hesitation read as a dead
 * control — and any race read as a rejected click. The URL is still updated, and a deep link still
 * wins, but the control answers the user first.
 */
export function MarketSelector() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const fromUrl = searchParams.get("market");
  const [selected, setSelected] = useState<string>(() => (isMarket(fromUrl) ? fromUrl : "US"));

  /**
   * Whether `onClick` is attached yet.
   *
   * Same defect as the instrument search: until React hydrates, these buttons render fully and do
   * nothing. Playwright caught it the same way — the first test in a fresh browser context failed
   * while a later test on a warm page passed, because `toBeVisible()` is not `isInteractive`.
   * Disabling until ready turns a silent dead control into brief, visible unavailability.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // A market named in the URL is authoritative: a shared link must land on the market it names,
  // whatever this browser last chose. Keyed on the value, not the params object, so it settles.
  useEffect(() => {
    if (isMarket(fromUrl)) setSelected(fromUrl);
  }, [fromUrl]);

  // Restore the remembered market only when the URL is silent.
  //
  // `searchParams` is deliberately absent from the dependencies. Including it was the loop: this
  // effect calls `router.replace`, which changes the params, which re-triggers the effect. It
  // depends on `fromUrl` — a string — so it runs once per actual change of market.
  useEffect(() => {
    if (fromUrl) {
      window.localStorage.setItem(STORAGE_KEY, fromUrl);
      return;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!isMarket(stored)) return;

    setSelected(stored);
    const params = new URLSearchParams(window.location.search);
    params.set("market", stored);
    router.replace(`${pathname}?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above on `searchParams`
  }, [fromUrl, pathname, router]);

  function select(value: string) {
    // Optimistic, so the control answers the press rather than the network.
    setSelected(value);
    window.localStorage.setItem(STORAGE_KEY, value);

    const params = new URLSearchParams(window.location.search);
    params.set("market", value);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="market-switch" aria-label="Market" aria-busy={pending} data-hydrated={hydrated ? "1" : "0"}>
      {MARKETS.map((market) => (
        <button
          key={market.value}
          type="button"
          aria-pressed={selected === market.value}
          disabled={!hydrated}
          onClick={() => select(market.value)}
          className={selected === market.value ? "market-switch-active" : ""}
        >
          {market.label}
        </button>
      ))}
    </div>
  );
}
