// The Rekt Runner (Canvas)
// Theme: Terminal Trading Desk (Neon Green on Black, Danger Red crash zones)
// Mechanic: infinite runner where "floor" is a scrolling price line.
// Live volatility hook is stubbed; game is production-safe offline.

export function initGame({ toast }){
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha:false });

  const hudPnl = document.getElementById("pnl");
  const hudSpd = document.getElementById("spd");

  const DPR = () => Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  function resize(){
    const dpr = DPR();
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize();
  addEventListener("resize", resize, { passive:true });

  // --- Game state
  const state = {
    t: 0,
    running: true,
    score: 0,
    speed: 1.0,
    boostT: 0,
    player: { x: 110, y: 0, vy: 0, w: 18, h: 18, grounded:false },
    floor: [],
    traps: [],
    boosts: [],
    camX: 0,
    lastFloorY: window.innerHeight*0.62,
    crash: { active:false, until:0 }
  };

  // price floor points (screen-space x, y)
  function seedFloor(){
    state.floor.length = 0;
    const w = window.innerWidth;
    const step = 26;
    let y = state.lastFloorY;
    for(let x = 0; x <= w + step; x += step){
      y += (Math.random()*2-1) * 10;
      y = clamp(y, 120, window.innerHeight - 120);
      state.floor.push({ x, y });
    }
    state.lastFloorY = y;
  }
  seedFloor();

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function getFloorY(x){
    // x in screen coords
    const pts = state.floor;
    if(pts.length < 2) return window.innerHeight*0.7;
    for(let i=0;i<pts.length-1;i++){
      const a = pts[i], b = pts[i+1];
      if(x>=a.x && x<=b.x){
        const t=(x-a.x)/(b.x-a.x);
        return a.y*(1-t)+b.y*t;
      }
    }
    return pts[pts.length-1].y;
  }

  function spawnTrap(){
    // "Bear Trap" = red spike block
    const x = window.innerWidth + 40;
    const y = getFloorY(x) - 18;
    state.traps.push({ x, y, w: 18, h: 18 });
  }

  function spawnBoost(){
    // "Green Dildo" = tall green candle => speed boost
    const x = window.innerWidth + 60;
    const baseY = getFloorY(x);
    const h = 44 + Math.random()*34;
    state.boosts.push({ x, y: baseY - h, w: 12, h });
  }

  // Volatility driver stub: occasionally trigger a "red candle crash"
  function maybeCrash(){
    // every ~6-10s on average
    if(state.crash.active) return;
    if(Math.random() < 0.006){
      state.crash.active = true;
      state.crash.until = performance.now() + 1400 + Math.random()*900;
      toast("RED CANDLE: floor dropping!");
    }
  }

  function scrollFloor(dx){
    // move points left and append new points to the right
    const step = 26;
    for(const p of state.floor) p.x -= dx;

    // drop floor during crash
    const now = performance.now();
    const crashDrop = state.crash.active ? 2.2 : 0;
    if(state.crash.active && now > state.crash.until) state.crash.active = false;

    // Apply slight noise + crash effect to y on append
    while(state.floor.length && state.floor[0].x < -step){
      state.floor.shift();
    }
    // ensure coverage
    const w = window.innerWidth;
    while(state.floor.length && state.floor[state.floor.length-1].x < w + step){
      const last = state.floor[state.floor.length-1];
      let y = last.y + (Math.random()*2-1)*10;
      y = clamp(y + crashDrop*22, 120, window.innerHeight - 120);
      state.floor.push({ x: last.x + step, y });
      state.lastFloorY = y;
    }
  }

  // Controls
  function jump(){
    const p = state.player;
    if(p.grounded){
      p.vy = -13.5;
      p.grounded = false;
    }
  }
  addEventListener("pointerdown", jump, { passive:true });
  addEventListener("keydown", (e)=>{
    if(e.code==="Space" || e.code==="ArrowUp") jump();
  });

  function rectsOverlap(a,b){
    return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
  }

  // Render helpers
  function drawGrid(){
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#00ff88";
    const gap = 80;
    for(let x=0;x<window.innerWidth;x+=gap){
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,window.innerHeight); ctx.stroke();
    }
    for(let y=0;y<window.innerHeight;y+=gap){
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(window.innerWidth,y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPriceLine(){
    ctx.save();
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for(let i=0;i<state.floor.length;i++){
      const p = state.floor[i];
      if(i===0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawCrashZone(){
    if(!state.crash.active) return;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ff0033";
    ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    ctx.restore();
  }

  function drawPlayer(){
    const p = state.player;
    ctx.save();
    // pixel bull: block body + horns
    ctx.fillStyle = "#00ff88";
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillRect(p.x+3, p.y-7, p.w-6, 6);
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x+2, p.y-7); ctx.lineTo(p.x-6, p.y-12); ctx.lineTo(p.x+3, p.y-9);
    ctx.moveTo(p.x+p.w-2, p.y-7); ctx.lineTo(p.x+p.w+6, p.y-12); ctx.lineTo(p.x+p.w-3, p.y-9);
    ctx.stroke();
    // red eye
    ctx.fillStyle = "#ff0033";
    ctx.fillRect(p.x + Math.floor(p.w*0.62), p.y + 6, 3, 3);
    ctx.restore();
  }

  function drawTrap(t){
    ctx.save();
    ctx.fillStyle = "#ff0033";
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.restore();
  }

  function drawBoost(b){
    ctx.save();
    // candle wick
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w/2, b.y - 10);
    ctx.lineTo(b.x + b.w/2, b.y + b.h + 10);
    ctx.stroke();
    // candle body
    ctx.fillStyle = "rgba(0,255,136,.65)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  // Main loop
  let last = performance.now();
  function frame(now){
    const dt = Math.min(0.033, (now-last)/1000);
    last = now;
    if(!state.running){ requestAnimationFrame(frame); return; }

    state.t += dt;
    state.score += dt * 42 * state.speed;

    // speed boost decay
    if(state.boostT > 0){
      state.boostT -= dt;
      if(state.boostT <= 0) state.speed = 1.0;
    }

    // spawn obstacles
    if(Math.random() < 0.018 * state.speed) spawnTrap();
    if(Math.random() < 0.010 * state.speed) spawnBoost();
    maybeCrash();

    // scroll world
    const dx = (220 * state.speed) * dt;
    scrollFloor(dx);
    for(const t of state.traps) t.x -= dx;
    for(const b of state.boosts) b.x -= dx;
    state.traps = state.traps.filter(t => t.x > -80);
    state.boosts = state.boosts.filter(b => b.x > -80);

    // physics
    const p = state.player;
    p.vy += 34 * dt;
    p.y += p.vy * 60 * dt;

    const floorY = getFloorY(p.x + p.w/2);
    if(p.y + p.h >= floorY){
      p.y = floorY - p.h;
      p.vy = 0;
      p.grounded = true;
    }else{
      p.grounded = false;
    }

    // collisions
    for(const t of state.traps){
      if(rectsOverlap(p, t)){
        state.running = false;
        toast("REKT: hit a Bear Trap. Tap to restart.");
      }
    }
    for(const b of state.boosts){
      if(rectsOverlap(p, b)){
        state.boosts.splice(state.boosts.indexOf(b), 1);
        state.speed = 1.55;
        state.boostT = 2.6;
        toast("GREEN CANDLE: speed boost!");
        break;
      }
    }

    // update HUD
    const pnl = Math.floor(state.score) / 10;
    hudPnl.textContent = `+$${pnl.toFixed(2)}`;
    hudSpd.textContent = `${state.speed.toFixed(2)}x`;

    // render
    ctx.fillStyle = "#000000";
    ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    drawGrid();
    drawCrashZone();
    drawPriceLine();
    for(const b of state.boosts) drawBoost(b);
    for(const t of state.traps) drawTrap(t);
    drawPlayer();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Restart on tap after death
  addEventListener("pointerdown", ()=>{
    if(state.running) return;
    state.running = true;
    state.score = 0;
    state.speed = 1.0;
    state.boostT = 0;
    state.traps.length = 0;
    state.boosts.length = 0;
    state.player.y = 0;
    state.player.vy = 0;
    seedFloor();
  }, { passive:true });
}
