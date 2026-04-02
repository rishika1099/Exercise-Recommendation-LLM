/**
 * Apollo Coaching App — React version
 *
 * A self-contained single-file React app.
 * Uses the Anthropic API directly for LLM re-ranking.
 *
 * To run:
 *   npx create-react-app apollo-ui
 *   Replace src/App.jsx with this file
 *   npm start
 *
 * Or deploy directly as a .jsx artifact in Claude.
 */

import { useState, useCallback } from "react";

// ── Exercise dataset ────────────────────────────────────────────────────────
const EXERCISES = [
  { id:"EX_001",title:"Single-Leg Box Squat",description:"Controlled unilateral squat improving knee stability",tags:"squat, unilateral",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"knee rehab",intensity:"low" },
  { id:"EX_002",title:"Depth Jumps",description:"Explosive jump with minimal ground contact",tags:"plyometric, jump",body_part:"lower",difficulty:"advanced",equipment:"none",injury_focus:"performance",intensity:"high" },
  { id:"EX_003",title:"Copenhagen Plank",description:"Isometric adductor strengthening",tags:"plank, adductor",body_part:"core",difficulty:"intermediate",equipment:"none",injury_focus:"groin rehab",intensity:"medium" },
  { id:"EX_004",title:"Seated DB Shoulder Press",description:"Vertical pressing for shoulder strength",tags:"press, shoulder",body_part:"upper",difficulty:"intermediate",equipment:"dumbbell",injury_focus:"none",intensity:"medium" },
  { id:"EX_005",title:"Wall Sit",description:"Isometric quad endurance hold",tags:"isometric, quad",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"knee rehab",intensity:"low" },
  { id:"EX_006",title:"Lateral Band Walk",description:"Hip stability activation",tags:"glute med, band",body_part:"lower",difficulty:"beginner",equipment:"band",injury_focus:"hip rehab",intensity:"low" },
  { id:"EX_007",title:"Barbell Back Squat",description:"Heavy compound squat",tags:"squat, compound",body_part:"lower",difficulty:"advanced",equipment:"barbell",injury_focus:"none",intensity:"high" },
  { id:"EX_008",title:"Single-Leg Hop",description:"Explosive unilateral hop",tags:"plyometric, unilateral",body_part:"lower",difficulty:"advanced",equipment:"none",injury_focus:"performance",intensity:"high" },
  { id:"EX_009",title:"Dead Bug",description:"Core stabilization drill",tags:"core, stability",body_part:"core",difficulty:"beginner",equipment:"bodyweight",injury_focus:"back rehab",intensity:"low" },
  { id:"EX_010",title:"Clamshell",description:"Hip external rotation exercise",tags:"glute med",body_part:"lower",difficulty:"beginner",equipment:"none",injury_focus:"hip rehab",intensity:"low" },
  { id:"EX_011",title:"Push-Up",description:"Bodyweight upper push",tags:"push, bodyweight",body_part:"upper",difficulty:"beginner",equipment:"bodyweight",injury_focus:"none",intensity:"medium" },
  { id:"EX_012",title:"Plank Shoulder Taps",description:"Dynamic plank with shoulder load",tags:"plank, stability",body_part:"core",difficulty:"intermediate",equipment:"bodyweight",injury_focus:"shoulder rehab",intensity:"low" },
  { id:"EX_013",title:"Trap Bar Deadlift",description:"Lower body hinge strength",tags:"hinge, compound",body_part:"lower",difficulty:"advanced",equipment:"barbell",injury_focus:"none",intensity:"high" },
  { id:"EX_014",title:"Bird Dog",description:"Spinal stability drill",tags:"core, rehab",body_part:"core",difficulty:"beginner",equipment:"bodyweight",injury_focus:"back rehab",intensity:"low" },
  { id:"EX_015",title:"Sprint Intervals",description:"High intensity sprint work",tags:"sprint, conditioning",body_part:"full body",difficulty:"advanced",equipment:"none",injury_focus:"performance",intensity:"high" },
  { id:"EX_016",title:"Tempo Runs",description:"Moderate sustained running",tags:"endurance, running",body_part:"full body",difficulty:"intermediate",equipment:"none",injury_focus:"performance",intensity:"medium" },
  { id:"EX_017",title:"Step-Ups",description:"Controlled unilateral strength",tags:"step, unilateral",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"knee rehab",intensity:"low" },
  { id:"EX_018",title:"Overhead Carry",description:"Loaded shoulder stability",tags:"carry, stability",body_part:"full body",difficulty:"intermediate",equipment:"dumbbell",injury_focus:"shoulder rehab",intensity:"medium" },
  { id:"EX_019",title:"Bench Press",description:"Horizontal press strength",tags:"press, compound",body_part:"upper",difficulty:"advanced",equipment:"barbell",injury_focus:"none",intensity:"high" },
  { id:"EX_020",title:"Side Plank",description:"Lateral core stability",tags:"plank, core",body_part:"core",difficulty:"beginner",equipment:"bodyweight",injury_focus:"back rehab",intensity:"low" },
  { id:"EX_021",title:"Reverse Lunges",description:"Backward stepping lunge",tags:"lunge, unilateral",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"knee rehab",intensity:"low" },
  { id:"EX_022",title:"Forward Lunges",description:"Forward lunge movement",tags:"lunge, unilateral",body_part:"lower",difficulty:"intermediate",equipment:"bodyweight",injury_focus:"none",intensity:"medium" },
  { id:"EX_023",title:"Bulgarian Split Squat",description:"Elevated rear foot squat",tags:"squat, unilateral",body_part:"lower",difficulty:"advanced",equipment:"bodyweight",injury_focus:"none",intensity:"high" },
  { id:"EX_024",title:"Box Jumps",description:"Explosive jump onto box",tags:"plyometric",body_part:"lower",difficulty:"advanced",equipment:"none",injury_focus:"performance",intensity:"high" },
  { id:"EX_025",title:"Hamstring Bridge",description:"Isometric posterior chain hold",tags:"bridge, hamstring",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"hamstring rehab",intensity:"low" },
  { id:"EX_026",title:"Nordic Curl",description:"Eccentric hamstring strength",tags:"curl, hamstring",body_part:"lower",difficulty:"advanced",equipment:"bodyweight",injury_focus:"none",intensity:"high" },
  { id:"EX_027",title:"Calf Raises",description:"Ankle plantarflexion strength",tags:"calf",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"ankle rehab",intensity:"low" },
  { id:"EX_028",title:"Single-Leg Calf Raise",description:"Unilateral calf strength",tags:"calf, unilateral",body_part:"lower",difficulty:"intermediate",equipment:"bodyweight",injury_focus:"ankle rehab",intensity:"medium" },
  { id:"EX_029",title:"Ankle Hops",description:"Reactive ankle stiffness drill",tags:"plyometric",body_part:"lower",difficulty:"intermediate",equipment:"none",injury_focus:"performance",intensity:"medium" },
  { id:"EX_030",title:"Broad Jumps",description:"Horizontal explosive power",tags:"jump, plyometric",body_part:"lower",difficulty:"advanced",equipment:"none",injury_focus:"performance",intensity:"high" },
  { id:"EX_031",title:"Hollow Hold",description:"Anterior core isometric",tags:"core",body_part:"core",difficulty:"beginner",equipment:"bodyweight",injury_focus:"back rehab",intensity:"low" },
  { id:"EX_032",title:"Hanging Knee Raises",description:"Dynamic core lift",tags:"core, hanging",body_part:"core",difficulty:"intermediate",equipment:"bar",injury_focus:"none",intensity:"medium" },
  { id:"EX_033",title:"Russian Twists",description:"Rotational core exercise",tags:"core, rotation",body_part:"core",difficulty:"intermediate",equipment:"bodyweight",injury_focus:"none",intensity:"medium" },
  { id:"EX_034",title:"Cable Rows",description:"Horizontal pulling movement",tags:"pull, upper",body_part:"upper",difficulty:"intermediate",equipment:"cable",injury_focus:"none",intensity:"medium" },
  { id:"EX_035",title:"Pull-Ups",description:"Vertical pulling strength",tags:"pull, bodyweight",body_part:"upper",difficulty:"advanced",equipment:"bar",injury_focus:"none",intensity:"high" },
  { id:"EX_036",title:"Face Pulls",description:"Shoulder stability and posture",tags:"pull, shoulder",body_part:"upper",difficulty:"beginner",equipment:"cable",injury_focus:"shoulder rehab",intensity:"low" },
  { id:"EX_037",title:"YT Raises",description:"Scapular control exercise",tags:"shoulder, rehab",body_part:"upper",difficulty:"beginner",equipment:"dumbbell",injury_focus:"shoulder rehab",intensity:"low" },
  { id:"EX_038",title:"Lateral Raises",description:"Isolated shoulder abduction",tags:"shoulder",body_part:"upper",difficulty:"beginner",equipment:"dumbbell",injury_focus:"none",intensity:"medium" },
  { id:"EX_039",title:"Incline DB Press",description:"Upper chest pressing",tags:"press",body_part:"upper",difficulty:"intermediate",equipment:"dumbbell",injury_focus:"none",intensity:"medium" },
  { id:"EX_040",title:"Dips",description:"Bodyweight pressing movement",tags:"push",body_part:"upper",difficulty:"advanced",equipment:"bodyweight",injury_focus:"none",intensity:"high" },
  { id:"EX_041",title:"Cat-Cow",description:"Spinal mobility drill",tags:"mobility, spine",body_part:"core",difficulty:"beginner",equipment:"bodyweight",injury_focus:"back rehab",intensity:"low" },
  { id:"EX_042",title:"Thread the Needle",description:"Thoracic mobility exercise",tags:"mobility, rotation",body_part:"core",difficulty:"beginner",equipment:"bodyweight",injury_focus:"back rehab",intensity:"low" },
  { id:"EX_043",title:"Hip Flexor Stretch",description:"Stretch for anterior hip",tags:"mobility",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"hip rehab",intensity:"low" },
  { id:"EX_044",title:"Downward Dog",description:"Full body stretch",tags:"mobility",body_part:"full body",difficulty:"beginner",equipment:"bodyweight",injury_focus:"none",intensity:"low" },
  { id:"EX_045",title:"90/90 Hip Stretch",description:"Hip rotation mobility",tags:"mobility",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"hip rehab",intensity:"low" },
  { id:"EX_046",title:"Sled Push",description:"Horizontal force production",tags:"conditioning",body_part:"lower",difficulty:"advanced",equipment:"sled",injury_focus:"performance",intensity:"high" },
  { id:"EX_047",title:"Sled Pull",description:"Posterior chain conditioning",tags:"conditioning",body_part:"lower",difficulty:"advanced",equipment:"sled",injury_focus:"performance",intensity:"high" },
  { id:"EX_048",title:"Battle Ropes",description:"Upper body conditioning",tags:"conditioning",body_part:"full body",difficulty:"intermediate",equipment:"rope",injury_focus:"performance",intensity:"high" },
  { id:"EX_049",title:"Rowing Machine",description:"Endurance conditioning",tags:"endurance",body_part:"full body",difficulty:"beginner",equipment:"machine",injury_focus:"performance",intensity:"medium" },
  { id:"EX_050",title:"Cycling",description:"Endurance cardio",tags:"endurance",body_part:"full body",difficulty:"beginner",equipment:"bike",injury_focus:"performance",intensity:"medium" },
  { id:"EX_051",title:"Glute Bridge",description:"Basic posterior chain activation",tags:"bridge",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"hip rehab",intensity:"low" },
  { id:"EX_052",title:"Single-Leg Bridge",description:"Unilateral glute strength",tags:"bridge",body_part:"lower",difficulty:"intermediate",equipment:"bodyweight",injury_focus:"hip rehab",intensity:"medium" },
  { id:"EX_053",title:"Hip Thrust",description:"Loaded glute strength",tags:"hip thrust",body_part:"lower",difficulty:"advanced",equipment:"barbell",injury_focus:"none",intensity:"high" },
  { id:"EX_054",title:"Kettlebell Swing",description:"Explosive hip hinge",tags:"hinge",body_part:"lower",difficulty:"intermediate",equipment:"kettlebell",injury_focus:"performance",intensity:"high" },
  { id:"EX_055",title:"Good Morning",description:"Posterior chain hinge",tags:"hinge",body_part:"lower",difficulty:"advanced",equipment:"barbell",injury_focus:"none",intensity:"high" },
  { id:"EX_056",title:"Isometric Lunge Hold",description:"Static lunge stability",tags:"lunge",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"knee rehab",intensity:"low" },
  { id:"EX_057",title:"Single-Leg Balance",description:"Balance and proprioception",tags:"balance",body_part:"lower",difficulty:"beginner",equipment:"bodyweight",injury_focus:"ankle rehab",intensity:"low" },
  { id:"EX_058",title:"Perturbation Training",description:"External stability challenges",tags:"stability",body_part:"full body",difficulty:"intermediate",equipment:"band",injury_focus:"knee rehab",intensity:"medium" },
  { id:"EX_059",title:"Agility Ladder Drills",description:"Footwork and coordination",tags:"agility",body_part:"full body",difficulty:"intermediate",equipment:"ladder",injury_focus:"performance",intensity:"medium" },
  { id:"EX_060",title:"Shuttle Runs",description:"Change of direction conditioning",tags:"conditioning",body_part:"full body",difficulty:"advanced",equipment:"none",injury_focus:"performance",intensity:"high" },
];

