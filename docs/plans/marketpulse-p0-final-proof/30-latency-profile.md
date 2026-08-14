# Research latency — profiled, and the earlier figure was wrong

**Date:** 2026-08-13. **Method:** direct instrumentation, not inference.

## The correction

The previous session reported "a research call takes 9.5–11 minutes" and raised a Playwright
budget to accommodate it. **That attribution was wrong, and the budget change was therefore
treating the wrong problem.**

9.5–11 minutes was the wall time of a Playwright *test*, which I attributed to the research call
inside it without measuring the call itself. Measured directly:

```
[gateway]  claude-code wall=57659ms api=55204ms cli=54006ms turns=1 tokens=4791
[research] IN:XNSE:RELIANCE prompt=2017ch system=1175ch
           evidence-packet=7ms  provider-probe=347ms  model-call=57664ms
```

**A research call is ~58 seconds**, on an otherwise idle server.

## Attribution

| Stage | Time | Share |
|---|---:|---|
| Evidence packet (identity, bar load, features, fingerprint) | 7 ms | ~0% |
| Provider probe (`detectProviders`, spawns a subprocess) | 347 ms | 0.6% |
| Model call — total wall | 57,664 ms | 99.4% |
| ‣ of which provider API (`duration_api_ms`) | 55,204 ms | 95.7% |
| ‣ of which our overhead (spawn, stdin, drain, parse) | ~2,460 ms | 4.3% |

`turns=1` — no agent loop, no retries. `tokens=4791`, `prompt=2017ch`, `system=1175ch` — the
prompt is small, so this is not a context-size problem.

Baseline for comparison: a trivial `claude -p` on this machine returns in **5.6s** total with
`duration_api_ms` 2980. So ~2.6s of every call is CLI startup, and the research call's 55s of API
time is genuine model work on a real request.

### What this rules out

Of the causes worth suspecting — huge prompts, excessive context, retries, provider fallback,
serial web fetches, Python subprocess startup, an unnecessary agent chain — **none are present**.
One turn, small prompt, no fallback, sub-second local work.

### What remains worth attention

- **55s of model time** for a single-shot research call is the dominant cost and is inherent to
  the provider, not to MarketPulse. It is a candidate for a faster model or a smaller task, not
  for local optimisation.
- **`detectProviders()` spawns a probe subprocess on the critical path of every call.** Only 347ms,
  but it is pure overhead on a request that already knows which provider it wants, and it will
  scale with the number of providers once more adapters exist. Worth caching with a TTL.

## The open question this raises

If a research call is 58s, the Playwright tests that took 9.5–11 minutes were spending that time
somewhere else. The material difference between those runs and this measurement: **the autonomous
machine was running** in the Playwright runs and idle here.

That points at contention between the AUTO lanes and interactive requests — and specifically at
the RESEARCH lane added in this same work, which drains the durable queue every 5s and shares one
SQLite database with every interactive request. SQLite serializes writers, so a busy lane can make
an interactive request wait.

**Measured. The hypothesis is wrong — there is no contention effect.**

With the autonomous machine RUNNING (`status: DEGRADED`, ticking, RESEARCH lane draining every 5s),
the same call against the same instrument:

```
real 0m57.504s
[gateway]  claude-code wall=56889ms api=54938ms cli=53435ms turns=1 tokens=4632
[research] evidence-packet=8ms  provider-probe=441ms  model-call=56891ms
```

57.5s loaded vs 58.0s idle. The RESEARCH lane added in this work does **not** starve interactive
requests, and SQLite write contention is not visible at this load. That clears my own change of
suspicion, which is why it was worth measuring rather than assuming.

## Still unexplained, and not being papered over

Playwright's own per-test durations:

```
identity setup ............................................ 63ms
unlock test (research → ingest → research) ................ 11.0m   ← unexplained
ingested history survives a page reload .................... 4.6s
readiness reported truthfully .............................. 93ms
```

Two research calls (~0.1s refusal + ~58s success) plus a fast ingest should cost about two
minutes. The unlock test spends eleven. `mutationFetch` was checked and contains no retry, so the
browser path does not multiply the call.

### LOCALISED — the time is in the browser, not the product

The phase stopwatch answers it. From a fresh database:

```
+0.1s  subject selected: IN:XNSE:RELIANCE
+1.5s  research#1 terminal: FAILED :: NO_STORED_DATA
+1.7s  ingest done: INGESTED — 260 daily bars
       research#2 terminal: NEVER PRINTED
```

Meanwhile the server, in the same run, finished research#2:

```
[gateway]  claude-code wall=48639ms api=45932ms cli=44431ms turns=1 tokens=4077
[research] evidence-packet=10ms provider-probe=354ms model-call=48644ms
```

**Everything through ingestion costs 1.7 seconds. The server answered research#2 in 48.6 seconds.
The test then sat for more than ten minutes without advancing one line.**

So the missing time is entirely on the browser side, after the server has responded. Two
corroborating details:

- The run-7 failure was literally `apiRequestContext.get: Test timeout of 600000ms exceeded` — a
  hanging Playwright request, not a slow endpoint.
- `waitForTerminalResearchState` uses `expect.poll` with a 90s timeout, and it blew straight
  through it. A poll timeout bounds the LOOP, not an in-flight callback: if
  `stateLabel.textContent()` never resolves, the poll waits on that pending promise instead of
  timing out. Overshooting 90s is therefore evidence that the page stopped answering Playwright
  queries at all.

**Working hypothesis, not yet proven:** the analyze page becomes unresponsive to automation after a
research envelope renders. Candidates worth separating: a long main-thread render of the envelope,
an unbounded effect re-render loop, or the `page.on("response")`/`console` listeners in
`collectPageProblems` interacting with a chatty page. The next step is a trace
(`--trace on`) plus a run without the problem collectors, to say which.

**What this changes:** `RESEARCH_LATENCY` is not a product P0. It is ~58s, dominated by provider
API time, with sub-second local work. The real defect is a **UI/automation hang after the research
result renders**, which is a different problem with a different owner — and it was completely
hidden while the wall time was being attributed to "the model is slow".

**Nothing here justifies calling PERFORMANCE a pass.** The 20-minute Playwright ceiling is a
diagnostic budget that exists to let the run finish and report, and the spec's docblock now says
exactly that.

## Consequence for the verdict

`PERFORMANCE` must not be recorded as PASS because a timeout was raised. On this evidence:

- `RESEARCH_CALL_LATENCY = 58s, ATTRIBUTED` — 95.7% provider API, one turn, no retries.
- `INTERACTIVE_LATENCY_UNDER_LOAD = UNDER MEASUREMENT`.

The 20-minute Playwright budget stays only as a diagnostic ceiling for a suite that also exercises
the autonomous runtime; it is not a statement that the product is fast.
