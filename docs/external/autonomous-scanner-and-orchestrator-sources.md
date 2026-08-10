# Autonomous Scanner and Orchestrator Sources

Verified on 2026-08-10. External material is design input, not runtime evidence.

## 24/7 AI Market Scanner

Source: https://docs.google.com/document/d/1D1KpxvKS66XkgtpUa4llNnC26mG46rgs3Xsx8p21DWM/mobilebasic

VERIFIED:

- The proposed workflow is `SCAN -> FILTER -> RESEARCH -> SCORE -> RISK -> ALERT`.
- The guide labels free data as delayed, forbids invented integrations, and keeps trading decisions with a human.
- Its sample score is subjective and its implementation uses `yfinance`, files, and optional alerts.

MarketPulse decision: reuse the staged funnel and data-honesty rules, not the implementation or subjective score.

## Structure Webworks Company Architecture

Source: https://structurewebworks.com/blog/ai-agents-run-an-entire-company

VERIFIED:

- The article describes a shared context layer, a central Chief of Staff, specialist departments, and one consolidated decision brief.
- It claims 133 agents and roughly $500/month, but supplies no independent evaluation proving that agent count is optimal.

MarketPulse decision: reuse the central-manager and consolidated-brief pattern. Do not create 133 permanent agents.

## Primary Agent Guidance

Anthropic: https://www.anthropic.com/engineering/multi-agent-research-system

- VERIFIED: Anthropic uses an orchestrator-worker pattern for parallel research.
- VERIFIED: its multi-agent research system used about 15 times the tokens of chat interactions.
- VERIFIED: explicit effort scaling was added after overly eager systems spawned excessive workers.
- VERIFIED: multi-agent systems fit breadth-first research better than tightly dependent coding work.

OpenAI: https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/

- VERIFIED: OpenAI recommends maximizing a single agent with tools before splitting into multiple agents.
- VERIFIED: the manager pattern keeps one agent in control while specialists act as tools.
- VERIFIED: tool risk, guardrails, and human intervention are required for high-risk actions.

## Repository Consequence

MarketPulse will start with one deterministic manager inside the existing learning cycle. Quant filtering uses no LLM. Dynamic research workers are deferred until bounded survivors and measured workload justify them.