// ── Retrieval (client-side, mirrors Postgres FTS logic) ─────────────────────
function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

function scoreExercise(ex, tokens) {
  const corpus = [ex.title, ex.description, ex.tags, ex.body_part, ex.injury_focus, ex.difficulty]
    .join(" ").toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (corpus.includes(t)) score += 1;
    if (ex.injury_focus.toLowerCase().includes(t)) score += 2;
    if (ex.body_part.toLowerCase().includes(t)) score += 1;
    if (ex.tags.toLowerCase().includes(t)) score += 1;
  }
  return score;
}

function retrieve(query, topK = 14) {
  const tokens = tokenize(query);
  const scored = EXERCISES
    .map(ex => ({ ...ex, _score: scoreExercise(ex, tokens) }))
    .filter(ex => ex._score > 0)
    .sort((a, b) => b._score - a._score);
  return scored.length ? scored.slice(0, topK) : EXERCISES.slice(0, topK);
}

// ── LLM re-ranking via Anthropic API ───────────────────────────────────────
async function rerankWithLLM(query, candidates, profile) {
  const list = candidates.map((c, i) =>
    `${i + 1}. [${c.id}] ${c.title} | ${c.description} | tags:${c.tags} | body:${c.body_part} | diff:${c.difficulty} | equip:${c.equipment} | injury:${c.injury_focus} | intensity:${c.intensity}`
  ).join("\n");

  const hasProfile = Object.values(profile).some(v => v);
  const profileSection = hasProfile
    ? `\nUser profile: goal=${profile.goal || "any"}, level=${profile.level || "any"}, injuries=${profile.injuries || "none"}, equipment=${profile.equipment || "any"}, intensity=${profile.intensity || "any"}, sport=${profile.sport || "none"}\n`
    : "";

  const prompt = `You are an expert sports science and rehabilitation coach.
User query: "${query}"${profileSection}
Candidates:
${list}

Select the 5 most relevant. Return ONLY a JSON array, no markdown:
[{"id":"EX_XXX","relevance_score":0.0,"rank_reason":"one sentence"}]`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const raw = data.content[0].text.trim().replace(/```json|```/g, "").trim();
  const ranked = JSON.parse(raw);

  const idMap = Object.fromEntries(candidates.map(c => [c.id, c]));
  return ranked
    .filter(r => idMap[r.id])
    .map(r => ({ ...idMap[r.id], relevance_score: r.relevance_score, rank_reason: r.rank_reason }))
    .slice(0, 5);
}

