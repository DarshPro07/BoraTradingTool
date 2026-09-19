"""
Shared agent memory (Mem0, local) as an MCP server — one memory for Claude, Codex, Gemini, OpenCode.

Owner, 2026-09-19: "also use mem0 for memory" and "a shared memory for all system".

Division of labour:
  - MarketPulse's database (knowledge_* tables, failure_memory, agent_runs, fund ledger) is the
    AUTHORITATIVE record: append-only, cited. Nothing here replaces it.
  - Mem0 is fast recall by meaning: "what did we learn about X?". Each memory should carry a `ref`
    back to the MarketPulse record it distils (a commit, a ledger id, an analysis id).

Fully local and free: FastEmbed (ONNX, BAAI/bge-small-en-v1.5) + FAISS on disk, and `infer=False`,
so no LLM is ever called — the agents do the thinking and store what they concluded. The OpenAI
entry is a placeholder Mem0 requires at start-up; an accidental call fails loudly, never bills.

Run:  D:/marketpulse-mem0/venv/Scripts/python tools/mem0/server.py   (stdio)
Data: MARKETPULSE_MEM0_DIR, default D:/marketpulse-mem0/data (outside the repo, never committed)
"""
import hashlib
import os

from mcp.server.mcpserver import MCPServer
from mem0 import Memory

DATA = os.environ.get("MARKETPULSE_MEM0_DIR", "D:/marketpulse-mem0/data")
USER = "marketpulse"  # one shared memory: every agent reads and writes the same space

CONFIG = {
    "embedder": {"provider": "fastembed", "config": {"model": "BAAI/bge-small-en-v1.5", "embedding_dims": 384}},
    "vector_store": {"provider": "faiss", "config": {"collection_name": "marketpulse", "path": f"{DATA}/faiss", "embedding_model_dims": 384}},
    "llm": {"provider": "openai", "config": {"api_key": "unused-infer-false-only"}},
    "history_db_path": f"{DATA}/history.db",
}
_memory = None


def store() -> Memory:
    """Built on first use, not at import: loading the embedding model before answering the MCP
    handshake made clients time out and drop the server (2026-09-19)."""
    global _memory
    if _memory is None:
        _memory = Memory.from_config(CONFIG)
    return _memory


mcp = MCPServer("mem0")


@mcp.tool()
def memory_remember(text: str, kind: str, agent: str, ref: str = "") -> str:
    """Store one distilled memory shared by every agent.

    kind: lesson | mistake | preference | observation | strategy-note
    agent: who is writing (claude, codex, gemini, opencode, or a sub-agent name)
    ref: the MarketPulse record this distils (commit, ledger id, analysis id) — strongly preferred
    Exact duplicates are skipped.
    """
    digest = hashlib.md5(text.encode("utf-8")).hexdigest()
    for hit in store().search(text, filters={"user_id": USER}, limit=3).get("results", []):
        if hit.get("hash") == digest:
            return f"already remembered ({hit['id']})"
    store().add(text, user_id=USER, agent_id=agent, metadata={"kind": kind, "ref": ref}, infer=False)
    return "remembered"


@mcp.tool()
def memory_recall(query: str, limit: int = 5) -> list[dict]:
    """Recall memories by meaning, best match first. Returns text, kind, ref, agent and score."""
    hits = store().search(query, filters={"user_id": USER}, limit=max(1, min(limit, 20))).get("results", [])
    return [
        {
            "memory": h["memory"],
            "kind": (h.get("metadata") or {}).get("kind"),
            "ref": (h.get("metadata") or {}).get("ref"),
            "agent": h.get("agent_id"),
            "score": round(h.get("score", 0.0), 3),
            "at": h.get("created_at"),
        }
        for h in hits
    ]


if __name__ == "__main__":
    mcp.run()
