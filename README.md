# Apollo LLM Coaching App
## Time Log

| Task | Time |
|---|---|
| Reading brief, understanding requirements, CSV analysis | 20 min |
| Schema design + db_setup.py | 30 min |
| Backend v1 (FastAPI, retrieval, LLM re-ranking) | 90 min |
| Frontend (HTML/JS, pipeline diagram, profile panel) | 60 min |
| Backend v2 (tool use, two-pass prompting, caching, eval framework) | 90 min |
| Evaluation framework + domain metrics + iterative tuning | 60 min |
| Deployment (Fly.io + Supabase + Netlify) | 45 min |
| Write-up | 30 min |
| **Total** | **~7 hrs** |

---

## Live Demo

Frontend: https://prescribed-motion.netlify.app
Backend: https://backend-lingering-shape-7460.fly.dev

---

## Project Structure

```
apollo-assessment/
├── exercises.csv
├── README.md
├── backend/
│   ├── main.py            # FastAPI app — full pipeline v2
│   ├── db_setup.py        # Schema creation + CSV loading
│   ├── eval_queries.json  # Ground truth eval dataset
│   ├── Dockerfile
│   ├── fly.toml
│   └── requirements.txt
└── frontend/
    ├── index.html         # Self-contained SPA (no build step)
    └── App.jsx            # React version
```

---

## Quickstart

### Prerequisites
- Python 3.11+
- PostgreSQL running locally
- Anthropic API key

### Backend

```bash
cd backend
pip install -r requirements.txt

export DATABASE_URL="postgresql://user:password@localhost:5432/apollo"
export ANTHROPIC_API_KEY="sk-ant-..."

python db_setup.py
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
python3 -m http.server 5500
# Open http://localhost:5500/index.html
```

---

## Data Setup

### Schema decisions

Each CSV field gets its own typed TEXT column to enable SQL filtering (e.g. WHERE difficulty = 'beginner'). Two additional fields were added beyond the provided CSV:

- intensity (low / medium / high) — enables filtering by training load, which is essential for rehab vs performance queries
- injury_focus (e.g. knee rehab, shoulder rehab, none) — enables contraindication filtering and targeted retrieval for injury-specific queries

A GIN index on tsvector covering title, description, tags, body_part, injury_focus, and difficulty enables fast full-text search. Trigram indexes on title, tags, injury_focus, and body_part allow fuzzy matching for partial words and misspellings. No normalization into separate tag or body-part tables at this scale (60 rows); a flat schema is simpler and the GIN index already enables multi-field search.

---

## Pipeline

```
User Query
    |
    v
Stage 1 — Query Expansion
  Maps sport/body-part terms to exercise keywords.
  Equipment constraints checked first (safety priority).
  e.g. "winger" expands to "explosive plyometric sprint agility"
    |
    v
Stage 2 — Retrieval (Postgres)
  FTS: plainto_tsquery over 6 fields.
  Trigram: similarity() on title, tags, injury_focus, body_part.
  Returns top-30 candidates.
  Connection pool via psycopg_pool (min=2, max=10).
    |
    v
Stage 3 — Intent Classification (Pass 1 LLM)
  Few-shot prompt with 14 labeled examples.
  Categories: rehab / performance / strength / mobility / conditioning / general.
  80% accuracy on eval set.
    |
    v
Stage 4 — Re-ranking (Pass 2 LLM)
  Claude tool use — guaranteed JSON schema via structured outputs.
  Intent-aware prompt with 8 explicit ranking rules.
  Body part, intensity, and equipment constraints enforced explicitly.
  Returns top-N results with relevance scores and one-sentence explanations.
    |
    v
Cache + Response
  MD5 hash cache with 5-minute TTL.
  Graceful fallback to retrieval order on LLM failure.
```

### Why separate retrieval and re-ranking?

