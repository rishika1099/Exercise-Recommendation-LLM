#!/usr/bin/env python3
"""
db_setup.py — Initialize PostgreSQL schema and load exercises.csv

Run once:
    python db_setup.py

Schema decisions:
  • Dedicated columns for every CSV field — allows typed filtering
    (e.g. WHERE difficulty = 'beginner' AND injury_focus = 'knee rehab').
  • GIN index on tsvector column — fast full-text search.
  • pg_trgm extension + trigram indexes on title, tags, injury_focus —
    enables fuzzy keyword matching for typos / partial terms.
  • In production with 100k+ rows we would add a vector COLUMN (pgvector)
    storing a 1536-dim OpenAI/Anthropic embedding, plus an ivfflat or hnsw
    index for approximate nearest-neighbour search.
"""

import csv
import os
import psycopg

DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/apollo"
)

SCHEMA = """
-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop and recreate for idempotency
DROP TABLE IF EXISTS exercises;

CREATE TABLE exercises (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    description   TEXT,
    tags          TEXT,
    body_part     TEXT,
    difficulty    TEXT,
    equipment     TEXT,
    injury_focus  TEXT,
    intensity     TEXT
);

-- Full-text search index (GIN on tsvector)
CREATE INDEX exercises_fts_idx ON exercises USING GIN (
    to_tsvector('english',
        coalesce(title,'') || ' ' ||
        coalesce(description,'') || ' ' ||
        coalesce(tags,'') || ' ' ||
        coalesce(body_part,'') || ' ' ||
        coalesce(injury_focus,'') || ' ' ||
        coalesce(difficulty,'')
    )
);

-- Trigram indexes for fuzzy matching
CREATE INDEX exercises_title_trgm   ON exercises USING GIN (lower(title)        gin_trgm_ops);
CREATE INDEX exercises_tags_trgm    ON exercises USING GIN (lower(tags)         gin_trgm_ops);
CREATE INDEX exercises_injury_trgm  ON exercises USING GIN (lower(injury_focus) gin_trgm_ops);
CREATE INDEX exercises_body_trgm    ON exercises USING GIN (lower(body_part)    gin_trgm_ops);
"""

INSERT_SQL = """
INSERT INTO exercises (id, title, description, tags, body_part, difficulty, equipment, injury_focus, intensity)
VALUES (%(id)s, %(title)s, %(description)s, %(tags)s, %(body_part)s, %(difficulty)s, %(equipment)s, %(injury_focus)s, %(intensity)s)
ON CONFLICT (id) DO UPDATE SET
    title        = EXCLUDED.title,
    description  = EXCLUDED.description,
    tags         = EXCLUDED.tags,
    body_part    = EXCLUDED.body_part,
    difficulty   = EXCLUDED.difficulty,
    equipment    = EXCLUDED.equipment,
    injury_focus = EXCLUDED.injury_focus,
    intensity    = EXCLUDED.intensity;
"""

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "exercises.csv")


def main():
    conn = psycopg.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    print("Creating schema…")
    cur.execute(SCHEMA)
    print("Schema created.")

    print(f"Loading data from {CSV_PATH}…")
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    # Clean up rows — strip whitespace from all values
    cleaned = []
    for row in rows:
        cleaned.append({k.strip(): (v.strip() if v else "") for k, v in row.items()})

    cur.executemany(INSERT_SQL, cleaned)
    print(f"Inserted {len(cleaned)} exercises.")

    cur.execute("SELECT COUNT(*) FROM exercises;")
    count = cur.fetchone()[0]
    print(f"Total rows in exercises table: {count}")

    cur.close()
    conn.close()
    print("Done!")


if __name__ == "__main__":
    main()