// ── Styles (CSS-in-JS via template literals) ────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,400&family=JetBrains+Mono:wght@400;500&display=swap');

  :root {
    --bg: #080c10; --surface: #0e1520; --surface2: #141d2b;
    --border: #1e2d42; --accent: #00e5ff; --accent2: #ff6b35;
    --text: #d4e4f0; --muted: #5a7a96; --green: #00ff8c;
    --font-d: 'Bebas Neue', sans-serif;
    --font-b: 'DM Sans', sans-serif;
    --font-m: 'JetBrains Mono', monospace;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-b);
    min-height: 100vh;
  }

  .app {
    max-width: 860px;
    margin: 0 auto;
    padding: 0 20px 80px;
    position: relative;
  }

  .grid-bg {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background-image:
      linear-gradient(rgba(0,229,255,.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,229,255,.025) 1px, transparent 1px);
    background-size: 36px 36px;
  }

  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 28px 0 20px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0;
    position: relative; z-index: 1;
  }

  .logo { font-family: var(--font-d); font-size: 2rem; letter-spacing: 4px; color: var(--accent); }
  .tagline { font-family: var(--font-m); font-size: .58rem; color: var(--muted); letter-spacing: 2px; margin-top: 3px; }

  .status { display: flex; align-items: center; gap: 6px; font-family: var(--font-m); font-size: .62rem; color: var(--muted); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

  nav {
    display: flex;
    border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
    position: relative; z-index: 1;
  }

  .tab-btn {
    font-family: var(--font-m); font-size: .62rem; letter-spacing: 2px;
    padding: 12px 20px; cursor: pointer; color: var(--muted);
    background: none; border: none; border-bottom: 2px solid transparent;
    transition: all .15s; margin-bottom: -1px;
  }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

  .view { position: relative; z-index: 1; }

  /* Pipeline */
  .pipeline { display: flex; align-items: center; gap: 0; margin-bottom: 18px; }
  .pipe-step {
    flex: 1; background: var(--surface); border: 1px solid var(--border);
    border-radius: 4px; padding: 8px 10px; text-align: center; transition: border-color .2s;
  }
  .pipe-step.active { border-color: var(--accent); }
  .pipe-label { font-family: var(--font-m); font-size: .55rem; color: var(--accent); letter-spacing: 2px; }
  .pipe-desc { font-size: .68rem; color: var(--muted); margin-top: 3px; }
  .pipe-arrow { color: var(--muted); padding: 0 4px; font-size: .9rem; flex-shrink: 0; }

  /* Query box */
  .q-label { font-family: var(--font-m); font-size: .6rem; letter-spacing: 3px; color: var(--accent); margin-bottom: 8px; }
  .q-box {
    background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
    position: relative; transition: border-color .2s; margin-bottom: 10px;
  }
  .q-box:focus-within { border-color: var(--accent); }
  .q-textarea {
    width: 100%; background: transparent; border: none; outline: none;
    color: var(--text); font-family: var(--font-b); font-size: .9rem;
    padding: 14px 16px 50px; resize: none; min-height: 90px; line-height: 1.6;
  }
  .q-textarea::placeholder { color: var(--muted); }
  .q-actions { position: absolute; bottom: 10px; right: 10px; display: flex; gap: 8px; }

  .btn-primary {
    background: var(--accent); color: var(--bg);
    font-family: var(--font-d); font-size: .9rem; letter-spacing: 1px;
    border: none; padding: 8px 18px; cursor: pointer; border-radius: 2px; transition: all .15s;
  }
  .btn-primary:hover { background: #33ecff; }
  .btn-primary:disabled { background: var(--border); color: var(--muted); cursor: not-allowed; }

  .btn-ghost {
    background: transparent; border: 1px solid var(--border); color: var(--muted);
    font-family: var(--font-m); font-size: .62rem; padding: 6px 12px;
    cursor: pointer; border-radius: 2px; transition: all .15s;
  }
  .btn-ghost:hover { border-color: var(--accent2); color: var(--accent2); }

  /* Chips */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
  .chip {
    font-size: .62rem; font-family: var(--font-m); color: var(--muted);
    background: var(--surface); border: 1px solid var(--border); border-radius: 2px;
    padding: 4px 10px; cursor: pointer; transition: all .15s;
  }
  .chip:hover { color: var(--accent); border-color: var(--accent); }

  /* Loading */
  .loading { text-align: center; padding: 40px 0; }
  .spinner {
    width: 30px; height: 30px; margin: 0 auto 12px;
    border: 2px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .load-txt { font-family: var(--font-m); font-size: .62rem; letter-spacing: 3px; color: var(--muted); }
  .load-sub { font-family: var(--font-m); font-size: .58rem; color: var(--border); margin-top: 6px; }

  /* Meta */
  .meta {
    display: flex; gap: 14px; flex-wrap: wrap;
    font-family: var(--font-m); font-size: .58rem; color: var(--muted); margin-bottom: 14px;
  }
  .meta span { color: var(--accent); }

  /* Result card */
  .result-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
    padding: 16px 18px; margin-bottom: 10px;
    display: grid; grid-template-columns: 40px 1fr auto;
    gap: 12px; align-items: start;
    transition: border-color .15s;
    animation: slideIn .3s ease both;
  }
  .result-card:hover { border-color: rgba(0,229,255,.2); }
  @keyframes slideIn { from { opacity:0; transform: translateY(10px); } }

  .rank { font-family: var(--font-d); font-size: 1.8rem; color: var(--border); line-height: 1; padding-top: 2px; }
  .rank.top { color: var(--accent); }
  .card-title { font-family: var(--font-d); font-size: 1.2rem; letter-spacing: 1px; margin-bottom: 3px; }
  .card-desc { font-size: .78rem; color: var(--muted); margin-bottom: 6px; line-height: 1.5; }
  .card-reason { font-size: .73rem; color: var(--green); font-style: italic; margin-bottom: 8px; line-height: 1.4; }

  .tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { font-family: var(--font-m); font-size: .56rem; padding: 2px 7px; border-radius: 2px; letter-spacing: 1px; }
  .tag-body { background: rgba(0,229,255,.08); color: var(--accent); border: 1px solid rgba(0,229,255,.2); }
  .tag-beg  { background: rgba(0,255,140,.08); color: #00ff8c; border: 1px solid rgba(0,255,140,.25); }
  .tag-int  { background: rgba(0,229,255,.08); color: var(--accent); border: 1px solid rgba(0,229,255,.2); }
  .tag-adv  { background: rgba(255,107,53,.08); color: var(--accent2); border: 1px solid rgba(255,107,53,.2); }
  .tag-equip{ background: rgba(255,255,255,.04); color: var(--muted); border: 1px solid var(--border); }
  .tag-inj  { background: rgba(0,255,140,.06); color: var(--green); border: 1px solid rgba(0,255,140,.2); }

  .score-col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .score-bar { width: 4px; height: 60px; border-radius: 2px; background: var(--border); position: relative; overflow: hidden; }
  .score-fill { position: absolute; bottom: 0; left: 0; right: 0; background: var(--accent); border-radius: 2px; }
  .fav-btn { background: none; border: none; cursor: pointer; font-size: 14px; transition: color .15s; padding: 0; }

  /* Error */
  .error {
    background: rgba(255,107,53,.08); border: 1px solid rgba(255,107,53,.3);
    border-radius: 4px; padding: 12px 16px;
    font-family: var(--font-m); font-size: .75rem; color: var(--accent2);
    margin-bottom: 14px;
  }

  /* Profile */
  .section-title { font-family: var(--font-d); font-size: 1.1rem; letter-spacing: 2px; color: var(--accent); margin-bottom: 14px; }
  .profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
  .field label { display: block; font-family: var(--font-m); font-size: .58rem; letter-spacing: 2px; color: var(--accent); margin-bottom: 5px; }
  .field select, .field input {
    width: 100%; background: var(--surface2); border: 1px solid var(--border);
    color: var(--text); font-family: var(--font-b); font-size: .82rem;
    padding: 7px 10px; border-radius: 2px; outline: none;
  }
  .field select:focus, .field input:focus { border-color: var(--accent); }
  .field select option { background: #0e1520; }
  .saved-badge { font-family: var(--font-m); font-size: .6rem; color: var(--green); }

  /* Favorites */
  .fav-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
    padding: 12px 14px; margin-bottom: 8px;
    display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;
  }
  .fav-title { font-family: var(--font-d); font-size: 1rem; letter-spacing: 1px; }
  .fav-desc { font-size: .73rem; color: var(--muted); margin-top: 2px; }
  .fav-remove { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 13px; padding: 2px 6px; transition: color .15s; }
  .fav-remove:hover { color: var(--accent2); }

  /* History */
  .hist-item {
    background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
    padding: 10px 14px; margin-bottom: 6px; cursor: pointer;
    display: flex; justify-content: space-between; align-items: center; transition: border-color .15s;
  }
  .hist-item:hover { border-color: rgba(0,229,255,.2); }
  .hist-q { font-size: .85rem; }
  .hist-meta { font-family: var(--font-m); font-size: .58rem; color: var(--muted); text-align: right; }
  .hist-count { font-family: var(--font-m); font-size: .58rem; color: var(--accent); margin-top: 2px; }

  .empty { text-align: center; padding: 40px; font-family: var(--font-m); font-size: .65rem; color: var(--border); letter-spacing: 2px; }

  .profile-note {
    margin-top: 18px; padding: 14px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 4px;
  }
  .profile-note p { font-size: .78rem; color: var(--muted); line-height: 1.6; }
`;

// ── Subcomponents ───────────────────────────────────────────────────────────

function DiffTag({ difficulty }) {
  const cls = difficulty === "beginner" ? "tag tag-beg"
    : difficulty === "intermediate" ? "tag tag-int"
    : "tag tag-adv";
  return <span className={cls}>{difficulty}</span>;
}

function ScoreBar({ score }) {
  const pct = Math.round((score || 0) * 100);
  return (
    <div className="score-bar">
      <div className="score-fill" style={{ height: `${pct}%`, transition: "height .6s ease .3s" }} />
    </div>
  );
}

function ResultCard({ ex, index, favorites, onToggleFav }) {
  const isFav = favorites.includes(ex.id);
  return (
    <div className="result-card" style={{ animationDelay: `${index * 0.06}s` }}>
      <div className={`rank ${index === 0 ? "top" : ""}`}>{String(index + 1).padStart(2, "0")}</div>
      <div>
        <div className="card-title">{ex.title}</div>
        <div className="card-desc">{ex.description}</div>
        {ex.rank_reason && <div className="card-reason">↳ {ex.rank_reason}</div>}
        <div className="tags">
          <span className="tag tag-body">{ex.body_part}</span>
          <DiffTag difficulty={ex.difficulty} />
          <span className="tag tag-equip">{ex.equipment}</span>
          {ex.injury_focus && ex.injury_focus !== "none" && (
            <span className="tag tag-inj">{ex.injury_focus}</span>
          )}
        </div>
      </div>
      <div className="score-col">
        <ScoreBar score={ex.relevance_score} />
        <button
          className="fav-btn"
          style={{ color: isFav ? "#ff6b35" : "#5a7a96" }}
          onClick={() => onToggleFav(ex)}
          title={isFav ? "Remove from favorites" : "Save to favorites"}
        >
          {isFav ? "♥" : "♡"}
        </button>
      </div>
    </div>
  );
}

// ── Tab: Search ─────────────────────────────────────────────────────────────
const EXAMPLE_QUERIES = [
  "knee pain, low-impact",
  "explosive drills for a winger",
  "upper body rehab no weights",
  "shoulder stability",
  "beginner core strength",
  "hip rehab after surgery",
];

const PIPE_STEPS = [
  { label: "Query", desc: "User input" },
  { label: "Retrieval", desc: "Keyword + fuzzy" },
  { label: "LLM Re-rank", desc: "Claude scores" },
  { label: "Results", desc: "Top 5" },
];

function SearchView({ profile, onAddHistory, favorites, onToggleFav }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [loadSub, setLoadSub] = useState("");
  const [results, setResults] = useState([]);
  const [retrievalCount, setRetrievalCount] = useState(0);
  const [error, setError] = useState("");
  const [pipeStep, setPipeStep] = useState(0);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResults([]);
    setPipeStep(1);

    try {
      setLoadMsg("Retrieving candidates…");
      setLoadSub("Stage 1 of 2 — keyword + fuzzy search");
      setPipeStep(2);
      const candidates = retrieve(query.trim(), 14);
      setRetrievalCount(candidates.length);
      await new Promise(r => setTimeout(r, 200));

      setLoadMsg("Re-ranking with Claude…");
      setLoadSub("Stage 2 of 2 — LLM scoring");
      setPipeStep(3);
      const ranked = await rerankWithLLM(query.trim(), candidates, profile);
      setPipeStep(4);
      setResults(ranked);
      onAddHistory({ query: query.trim(), count: ranked.length });
    } catch (err) {
      setError(err.message);
      setPipeStep(0);
    } finally {
      setLoading(false);
    }
  }, [query, profile, onAddHistory]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSearch(); }
  };

  return (
    <div className="view">
      {/* Pipeline indicator */}
      <div className="pipeline">
        {PIPE_STEPS.map((s, i) => (
          <div key={i} style={{ display: "contents" }}>
            {i > 0 && <span className="pipe-arrow">→</span>}
            <div className={`pipe-step ${pipeStep === i + 1 ? "active" : ""}`}>
              <div className="pipe-label">{s.label}</div>
              <div className="pipe-desc">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="q-label">// describe your training need</div>
      <div className="q-box">
        <textarea
          className="q-textarea"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="e.g. 'I have knee pain and need low-impact exercises'"
          rows={3}
        />
        <div className="q-actions">
          <button className="btn-ghost" onClick={() => { setQuery(""); setResults([]); setError(""); setPipeStep(0); }}>
            CLEAR
          </button>
          <button className="btn-primary" onClick={doSearch} disabled={loading}>
            SEARCH
          </button>
        </div>
      </div>

      <div className="chips">
        {EXAMPLE_QUERIES.map(q => (
          <span key={q} className="chip" onClick={() => setQuery(q)}>{q}</span>
        ))}
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <div className="load-txt">{loadMsg}</div>
          <div className="load-sub">{loadSub}</div>
        </div>
      )}

      {error && <div className="error">Error: {error}</div>}

      {results.length > 0 && !loading && (
        <>
          <div className="meta">
            <span>RETRIEVED <span>{retrievalCount}</span> CANDIDATES</span>
            <span>→ LLM RANKED TO <span>{results.length}</span></span>
            <span>MODEL <span>CLAUDE</span></span>
          </div>
          {results.map((ex, i) => (
            <ResultCard key={ex.id} ex={ex} index={i} favorites={favorites} onToggleFav={onToggleFav} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Tab: Profile ────────────────────────────────────────────────────────────
function ProfileView({ profile, setProfile }) {
  const [saved, setSaved] = useState(false);
  const update = (k, v) => setProfile(p => ({ ...p, [k]: v }));
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div className="view">
      <div className="section-title">USER PROFILE</div>
      <div className="q-label" style={{ marginBottom: 14 }}>Personalize your recommendations</div>
      <div className="profile-grid">
        <div className="field">
          <label>Primary Goal</label>
          <select value={profile.goal} onChange={e => update("goal", e.target.value)}>
            <option value="">— any —</option>
            <option value="rehab">Rehabilitation</option>
            <option value="strength">Strength</option>
            <option value="endurance">Endurance</option>
            <option value="performance">Athletic Performance</option>
            <option value="mobility">Mobility</option>
          </select>
        </div>
        <div className="field">
          <label>Experience Level</label>
          <select value={profile.level} onChange={e => update("level", e.target.value)}>
            <option value="">— any —</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
        <div className="field">
          <label>Injuries / Constraints</label>
          <input value={profile.injuries} onChange={e => update("injuries", e.target.value)} placeholder="e.g. ACL tear, no jumping" />
        </div>
        <div className="field">
          <label>Available Equipment</label>
          <input value={profile.equipment} onChange={e => update("equipment", e.target.value)} placeholder="e.g. bodyweight, dumbbells" />
        </div>
        <div className="field">
          <label>Preferred Intensity</label>
          <select value={profile.intensity} onChange={e => update("intensity", e.target.value)}>
            <option value="">— any —</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="field">
          <label>Sport / Position</label>
          <input value={profile.sport} onChange={e => update("sport", e.target.value)} placeholder="e.g. winger, centre-back" />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn-primary" onClick={save}>SAVE PROFILE</button>
        {saved && <span className="saved-badge">✓ SAVED</span>}
      </div>
      <div className="profile-note">
        <div className="q-label" style={{ marginBottom: 6 }}>How profile affects recommendations</div>
        <p>Your goal and injury data are injected into the LLM re-ranking prompt so Claude reasons about your specific context — not just keyword matches. Equipment constraints act as hard filters during retrieval. Intensity preference boosts matching exercises in scoring.</p>
      </div>
    </div>
  );
}

// ── Tab: Favorites ──────────────────────────────────────────────────────────
function FavoritesView({ favorites, allExercises, onRemove }) {
  const favExercises = allExercises.filter(e => favorites.includes(e.id));
  if (!favExercises.length) return <div className="view"><div className="empty">NO SAVED EXERCISES YET</div></div>;

  return (
    <div className="view">
      <div className="section-title">SAVED EXERCISES</div>
      {favExercises.map(ex => (
        <div key={ex.id} className="fav-card">
          <div>
            <div className="fav-title">{ex.title}</div>
            <div className="fav-desc">{ex.description}</div>
            <div className="tags" style={{ marginTop: 6 }}>
              <span className="tag tag-body">{ex.body_part}</span>
              <DiffTag difficulty={ex.difficulty} />
            </div>
          </div>
          <button className="fav-remove" onClick={() => onRemove(ex.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Tab: History ────────────────────────────────────────────────────────────
function HistoryView({ history, onReplay }) {
  if (!history.length) return <div className="view"><div className="empty">NO SEARCHES YET</div></div>;

  return (
    <div className="view">
      <div className="section-title">SEARCH HISTORY</div>
      {[...history].reverse().map((h, i) => (
        <div key={i} className="hist-item" onClick={() => onReplay(h.query)}>
          <div>
            <div className="hist-q">{h.query}</div>
            <div className="hist-count">{h.count} results</div>
          </div>
          <div className="hist-meta">{h.time}</div>
        </div>
      ))}
    </div>
  );
}

// ── Root App ────────────────────────────────────────────────────────────────
const TABS = ["search", "profile", "favorites", "history"];

export default function App() {
  const [tab, setTab] = useState("search");
  const [profile, setProfile] = useState({ goal: "", level: "", injuries: "", equipment: "", intensity: "", sport: "" });
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [replayQuery, setReplayQuery] = useState(null);

  const toggleFav = (ex) => {
    setFavorites(prev =>
      prev.includes(ex.id) ? prev.filter(id => id !== ex.id) : [...prev, ex.id]
    );
  };

  const addHistory = ({ query, count }) => {
    const now = new Date();
    setHistory(prev => {
      const updated = [...prev, { query, count, time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }];
      return updated.slice(-20);
    });
  };

  const handleReplay = (q) => {
    setReplayQuery(q);
    setTab("search");
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="grid-bg" />
      <div className="app">
        <header>
          <div>
            <div className="logo">APOLLO</div>
            <div className="tagline">AI-POWERED TRAINING INTELLIGENCE</div>
          </div>
          <div className="status"><div className="dot" />LLM ACTIVE</div>
        </header>

        <nav>
          {TABS.map(t => (
            <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </nav>

        {tab === "search" && (
          <SearchView
            profile={profile}
            onAddHistory={addHistory}
            favorites={favorites}
            onToggleFav={toggleFav}
            replayQuery={replayQuery}
          />
        )}
        {tab === "profile" && <ProfileView profile={profile} setProfile={setProfile} />}
        {tab === "favorites" && (
          <FavoritesView favorites={favorites} allExercises={EXERCISES} onRemove={id => setFavorites(prev => prev.filter(f => f !== id))} />
        )}
        {tab === "history" && <HistoryView history={history} onReplay={handleReplay} />}
      </div>
    </>
  );
}