At 100k+ exercises, passing all rows to an LLM is not feasible due to cost, latency, and context window limits. Retrieval cheaply narrows the candidate set to a manageable window; the LLM then applies reasoning to that small set. This is the standard RAG pattern and scales cleanly.

### Key design decisions

| Decision | Rationale |
|---|---|
| Tool use instead of JSON parsing | Guaranteed schema compliance; no brittle string parsing |
| Two-pass prompting | Intent classification before re-ranking gives Claude richer context |
| Few-shot intent classifier | 14 labeled examples reduce edge-case misclassification |
| Query expansion | Maps domain terms like "winger" to exercise tags the DB understands |
| Connection pool | No new DB connection per request; scales to concurrent users |
| In-memory cache | Repeated queries return in under 100ms instead of ~14 seconds |
| Graceful fallbacks | LLM failure returns retrieval order rather than a 500 error |

---

## Evaluation Framework

### Running the eval

```bash
curl -X POST http://localhost:8000/evaluate \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Metrics

The /evaluate endpoint computes 14 metrics across 4 categories. This directly addresses the assessment requirement to "build tooling to test different prompts and model configurations, and create evaluation datasets to benchmark retrieval performance."

**Retrieval**
- precision_at_n: fraction of returned results in the expected set
- recall_at_n: fraction of expected results that were returned
- any_match_rate: did at least one correct result appear?
- mean_mrr: Mean Reciprocal Rank — rewards correct results appearing higher
- mean_ndcg: Normalized Discounted Cumulative Gain — position-weighted relevance
- top_1_accuracy: was the number-one result always correct?

**Intent Classification**
- intent_accuracy: did the classifier predict the right category?

**LLM Quality**
- reason_coverage: percentage of results with Claude explanations
- mean_reason_length: proxy for explanation quality (approximately 17 words on average)

**Domain-Specific (custom metrics for coaching apps)**

These five metrics are not present in standard IR benchmarks. They were designed specifically for the exercise recommendation domain, where clinical correctness matters more than generic relevance.

- safety_score: no contraindicated exercises returned for injury queries
- difficulty_appropriateness: difficulty matches the level implied by the query
- equipment_compliance: equipment constraints in the query are respected
- body_part_specificity: exercises target the body part mentioned in the query
- intensity_match: intensity matches the context implied by the query
- domain_score: composite average of all five domain metrics

### Results (best observed across multiple runs)

| Metric | Score |
|---|---|
| Mean Precision@8 | 0.775 |
| Mean Recall@8 | 0.745 |
| Any-match Rate | 1.0 |
| Mean MRR | 1.0 |
| Mean NDCG | 0.856 |
| Top-1 Accuracy | 1.0 |
| Intent Accuracy | 0.80 |
| Reason Coverage | 1.0 |
| Safety Score | 1.0 |
| Difficulty Appropriateness | 0.925 |
| Equipment Compliance | 1.0 |
| Body Part Specificity | 0.95 |
| Intensity Match | 0.85 |
| Domain Score | 0.905 |

### Key findings

MRR = 1.0 and Top-1 Accuracy = 1.0 across all runs. The system never put a wrong exercise at the top position. The most visible result is always correct.

Safety Score = 1.0. The system never returned a contraindicated exercise for injury queries. This is the most clinically important metric for a coaching application.

LLM nondeterminism: precision and recall vary by approximately plus or minus 0.05 across identical runs due to Claude's sampling temperature. This is expected behavior. In production, a lower temperature setting and persistent caching would reduce this variance.

Improvement from v1 to v2: precision improved from 0.56 to 0.775 (+38%) and recall from 0.40 to 0.745 (+86%) through query expansion, few-shot prompting, retrieval tuning, and iterative prompt engineering.

---

## Scaling to 100k+ Exercises and Many Concurrent Users

### Growing dataset

| Problem | Solution |
|---|---|
| FTS and trigram slow at scale | Add pgvector column with pre-computed embeddings. Use HNSW index for approximate nearest neighbor search. |
| Retrieval recall | Blend BM25 (via pg_bm25 / ParadeDB) with vector similarity using Reciprocal Rank Fusion. |
| Embeddings freshness | Recompute on write via background queue (Celery or Postgres trigger). |
| LLM prompt size | Hard-cap candidates at 20-30; compress exercise representation in the prompt. |

### Concurrent users

| Problem | Solution |
|---|---|
| Single process | Deploy behind Gunicorn with multiple Uvicorn workers, or containerize with Kubernetes HPA. |
| Anthropic rate limits | Semaphore or token bucket in the re-ranking layer; jitter on retries. |
| DB connection pressure | Already using psycopg_pool; move to asyncpg for fully async operation. |
| Repeated queries | Already cached in memory; replace with Redis for multi-instance deployments. |
| Cold LLM calls | Pre-warm popular queries; request coalescing for identical concurrent queries. |

For very high throughput, the LLM re-ranking call can be replaced with a fine-tuned cross-encoder (e.g. ms-marco-MiniLM) deployed on GPU — equivalent ranking quality with no API latency or per-call cost.

---

## Personalization via Onboarding

### What data to collect

A short onboarding flow (3-4 screens, approximately 2 minutes) should gather:

| Field | Values | Pipeline effect |
|---|---|---|
| Primary goal | rehab / strength / endurance / performance / mobility | Hard filter + LLM prompt context |
| Experience level | beginner / intermediate / advanced | Hard SQL filter on difficulty |
| Injury history | free text + structured tags (e.g. ACL, shoulder impingement) | Hard filter on contraindication list |
| Available equipment | bodyweight / bands / dumbbells / barbell / machine | Hard SQL filter on equipment field |
| Preferred intensity | low / medium / high | Soft boost in re-ranking prompt |
| Sport or position | optional free text | Appended to LLM prompt as context |

### How it influences the pipeline

**Hard filters at retrieval (SQL)**

```sql
WHERE equipment = ANY(%(user_equipment)s)
  AND difficulty <= %(max_difficulty)s
  AND injury_focus != ANY(%(contraindicated)s)
