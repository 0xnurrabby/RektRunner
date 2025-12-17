import { sdk } from "https://esm.sh/@farcaster/frame-sdk";
sdk.actions.ready();

import { initGame } from "./game.js";
import { initTip } from "./tip.js";

function toast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, 2600);
}

// Mandatory detection gate validation (runtime guard - does not affect crawler)
async function detectionGate(){
  // 1) farcaster manifest existence + homeUrl match + imageUrl requirement
  try{
    const res = await fetch("/.well-known/farcaster.json", { cache:"no-store" });
    if(!res.ok) throw new Error("Missing /.well-known/farcaster.json");
    const j = await res.json();
    if(j.homeUrl !== "https://nurrabby.com/") throw new Error("homeUrl mismatch");
    if(!j.imageUrl || !String(j.imageUrl).endsWith("/assets/embed-3x2.png")) throw new Error("miniapp.imageUrl missing/incorrect");
  }catch(e){
    // If this fails, user likely deployed wrong. Show hard error.
    document.body.innerHTML = `<div style="padding:18px;color:#00ff88;font-family:monospace">
      <div style="font-weight:800;margin-bottom:8px">Mini App detection FAILED</div>
      <div style="opacity:.9">Fix: ensure /.well-known/farcaster.json exists and matches https://nurrabby.com/ exactly.</div>
      <div style="opacity:.7;margin-top:10px">Details: ${String(e.message||e)}</div>
    </div>`;
    throw e;
  }

  // 2) meta tags existence + valid JSON + launch_frame
  const names = ["fc:miniapp","fc:frame"];
  for(const name of names){
    const tag = document.querySelector(`meta[name="${name}"]`);
    if(!tag) throw new Error(`Missing <meta name="${name}">`);
    const content = tag.getAttribute("content");
    let parsed;
    try{ parsed = JSON.parse(content); }catch{ throw new Error(`${name} JSON parse failed`); }
    const action = parsed?.button?.action;
    if(action?.type !== "launch_frame") throw new Error(`${name} action.type must be launch_frame`);
  }

  // 3) embed image exists
  const imgRes = await fetch("/assets/embed-3x2.png", { method:"HEAD" });
  if(!imgRes.ok) throw new Error("Missing /assets/embed-3x2.png");
}

(async function boot(){
  await detectionGate();
  initGame({ toast });
  initTip({ toast });
})();
