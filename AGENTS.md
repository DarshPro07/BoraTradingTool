<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## MANDATORY: Software Factory Autonomous Workflow

1. For ANY substantial task (new feature, architectural change, bug cluster, product workflow, multi-file implementation), load the `software-factory-autonomous` skill FIRST and execute its gates in order (Reality → Product → Architecture → Program Design → Vertical Slices → Independent Verification), writing plan docs to `docs/plans/<feature-slug>/` (`00-status.md` … `07-final.md`).
2. Proceed through every gate automatically — no routine approval pauses, no "should I continue?" questions. Ask the user only for genuinely human-only boundaries: live/real-money trading, production-destructive operations, unavailable credentials, legal/regulatory authority, irreversible migrations.
3. Trivial changes (renames, copy, formatting, one-line config) are exempt. When unsure whether a task qualifies, run the workflow (safe default).
4. Do not declare completion without passing the independent verification gate and writing `07-final.md` with a VERIFIED / PARTIALLY_VERIFIED / NOT_VERIFIED verdict.
