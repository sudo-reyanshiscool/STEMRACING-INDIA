// Reads the files that come out of the STEM Racing India platform, for the graphics control page.
//   SRIEvent.heats(json)                 the platform's "Heats" or "Heats-Graphics" export -> teams and the race order
//   SRIEvent.results(json, awards, teams) a results file -> nominees and winners per award
// Nothing here touches the page, so it can be checked on its own (see tools/check-event-data.cjs).
(function (root) {
  // Six knockout rounds, as the platform runs them. Change here if an event uses a smaller bracket.
  const ROUNDS = ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];
  const teamId = t => t ? String(t.number || t.id || "") : "";
  const plain = s => String(s == null ? "" : s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

  function heats(json) {
    if (!json || (json.kind !== "heats" && json.kind !== "heat-matchups")) throw new Error("This is not a heats file from the platform.");
    const teams = {}, races = [], extra = {fastest: [], champion: "", runs: []};
    const see = t => { const id = teamId(t); if (id && !teams[id]) teams[id] = {id, name: t.name || "Team " + id, school: t.school || ""}; return id; };
    (json.teams || []).forEach(see);   // the platform's live feed lists every entered team, raced or not
    if (json.kind === "heat-matchups") {
      (json.matchups || []).forEach(m => races.push({phase: m.phase, round: m.round, match: m.match, a: see(m.teamA), b: m.teamB ? see(m.teamB) : "",
        codes: (m.heats || []).slice(), done: false, winner: "", sure: false}));
    } else {
      // the same grouping the platform uses for its graphics export: lane swaps and reruns belong to one pairing
      const by = {}, list = (json.heats || []).slice().sort((x, y) => x.number - y.number);
      list.forEach(h => { const a = see(h.lanes[0].team), b = see(h.lanes[1].team);
        const key = h.phase === "knockout" && h.round != null ? "k:" + h.round + ":" + h.match : h.phase + ":" + [a, b].sort().join("|");
        let r = by[key]; if (!r) { r = by[key] = {phase: h.phase, round: h.round, match: h.match, a, b: a === b ? "" : b, codes: [], heats: []}; races.push(r); }
        if (!r.codes.includes(h.code)) r.codes.push(h.code); r.heats.push(h); });
      races.forEach(r => { r.done = r.heats.every(h => h.lanes.every(l => l.status !== "pending")); r.winner = ""; r.sure = false; });
      // knockout: a team that appears in the next round has certainly won. Otherwise the latest attempt's raw result is the likely
      // winner (the platform adds inspection penalties before it confirms one, and those are not in the file).
      const ko = races.filter(r => r.phase === "knockout" && r.round != null);
      ko.forEach(r => { const next = ko.find(n => n.round === r.round + 1 && n.match === Math.ceil(r.match / 2));
        const through = next ? [r.a, r.b].find(id => id && (id === next.a || id === next.b)) : "";
        if (through) { r.winner = through; r.sure = true; r.done = true; return; }
        const last = r.heats[r.heats.length - 1], w = last && r.done ? last.winnerTeamId : null;
        const lane = w ? last.lanes.find(l => l.team.id === w) : null; if (lane) r.winner = teamId(lane.team); });
      races.forEach(r => delete r.heats);
      // every run with its timings, for the car analysis
      list.forEach(h => h.lanes.forEach((l, i) => extra.runs.push({n: h.number, code: h.code, phase: h.phase, lane: l.lane, team: teamId(l.team), car: l.car,
        status: l.status, total: l.totalMs, reaction: l.reactionMs, opp: teamId(h.lanes[1 - i].team)})));
      // fastest cars: each team's best finished time in the reaction races, as the platform ranks them (raw times)
      const best = {};
      list.filter(h => h.phase === "reaction").forEach(h => h.lanes.forEach(l => { const id = teamId(l.team);
        if (l.status === "finished" && typeof l.totalMs === "number" && (best[id] == null || l.totalMs < best[id])) best[id] = l.totalMs; }));
      extra.fastest = Object.keys(best).sort((x, y) => best[x] - best[y] || x.localeCompare(y)).slice(0, 3);
      const final = ko.find(r => r.round === ROUNDS.length); extra.champion = final && final.winner ? final.winner : "";
    }
    races.forEach((r, k) => { r.order = k + 1; });
    const ids = Object.keys(teams).sort((x, y) => x.localeCompare(y, undefined, {numeric: true}));
    return {name: (json.event && json.event.name) || "", generatedAt: json.generatedAt || "", full: json.kind === "heats", teams: ids.map(id => teams[id]), races, fastest: extra.fastest, champion: extra.champion, runs: extra.runs};
  }
  // "Round of 16", and what winning that round puts a team into ("the Quarter-finals"; nothing after the final)
  const roundName = r => ROUNDS[r - 1] || "Round " + r;
  const nextRound = r => r >= ROUNDS.length ? "" : "the " + ROUNDS[r];

  // Results files. The platform's three downloads are read as they come:
  //   Awards.json       (kind "awards")       the winner of each award
  //   Nominations.json  (kind "nominations")  the three most-nominated teams for each award
  //   Results.json      (kind "results")      the standings: first, second and third fill the podium
  // A hand-made file works too: {"awards": {"fastest-car": {"winner": "001", "nominees": ["001","004","009"]}, ...}}
  // or a list [{"award": "Fastest Car Award", "winner": ..., "nominees": [...]}]. Awards go by id or name; teams by number, platform id or name.
  // Returns only what the file says: {winners, nominees, loaded, problems, what}. Awards it does not mention are left alone.
  function results(json, awards, teams) {
    const awardKey = s => plain(s).replace(/award$/, "");
    const findAward = k => awards.find(a => a.id === k) || awards.find(a => awardKey(a.id) === awardKey(k) || awardKey(a.name) === awardKey(k));
    const findTeam = v => { if (v && typeof v === "object") v = v.number || v.name || v.id; if (v == null || v === "") return null;
      const s = String(v), n = s.replace(/^team-/i, "");
      return teams.find(t => t.id === s || t.id === n) || teams.find(t => /^\d+$/.test(n) && +t.id === +n && /^\d+$/.test(t.id)) || teams.find(t => plain(t.name) === plain(s)) || false; };
    const out = {winners: {}, nominees: {}, loaded: 0, problems: [], what: "results"};
    const kind = json && json.kind;
    if (kind === "results") { out.what = "standings" + (json.released === false ? " (not released yet)" : "");
      const rows = (json.standings || []).slice().sort((x, y) => x.rank - y.rank);
      awards.filter(a => a.place).forEach(a => { const at = rows.filter(r => r.rank === a.place);
        if (at.length !== 1 || at[0].tied) { out.problems.push({award: a.name, what: at.length ? "tie" : "no-rank"}); return; }
        const t = findTeam(at[0].team); if (!t) { out.problems.push({award: a.name, what: "winner"}); return; }
        out.winners[a.id] = t.id; out.loaded++; });
      return out; }
    if (kind === "nominations") { out.what = "nominations";
      (json.awards || []).forEach(x => { if (!x.nominees || !x.nominees.length) return;
        const a = findAward(x.id) || findAward(x.name); if (!a) { out.problems.push({award: x.name || x.id, what: "award"}); return; }
        if (a.nominees === false) return;
        const ns = []; x.nominees.slice(0, 3).forEach(n => { const t = findTeam(n.team); if (t === false || t === null) out.problems.push({award: a.name, what: "nominee"}); else if (!ns.includes(t.id)) ns.push(t.id); });
        // a tie across the cut-off means the file cannot say which three go on screen
        if (x.nominees[3] && x.nominees[3].nominations === x.nominees[2].nominations) out.problems.push({award: a.name, what: "nominee-tie"});
        out.nominees[a.id] = ns; out.loaded++; });
      return out; }
    if (kind === "awards") { out.what = "award winners" + (json.confirmed === false ? " (not confirmed yet)" : "");
      (json.awards || []).forEach(x => { const a = findAward(x.title) || findAward(x.id); if (!a) { out.problems.push({award: x.title || x.id, what: "award"}); return; }
        const t = findTeam(x.team); if (!t) { out.problems.push({award: a.name, what: "winner"}); return; }
        out.winners[a.id] = t.id; out.loaded++; });
      return out; }
    const src = json && (json.awards || json.results || json), rows = [];
    if (Array.isArray(src)) src.forEach(x => x && rows.push([x.award || x.id || x.name, x]));
    else if (src && typeof src === "object") Object.keys(src).forEach(k => rows.push([k, src[k]]));
    if (!rows.length) throw new Error("No awards were found in this file.");
    rows.forEach(([k, v]) => { const a = findAward(k); if (!a) { out.problems.push({award: String(k), what: "award"}); return; }
      if (typeof v === "string" || typeof v === "number") v = {winner: v};
      v = v || {}; out.loaded++;
      const w = findTeam(v.winner != null ? v.winner : v.team);
      if (w === false) out.problems.push({award: a.name, what: "winner"}); else if (w) out.winners[a.id] = w.id;
      if (a.nominees !== false && Array.isArray(v.nominees)) { const ns = []; v.nominees.forEach(x => { const t = findTeam(x);
          if (t === false) out.problems.push({award: a.name, what: "nominee"}); else if (t && !ns.includes(t.id)) ns.push(t.id); });
        out.nominees[a.id] = ns.slice(0, 3); } });
    return out;
  }
  // The platform's Cars file: each car's size as measured at scrutineering -> {teams: {"014": {A: {w, h, g, wb}, B: {...}}}, count}
  function cars(json) {
    if (!json || json.kind !== "cars" || !Array.isArray(json.cars)) throw new Error("This is not a cars file from the platform.");
    const teams = {}; let count = 0, num = v => typeof v === "number" && isFinite(v) ? v : null;
    json.cars.forEach(c => { const id = teamId(c.team); if (!id || (c.car !== "A" && c.car !== "B")) return;
      const d = {w: num(c.widthMm), h: num(c.heightMm), g: num(c.weightG), wb: num(c.wheelbaseMm), final: c.status === "submitted"};
      if (d.w == null && d.h == null && d.g == null) return; (teams[id] = teams[id] || {})[c.car] = d; count++; });
    return {teams, count, generatedAt: json.generatedAt || ""};
  }
  root.SRIEvent = {heats, results, cars, roundName, nextRound, ROUNDS};
})(typeof window !== "undefined" ? window : globalThis);
