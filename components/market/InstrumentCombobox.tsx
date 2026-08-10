"use client";

import { useDeferredValue, useEffect, useEffectEvent, useId, useState, startTransition } from "react";
import type { Exchange, Instrument } from "@/lib/market/types";

interface InstrumentOption extends Instrument {}

interface MasterStatus {
  state: "CURRENT" | "STALE" | "FAILED_LAST_ATTEMPT" | "INCOMPLETE" | "UNAVAILABLE";
  observedAt: string | null;
  totalRows: number;
}

interface InstrumentComboboxProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  labelClassName?: string;
  storageKey?: string;
  exchange?: Exchange;
}

const SERIES = ["", "EQ", "BE", "BZ", "SM", "ST", "SZ"] as const;

export function InstrumentCombobox({
  id,
  label,
  value,
  onValueChange,
  placeholder = "Symbol, company, or ISIN",
  required = false,
  className = "terminal-input",
  labelClassName = "sr-only",
  storageKey,
  exchange,
}: InstrumentComboboxProps) {
  const listboxId = useId();
  const helpId = useId();
  const deferredQuery = useDeferredValue(value);
  const [open, setOpen] = useState(false);
  const [series, setSeries] = useState("");
  const [options, setOptions] = useState<InstrumentOption[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MasterStatus | null>(null);
  const [total, setTotal] = useState(0);

  const restoreSelection = useEffectEvent(async (saved: { securityId?: string; id?: string }) => {
    const query = saved.securityId || saved.id;
    if (!query) return;
    try {
      const response = await fetch(`/api/market/instruments?q=${encodeURIComponent(query)}&limit=25`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { instruments?: InstrumentOption[] };
      const match = data.instruments?.find(
        (instrument) => instrument.securityId === saved.securityId || instrument.id === saved.id,
      );
      if (match) onValueChange(match.id);
    } catch {
      // Restoration is optional. The visible initial value remains usable when the API is offline.
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
        version?: number;
        securityId?: string;
        id?: string;
      } | null;
      if (saved?.version === 1) void restoreSelection(saved);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const parameters = new URLSearchParams({ q: deferredQuery.trim(), limit: "25", offset: "0" });
    if (exchange) parameters.set("exchange", exchange);
    if (series) {
      parameters.set("exchange", "XNSE");
      parameters.set("series", series);
    }
    setLoading(true);
    setError(null);
    fetch(`/api/market/instruments?${parameters}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          instruments?: InstrumentOption[];
          pagination?: { total?: number };
          securityMaster?: MasterStatus;
          message?: string;
        };
        if (!response.ok) throw new Error(data.message ?? "Instrument search is unavailable.");
        startTransition(() => {
          setOptions(data.instruments ?? []);
          setTotal(data.pagination?.total ?? data.instruments?.length ?? 0);
          setStatus(data.securityMaster ?? null);
          setActiveIndex(-1);
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setOptions([]);
        setError(reason instanceof Error ? reason.message : "Instrument search is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [deferredQuery, exchange, open, series]);

  function selectInstrument(instrument: InstrumentOption) {
    onValueChange(instrument.id);
    setOpen(false);
    setActiveIndex(-1);
    if (storageKey) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, securityId: instrument.securityId, id: instrument.id }),
      );
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, options.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      selectInstrument(options[activeIndex]);
    }
  }

  const statusText = status?.state === "FAILED_LAST_ATTEMPT"
    ? "LAST SYNC FAILED - USING VERIFIED MASTER"
    : status?.state === "INCOMPLETE"
      ? "NSE MASTER INCOMPLETE - REFRESH REQUIRED"
    : status?.state === "STALE"
      ? "STALE VERIFIED MASTER"
      : status?.state === "CURRENT"
        ? `NSE VERIFIED - ${status.totalRows} LISTINGS`
        : "NSE MASTER UNAVAILABLE";

  return (
    <div className="instrument-combobox">
      <label htmlFor={id} className={labelClassName}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-describedby={helpId}
        aria-busy={loading}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        required={required}
      />
      <span id={helpId} className="sr-only">
        Type a symbol, company name, or ISIN. Use arrow keys and Enter to select.
      </span>

      {open ? (
        <div className="instrument-popover">
          <div className="instrument-filter-row">
            <label htmlFor={`${id}-series`}>NSE series</label>
            <select id={`${id}-series`} value={series} onChange={(event) => setSeries(event.target.value)}>
              {SERIES.map((value) => (
                <option key={value || "ALL"} value={value}>{value || "ALL"}</option>
              ))}
            </select>
            <span>{total > options.length ? `${options.length} OF ${total}` : `${total} FOUND`}</span>
          </div>
          <div data-testid="security-master-status" className={`instrument-master-status status-${status?.state?.toLowerCase() ?? "unavailable"}`}>
            {statusText}
          </div>
          {error ? <p role="alert" className="instrument-message instrument-error">{error}</p> : null}
          {loading && options.length === 0 ? <p className="instrument-message">SEARCHING VERIFIED MASTER...</p> : null}
          {!loading && !error && options.length === 0 ? <p className="instrument-message">NO MATCHING INSTRUMENTS</p> : null}
          {options.length > 0 ? (
            <ul id={listboxId} role="listbox" aria-label={`${label} results`} className="instrument-options">
              {options.map((instrument, index) => {
                const unavailable = instrument.listingStatus === "LISTED" && instrument.dataAvailability === "UNAVAILABLE";
                return (
                  <li
                    id={`${listboxId}-${index}`}
                    key={`${instrument.id}-${instrument.series ?? ""}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectInstrument(instrument);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="instrument-option-symbol">{instrument.symbol}</span>
                    <span className="instrument-option-name">{instrument.name}</span>
                    <span className="instrument-option-meta">
                      {instrument.series ?? instrument.exchange} {instrument.isin ?? instrument.id}
                    </span>
                    {unavailable ? <strong>LISTED - DATA NOT AVAILABLE</strong> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
