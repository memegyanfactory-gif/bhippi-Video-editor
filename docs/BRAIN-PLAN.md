# Bhippi Brain — self-learning plan

The brain is Bhippi's long-term memory: it watches every AI turn, learns the user,
writes its own reusable skills, and shows everything it knows as a live mind map.

## Why the old brain failed

The old brain shelled out to the external `ig` CLI (IdeaGraph, Python). On a machine
without `pip install ideagraph-live` every call failed with *"could not start ig —
program not found"*, so nothing was ever learned and Settings → Brain showed an error.

**Fix:** the brain is now native Rust inside Bhippi (`src-tauri/src/brain.rs`). No
Python, no install, no network. It works on first launch. IdeaGraph stays an optional
mirror: when an `ig` command is configured, turns are also sent there.

## What we copy from Hermes Agent (Nous Research)

Research (Hermes Agent docs, "Inside Hermes Agent", awesome-hermes-agent) shows its
learning loop is five mechanisms working together:

| Hermes mechanism | What it does | Bhippi brain equivalent |
|---|---|---|
| `MEMORY.md` + `USER.md`, hard char cap (~3.5k total) | Small curated memory loaded every session; the cap forces curation, not hoarding | `memory` and `user` nodes, rendered to MEMORY.md / USER.md, capped at 2200 + 1400 chars; lowest-value entries are evicted |
| Autonomous skill creation (≥5 tool calls, error recovery, user correction, non-obvious workflow) | Turns experience into procedures | Every turn is scored against the same triggers; a qualifying turn leaves a **nudge** that tells the model to save a skill |
| Skills self-improve during use (`skill_manage` patch) | Fix a skill in place with old→new text | `brain_save_skill` with `mode: patch`; each skill counts uses, wins and fails, and a failing skill is flagged for patching |
| Progressive disclosure of skills (agentskills.io `SKILL.md`) | Only names + descriptions in the prompt; bodies loaded on demand | Skill index in every turn's context; `brain_load_skill` loads the body. Skills are saved as `skills/<name>/SKILL.md` with agentskills.io front matter |
| Periodic nudges | Internal prompt asks "what is worth persisting?" | Rules in the brain brief every turn, plus targeted nudges after qualifying turns |
| FTS5 session search | Recall past sessions instead of loading them | `brain_recall` — hashed-vector semantic search over every episode, memory and skill |
| Honcho user modelling | A deepening model of the user | `user` nodes (preferences, style, audience, dislikes) plus the automatic tool/style profile learned from turns |
| Curator / pruning | Keeps memory from growing forever | **Dream** pass: decays old episodes, merges near-duplicates, caps episodes, recomputes topic hubs |

Bhippi already had the tool-creation half (`create_custom_tool`, `update_custom_tool`);
the brain ties those tools into the graph and tracks how they perform.

## Architecture

```
chat turn ──► brain brief injected into context (memory, user, skills index,
   │          top-k recall for this prompt, weak tools, pending nudge, rules)
   │
   ├─ model calls brain_remember / brain_save_skill / brain_load_skill / brain_recall
   │
   └─ turn ends ──► record_turn: episode node, tool stats, provider link,
                    similarity links, topic keywords, skill triggers → nudge
                          │
                          ▼
                  bhippi://brain-changed ──► live mind map pulses the new dots
dream (on start + every 40 turns): decay, merge duplicates, cap, rebuild topic hubs
```

Storage (default `<app data>/brain`, or the path in Settings → Brain):

- `graph.json` — nodes + edges (atomic writes)
- `MEMORY.md`, `USER.md` — human-readable render of the curated memory
- `skills/<name>/SKILL.md` — agentskills.io format, editable by hand

Node kinds: `memory`, `user`, `skill`, `tool`, `topic`, `episode`, `provider`.
Edge kinds: `used` (episode→tool), `by` (episode→provider), `about` (→topic),
`similar` (semantic neighbour), `derived` (skill↔episode).

Embeddings: signed feature hashing of words + character trigrams into 384 dims,
L2-normalised. Deterministic, instant, no model download — good enough for dedup,
linking and recall at this scale (thousands of nodes).

## AI tools

| Tool | Purpose |
|---|---|
| `brain_remember` | Save a durable fact (`memory`) or user preference (`user`); dedups and updates similar entries |
| `brain_forget` | Remove a wrong/outdated memory |
| `brain_recall` | Semantic search over everything the brain knows |
| `brain_save_skill` | Create a skill or patch one (old → new text) |
| `brain_load_skill` | Load a skill's full procedure before using it (counts a use) |

All five only touch the brain, never the project, so they are allowed in every
permission mode.

## Mind map

Settings → Brain opens a full canvas mind map:

- dots coloured by kind, sized by weight/usage, labels on hubs and on hover
- force-directed layout that keeps settling as new knowledge arrives
- new nodes pulse when they are learned (live via `bhippi://brain-changed`)
- pan, zoom, filter by kind, search; clicking a dot opens its details
  (memory text, skill procedure + win rate, tool success stats, episode)
- stats strip: memories, user facts, skills, tools, episodes, topics
- actions: Dream now, open the brain folder, forget a node

## Phases

1. **Native engine** — store, hashing embedder, record turn, remember/forget/recall,
   skills, dream, brief. Unit tests. ✅
2. **Wire-in** — brief injected into every chat turn; turns recorded natively by
   default; IdeaGraph optional mirror; five AI tools. ✅
3. **Mind map UI** — live canvas graph, inspector, filters, stats. ✅
4. **Next** — LLM-written reflections in a background subagent after long turns,
   skill sharing (import/export SKILL.md bundles), per-project brains, a timeline
   scrubber that replays how the brain grew.
