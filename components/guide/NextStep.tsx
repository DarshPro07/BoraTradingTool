import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { nextStep } from "@/lib/guide/next-step";

/**
 * The one thing to do next, in plain language.
 *
 * Every other panel reports state. This one says what to do about it — the difference between a
 * terminal that is honest and a terminal that is usable by someone who has not traded before.
 *
 * One step, never a checklist. A list of nine things is another way of saying "work it out".
 */
export function NextStep() {
  const step = nextStep();
  const stages = [
    { label: "authored", value: step.progress.authored },
    { label: "testable", value: step.progress.evaluable },
    { label: "survived", value: step.progress.wouldPass },
    { label: "validated", value: step.progress.validated },
    { label: "forward", value: step.progress.forward },
  ];

  return (
    <section className="next-step rise-1" data-testid="next-step" data-step={step.id}>
      <div className="flex items-start gap-3">
        <Compass className="w-4 h-4 mt-0.5 text-terminal shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-bold tracking-wide">{step.title}</h2>
            {step.needsYou ? (
              <span className="text-[9px] uppercase tracking-wider border border-amber/40 text-amber px-1.5 py-0.5">
                needs you
              </span>
            ) : (
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">running on its own</span>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5" data-testid="next-step-why">
            {step.why}
          </p>
          <p className="text-[11px] leading-relaxed mt-1.5" data-testid="next-step-action">
            {step.action}
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-2.5">
            <Link
              href={step.href}
              className="inline-flex items-center gap-1.5 border border-terminal text-terminal px-2.5 py-1 text-[11px] uppercase tracking-wider hover:bg-terminal/10 transition-colors"
              data-testid="next-step-cta"
            >
              Go there <ArrowRight className="w-3 h-3" />
            </Link>

            {/* The pipeline as five numbers. Zeroes are the point: they show exactly how far the
                system has actually got, rather than implying progress it has not made. */}
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              {stages.map((stage, index) => (
                <span key={stage.label} className="flex items-center gap-2">
                  <span className={stage.value > 0 ? "text-foreground" : ""}>
                    {stage.value} {stage.label}
                  </span>
                  {index < stages.length - 1 ? <span className="text-panel">›</span> : null}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
