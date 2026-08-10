/**
 * Sets the paper account to the capital the owner actually has.
 *
 * ## Why this needed doing
 *
 * The INR paper account was seeded at ₹1,00,00,000 — a crore, ten thousand times the owner's
 * stated ₹1,000. At that size every position is large enough that transaction costs round to
 * nothing, which is precisely the regime the owner is not in. Paper evidence gathered there
 * answers "does this edge exist for someone with a crore", and the owner would read it as "does
 * this earn me money".
 *
 * It is the same class of error as the factory's hardcoded 20 bps: a plausible default that
 * nobody checked against the account that exists.
 *
 * Refuses to touch an account that has traded. Rewriting `startingCash` under a live ledger
 * silently rebases every drawdown and utilisation figure derived from it, so a account with
 * history must be reset deliberately, not as a side effect of running this.
 *
 * Usage:  npx tsx scripts/set-paper-capital.mts [--currency INR] [--amount 1000]
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { OWNER_CAPITAL, viableConfiguration } from "@/lib/paper/capital";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const currency = (flag("currency") ?? "INR").toUpperCase();
const amount = Number(flag("amount") ?? OWNER_CAPITAL.amount);

if (!Number.isFinite(amount) || amount <= 0) {
  console.error(`Refusing to set paper capital to "${flag("amount")}".`);
  process.exit(2);
}

const db = getDb();
const account = db.select().from(schema.paperAccounts).where(eq(schema.paperAccounts.currency, currency)).get();

if (!account) {
  db.insert(schema.paperAccounts)
    .values({ currency, startingCash: amount, cash: amount, updatedAt: new Date() })
    .run();
  console.log(`Created ${currency} paper account at ${amount.toLocaleString("en-IN")}.`);
} else if (account.cash !== account.startingCash) {
  console.error(
    `${currency} has traded: starting ${account.startingCash}, cash now ${account.cash}. ` +
      "Refusing to rewrite startingCash under a live ledger — every drawdown and utilisation " +
      "figure is derived from it, and rebasing them silently would make the history a lie. " +
      "Reset the ledger deliberately if that is what you want.",
  );
  process.exit(1);
} else {
  db.update(schema.paperAccounts)
    .set({ startingCash: amount, cash: amount, updatedAt: new Date() })
    .where(eq(schema.paperAccounts.currency, currency))
    .run();
  console.log(
    `${currency} paper account set to ${amount.toLocaleString("en-IN")} ` +
      `(was ${account.startingCash.toLocaleString("en-IN")}, untraded so nothing was lost).`,
  );
}

// What that capital can actually do, stated plainly rather than left for the owner to discover
// after a week of empty paper sessions.
try {
  const configuration = viableConfiguration(amount, "IN");
  console.log(`  ${configuration.reason}`);
} catch (caught) {
  console.log(`  ${caught instanceof Error ? caught.message : String(caught)}`);
}
