// The Rekt Runner — addictive pack
// Adds:
// - Daily streak bonus (consecutive days played) + bonus credits
// - Combo multiplier (no-hit streak increases multiplier & PnL gain)
// - Shop (persistent): start with +1 life and/or starting shield (costs credits)
// - Leaderboard: local top runs + per-Farcaster user (fid) best, stored locally
// Keeps:
// - Lives, life pickup, combo pickup (speed+shield), responsive triple jump

export function initGame({ toast, fcUser }) {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const hudPnl = document.getElementById("pnl");
  const hudSpd = document.getElementById("spd");
  const hudLives = document.getElementById("lives");
  const hudShield = document.getElementById("shield");
  const hudStreak = document.getElementById("streak");
  const hudMult = document.getElementById("mult");

  const shopBtn = document.getElementById("shopBtn");
  const lbBtn = document.getElementById("lbBtn");
  const shopModal = document.getElementById("shopModal");
  const lbModal = document.getElementById("lbModal");

  // --------- Safe user identity (local leaderboard) ----------
  const user = {
    fid: (fcUser && (fcUser.fid ?? fcUser.id)) ? String(fcUser.fid ?? fcUser.id) : "guest",
    username: (fcUser && (fcUser.username || fcUser.displayName || fcUser.name)) ? String(fcUser.username || fcUser.displayName || fcUser.name) : null
  };

  // For guests, keep a stable nickname
  const LS = {
    credits: "rr_credits_v1",
    streak: "rr_streak_v1",
    lastDay: "rr_lastDay_v1",
    shop: "rr_shop_v1",
    runs: "rr_runs_v1",          // array of top runs
    userBest: "rr_userBest_v1",  // map fid->best
    nick: "rr_nick_v1"
  };

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const da = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${da}`;
  }

  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (!v) return fallback;
      return JSON.parse(v);
    } catch { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  function loadNum(key, fallback=0) {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  }
  function saveNum(key, val) {
    try { localStorage.setItem(key, String(val)); } catch {}
  }

  // Initialize nickname if guest
  if (user.fid === "guest") {
    const existing = localStorage.getItem(LS.nick);
    if (existing) user.username = existing;
    else {
      const nick = "Guest" + Math.floor(Math.random()*9000+1000);
      user.username = nick;
      try { localStorage.setItem(LS.nick, nick); } catch {}
    }
  }

  // --------- Daily streak ----------
  function computeStreak() {
    const lastDay = localStorage.getItem(LS.lastDay);
    const streak = loadNum(LS.streak, 0);
    const today = todayKey();
    if (!lastDay) {
      saveNum(LS.streak, 1);
      localStorage.setItem(LS.lastDay, today);
      return 1;
    }
    if (lastDay === today) return Math.max(1, streak || 1);

    // compare day difference (UTC-safe enough for daily)
    const last = new Date(lastDay + "T00:00:00");
    const cur = new Date(today + "T00:00:00");
    const diffDays = Math.round((cur - last) / (24*3600*1000));
    if (diffDays === 1) {
      const ns = (streak || 1) + 1;
      saveNum(LS.streak, ns);
      localStorage.setItem(LS.lastDay, today);
      return ns;
    }
    // broken streak
    saveNum(LS.streak, 1);
    localStorage.setItem(LS.lastDay, today);
    return 1;
  }

  const dailyStreak = computeStreak();

  // --------- Credits economy ----------
  // Credits are earned each run. Used in shop.
  function credits() { return loadNum(LS.credits, 0); }
  function addCredits(n) { saveNum(LS.credits, Math.max(0, credits() + n)); }
  function spendCredits(n) {
    const c = credits();
    if (c < n) return false;
    saveNum(LS.credits, c - n);
    return true;
  }

  // Daily login bonus credits (once per day)
  // We track by lastDay already. If lastDay changed, streak compute updated.
  // Give a small bonus when opening app and it's a new day.
  const lastBonusKey = "rr_lastBonusDay_v1";
  const today = todayKey();
  const lastBonus = localStorage.getItem(lastBonusKey);
  if (lastBonus !== today) {
    const bonus = Math.min(25, 5 + dailyStreak * 2); // grows slowly, caps
    addCredits(bonus);
    localStorage.setItem(lastBonusKey, today);
    toast?.(`Daily bonus +${bonus} CR (streak ${dailyStreak})`);
  }

  // --------- Shop persistent toggles ----------
  const defaultShop = { extraLife: false, startShield: false };
  const shop = Object.assign({}, defaultShop, loadJSON(LS.shop, defaultShop));

  function saveShop() { saveJSON(LS.shop, shop); }

  // --------- Resize ----------
  const DPR = () => Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  function resize() {
    const dpr = DPR();
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener("resize", resize, { passive: true });

  // --------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function formatPnL(v) {
    const sign = v >= 0 ? "+" : "-";
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  }

  // --------- State ----------
  const state = {
    running: true,
    t: 0,
    score: 0,
    worldX: 0,
    camX: 0,

    baseSpeed: 260,
    speedMul: 1.0,
    boostT: 0,

    difficulty: 0,

    crash: { active: false, until: 0 },

    // input
    jumpBufferT: 0,
    coyoteT: 0,

    // triple jump
    jumpsLeft: 3,

    // lives / shield
    lives: 3,
    maxLives: 7,
    shield: { active: false, until: 0, hitsLeft: 0 },
    hitIFrameT: 0,

    // combo multiplier (no-hit streak)
    noHit: 0,          // counts seconds survived without hit
    mult: 1.0,         // score multiplier
    multTarget: 1.0,   // smooth interpolation

    // player
    p: { x: 130, y: 0, vy: 0, w: 18, h: 18, grounded: false },

    // terrain points
    floor: [],

    // entities
    traps: [],
    boosts: [],
    comboPickups: [],
    lifePickups: [],

    // spawns
    nextTrapAtX: 0,
    nextBoostAtX: 0,
    nextComboAtX: 0,
    nextLifeAtX: 0,
  };

  // --------- Terrain ----------
  const FLOOR_STEP = 44;
  function seedFloor() {
    state.floor.length = 0;
    const w = window.innerWidth;
    const endX = w + 4 * FLOOR_STEP;
    let y = window.innerHeight * 0.70;
    for (let x = 0; x <= endX; x += FLOOR_STEP) {
      y = nextFloorY(y);
      state.floor.push({ x, y });
    }
  }
  function nextFloorY(prevY) {
    const base = prevY + (Math.random() * 2 - 1) * 10;
    const yMin = 140;
    const yMax = window.innerHeight - 140;
    return clamp(base, yMin, yMax);
  }
  function ensureFloorCoverage() {
    const w = window.innerWidth;
    const needUntil = state.camX + w + 6 * FLOOR_STEP;
    while (state.floor.length && state.floor[state.floor.length - 1].x < needUntil) {
      const last = state.floor[state.floor.length - 1];
      let y = nextFloorY(last.y);
      const now = performance.now();
      if (state.crash.active && now < state.crash.until) {
        y = clamp(y + 26, 140, window.innerHeight - 140);
      } else if (state.crash.active && now >= state.crash.until) {
        state.crash.active = false;
      }
      state.floor.push({ x: last.x + FLOOR_STEP, y });
    }
    while (state.floor.length > 2 && state.floor[1].x < state.camX - 3 * FLOOR_STEP) {
      state.floor.shift();
    }
  }
  function floorYAt(worldX) {
    const pts = state.floor;
    if (pts.length < 2) return window.innerHeight * 0.7;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (worldX >= a.x && worldX <= b.x) {
        const t = (worldX - a.x) / (b.x - a.x);
        return a.y * (1 - t) + b.y * t;
      }
    }
    return pts[pts.length - 1].y;
  }

  // --------- Spawns ----------
  function scheduleSpawns() {
    const px = state.worldX;

    if (state.nextTrapAtX <= px) {
      const minGap = 260;
      const maxGap = 540;
      const gap = clamp(maxGap - state.difficulty * 12, minGap, maxGap) + Math.random() * 90;
      state.nextTrapAtX = px + gap;
      spawnTrap(state.nextTrapAtX);
    }

    if (state.nextBoostAtX <= px) {
      const minGap = 620;
      const maxGap = 1080;
      const gap = clamp(maxGap - state.difficulty * 10, minGap, maxGap) + Math.random() * 140;
      state.nextBoostAtX = px + gap;
      spawnBoost(state.nextBoostAtX);
    }

    if (state.nextComboAtX <= px) {
      const minGap = 900;
      const maxGap = 1500;
      const gap = clamp(maxGap - state.difficulty * 12, minGap, maxGap) + Math.random() * 160;
      state.nextComboAtX = px + gap;
      spawnCombo(state.nextComboAtX);
    }

    if (state.nextLifeAtX <= px) {
      const minGap = 1200;
      const maxGap = 2200;
      const gap = clamp(maxGap - state.difficulty * 10, minGap, maxGap) + Math.random() * 220;
      state.nextLifeAtX = px + gap;
      spawnLife(state.nextLifeAtX);
    }
  }

  function spawnTrap(x) {
    const baseY = floorYAt(x);
    const r = Math.random();
    if (r < 0.60) state.traps.push({ kind: "trap", x, y: baseY - 18, w: 18, h: 18 });
    else if (r < 0.90) state.traps.push({ kind: "trapTall", x, y: baseY - 36, w: 18, h: 36 });
    else state.traps.push({ kind: "crashPillar", x, y: baseY - 70, w: 12, h: 70 });
  }
  function spawnBoost(x) {
    const baseY = floorYAt(x);
    const h = 54 + Math.random() * 46;
    state.boosts.push({ x, y: baseY - h, w: 12, h });
  }
  function emphasizesY(x) {
    return floorYAt(x) - (42 + Math.random() * 10);
  }
  function spawnCombo(x) {
    const y = emphasizesY(x) - 18;
    state.comboPickups.push({ x, y, w: 18, h: 18 });
  }
  function spawnLife(x) {
    const y = emphasizesY(x) - 18;
    state.lifePickups.push({ x, y, w: 18, h: 18 });
  }
  function maybeCrash() {
    if (state.crash.active) return;
    const p = 0.003 + state.difficulty * 0.00003;
    if (Math.random() < p) {
      state.crash.active = true;
      state.crash.until = performance.now() + 1200 + Math.random() * 900;
      toast?.("RED CANDLE: floor dropping!");
    }
  }

  // --------- Input ----------
  function requestJump() { state.jumpBufferT = 0.14; }
  function onPointerDown(e) {
    e.preventDefault?.();
    if (!state.running) { endRunAndShow(); return; }
    requestJump();
  }
  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") requestJump();
  });

  function doJump() {
    if (state.jumpsLeft <= 0) return false;
    const jumpIndex = 3 - state.jumpsLeft;
    const impulse = jumpIndex === 0 ? -14.4 : (jumpIndex === 1 ? -13.1 : -12.1);
    state.p.vy = impulse;
    state.p.grounded = false;
    state.jumpsLeft -= 1;
    state.jumpBufferT = 0;
    return true;
  }

  // --------- Collision helpers ----------
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function applySpeedBoost(seconds = 2.4, mul = 1.55) {
    state.speedMul = Math.max(state.speedMul, mul);
    state.boostT = Math.max(state.boostT, seconds);
  }
  function applyShield(seconds = 4.5, hits = 1) {
    state.shield.active = true;
    state.shield.until = performance.now() + seconds * 1000;
    state.shield.hitsLeft = Math.max(state.shield.hitsLeft, hits);
  }

  // --------- Combo multiplier logic ----------
  // Every 8 seconds without getting hit, increase multiplier up to a cap.
  function updateMultiplier(dt) {
    state.noHit += dt;
    const steps = Math.floor(state.noHit / 8);       // 0,1,2,3...
    const cap = 6;
    const target = 1 + Math.min(cap-1, steps) * 0.25; // 1.00,1.25,1.50... up to 2.25
    state.multTarget = target;
    // Smooth towards target
    state.mult += (state.multTarget - state.mult) * Math.min(1, dt * 6);
  }
  function resetMultiplierOnHit() {
    state.noHit = 0;
    state.multTarget = 1.0;
    state.mult = 1.0;
  }

  // --------- HUD ----------
  function renderHUD(speed) {
    const pnl = (Math.floor(state.score) / 10);
    hudPnl.textContent = formatPnL(pnl);
    hudSpd.textContent = `${(speed / state.baseSpeed).toFixed(2)}x`;

    const hearts = "♥".repeat(state.lives) + "♡".repeat(Math.max(0, state.maxLives - state.lives));
    hudLives.textContent = hearts.slice(0, state.maxLives);

    const now = performance.now();
    const shieldOn = state.shield.active && now < state.shield.until && state.shield.hitsLeft > 0;
    hudShield.textContent = shieldOn ? `SHIELD: ON (${state.shield.hitsLeft})` : "SHIELD: OFF";

    hudStreak.textContent = `STREAK: ${dailyStreak}  |  CR: ${credits()}`;
    hudMult.textContent = `MULT: ${state.mult.toFixed(2)}x  |  NO-HIT: ${Math.floor(state.noHit)}s`;
  }

  // --------- Rendering ----------
  function drawGrid() {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#00ff88";
    const gap = 88;
    for (let x = 0; x < window.innerWidth; x += gap) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, window.innerHeight); ctx.stroke();
    }
    for (let y = 0; y < window.innerHeight; y += gap) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(window.innerWidth, y); ctx.stroke();
    }
    ctx.restore();
  }
  function drawPriceLine() {
    ctx.save();
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < state.floor.length; i++) {
      const p = state.floor[i];
      const sx = p.x - state.camX;
      if (i === 0) ctx.moveTo(sx, p.y);
      else ctx.lineTo(sx, p.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.restore();
  }
  function drawCrashOverlay() {
    if (!state.crash.active) return;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ff0033";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.restore();
  }
  function drawCandle(b) {
    const sx = b.x - state.camX;
    ctx.save();
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(sx + b.w / 2, b.y - 14);
    ctx.lineTo(sx + b.w / 2, b.y + b.h + 14);
    ctx.stroke();
    ctx.globalAlpha = 0.70;
    ctx.fillStyle = "#00ff88";
    ctx.fillRect(sx, b.y, b.w, b.h);
    ctx.globalAlpha = 0.12;
    ctx.fillRect(sx - 6, b.y - 6, b.w + 12, b.h + 12);
    ctx.restore();
  }
  function drawTrap(t) {
    const sx = t.x - state.camX;
    ctx.save();
    ctx.fillStyle = "#ff0033";
    if (t.kind === "trap") ctx.fillRect(sx, t.y, t.w, t.h);
    else if (t.kind === "trapTall") {
      ctx.fillRect(sx, t.y, t.w, t.h);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(sx - 4, t.y - 4, t.w + 8, t.h + 8);
    } else {
      ctx.fillRect(sx, t.y, t.w, t.h);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(sx - 6, t.y - 10, t.w + 12, t.h + 20);
    }
    ctx.restore();
  }
  function drawPickupBox(x, y, w, h, fill, outline) {
    const sx = x - state.camX;
    const r = 6;
    ctx.save();
    ctx.globalAlpha = 0.90;
    ctx.fillStyle = fill;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + r, y);
    ctx.arcTo(sx + w, y, sx + w, y + h, r);
    ctx.arcTo(sx + w, y + h, sx, y + h, r);
    ctx.arcTo(sx, y + h, sx, y, r);
    ctx.arcTo(sx, y, sx + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillRect(sx - 8, y - 8, w + 16, h + 16);
    ctx.restore();
  }
  function drawCombo(pu) {
    drawPickupBox(pu.x, pu.y, pu.w, pu.h, "rgba(0,255,200,.18)", "#00ff88");
    const sx = pu.x - state.camX;
    ctx.save();
    ctx.fillStyle = "#00ff88";
    ctx.globalAlpha = 0.95;
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillText("S+", sx + 3, pu.y + 13);
    ctx.restore();
  }
  function drawLife(pu) {
    drawPickupBox(pu.x, pu.y, pu.w, pu.h, "rgba(255,0,51,.12)", "#00ff88");
    const sx = pu.x - state.camX;
    ctx.save();
    ctx.fillStyle = "#00ff88";
    ctx.globalAlpha = 0.95;
    ctx.font = "700 12px ui-monospace, monospace";
    ctx.fillText("♥", sx + 6, pu.y + 14);
    ctx.restore();
  }
  function drawPlayer() {
    const p = state.p;
    const now = performance.now();
    const shieldOn = state.shield.active && now < state.shield.until && state.shield.hitsLeft > 0;
    const flashing = state.hitIFrameT > 0;

    ctx.save();
    ctx.translate(p.x, p.y);

    if (shieldOn) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.w / 2, p.h / 2, 18, 16, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.ellipse(p.w / 2, p.h / 2, 26, 22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = flashing ? 0.45 : 1.0;

    ctx.fillStyle = "#00ff88";
    ctx.fillRect(0, 0, p.w, p.h);
    ctx.fillRect(3, -7, p.w - 6, 6);

    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(2, -7); ctx.lineTo(-6, -12); ctx.lineTo(3, -9);
    ctx.moveTo(p.w - 2, -7); ctx.lineTo(p.w + 6, -12); ctx.lineTo(p.w - 3, -9);
    ctx.stroke();

    ctx.fillStyle = "#ff0033";
    ctx.fillRect(Math.floor(p.w * 0.62), 6, 3, 3);

    ctx.globalAlpha = flashing ? 0.35 : 0.9;
    for (let i = 0; i < state.jumpsLeft; i++) {
      ctx.fillStyle = "#00ff88";
      ctx.fillRect(-10 + i * 5, -14, 3, 3);
    }

    ctx.restore();
  }

  // --------- Leaderboard ----------
  function recordRun(pnl, survivedSeconds) {
    const run = {
      t: Date.now(),
      user: user.username || `FID:${user.fid}`,
      fid: user.fid,
      pnl: Number(pnl.toFixed(2)),
      secs: Math.floor(survivedSeconds),
      streak: dailyStreak
    };

    // top runs list
    const runs = loadJSON(LS.runs, []);
    runs.push(run);
    runs.sort((a,b)=> b.pnl - a.pnl);
    const top = runs.slice(0, 25);
    saveJSON(LS.runs, top);

    // user best
    const ub = loadJSON(LS.userBest, {});
    const prev = ub[user.fid];
    if (!prev || run.pnl > prev.pnl) ub[user.fid] = run;
    saveJSON(LS.userBest, ub);
  }

  function renderLeaderboard() {
    const runs = loadJSON(LS.runs, []);
    const ub = loadJSON(LS.userBest, {});
    const me = ub[user.fid];

    lbModal.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Leaderboard">
        <div class="sheetHeader">
          <div class="sheetTitle">LEADERBOARD</div>
          <button class="xBtn" id="closeLb" type="button">Close</button>
        </div>
        <div class="sheetBody">
          <div class="small">
            User: <span class="badge">${(user.username || "guest")}</span>
            <span class="badge">FID ${user.fid}</span>
            <span class="badge">CR ${credits()}</span>
            <span class="badge">Streak ${dailyStreak}</span>
          </div>

          <div class="list">
            ${(me ? `
              <div class="row">
                <div>
                  <div><b>YOUR BEST</b> <span class="badge">${me.pnl >= 0 ? "+" : "-"}$${Math.abs(me.pnl).toFixed(2)}</span></div>
                  <div class="small">Survived ${me.secs}s • streak ${me.streak}</div>
                </div>
                <div class="badge">#ME</div>
              </div>
            ` : ``)}

            ${runs.map((r, i) => `
              <div class="row">
                <div>
                  <div><b>#${i+1}</b> ${r.user} <span class="badge">${r.pnl >= 0 ? "+" : "-"}$${Math.abs(r.pnl).toFixed(2)}</span></div>
                  <div class="small">Survived ${r.secs}s • streak ${r.streak}</div>
                </div>
                <div class="badge">FID ${r.fid}</div>
              </div>
            `).join("")}
          </div>

          <div class="subtle">Leaderboard is stored locally in your device. Farcaster/global leaderboard requires a backend (can add next).</div>
        </div>
      </div>
    `;
    lbModal.hidden = false;
    lbModal.querySelector("#closeLb").onclick = () => (lbModal.hidden = true);
    lbModal.onclick = (e) => { if (e.target === lbModal) lbModal.hidden = true; };
  }

  // --------- Shop ----------
  // Simple permanent start-perks. Costs credits per run activation.
  const COST = { extraLife: 30, startShield: 45 };

  function renderShop() {
    shopModal.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Shop">
        <div class="sheetHeader">
          <div class="sheetTitle">SHOP</div>
          <button class="xBtn" id="closeShop" type="button">Close</button>
        </div>
        <div class="sheetBody">
          <div class="small">
            Credits: <span class="badge">${credits()}</span>
            Daily streak: <span class="badge">${dailyStreak}</span>
          </div>

          <div class="toggle">
            <div>
              <div><b>Start with +1 Life</b> <span class="badge">${COST.extraLife} CR / run</span></div>
              <div class="small">Helps you push for higher streak multipliers.</div>
            </div>
            <input id="togLife" type="checkbox" ${shop.extraLife ? "checked" : ""} />
          </div>

          <div class="toggle">
            <div>
              <div><b>Start with Shield</b> <span class="badge">${COST.startShield} CR / run</span></div>
              <div class="small">Blocks 1 hit at the start of the run.</div>
            </div>
            <input id="togShield" type="checkbox" ${shop.startShield ? "checked" : ""} />
          </div>

          <div class="subtle">
            You earn credits after each run. Daily bonus scales with streak.
          </div>
        </div>
      </div>
    `;
    shopModal.hidden = false;
    shopModal.querySelector("#closeShop").onclick = () => (shopModal.hidden = true);
    shopModal.onclick = (e) => { if (e.target === shopModal) shopModal.hidden = true; };

    shopModal.querySelector("#togLife").onchange = (e) => { shop.extraLife = !!e.target.checked; saveShop(); };
    shopModal.querySelector("#togShield").onchange = (e) => { shop.startShield = !!e.target.checked; saveShop(); };
  }

  shopBtn?.addEventListener("click", () => renderShop());
  lbBtn?.addEventListener("click", () => renderLeaderboard());

  // --------- Run lifecycle ----------
  function resetRun() {
    state.running = true;
    state.t = 0;
    state.score = 0;
    state.worldX = 0;
    state.camX = 0;

    state.baseSpeed = 260;
    state.speedMul = 1.0;
    state.boostT = 0;
    state.difficulty = 0;
    state.crash.active = false;

    state.jumpBufferT = 0;
    state.coyoteT = 0;
    state.jumpsLeft = 3;

    // base lives + shop extra life (if paid) + streak tiny buff (every 5 days)
    state.lives = 3;
    state.maxLives = 7;
    state.hitIFrameT = 0;
    state.shield.active = false;
    state.shield.until = 0;
    state.shield.hitsLeft = 0;

    state.noHit = 0;
    state.mult = 1.0;
    state.multTarget = 1.0;

    state.p.y = 0;
    state.p.vy = 0;
    state.p.grounded = false;

    state.traps.length = 0;
    state.boosts.length = 0;
    state.comboPickups.length = 0;
    state.lifePickups.length = 0;

    state.nextTrapAtX = 420;
    state.nextBoostAtX = 760;
    state.nextComboAtX = 980;
    state.nextLifeAtX = 1400;

    seedFloor();

    // Apply daily streak perk: every 5 streak gives +1 starting life (cap)
    const streakBonusLife = Math.min(2, Math.floor(dailyStreak / 5));
    state.lives = clamp(state.lives + streakBonusLife, 1, state.maxLives);

    // Apply shop perks (cost per run)
    if (shop.extraLife) {
      if (spendCredits(COST.extraLife)) {
        state.lives = clamp(state.lives + 1, 1, state.maxLives);
      } else {
        toast?.("Not enough CR for +1 Life (Shop)");
      }
    }
    if (shop.startShield) {
      if (spendCredits(COST.startShield)) {
        applyShield(5.5, 1);
      } else {
        toast?.("Not enough CR for Shield (Shop)");
      }
    }
  }

  function endRunAndShow() {
    // tap to restart
    resetRun();
  }

  seedFloor();
  resetRun();

  // --------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    drawGrid();

    if (!state.running) {
      drawCrashOverlay();
      drawPriceLine();
      drawPlayer();
      ctx.save();
      ctx.fillStyle = "#00ff88";
      ctx.globalAlpha = 0.95;
      ctx.font = "700 16px ui-monospace, monospace";
      ctx.fillText("REKT. TAP TO RESTART.", 18, 58);
      ctx.restore();
      requestAnimationFrame(frame);
      return;
    }

    state.t += dt;
    state.difficulty = state.t * 0.55;

    const speed = (state.baseSpeed + state.difficulty * 6.5) * state.speedMul;
    const dx = speed * dt;

    state.worldX += dx;
    state.camX += dx;

    // multiplier updates (no-hit time)
    updateMultiplier(dt);

    // PnL gain uses multiplier
    state.score += dt * (35 + state.difficulty * 0.8) * state.speedMul * state.mult;

    // timers
    if (state.boostT > 0) {
      state.boostT -= dt;
      if (state.boostT <= 0) state.speedMul = 1.0;
    }
    if (state.hitIFrameT > 0) state.hitIFrameT -= dt;

    const shieldOn = state.shield.active && now < state.shield.until && state.shield.hitsLeft > 0;
    if (state.shield.active && now >= state.shield.until) {
      state.shield.active = false;
      state.shield.hitsLeft = 0;
    }

    maybeCrash();
    ensureFloorCoverage();
    scheduleSpawns();

    // physics
    const p = state.p;
    if (state.jumpBufferT > 0) state.jumpBufferT -= dt;
    if (state.coyoteT > 0) state.coyoteT -= dt;

    p.vy += 36 * dt;
    p.y += p.vy * 60 * dt;

    const groundY = floorYAt(state.camX + p.x + p.w / 2) - p.h;
    if (p.y >= groundY) {
      p.y = groundY;
      p.vy = 0;
      if (!p.grounded) state.jumpsLeft = 3;
      p.grounded = true;
      state.coyoteT = 0.10;
    } else {
      if (p.grounded) state.coyoteT = 0.10;
      p.grounded = false;
    }

    if (state.jumpBufferT > 0) {
      if (p.grounded || state.coyoteT > 0) {
        if (p.grounded) state.jumpsLeft = 3;
        doJump();
      } else {
        doJump();
      }
    }

    // cleanup
    const leftBound = state.camX - 140;
    state.traps = state.traps.filter(t => t.x > leftBound);
    state.boosts = state.boosts.filter(b => b.x > leftBound);
    state.comboPickups = state.comboPickups.filter(b => b.x > leftBound);
    state.lifePickups = state.lifePickups.filter(b => b.x > leftBound);

    // collisions
    const playerAABB = { x: state.camX + p.x, y: p.y, w: p.w, h: p.h };

    // pickups
    for (let i = 0; i < state.boosts.length; i++) {
      const b = state.boosts[i];
      if (overlap(playerAABB, { x: b.x, y: b.y, w: b.w, h: b.h })) {
        state.boosts.splice(i, 1);
        applySpeedBoost(2.4, 1.55);
        toast?.("GREEN CANDLE: speed boost!");
        break;
      }
    }
    for (let i = 0; i < state.comboPickups.length; i++) {
      const b = state.comboPickups[i];
      if (overlap(playerAABB, { x: b.x, y: b.y, w: b.w, h: b.h })) {
        state.comboPickups.splice(i, 1);
        applySpeedBoost(2.8, 1.65);
        applyShield(5.0, 1);
        toast?.("PROTECTOR: shield + speed!");
        break;
      }
    }
    for (let i = 0; i < state.lifePickups.length; i++) {
      const b = state.lifePickups[i];
      if (overlap(playerAABB, { x: b.x, y: b.y, w: b.w, h: b.h })) {
        state.lifePickups.splice(i, 1);
        const before = state.lives;
        state.lives = clamp(state.lives + 1, 0, state.maxLives);
        toast?.(state.lives > before ? "LIFE +1" : "MAX LIVES");
        break;
      }
    }

    // trap hits
    for (let i = 0; i < state.traps.length; i++) {
      const t = state.traps[i];
      if (overlap(playerAABB, { x: t.x, y: t.y, w: t.w, h: t.h })) {
        if (state.hitIFrameT > 0) break;

        if (shieldOn) {
          state.shield.hitsLeft = Math.max(0, state.shield.hitsLeft - 1);
          state.hitIFrameT = 0.35;
          state.traps.splice(i, 1);
          toast?.("SHIELD BLOCKED!");
          break;
        }

        state.lives -= 1;
        state.hitIFrameT = 0.55;
        state.traps.splice(i, 1);
        toast?.("HIT! -1 LIFE");

        // reset multiplier on hit (core addiction loop)
        resetMultiplierOnHit();

        if (state.lives <= 0) {
          state.running = false;

          // credits earned this run
          const pnl = (Math.floor(state.score) / 10);
          const earned = Math.max(5, Math.min(180, Math.floor(Math.max(0, pnl) / 2) + dailyStreak));
          addCredits(earned);
          toast?.(`RUN END. +${earned} CR`);

          // leaderboard record
          recordRun(Math.max(0, pnl), state.t);
        }
        break;
      }
    }

    renderHUD(speed);

    drawCrashOverlay();
    drawPriceLine();
    for (const b of state.boosts) drawCandle(b);
    for (const b of state.comboPickups) drawCombo(b);
    for (const b of state.lifePickups) drawLife(b);
    for (const t of state.traps) drawTrap(t);
    drawPlayer();

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
