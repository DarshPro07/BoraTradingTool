export default function AnalyzeLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4" role="status" aria-live="polite">
      <div className="border border-panel bg-panel px-5 py-4 font-mono text-xs text-terminal">
        LOADING INSTRUMENT ANALYSIS...
      </div>
    </div>
  );
}
