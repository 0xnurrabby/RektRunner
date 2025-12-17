(function(){
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const pnlEl = document.getElementById("pnlVal");
  const restartBtn = document.getElementById("restartBtn");
  const startOverlay = document.getElementById("startOverlay");

  const C = {
    bg: "#020617",
    grid: "rgba(52,211,255,0.08)",
    lime: "#a3ff12",
    cyan: "rgba(52,211,255,0.90)",
    danger: "#ff2e88",
    dim: "rgba(163,255,18,0.06)"
  };

  function fit(){
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener("resize", fit, {passive:true});
  fit();

  let last = performance.now();

  const world = {
    x: 0,
    speed: 0,           // starts at 0; ramps after start
    baseSpeed: 2.4,      // slower baseline
    ramp: 0,             // increases over time
    boost: 0,
    dead: false,
    started: false,
    score: 0,
    pnl: 0
  };

  const bull = {
    x: 74,
    y: window.innerHeight * 0.45,
    vy: 0,
    r: 10,
    grounded: false,
    coyote: 0,           // ms
    jumpBuf: 0           // ms
  };

  const terrain = {
    points: [],
    baseY: () => Math.round(window.innerHeight * 0.64),
    amp: 40
  };

  const hazards = [];
  const boosts = [];

  function noise(x){
    return Math.sin(x*0.013) * 0.6 + Math.sin(x*0.041) * 0.3 + Math.sin(x*0.007) * 0.25;
  }

  function updateTerrain(){
    const w = window.innerWidth;
    const step = 10;
    const need = Math.ceil(w/step)+4;
    while(terrain.points.length < need){
      const i = terrain.points.length;
      const px = i*step;
      const nx = (world.x + px);

      const vol = Math.abs(noise(nx)) * 1.2;
      let y = terrain.baseY() + noise(nx) * terrain.amp;

      // crash zones: occasional sharp drops
      const crash = (Math.sin(nx*0.0031) < -0.985) ? 1 : 0;
      if(crash){
        y += 80 + vol*34;
      }

      terrain.points.push({x:px, y, crash});
    }
  }

  function shiftTerrain(dx){
    for(const p of terrain.points) p.x -= dx;
    while(terrain.points.length && terrain.points[0].x < -20) terrain.points.shift();
  }

  function groundYAt(x){
    if(terrain.points.length < 2) return terrain.baseY();
    const step = 10;
    const i = Math.max(0, Math.min(terrain.points.length-2, Math.floor(x/step)));
    const a = terrain.points[i];
    const b = terrain.points[i+1];
    const t = (x - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * t;
  }

  function spawn(){
    // slower, fairer spawns
    if(Math.random() < 0.020){
      hazards.push({ x: window.innerWidth + 60, y: 0, w: 22, h: 18, live:true });
    }
    if(Math.random() < 0.016){
      boosts.push({ x: window.innerWidth + 60, y: 0, w: 14, h: 54, live:true });
    }
  }

  function collideRectCircle(rx, ry, rw, rh, cx, cy, cr){
    const nx = Math.max(rx, Math.min(cx, rx+rw));
    const ny = Math.max(ry, Math.min(cy, ry+rh));
    const dx = cx - nx, dy = cy - ny;
    return (dx*dx + dy*dy) <= cr*cr;
  }

  function jumpNow(){
    // jump with buffering + coyote
    const can = bull.grounded || bull.coyote > 0;
    if(can){
      bull.vy = -12.2 - Math.min(2.0, world.boost*0.35);
      bull.grounded = false;
      bull.coyote = 0;
      bull.jumpBuf = 0;
    }else{
      bull.jumpBuf = 140; // buffer jump for 140ms
    }
  }

  function startRun(){
    if(world.started) return;
    world.started = true;
    startOverlay.style.display = "none";
  }

  function onTap(){
    if(world.dead){ reset(); return; }
    startRun();
    jumpNow();
  }

  function reset(){
    world.x = 0;
    world.speed = 0;
    world.ramp = 0;
    world.boost = 0;
    world.dead = false;
    world.started = false;
    world.score = 0;
    world.pnl = 0;

    bull.y = window.innerHeight * 0.45;
    bull.vy = 0;
    bull.grounded = false;
    bull.coyote = 0;
    bull.jumpBuf = 0;

    terrain.points = [];
    hazards.length = 0;
    boosts.length = 0;

    startOverlay.style.display = "flex";
  }

  function flashBoost(){
    world.boost = Math.min(6, world.boost + 2.4);
  }

  window.RektUI = { onTap, flashBoost };

  restartBtn.addEventListener("click", reset);

  function drawGrid(){
    const w = window.innerWidth, h = window.innerHeight;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0,0,w,h);

    ctx.strokeStyle = C.dim;
    ctx.lineWidth = 1;
    const step = 28;
    for(let x=0; x<=w; x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for(let y=0; y<=h; y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

    // scanline sweep
    const t = performance.now()*0.02;
    const y = (t % (h+200)) - 100;
    ctx.fillStyle = "rgba(52,211,255,0.04)";
    ctx.fillRect(0, y, w, 26);
  }

  function drawCandles(){
    const w = window.innerWidth, h = window.innerHeight;
    const n = 14;
    for(let i=0;i<n;i++){
      const x = (w - ((world.x*2.6 + i*130) % (w+180))) - 40;
      const up = Math.sin((world.x+i*110)*0.01) > -0.2;
      const col = up ? C.lime : C.danger;
      const cy = h*0.22 + (i%5)*34;
      const bh = 24 + (i%6)*10;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, cy-bh); ctx.lineTo(x, cy+bh); ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(x-6, cy-12, 12, 24);
    }
  }

  function drawTerrain(){
    if(terrain.points.length < 2) return;

    // price line
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.lime;
    ctx.beginPath();
    ctx.moveTo(terrain.points[0].x, terrain.points[0].y);
    for(const p of terrain.points) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // crash accents
    for(const p of terrain.points){
      if(!p.crash) continue;
      ctx.strokeStyle = "rgba(255,46,136,0.45)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x+14, p.y+52);
      ctx.stroke();
    }
  }

  function drawBull(){
    const x = bull.x, y = bull.y;
    ctx.fillStyle = C.lime;
    ctx.fillRect(x-8, y-8, 16, 16);
    ctx.fillRect(x-18, y-2, 10, 6);
    ctx.fillRect(x+8, y-2, 10, 6);
    ctx.fillStyle = "rgba(2,6,23,0.9)";
    ctx.fillRect(x-2, y-2, 4, 4);

    if(world.boost > 0.1){
      ctx.strokeStyle = "rgba(163,255,18,0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 18 + world.boost*2, 0, Math.PI*2);
      ctx.stroke();
    }
  }

  function drawHazards(){
    for(const h of hazards){
      if(!h.live) continue;
      ctx.strokeStyle = C.danger;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(h.x-h.w/2, h.y+h.h);
      ctx.lineTo(h.x, h.y);
      ctx.lineTo(h.x+h.w/2, h.y+h.h);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,46,136,0.18)";
      ctx.fillRect(h.x-h.w/2, h.y+h.h, h.w, 6);
    }
  }

  function drawBoosts(){
    for(const b of boosts){
      if(!b.live) continue;
      ctx.fillStyle = C.lime;
      ctx.fillRect(b.x-b.w/2, b.y-b.h, b.w, b.h);
      ctx.strokeStyle = C.lime;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y-b.h-14);
      ctx.lineTo(b.x, b.y+10);
      ctx.stroke();
    }
  }

  function fmtUsd(n){
    const sign = n >= 0 ? "+" : "-";
    const v = Math.abs(n);
    return `${sign}$${v.toFixed(2)}`;
  }

  function tick(dt){
    if(world.dead) return;

    if(!world.started){
      // idle animation only
      updateTerrain();
      return;
    }

    // speed ramp: starts gentle, then ramps
    world.ramp += dt * 0.00006; // slow ramp
    const base = world.baseSpeed + Math.min(2.4, world.ramp);
    world.speed = base + world.boost*0.55;
    world.boost = Math.max(0, world.boost - dt*0.0016);

    world.x += world.speed;
    world.score += world.speed;
    world.pnl = world.score*0.019;

    updateTerrain();
    shiftTerrain(world.speed);

    if(Math.random() < 0.16) spawn();

    // place objects
    for(const h of hazards){
      if(!h.live) continue;
      h.x -= world.speed;
      h.y = groundYAt(h.x) - 18;
      if(h.x < -80) h.live = false;
      if(collideRectCircle(h.x-h.w/2, h.y, h.w, h.h, bull.x, bull.y, bull.r)){
        world.dead = true;
        world.pnl -= 66;
      }
    }
    for(const b of boosts){
      if(!b.live) continue;
      b.x -= world.speed;
      b.y = groundYAt(b.x) - 4;
      if(b.x < -80) b.live = false;
      if(collideRectCircle(b.x-b.w/2, b.y-b.h, b.w, b.h, bull.x, bull.y, bull.r)){
        b.live = false;
        world.boost = Math.min(6, world.boost + 3.0);
      }
    }

    // jump buffer timer
    if(bull.jumpBuf > 0) bull.jumpBuf = Math.max(0, bull.jumpBuf - dt);

    // physics
    const g = 0.58;
    bull.vy += g;
    bull.y += bull.vy;

    const gy = groundYAt(bull.x) - 10;
    if(bull.y >= gy){
      bull.y = gy;
      bull.vy = 0;
      if(!bull.grounded){
        // landing
      }
      bull.grounded = true;
      bull.coyote = 120; // ms coyote window while grounded refreshes
      if(bull.jumpBuf > 0){
        // buffered jump triggers immediately on landing
        bull.vy = -12.2 - Math.min(2.0, world.boost*0.35);
        bull.grounded = false;
        bull.jumpBuf = 0;
        bull.coyote = 0;
      }
    }else{
      if(bull.grounded){
        bull.grounded = false;
      }
      bull.coyote = Math.max(0, bull.coyote - dt);
      // allow buffered jump during coyote
      if(bull.jumpBuf > 0 && bull.coyote > 0){
        bull.vy = -12.2 - Math.min(2.0, world.boost*0.35);
        bull.jumpBuf = 0;
        bull.coyote = 0;
      }
    }

    if(bull.y > window.innerHeight + 100){
      world.dead = true;
    }
  }

  function draw(){
    drawGrid();
    drawCandles();
    drawTerrain();
    drawBoosts();
    drawHazards();
    drawBull();

    if(world.dead){
      ctx.fillStyle = "rgba(2,6,23,0.72)";
      ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
      ctx.strokeStyle = C.danger;
      ctx.lineWidth = 3;
      ctx.strokeRect(18, 140, window.innerWidth-36, 170);
      ctx.fillStyle = C.danger;
      ctx.font = "800 18px ui-monospace, Menlo, monospace";
      ctx.fillText("REKT.", 34, 182);
      ctx.fillStyle = C.cyan;
      ctx.font = "14px ui-monospace, Menlo, monospace";
      ctx.fillText("Tap anywhere to restart.", 34, 212);
      ctx.fillText("Tip: tap slightly BEFORE the edge (buffer + coyote enabled).", 34, 236);
    }
  }

  function loop(now){
    const dt = now - last;
    last = now;
    tick(dt);
    draw();
    pnlEl.textContent = fmtUsd(world.pnl);
    requestAnimationFrame(loop);
  }

  reset();
  requestAnimationFrame(loop);
})();