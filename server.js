// server.js
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (our frontend) from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Simple in-memory cache to avoid hammering the FPL API
let cachedBootstrap = null;
let cacheTimestamp = 0;
const CACHE_MS = 60 * 1000; // 1 minute cache

// Fetch FPL bootstrap-static (all players, teams, etc.)
async function getBootstrapStatic() {
  const now = Date.now();
  if (cachedBootstrap && now - cacheTimestamp < CACHE_MS) {
    return cachedBootstrap;
  }

  const res = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!res.ok) {
    throw new Error(`FPL API error: ${res.status}`);
  }

  const data = await res.json();
  cachedBootstrap = data;
  cacheTimestamp = now;
  return data;
}

// Map raw FPL player data into a friendlier shape
function mapPlayer(rawPlayer, teams, elementsTypes) {
  const team = teams.find(t => t.id === rawPlayer.team);
  const type = elementsTypes.find(et => et.id === rawPlayer.element_type);

  return {
    id: rawPlayer.id,
    web_name: rawPlayer.web_name,
    first_name: rawPlayer.first_name,
    second_name: rawPlayer.second_name,
    team_id: rawPlayer.team,                          // <--- NEW: numeric team id
    team: team ? team.name : "Unknown",
    position: type ? type.singular_name_short : "UNK",
    stats: {
      now_cost: rawPlayer.now_cost,                 // e.g. 55 = £5.5m
      total_points: rawPlayer.total_points,
      minutes: rawPlayer.minutes,
      goals_scored: rawPlayer.goals_scored,
      assists: rawPlayer.assists,
      clean_sheets: rawPlayer.clean_sheets,
      goals_conceded: rawPlayer.goals_conceded,
      own_goals: rawPlayer.own_goals,
      penalties_saved: rawPlayer.penalties_saved,
      penalties_missed: rawPlayer.penalties_missed,
      yellow_cards: rawPlayer.yellow_cards,
      red_cards: rawPlayer.red_cards,
      saves: rawPlayer.saves,
      bonus: rawPlayer.bonus,
      bps: rawPlayer.bps,
      influence: rawPlayer.influence,
      creativity: rawPlayer.creativity,
      threat: rawPlayer.threat,
      ict_index: rawPlayer.ict_index,
      form: rawPlayer.form,
      points_per_game: rawPlayer.points_per_game,
      selected_by_percent: rawPlayer.selected_by_percent,
      ep_next: rawPlayer.ep_next,
      ep_this: rawPlayer.ep_this,

      // NEW: underlying expected stats (xG / xA / xGI / xGC)
      expected_goals: rawPlayer.expected_goals,
      expected_assists: rawPlayer.expected_assists,
      expected_goal_involvements: rawPlayer.expected_goal_involvements,
      expected_goals_conceded: rawPlayer.expected_goals_conceded
    }
  };
}

// GET /api/players -> list of all players with stats + teams
app.get("/api/players", async (req, res) => {
  try {
    const data = await getBootstrapStatic();
    const teams = data.teams || [];
    const elementTypes = data.element_types || [];

    const players = (data.elements || []).map(p =>
      mapPlayer(p, teams, elementTypes)
    );

    // Simple team list for the frontend
    const simpleTeams = teams.map(t => ({
      id: t.id,
      name: t.name
    }));

    res.json({ players, teams: simpleTeams });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch FPL data" });
  }
});

// Optional: GET /api/player/:id -> single player details
app.get("/api/player/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = await getBootstrapStatic();
    const teams = data.teams || [];
    const elementTypes = data.element_types || [];
    const playerRaw = (data.elements || []).find(p => p.id === id);

    if (!playerRaw) {
      return res.status(404).json({ error: "Player not found" });
    }

    const player = mapPlayer(playerRaw, teams, elementTypes);
    res.json(player);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch player" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

