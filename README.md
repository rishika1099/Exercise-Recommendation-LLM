# Apollo LLM Coaching App

## Time Log

| Task | Time |
|---|---|
| Reading brief, understanding requirements, CSV analysis | 20 min |
| Schema design + db_setup.py | 30 min |
| Backend (FastAPI, retrieval, LLM re-ranking) | 90 min |
| Frontend (HTML/JS, UI, embedded retrieval + LLM call) | 60 min |
| Write-up (README, onboarding proposal, scaling section) | 40 min |
| **Total** | **~4 hrs** |

---

## Project Structure

```
apollo-assessment/
├── exercises.csv              # provided dataset
├── backend/
│   ├── main.py                # FastAPI app (retrieval + re-ranking)
│   ├── db_setup.py            # schema creation + CSV loading
│   └── requirements.txt
├── frontend/
│   └── index.html             # self-contained SPA (no build step needed)
└── README.md                  # this file
```

---

## Quickstart

### 1. Prerequisites

- Python 3.11+
- PostgreSQL running locally (default: `postgres:postgres@localhost:5432/apollo`)
- An Anthropic API key

### 2. Backend

```bash
cd backend
pip install -r requirements.txt

# Set env vars
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/apollo"
export ANTHROPIC_API_KEY="sk-ant-..."

# Load data
python db_setup.py

# Start API
uvicorn main:app --reload --port 8000
```

The API will be available at http://localhost:8000.

### 3. Frontend

The frontend is a **single self-contained HTML file** — no Node, no build step.

**Option A — Live demo (standalone, calls Anthropic API directly):**
```bash
open frontend/index.html
```
Just open in a browser. The page embeds the exercise dataset client-side and calls the Anthropic API directly for re-ranking. Add your API key in the browser console if needed, or the app will use the API key passed via headers if deployed behind a proxy.

**Option B — Full backend mode:**
Point the `fetch` call in `index.html` to `http://localhost:8000/recommend` and POST a `QueryRequest` JSON body.

---

## Architecture Overview

### Data Setup

**Schema decisions:**
- Each CSV field gets its own typed `TEXT` column to enable SQL filtering (`WHERE difficulty = 'beginner'`).
- A **GIN index on `tsvector`** covering title + description + tags + body_part + injury_focus + difficulty enables fast full-text search.
- **Trigram indexes** (`pg_trgm`) on `title`, `tags`, `injury_focus`, `body_part` allow fuzzy matching — useful when users type partial words or misspell muscle groups.
- No normalization into separate tag/body-part tables at this scale (60 rows); a flat schema is simpler and the GIN index already enables multi-field search.

### Pipeline

```
User Query
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  Stage 1 — Retrieval (Postgres)                     │
│  • FTS: plainto_tsquery over 6 fields               │
│  • Trigram: similarity() on title/tags/injury/body  │
│  • Blended score: fts_score×2 + trgm_score          │
│  • Returns top-K candidates (default K=10)          │
└─────────────────────────────────────────────────────┘
    │
    ▼ candidates list (exercise metadata)
    │
┌─────────────────────────────────────────────────────┐
│  Stage 2 — Re-ranking (Claude / Anthropic API)      │
│  • Sends query + candidate list in a structured     │
│    prompt to claude-opus-4-5                        │
│  • LLM scores each candidate 0–1, selects top-N    │
│  • Returns JSON: [{id, relevance_score, reason}]    │
│  • Optional: user profile appended to prompt        │
└─────────────────────────────────────────────────────┘
    │
    ▼
Top-N recommendations with scores + explanations
```

**Why separate retrieval and re-ranking?**

- **Cost / latency**: Running the LLM over the full corpus (even 60 rows) wastes tokens and adds latency. Retrieval cheaply narrows the candidate set.
- **Scalability**: At 100k+ exercises, you cannot pass all rows to an LLM. Retrieval must shrink the candidate set to a manageable window (e.g. top 15–20).
- **Quality**: The LLM understands nuance that keyword matching misses — it can reason about injury context, load contraindications, and exercise progressions.

---

## Scaling to 100k+ Exercises / Many Concurrent Users

### Growing dataset

| Problem | Solution |
|---|---|
| FTS + trigram slow at scale | Add **pgvector** column with pre-computed embeddings (OpenAI `text-embedding-3-small` or Anthropic). Use **IVFFlat or HNSW** index for ANN search. |
| Retrieval recall | Blend BM25 (via `pg_bm25` / ParadeDB) with vector similarity using **Reciprocal Rank Fusion** |
| Embeddings freshness | Recompute on write via a background queue (Celery / Postgres trigger) |
| LLM prompt size | Hard-cap candidates at 20; compress exercise representation in the prompt |

