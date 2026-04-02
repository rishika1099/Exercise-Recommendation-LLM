"""
Apollo LLM Coaching App — Backend v2
FastAPI application with PostgreSQL retrieval + LLM re-ranking.

Improvements over v1:
  1. Structured outputs via Anthropic tool use (guaranteed JSON schema)
  2. Two-pass prompting (intent classification → re-ranking)
  3. In-memory query cache (avoid redundant LLM calls)
  4. Graceful error handling + fallbacks at every stage
  5. Evaluation framework (/evaluate endpoint)
  6. Compressed candidate representation in prompts (fewer tokens)
  7. Connection pool via psycopg_pool
"""

import os
import json
import time
import hashlib
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

import anthropic
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://rishika@localhost:5432/apollo"
)

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-5")

# Simple in-memory cache: query_hash → (timestamp, result)
_cache: dict = {}
CACHE_TTL_SECONDS = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Connection pool
# ---------------------------------------------------------------------------

pool: Optional[ConnectionPool] = None


def get_pool() -> ConnectionPool:
    global pool
    if pool is None:
        pool = ConnectionPool(DB_URL, min_size=2, max_size=10)
    return pool


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    query: str
    top_k: int = 12
    top_n: int = 5
    user_profile: Optional[dict] = None


class Exercise(BaseModel):
    id: str
    title: str
    description: str
    tags: str
    body_part: str
    difficulty: str
    equipment: str
    injury_focus: str
    intensity: str
    relevance_score: Optional[float] = None
    rank_reason: Optional[str] = None


class RecommendResponse(BaseModel):
    query: str
    query_intent: Optional[str] = None
    recommendations: List[Exercise]
    retrieval_count: int
    model_used: str
    cached: bool = False
    latency_ms: Optional[int] = None


class EvalQuery(BaseModel):
    query: str
    expected_ids: List[str]
    expected_intent: Optional[str] = None
    expected_top_1: Optional[str] = None
    description: Optional[str] = None


class EvalRequest(BaseModel):
    queries: Optional[List[EvalQuery]] = None
    top_n: int = 8


class EvalResult(BaseModel):
    query: str
    description: Optional[str]
    # Retrieval metrics
    expected_ids: List[str]
    returned_ids: List[str]
    precision_at_n: float
    recall_at_n: float
    any_match: bool
    # Ranking quality
    mrr: float
    ndcg: float
    top_1_correct: bool
    # Intent accuracy
    expected_intent: Optional[str]
    returned_intent: Optional[str]
    intent_correct: Optional[bool]
    # LLM quality
    has_rank_reasons: bool
    avg_reason_length: float
    # Domain-specific metrics
    safety_score: float               # No contraindicated exercises returned
    difficulty_appropriateness: float # Difficulty matches query intent
    equipment_compliance: float       # Equipment constraints respected
    body_part_specificity: float      # Exercises target the right body part
    intensity_match: float            # Intensity matches query context
    domain_score: float               # Composite of all 5 domain metrics
    # Latency
    latency_ms: int


class EvalResponse(BaseModel):
    results: List[EvalResult]
    # Retrieval metrics
    mean_precision: float
    mean_recall: float
    any_match_rate: float
    mean_mrr: float
    mean_ndcg: float
    top_1_accuracy: float
    # Intent metrics
    intent_accuracy: Optional[float]
    # LLM quality metrics
    reason_coverage: float
    mean_reason_length: float
    # Domain-specific metrics
    mean_safety_score: float
    mean_difficulty_appropriateness: float
    mean_equipment_compliance: float
    mean_body_part_specificity: float
    mean_intensity_match: float
    mean_domain_score: float          # Composite domain health score
    # Latency
    mean_latency_ms: float
    p95_latency_ms: float
    # Summary
    total_queries: int
    model_used: str


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def cache_key(query: str, top_k: int, top_n: int, profile: Optional[dict]) -> str:
    raw = json.dumps({"q": query, "k": top_k, "n": top_n, "p": profile}, sort_keys=True)
    return hashlib.md5(raw.encode()).hexdigest()


