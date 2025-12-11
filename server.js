// server.js
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (our frontend) from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Simple in-memory cache for bootstrap-static
let cachedBootstrap = null;
let bootstrapTimestamp = 0;
const BOOTSTRAP_CACHE_MS = 60 * 1000; // 1 minute

// Simple in-memory cache for fixtures
let cachedFixtures = null;
let fixturesTimestamp = 0;
const FIXTURES_CACHE_MS = 60 * 1000; // 1 minute

// Fetch FPL bootstrap-static (all players, teams, etc.)
async function getBootstrapStatic() {
  const now = Date.now();
  if (cachedBootstrap && now - bootstrapTimestamp < BOOTSTRAP_CACHE_MS) {
    return cachedBootstrap;
  }

  const res = await fetch(
    "https://fantasy.premierleague.com/api/bootstrap-static/"
  );
  if (!res.ok) {
    throw new Error(`FPL bootstrap API error: ${res.status}`);
  }

  const data = await res.json();
  cachedBootstrap = data;
  bootstrapTimestamp = now;
  return data;
}

// Fetch upcoming fixtures only
async function getFixtures() {
  const now = Date.now();
  if (cachedFixtures && now - fixturesTimestamp < FIXTURES_CACHE_MS) {
    return cachedFixtures;
  }

  const res = await fetch(
    "https://fantasy.premierleague.com/api/fixtures/?future=1"
  );
  if (!res.ok) {
    throw new Error(`FPL fixtures API error: ${res.status}`);
  }

  const data = await res.json();
  cachedFixtures = data;
  fixturesTimestamp = now;
  return data;
}

// Map raw FPL player data into a friendlier shape
function mapPlayer(rawPlayer, teams, elementsTypes) {
  const team = teams.find((t) => t.id === rawPlayer.team);
  const type = elementsTypes.find((et) => et.id === rawPlayer.element_type);

  return {
    id: rawPlayer.id,
    web_name: rawPlayer.web_name,
    first_name: rawPlayer.first_name,
    second_name: rawPlayer.second_name,
    team_id: rawPlayer.team,
    team: team ? team.name : "Unknown",
    position: type ? type.singular_name_short : "UNK",
    stats: {
      now_cost: rawPlayer.now_cost, // e.g. 55 = £5.5m
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

      // expected stats from FPL
      expected_goals: rawPlayer.expected_goals,
      expected_assists: rawPlayer.expected_assists,
      expected_goal_involvements: rawPlayer.expected_goal_involvements,
      expected_goals_conceded: rawPlayer.expected_goals_conceded,
    },
  };
}

// GET /api/players -> list of all players with stats + teams
app.get("/api/players", async (req, res) => {
  try {
    const data = await getBootstrapStatic();
    const teams = data.teams || [];
    const elementTypes = data.element_types || [];

    const players = (data.elements || []).map((p) =>
      mapPlayer(p, teams, elementTypes)
    );

    const simpleTeams = teams.map((t) => ({
      id: t.id,
      name: t.name,
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
    const playerRaw = (data.elements || []).find((p) => p.id === id);

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

// NEW: GET /api/team-fixtures/:teamId -> next fixtures with difficulty/strength
app.get("/api/team-fixtures/:teamId", async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    if (!teamId) {
      return res.status(400).json({ error: "Invalid team id" });
    }

    const [bootstrap, fixtures] = await Promise.all([
      getBootstrapStatic(),
      getFixtures(),
    ]);

    const teams = bootstrap.teams || [];
    const team = teams.find((t) => t.id === teamId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    const teamMap = new Map();
    teams.forEach((t) => teamMap.set(t.id, t));

    const teamFixtures = fixtures
      .filter((f) => f.team_h === teamId || f.team_a === teamId)
      .sort((a, b) => {
        const evA = a.event || 999;
        const evB = b.event || 999;
        return evA - evB;
      })
      .slice(0, 5) // next 5 fixtures
      .map((f) => {
        const isHome = f.team_h === teamId;
        const opponentId = isHome ? f.team_a : f.team_h;
        const opponentTeam = teamMap.get(opponentId);

        const opponentName = opponentTeam ? opponentTeam.name : "Unknown";
        const gw = f.event;
        const difficulty = isHome ? f.team_h_difficulty : f.team_a_difficulty;

        const opponentDefStrength = opponentTeam
          ? isHome
            ? opponentTeam.strength_defence_away
            : opponentTeam.strength_defence_home
          : null;

        const opponentAttStrength = opponentTeam
          ? isHome
            ? opponentTeam.strength_attack_away
            : opponentTeam.strength_attack_home
          : null;

        return {
          gw,
          is_home: isHome,
          opponent_team_id: opponentId,
          opponent_name: opponentName,
          difficulty,
          opponent_def_strength: opponentDefStrength,
          opponent_att_strength: opponentAttStrength,
          kickoff_time: f.kickoff_time,
        };
      });

    res.json({
      team_id: teamId,
      team_name: team.name,
      fixtures: teamFixtures,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch team fixtures" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
