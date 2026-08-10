# Gate 1 — Product

**Problem**: a trade's story (setup, fill, path, exit) is only readable as numbers; the owner
asked for entry/exit drawn on the bars ("LEAN-style" inspection, item 14).

**Outcome**: clicking a trade row draws the trade's window — entry marker below its bar, exit
marker above its bar with the exit reason, dashed lines at both fill prices — on bars from the
canonical store, with the source stated under the chart.

**Success evidence**: e2e clicks trade row 0 in the ledger flow, sees the chart canvas, the
"canonical candle store" caption, and zero provider-shaped browser requests.

**Failure conditions**: bars fetched from the live provider; a chart shown when the store cannot
serve the window (must abstain with the reason); chart errors blocking the numeric evidence.

**Non-goals**: markers on the live CandlestickChart; multi-trade overlay; indicator overlays.