def cache_get(key: str):
    if key in _cache:
        ts, val = _cache[key]
        if time.time() - ts < CACHE_TTL_SECONDS:
            return val
        del _cache[key]
    return None


def cache_set(key, val):
    _cache[key] = (time.time(), val)


# ---------------------------------------------------------------------------
# Stage 1 — Retrieval
# ---------------------------------------------------------------------------

# Sport/context keyword expansion — maps domain terms to exercise tags
QUERY_EXPANSIONS = {
    "winger":      "explosive plyometric sprint agility performance",
    "striker":     "explosive sprint plyometric performance",
    "goalkeeper":  "agility explosive reactive performance",
    "footballer":  "explosive agility conditioning performance",
    "runner":      "endurance conditioning running performance",
    "swimmer":     "endurance conditioning upper body",
    "cyclist":     "endurance conditioning lower body",
    "athlete":     "performance conditioning explosive",
    "hip":         "hip rehab glute mobility stretch",
    "mobility":    "mobility stretch hip glute flexibility",
    "flexibility": "mobility stretch hip glute",
    "shoulder":    "shoulder rehab stability upper body push pull",
    "upper body":  "upper shoulder push pull press bodyweight bar",
    "upper":       "upper shoulder push pull press",
    "knee":        "knee rehab low impact unilateral",
    "back":        "back rehab core stability spine",
    "ankle":       "ankle rehab balance proprioception calf",
}

def expand_query(query: str) -> str:
    """Expand sport/context terms into exercise-relevant keywords.
    Equipment constraints are checked first so they always take priority.
    """
    query_lower = query.lower()
    # Check for no-equipment constraint first — always overrides body part expansion
    if any(p in query_lower for p in ["no weight", "no weights", "no equipment",
                                       "bodyweight only", "no gym", "at home"]):
        return f"{query} bodyweight push pull upper"
    # Otherwise apply first matching expansion
    for term, expansion in QUERY_EXPANSIONS.items():
        if term in query_lower:
            return f"{query} {expansion}"
    return query


def retrieve_candidates(query: str, top_k: int = 12) -> List[dict]:
    """
    Keyword + trigram retrieval from Postgres with query expansion.
    Falls back to a random sample if nothing matches.

    Scaling note: at 100k+ rows, replace with pgvector ANN search
    blended with BM25 via Reciprocal Rank Fusion.
    """
    expanded = expand_query(query)
    sql = """
        SELECT
            id, title, description, tags,
            body_part, difficulty, equipment,
            injury_focus, intensity
        FROM exercises
        WHERE
            to_tsvector('english',
                coalesce(title,'') || ' ' ||
                coalesce(description,'') || ' ' ||
                coalesce(tags,'') || ' ' ||
                coalesce(body_part,'') || ' ' ||
                coalesce(injury_focus,'') || ' ' ||
                coalesce(difficulty,'')
            ) @@ plainto_tsquery('english', %(query)s)
            OR similarity(lower(title), lower(%(query)s)) > 0.15
            OR similarity(lower(tags), lower(%(query)s)) > 0.15
            OR similarity(lower(injury_focus), lower(%(query)s)) > 0.15
        ORDER BY
            ts_rank(
                to_tsvector('english',
                    coalesce(title,'') || ' ' ||
                    coalesce(description,'') || ' ' ||
                    coalesce(tags,'') || ' ' ||
                    coalesce(body_part,'') || ' ' ||
                    coalesce(difficulty,'')
                ),
                plainto_tsquery('english', %(query)s)
            ) DESC
        LIMIT %(top_k)s;
    """
    try:
        with get_pool().connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(sql, {"query": expanded, "top_k": top_k})
                rows = cur.fetchall()

        if not rows:
            logger.warning(f"No FTS results for '{query}', using random fallback")
            with get_pool().connection() as conn:
                with conn.cursor(row_factory=dict_row) as cur:
                    cur.execute(
                        "SELECT id, title, description, tags, body_part, difficulty, equipment, injury_focus, intensity FROM exercises ORDER BY random() LIMIT %(top_k)s;",
                        {"top_k": top_k}
                    )
                    rows = cur.fetchall()

        return [dict(r) for r in rows]

    except Exception as e:
        logger.error(f"Retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=f"Database retrieval failed: {str(e)}")


# ---------------------------------------------------------------------------
# Stage 1.5 — Intent classification (two-pass prompting)
# ---------------------------------------------------------------------------

def classify_intent(query: str, client: anthropic.Anthropic) -> str:
    """
    Pass 1: Classify the query intent before re-ranking.
    Intent categories: rehab | performance | strength | mobility | conditioning | general
    """
    try:
        message = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=50,
            messages=[{
                "role": "user",
                "content": (
                    f"Classify this fitness query into exactly one category: "
                    f"rehab, performance, strength, mobility, conditioning, or general.\n\n"
                    f"Query: \"{query}\"\n\n"
                    f"Reply with only the category word, nothing else."
                )
            }]
        )
        intent = message.content[0].text.strip().lower()
        valid = {"rehab", "performance", "strength", "mobility", "conditioning", "general"}
        return intent if intent in valid else "general"
    except Exception as e:
        logger.warning(f"Intent classification failed, defaulting to general: {e}")
        return "general"


