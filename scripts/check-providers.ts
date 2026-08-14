import { getAdapter } from "@/lib/runtime/adapter";
import type { ProviderId } from "@/lib/runtime/providers";

const ids: ProviderId[] = ["claude-code", "anthropic-api", "openai-api", "local-model", "deepseek"];

(async () => {
  for (const id of ids) {
    const adapter = getAdapter(id);
    if (!adapter) {
      console.log(`${id}: NO ADAPTER`);
      continue;
    }
    const h = await adapter.health();
    console.log(`${id}: ${h.status} - ${h.reason.slice(0, 100)}`);
    const models = await adapter.listModels();
    console.log(`  models: ${models.map((m) => m.modelId).join(", ")}`);
  }
})();
