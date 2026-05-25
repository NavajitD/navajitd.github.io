# Numo Memory Roadmap

How Numo remembers users and conversations — what's shipped, what's next, and why.

Research basis: April 2026 survey of Mem0, Letta (MemGPT), Zep, Cognee, Hindsight, plus the LOCOMO benchmark and LinkedIn's Cognitive Memory Agent post.

---

## Shipped (current)

| Layer | Mechanism | Storage |
|---|---|---|
| **Static identity** | `userFacts` block (Pilot/Co-Pilot/FA, Personal Year etc.) computed client-side, sent every turn | localStorage + request body |
| **Recent dialogue** | Last 6 messages verbatim | `numo_sessions/{id}/messages` |
| **Rolling summary** | Older messages compressed into a ≤200-word prose summary by `llama3.1-8b`, refreshed every 6 new old-msgs | `numo_sessions/{id}.summary` |
| **Semantic facts** | LLM extracts 0–3 durable facts per turn → embed via HF `bge-small-en-v1.5` (384d) → cosine-retrieve top 3 per query | `numo_sessions/{id}/facts/*` |
| **Async writes** | All memory ops fire after `res.end()`; user-facing latency unaffected | — |
| **Resilience** | Fallback from Qwen-3-235B → llama3.1-8b on 429 / 5xx | — |

This combination puts Numo in the same architectural family as Mem0 (vector facts) crossed with classic summarization-buffer chains (LangChain `ConversationSummaryBufferMemory`). LongMemEval-style accuracy: roughly Mem0-tier (~50%) — good enough for a single-session numerology assistant, weak for multi-session continuity.

---

## Phase 3 — Production-grade vector search

**Trigger:** session fact counts cross ~500, or in-memory cosine in Cloud Functions causes >300ms retrieval.

**Why:** Today we `get()` the whole `facts` collection per turn and cosine-sim in JS. Fine for now, dies at scale.

**Options ranked by cost:**
1. **Vertex AI Vector Search** — free 10K queries/month, native to GCP, no infra to run.
2. **pgvector on Cloud SQL** — cheapest paid; ~\$10/mo for a small instance.
3. **Pinecone Starter** — free 100K vectors, 5 indices.
4. **Self-host Mem0 / Letta on Cloud Run + Postgres + Neo4j** — most powerful, ~\$30/mo floor.

Recommendation when triggered: **Vertex AI Vector Search**, since the project is already on GCP/Firebase.

---

## Phase 4 — Graph memory (Zep-style state tracking)

**Why:** Vector stores treat *"I live in Mumbai"* and *"I moved to Bangalore"* as both equally valid. A user updating their state should retire the old fact, not just shadow it.

**Implementation sketch:**
- New collection `numo_sessions/{id}/relations/*` with `{subject, predicate, object, validFrom, validTo}`.
- During fact extraction, classify whether the new fact *supersedes* an existing one (LLM call or rule-based key match on subject+predicate). If so, set `validTo = now` on the old, create a new one.
- Retrieval prefers `validTo == null` rows, scoring others as historical context only.

**Reference:** Zep's [Graphiti](https://github.com/getzep/graphiti) is the open-source primitive for this.

---

## Phase 5 — Cross-session memory (Mem0/ChatGPT-style)

**Why:** Today `sessionId` is the boundary. Each new chat reset → memory wiped. For a numerology app where users return monthly, that's a regression vs. competitors like AskNumeroAI.

**Implementation sketch:**
- Derive `userKey = sha256(name|dob|gender)`.
- New collection `numo_users/{userKey}/facts/*` for cross-session facts.
- Distinguish session-local from user-global at extraction time: ephemeral situation → session, durable identity/relationship → user.
- Inject *both* fact pools into context, labeled separately ("you've shared with Numo before:" vs "from this conversation:").

---

## Phase 6 — Procedural memory (Letta-inspired)

**Why:** Many users follow predictable arcs — full reading → "what about my career?" → "and love?" → "should I change my name?". Procedural memory pre-loads context for the next probable question.

**Implementation sketch:**
- Track `(question_topic, predecessor_topic)` co-occurrence.
- After 3+ co-occurrences for a user, store as procedural memory (`numo_users/{key}/patterns/*`).
- On matching predecessor turn, pre-fetch likely-relevant facts so latency stays low when the predicted question arrives.

---

## Phase 7 — Tiered memory (Letta MemGPT, SOTA on LongMemEval)

**Why:** Letta scores 83.2% on LongMemEval — substantially above our current architecture. The gap comes from giving the LLM *agency* over its own memory: tool calls to read/write/edit memory mid-conversation.

**Three-tier model:**
- **Core** (always in-context, ~500 tokens) → already covered by `userFacts`.
- **Recall** (paged-in conversation history) → already covered by `messages`.
- **Archival** (vector-searched long-term knowledge) → already covered by `facts`.

**The missing piece is tool-calling.** Expose memory write/edit as functions the LLM can invoke:
- `remember(fact)` — explicit "lock this in"
- `correct_fact(old, new)` — when the user says "actually it's…"
- `forget(query)` — when the user says "stop bringing up X"

Requires switching to a model with strong tool-calling on Cerebras (Qwen-3-235B supports it).

---

## Phase 8 — Evaluation harness

**Why:** Right now we have *zero* memory tests. Every memory change is judged by feel.

**Build:**
- Adopt LOCOMO methodology — generate synthetic multi-session conversations covering recall, reasoning, contradiction-resolution, and temporal queries.
- Baselines: pure window, +summary, +facts, +graph, +tools.
- Metrics: precision\@k, recall\@k, latency p50/p99, token cost per turn.
- Run as a CI job on every prompt or memory change.

---

## Phase 9 — Compression & cost tuning

- Upgrade embeddings: BGE-small (384d, free) → BGE-large (1024d) once on a real vector DB.
- Semantic dedup: merge facts with cosine > 0.95.
- TTL: archive facts unaccessed >90 days.
- Per-fact decay weighting in retrieval (recent + relevant beats old + relevant).

---

## Phase 10 — Multimodal memory

- Users upload palm photos, signed natal charts, handwriting samples.
- Store image embeddings (CLIP) alongside text facts.
- Retrieve visually: *"you saw my palm last time, what changed?"*

---

## Migration Triggers (when to invest)

| Trigger | Action |
|---|---|
| 100+ active monthly users | Move to managed vector DB (Phase 3) |
| Users return for second session | Add cross-session memory (Phase 5) |
| "Numo forgot…" complaints | Audit retrieval, consider tiered (Phase 7) |
| Sessions exceed 100 turns | Invest in summarization quality + dedup (Phase 9) |
| Need state changes (moves, breakups) | Graph memory (Phase 4) |

---

## Reference Implementations Studied

- [Mem0](https://github.com/mem0ai/mem0) — simplest API, fact-based; LongMemEval ~49%.
- [Letta (MemGPT)](https://github.com/letta-ai/letta) — tiered, self-editing; LongMemEval 83.2%.
- [Zep](https://github.com/getzep/zep) — graph + vector hybrid; strong on state changes.
- [Cognee](https://github.com/topoteretes/cognee) — knowledge-graph focus.
- [LOCOMO benchmark](https://snap-stanford.github.io/locomo/) — evaluation standard.