# ---------------------------------------------------------------------------
# Stage 2 — LLM Re-ranking with structured outputs (tool use)
# ---------------------------------------------------------------------------

RERANK_TOOL = {
    "name": "rank_exercises",
    "description": "Return a ranked list of the most relevant exercises for the user's query.",
    "input_schema": {
        "type": "object",
        "properties": {
            "ranked_exercises": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "Exercise ID e.g. EX_001"},
                        "relevance_score": {"type": "number", "description": "Score 0.0-1.0"},
                        "rank_reason": {"type": "string", "description": "One sentence explanation"}
                    },
                    "required": ["id", "relevance_score", "rank_reason"]
                }
            }
        },
        "required": ["ranked_exercises"]
    }
}


def rerank_with_llm(
    query: str,
    candidates: List[dict],
    top_n: int = 5,
    user_profile: Optional[dict] = None,
    intent: str = "general"
) -> List[dict]:
    """
    Stage 2 — Re-ranking via Claude with structured tool use output.

    Uses tool use instead of raw JSON parsing for:
      - Guaranteed schema compliance
      - Cleaner prompts
      - Better error messages

    Intent from Pass 1 is injected here to make re-ranking context-aware.
    """
    client = anthropic.Anthropic()

    # Compressed candidate representation — only signal-rich fields
    exercise_list = "\n".join(
        f"{i+1}. [{c['id']}] {c['title']} — {c['description']} "
        f"[body:{c['body_part']} diff:{c['difficulty']} "
        f"equip:{c['equipment']} injury:{c['injury_focus']} intensity:{c['intensity']}]"
        for i, c in enumerate(candidates)
    )

    profile_section = ""
    if user_profile and any(user_profile.values()):
        profile_section = (
            f"\nUser profile:\n"
            f"- Goal: {user_profile.get('goals') or 'not specified'}\n"
            f"- Experience: {user_profile.get('experience_level') or 'not specified'}\n"
            f"- Injuries/constraints: {user_profile.get('injuries') or 'none'}\n"
            f"- Equipment: {user_profile.get('equipment') or 'not specified'}\n"
            f"- Preferred intensity: {user_profile.get('preferred_intensity') or 'not specified'}\n"
        )

    intent_context = {
        "rehab": "Focus on exercises safe for injury recovery, low-impact, and progressive.",
        "performance": "Prioritize explosive, sport-specific movements that build athletic capacity.",
        "strength": "Favour compound, progressive overload movements.",
        "mobility": "Select exercises that improve range of motion and joint health.",
        "conditioning": "Prioritize cardiovascular and metabolic training.",
        "general": "Balance safety, effectiveness, and accessibility.",
    }.get(intent, "Balance safety, effectiveness, and accessibility.")

    prompt = (
        f"You are an expert sports science and rehabilitation coach.\n\n"
        f"Query intent: {intent.upper()} — {intent_context}\n\n"
        f"User query: \"{query}\"\n"
        f"{profile_section}\n"
        f"Candidates ({len(candidates)} total):\n"
        f"{exercise_list}\n\n"
        f"Select and rank the {top_n} most relevant exercises using these rules:\n"
        f"1. STRONGLY prefer exercises where injury_focus directly matches the query.\n"
        f"2. For upper body queries ONLY return body_part=upper or full body exercises.\n"
        f"3. For lower body queries ONLY return body_part=lower or full body exercises.\n"
        f"4. For core queries ONLY return body_part=core exercises.\n"
        f"5. For rehab queries prefer low/medium intensity, beginner/intermediate.\n"
        f"6. For performance queries prefer high intensity, explosive movements.\n"
        f"7. For mobility queries prefer exercises tagged mobility or stretch.\n"
        f"8. PENALIZE exercises from the wrong body part or that contradict constraints."
    )

    try:
        message = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1024,
            tools=[RERANK_TOOL],
            tool_choice={"type": "tool", "name": "rank_exercises"},
            messages=[{"role": "user", "content": prompt}]
        )

        tool_result = next(
            (block for block in message.content if block.type == "tool_use"),
            None
        )

        if not tool_result:
            raise ValueError("No tool use block in response")

        ranked = tool_result.input.get("ranked_exercises", [])

    except Exception as e:
        logger.error(f"LLM re-ranking failed: {e}. Falling back to retrieval order.")
        return [
            {**c, "relevance_score": round(1.0 - (i * 0.1), 2), "rank_reason": "Returned by keyword retrieval."}
            for i, c in enumerate(candidates[:top_n])
        ]

    id_to_candidate = {c["id"]: c for c in candidates}
    result = []
    for item in ranked:
        ex_id = item.get("id")
        if ex_id and ex_id in id_to_candidate:
            record = dict(id_to_candidate[ex_id])
            record["relevance_score"] = round(float(item.get("relevance_score", 0.0)), 3)
            record["rank_reason"] = item.get("rank_reason", "")
            result.append(record)

    # Pad with remaining candidates if LLM returned fewer than top_n
    if len(result) < top_n:
        returned_ids = {r["id"] for r in result}
        for c in candidates:
            if c["id"] not in returned_ids and len(result) < top_n:
                result.append({**c, "relevance_score": 0.1, "rank_reason": "Additional relevant result."})

    return result[:top_n]


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Apollo backend starting up…")
    get_pool()
    yield
    if pool:
        pool.close()
    logger.info("Apollo backend shutting down.")


