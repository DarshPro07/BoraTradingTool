import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import type { Order } from "@/lib/db/schema";
import { executionCapabilities } from "./capabilities";

/**
 * Read-only access to historical live-order rows. Mutation code was removed;
 * current live-order routes are unconditional fail-closed compatibility surfaces.
 */
export function listOrders(opts?: { status?: string; limit?: number }): Order[] {
  if (opts?.status === "authorized" && !executionCapabilities.confirmedLive) return [];
  const db = getDb();
  const query = db.select().from(orders);
  const rows = opts?.status ? query.where(eq(orders.status, opts.status)).all() : query.all();
  rows.sort((left, right) => right.proposedAt.getTime() - left.proposedAt.getTime());
  return opts?.limit ? rows.slice(0, opts.limit) : rows;
}