### Concurrent users

| Problem | Solution |
|---|---|
| Single FastAPI process | Deploy behind **Gunicorn** with multiple Uvicorn workers, or containerise and use Kubernetes HPA |
| Anthropic API rate limits | Add a **semaphore / token bucket** in the re-ranking layer; queue overflow requests; add jitter to retries |
| DB connection pressure | Use **asyncpg** + connection pool (`asyncpg.create_pool`) instead of synchronous psycopg2 |
| Repeated queries | **Query-level caching** in Redis (key = hash of query + profile); short TTL (5–10 min) |
| Cold LLM calls | Pre-warm popular query patterns; use a **request coalescing** layer to batch similar queries |

For very high throughput, the re-ranking call can be replaced by a **cross-encoder** model deployed on GPU (e.g. a fine-tuned `ms-marco-MiniLM`) — same quality, no API latency.

---

## Personalization via Onboarding

### What data to collect

A short onboarding flow (3–4 screens, max 2 min) should gather:

| Field | Values | Purpose |
|---|---|---|
| **Primary goal** | rehab / strength / endurance / performance / mobility | Filters and boosts |
| **Experience level** | beginner / intermediate / advanced | Filters difficulty |
| **Injury history** | free text + structured tags (e.g. "ACL", "shoulder impingement") | Hard-filters contraindicated exercises |
| **Available equipment** | multi-select: bodyweight / bands / dumbbells / barbell / machine / sled | Hard-filters by equipment |
| **Preferred intensity** | low / medium / high | Soft boost in re-ranking |
| **Sport / position** | optional free text | Added to the LLM prompt as context |
| **Session duration** | 20 / 45 / 60+ min | Influences number of recommendations |

### How it influences the pipeline

**Hard filters (Retrieval stage — SQL)**
```sql
WHERE equipment = ANY(%(user_equipment)s)
  AND difficulty <= %(max_difficulty)s
  AND (injury_focus = 'none' OR injury_focus != ANY(%(contraindicated)s))
```
Contraindicated exercises (e.g. plyometrics for an ACL tear) never enter the candidate set.

**Soft boost (Retrieval stage — score)**
User goal maps to a preferred `intensity` / `injury_focus` range, which increases the blended score for matching rows.

**Contextual re-ranking (LLM stage — prompt)**
The user profile is prepended to the LLM prompt (already implemented in `rerank_with_llm`). The model reasons holistically: *"User is a winger rehabbing a hamstring — Nordic Curl is contraindicated right now; Hamstring Bridge is a better starting point."*

**Long-term personalization (feedback loop)**
Inspired by Spotify's Discover Weekly and Netflix's recommendation engine:
- Track **implicit signals**: exercises viewed, saved, or skipped.
- Store a **user embedding** (dense vector of preferences) updated after each session.
- At retrieval time, bias the ANN search toward the user's embedding subspace.
- Periodically re-train a lightweight **collaborative filtering** model on interaction data to surface exercises similar users enjoyed.

### Inspiration from Spotify / Netflix

| Mechanic | Coaching App Equivalent |
|---|---|
| Spotify "Discover Weekly" — finds novel content similar to your taste | Suggest exercises the user hasn't tried that match their profile vector |
| Netflix "Because you watched X" | "Because you did Nordic Curls, try these hamstring progressions" |
| Netflix maturity / content filters | Hard equipment + injury filters in SQL |
| Spotify mood playlists | Session-type filter: "Recovery day" vs "Game day activation" |
| Popularity bias correction | Avoid always recommending the most common exercises; surface underused gems |

---

## API Reference

### `POST /recommend`

```json
{
  "query": "knee pain, low-impact exercises",
  "top_k": 10,
  "top_n": 5,
  "user_profile": {
    "goals": "rehab",
    "injuries": "knee sprain",
    "equipment": "bodyweight",
    "preferred_intensity": "low",
    "experience_level": "beginner"
  }
}
```

**Response:**
```json
{
  "query": "knee pain, low-impact exercises",
  "recommendations": [
    {
      "id": "EX_001",
      "title": "Single-Leg Box Squat",
      "description": "Controlled unilateral squat improving knee stability",
      "relevance_score": 0.95,
      "rank_reason": "Low-impact unilateral squat specifically designed for knee rehab.",
      ...
    }
  ],
  "retrieval_count": 10,
  "model_used": "claude-opus-4-5"
}
```

### `GET /exercises` — Returns all 60 exercises.
### `GET /health` — Returns `{"status": "ok"}`.