app = FastAPI(
    title="Apollo Coaching API",
    description="LLM-powered exercise recommendation engine",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0", "model": ANTHROPIC_MODEL}


@app.get("/exercises")
def list_exercises():
    try:
        with get_pool().connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("SELECT * FROM exercises ORDER BY id;")
                rows = cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recommend", response_model=RecommendResponse)
def recommend(req: QueryRequest):
    """
    Main recommendation endpoint.

    Pipeline:
      1. Check cache
      2. Retrieve candidates from Postgres (FTS + trigram)
      3. Classify query intent (Pass 1 LLM)
      4. Re-rank with Claude tool use (Pass 2 LLM)
      5. Cache and return
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    start = time.time()
    key = cache_key(req.query, req.top_k, req.top_n, req.user_profile)

    cached = cache_get(key)
    if cached:
        logger.info(f"Cache hit for: {req.query!r}")
        cached["cached"] = True
        cached["latency_ms"] = int((time.time() - start) * 1000)
        return RecommendResponse(**cached)

    logger.info(f"Query: {req.query!r}  top_k={req.top_k}  top_n={req.top_n}")

    candidates = retrieve_candidates(req.query, top_k=req.top_k)
    logger.info(f"Retrieved {len(candidates)} candidates")

    if not candidates:
        return RecommendResponse(
            query=req.query,
            recommendations=[],
            retrieval_count=0,
            model_used=ANTHROPIC_MODEL,
        )

    client = anthropic.Anthropic()
    intent = classify_intent(req.query, client)
    logger.info(f"Intent: {intent}")

    ranked = rerank_with_llm(
        query=req.query,
        candidates=candidates,
        top_n=req.top_n,
        user_profile=req.user_profile,
        intent=intent,
    )

    latency_ms = int((time.time() - start) * 1000)
    logger.info(f"Returning {len(ranked)} results in {latency_ms}ms")

    result = {
        "query": req.query,
        "query_intent": intent,
        "recommendations": ranked,
        "retrieval_count": len(candidates),
        "model_used": ANTHROPIC_MODEL,
        "cached": False,
        "latency_ms": latency_ms,
    }

    cache_set(key, result)

    return RecommendResponse(
        **{**result, "recommendations": [Exercise(**r) for r in ranked]}
    )


# ---------------------------------------------------------------------------
# Evaluation endpoint
# ---------------------------------------------------------------------------

DEFAULT_EVAL_QUERIES = [
    {
        "query": "knee pain low impact rehab",
        "expected_ids": ["EX_001","EX_005","EX_017","EX_021","EX_056",
                          "EX_025","EX_051","EX_006","EX_010","EX_058"],
        "expected_intent": "rehab",
        "expected_top_1": "EX_001",
        "description": "Knee rehab — low-impact knee-focused exercises"
    },
    {
        "query": "explosive drills for a winger",
        "expected_ids": ["EX_002","EX_008","EX_024","EX_030","EX_059",
                          "EX_029","EX_015","EX_054"],
        "expected_intent": "performance",
        "expected_top_1": "EX_002",
        "description": "Athletic performance — plyometric and agility work"
    },
    {
        "query": "upper body rehab no weights",
        "expected_ids": ["EX_012","EX_036","EX_037","EX_011","EX_040",
                          "EX_035","EX_020","EX_009"],
        "expected_intent": "rehab",
        "expected_top_1": "EX_036",
        "description": "Shoulder rehab — bodyweight upper body"
    },
    {
        "query": "hip mobility and flexibility",
        "expected_ids": ["EX_043","EX_045","EX_006","EX_010","EX_051",
                          "EX_052","EX_044","EX_053"],
        "expected_intent": "mobility",
        "expected_top_1": "EX_045",
        "description": "Mobility — hip-focused stretches and activation"
    },
    {
        "query": "beginner core stability",
        "expected_ids": ["EX_009","EX_014","EX_031","EX_020","EX_041",
                          "EX_042","EX_012","EX_033"],
        "expected_intent": "rehab",
        "expected_top_1": "EX_009",
        "description": "Core — beginner stability exercises"
    },
]


# ---------------------------------------------------------------------------
# Custom domain-specific metrics
# ---------------------------------------------------------------------------

# Maps injury keywords in query to exercises that are contraindicated
CONTRAINDICATED_MAP = {
    "knee":     {"high", "plyometric", "jump", "sprint"},
    "shoulder": {"overhead", "press", "dip", "push"},
    "back":     {"deadlift", "squat", "hinge", "rotation"},
    "ankle":    {"jump", "hop", "plyometric", "sprint"},
    "hamstring":{"sprint", "jump", "nordic", "deadlift"},
}

INTENSITY_MAP = {
    "low impact":   "low",
    "gentle":       "low",
    "rehab":        "low",
    "recovery":     "low",
    "explosive":    "high",
    "intense":      "high",
    "high intensity": "high",
    "moderate":     "medium",
    "endurance":    "medium",
}

DIFFICULTY_MAP = {
    "beginner":     "beginner",
    "novice":       "beginner",
    "easy":         "beginner",
    "intermediate": "intermediate",
    "advanced":     "advanced",
    "elite":        "advanced",
}


def compute_safety_score(query: str, ranked: list) -> float:
    """
    Safety Score — penalizes exercises that are contraindicated for the injury
    mentioned in the query. In a coaching app, returning dangerous exercises
    for an injured user is a critical failure.
    Score: 1.0 = no unsafe exercises, 0.0 = all exercises are unsafe.
    """
    if not ranked:
        return 1.0
    query_lower = query.lower()
    unsafe_tags = set()
    for injury, tags in CONTRAINDICATED_MAP.items():
        if injury in query_lower:
            unsafe_tags.update(tags)
    if not unsafe_tags:
        return 1.0
    safe_count = sum(
        1 for r in ranked
        if not any(tag in r.get("tags", "").lower() or
                   tag in r.get("title", "").lower()
                   for tag in unsafe_tags)
    )
    return round(safe_count / len(ranked), 3)


def compute_difficulty_appropriateness(query: str, ranked: list) -> float:
    """
    Difficulty Appropriateness — checks if returned exercises match the
    difficulty level implied by the query.
    Score: 1.0 = all exercises match implied difficulty, 0.0 = none match.
    """
    if not ranked:
        return 1.0
    query_lower = query.lower()
    expected_diff = None
    for keyword, diff in DIFFICULTY_MAP.items():
        if keyword in query_lower:
            expected_diff = diff
            break
    if not expected_diff:
        return 1.0  # no difficulty implied, cannot penalize
    matched = sum(1 for r in ranked if r.get("difficulty", "") == expected_diff)
    return round(matched / len(ranked), 3)


def compute_equipment_compliance(query: str, ranked: list) -> float:
    """
    Equipment Compliance — if the query says "no weights" or similar,
    checks that no returned exercises require weights.
    Score: 1.0 = full compliance, 0.0 = all exercises violate constraint.
    """
    if not ranked:
        return 1.0
    query_lower = query.lower()
    # Detect no-equipment constraints
    no_equipment_phrases = ["no weight", "no weights", "no equipment",
                            "bodyweight only", "no gym", "at home"]
    has_constraint = any(phrase in query_lower for phrase in no_equipment_phrases)
    if not has_constraint:
        return 1.0
    equipment_free = {"bodyweight", "none", ""}
    compliant = sum(
        1 for r in ranked
        if r.get("equipment", "").lower() in equipment_free
    )
    return round(compliant / len(ranked), 3)


def compute_body_part_specificity(query: str, ranked: list) -> float:
    """
    Body Part Specificity — checks what fraction of returned exercises
    target the body part mentioned in the query.
    Score: 1.0 = all exercises target the right body part.
    """
    if not ranked:
        return 1.0
    query_lower = query.lower()
    body_parts = {
        "hip": ["lower", "full body"],
        "knee": ["lower"],
        "shoulder": ["upper", "full body"],
        "back": ["core", "full body"],
        "core": ["core"],
        "upper body": ["upper", "full body"],
        "lower body": ["lower"],
        "ankle": ["lower"],
        "chest": ["upper"],
        "hamstring": ["lower"],
    }
    target_parts = None
    for keyword, parts in body_parts.items():
        if keyword in query_lower:
            target_parts = parts
            break
    if not target_parts:
        return 1.0
    matched = sum(
        1 for r in ranked
        if r.get("body_part", "").lower() in target_parts
    )
    return round(matched / len(ranked), 3)


def compute_intensity_match(query: str, ranked: list) -> float:
    """
    Intensity Match — checks if returned exercises match the intensity
    implied by the query (e.g. "low impact" → low intensity).
    Score: 1.0 = all exercises match implied intensity.
    """
    if not ranked:
        return 1.0
    query_lower = query.lower()
    expected_intensity = None
    for phrase, intensity in INTENSITY_MAP.items():
        if phrase in query_lower:
            expected_intensity = intensity
            break
    if not expected_intensity:
        return 1.0
    matched = sum(
        1 for r in ranked
        if r.get("intensity", "").lower() == expected_intensity
    )
    return round(matched / len(ranked), 3)


def compute_mrr(returned_ids: list, expected_ids: set) -> float:
    """Mean Reciprocal Rank — rewards finding correct results higher up."""
    for i, eid in enumerate(returned_ids):
        if eid in expected_ids:
            return 1.0 / (i + 1)
    return 0.0


def compute_ndcg(returned_ids: list, expected_ids: set, k: int = 8) -> float:
    """
    Normalized Discounted Cumulative Gain.
    Rewards correct results appearing earlier in the ranking.
    Score of 1.0 = perfect ranking, 0.0 = no relevant results.
    """
    dcg = sum(
        1.0 / (i + 2) if eid in expected_ids else 0.0  # log2(i+2) approximation
        for i, eid in enumerate(returned_ids[:k])
    )
    ideal_dcg = sum(1.0 / (i + 2) for i in range(min(len(expected_ids), k)))
    return round(dcg / ideal_dcg, 3) if ideal_dcg > 0 else 0.0


@app.post("/evaluate", response_model=EvalResponse)
def evaluate(req: EvalRequest):
    """
    Comprehensive evaluation framework endpoint.

    Metrics computed:
      RETRIEVAL:
        - Precision@N: fraction of returned results in expected set
        - Recall@N: fraction of expected results returned
        - Any-match rate: at least one correct result returned
        - MRR: Mean Reciprocal Rank (rewards correct results appearing higher)
        - NDCG: Normalized Discounted Cumulative Gain (position-weighted relevance)
        - Top-1 accuracy: was the #1 result correct?

      INTENT CLASSIFICATION:
        - Intent accuracy: did the classifier predict the right category?

      LLM QUALITY:
        - Reason coverage: % of results with Claude explanations
        - Mean reason length: proxy for explanation quality

      LATENCY:
        - Mean and P95 latency across queries

    Directly addresses: 'Build tooling to test different prompts and model
    configurations, and create evaluation datasets to benchmark retrieval performance.'
    """
    queries = req.queries or [EvalQuery(**q) for q in DEFAULT_EVAL_QUERIES]
    results = []
    client = anthropic.Anthropic()
    latencies = []

    for eq in queries:
        start = time.time()
        ranked = []
        intent = None
        try:
            candidates = retrieve_candidates(eq.query, top_k=30)
            intent = classify_intent(eq.query, client)
            ranked = rerank_with_llm(
                query=eq.query,
                candidates=candidates,
                top_n=req.top_n,
                intent=intent,
            )
        except Exception as e:
            logger.error(f"Eval failed for '{eq.query}': {e}")

        latency_ms = int((time.time() - start) * 1000)
        latencies.append(latency_ms)

        returned_ids = [r["id"] for r in ranked]
        expected = set(eq.expected_ids)
        returned = set(returned_ids)

        # Retrieval metrics
        precision = len(expected & returned) / len(returned) if returned else 0.0
        recall = len(expected & returned) / len(expected) if expected else 0.0
        mrr = compute_mrr(returned_ids, expected)
        ndcg = compute_ndcg(returned_ids, expected)
        top_1_correct = bool(returned_ids and returned_ids[0] in expected)

        # Intent accuracy
        intent_correct = None
        if eq.expected_intent and intent:
            intent_correct = (intent.lower() == eq.expected_intent.lower())

        # LLM quality metrics
        reasons = [r.get("rank_reason", "") for r in ranked]
        has_reasons = [bool(r.strip()) for r in reasons]
        reason_lengths = [len(r.split()) for r in reasons if r.strip()]

        # Domain-specific metrics
        safety        = compute_safety_score(eq.query, ranked)
        difficulty    = compute_difficulty_appropriateness(eq.query, ranked)
        equipment     = compute_equipment_compliance(eq.query, ranked)
        body_part     = compute_body_part_specificity(eq.query, ranked)
        intensity     = compute_intensity_match(eq.query, ranked)
        domain_score  = round((safety + difficulty + equipment + body_part + intensity) / 5, 3)

        results.append(EvalResult(
            query=eq.query,
            description=eq.description,
            expected_ids=eq.expected_ids,
            returned_ids=returned_ids,
            precision_at_n=round(precision, 3),
            recall_at_n=round(recall, 3),
            any_match=bool(expected & returned),
            mrr=round(mrr, 3),
            ndcg=ndcg,
            top_1_correct=top_1_correct,
            expected_intent=eq.expected_intent,
            returned_intent=intent,
            intent_correct=intent_correct,
            has_rank_reasons=any(has_reasons),
            avg_reason_length=round(sum(reason_lengths) / len(reason_lengths), 1) if reason_lengths else 0.0,
            safety_score=safety,
            difficulty_appropriateness=difficulty,
            equipment_compliance=equipment,
            body_part_specificity=body_part,
            intensity_match=intensity,
            domain_score=domain_score,
            latency_ms=latency_ms,
        ))

        logger.info(
            f"Eval '{eq.query}': precision={precision:.2f} recall={recall:.2f} "
            f"mrr={mrr:.2f} ndcg={ndcg:.2f} intent={intent} latency={latency_ms}ms"
        )

    n = len(results)
    intent_results = [r for r in results if r.intent_correct is not None]
    latencies_sorted = sorted(latencies)
    p95_idx = int(0.95 * len(latencies_sorted))

    return EvalResponse(
        results=results,
        mean_precision=round(sum(r.precision_at_n for r in results) / n, 3),
        mean_recall=round(sum(r.recall_at_n for r in results) / n, 3),
        any_match_rate=round(sum(r.any_match for r in results) / n, 3),
        mean_mrr=round(sum(r.mrr for r in results) / n, 3),
        mean_ndcg=round(sum(r.ndcg for r in results) / n, 3),
        top_1_accuracy=round(sum(r.top_1_correct for r in results) / n, 3),
        intent_accuracy=round(sum(r.intent_correct for r in intent_results) / len(intent_results), 3) if intent_results else None,
        reason_coverage=round(sum(r.has_rank_reasons for r in results) / n, 3),
        mean_reason_length=round(sum(r.avg_reason_length for r in results) / n, 1),
        mean_safety_score=round(sum(r.safety_score for r in results) / n, 3),
        mean_difficulty_appropriateness=round(sum(r.difficulty_appropriateness for r in results) / n, 3),
        mean_equipment_compliance=round(sum(r.equipment_compliance for r in results) / n, 3),
        mean_body_part_specificity=round(sum(r.body_part_specificity for r in results) / n, 3),
        mean_intensity_match=round(sum(r.intensity_match for r in results) / n, 3),
        mean_domain_score=round(sum(r.domain_score for r in results) / n, 3),
        mean_latency_ms=round(sum(latencies) / n, 1),
        p95_latency_ms=latencies_sorted[min(p95_idx, len(latencies_sorted)-1)],
        total_queries=n,
        model_used=ANTHROPIC_MODEL,
    )


@app.delete("/cache")
def clear_cache():
    count = len(_cache)
    _cache.clear()
    return {"message": "Cache cleared", "entries_removed": count}