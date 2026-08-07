"use client";

import { useEffect, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MARKETS = [
  { value: "US", label: "US" },
  { value: "NSE", label: "NSE" },
  { value: "BSE", label: "BSE" },
] as const;

export function MarketSelector() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fromUrl = searchParams.get("market");
  const selected = MARKETS.some((item) => item.value === fromUrl) ? fromUrl : "US";

  useEffect(() => {
    if (fromUrl) {
      window.localStorage.setItem("marketpulse-market", fromUrl);
      return;
    }
    const stored = window.localStorage.getItem("marketpulse-market");
    if (!MARKETS.some((item) => item.value === stored)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("market", stored!);
    router.replace(`${pathname}?${params.toString()}`);
  }, [fromUrl, pathname, router, searchParams]);

  function select(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("market", value);
    window.localStorage.setItem("marketpulse-market", value);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="market-switch" aria-label="Market" aria-busy={pending}>
      {MARKETS.map((market) => (
        <button
          key={market.value}
          type="button"
          aria-pressed={selected === market.value}
          onClick={() => select(market.value)}
          className={selected === market.value ? "market-switch-active" : ""}
        >
          {market.label}
        </button>
      ))}
    </div>
  );
}