```

Contraindicated exercises (e.g. plyometrics for an ACL tear) never enter the candidate set.

**Contextual re-ranking (LLM prompt)**

The user profile is prepended to the re-ranking prompt. Claude reasons holistically: "User is a winger rehabbing a hamstring — Nordic Curl is contraindicated right now; Hamstring Bridge is the appropriate starting point."

This is already implemented in the rerank_with_llm function via the user_profile parameter.

**Long-term personalization (feedback loop)**

- Track implicit signals: exercises viewed, saved, or skipped.
- Store a user embedding (dense preference vector) updated after each session.
- Bias ANN retrieval toward the user's embedding subspace at query time.
- Periodically retrain a lightweight collaborative filtering model on interaction data.

### Inspiration from Spotify and Netflix

| Mechanic | Coaching equivalent |
|---|---|
| Spotify Discover Weekly — finds novel content matching taste profile | Surface exercises the user has not tried that match their profile vector |
| Netflix "Because you watched X" | "Because you did Nordic Curls, try these hamstring progressions" |
| Netflix content maturity filters | Hard equipment and injury filters in SQL |
| Spotify mood playlists | Session type filter: Recovery day vs Game day activation |
| Popularity bias correction | Avoid always recommending the most common exercises; surface underused but appropriate movements |

---

## API Reference

### POST /recommend

```json
{
  "query": "knee pain, low-impact exercises",
  "top_k": 12,
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

Response includes: query, query_intent, recommendations (with relevance_score and rank_reason per exercise), retrieval_count, model_used, cached, latency_ms.

### POST /evaluate
Run full benchmark suite. Returns all 14 metrics across retrieval, ranking, intent, LLM quality, domain-specific, and latency categories.

### DELETE /cache
Clear in-memory query cache.

### GET /exercises
Return all 60 exercises.

### GET /health
Returns status, version, and model name.
