import { sdk } from "https://esm.sh/@farcaster/frame-sdk";
sdk.actions.ready();

import { initGame } from "./game.js";
import { initTip } from "./tip.js";

const EXPECTED_HOME = "https://rekt-runner.vercel.app/";
const EXPECTED_EMBED_SUFFIX = "/assets/embed-3x2.png";

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function normalizeUrl(u) {
  if (!u || typeof u !== "string") return "";
  // Ensure trailing slash for homeUrl comparisons
  return u.replace(/\/+$/, "/");
}

function getManifestHomeAndImage(manifestJson) {
  // Supports BOTH:
  // 1) New schema: { miniapp: { homeUrl, imageUrl } }
  // 2) Old schema: { homeUrl, imageUrl }
  const homeUrl =
    manifestJson?.miniapp?.homeUrl ??
    manifestJson?.homeUrl ??
    "";

  const imageUrl =
    manifestJson?.miniapp?.imageUrl ??
    manifestJson?.imageUrl ??
    "";

  return { homeUrl, imageUrl };
}

// Mandatory detection gate validation (runtime guard - does not affect crawler)
async function detectionGate() {
  // 1) farcaster manifest existence + homeUrl match + imageUrl requirement
  try {
    const res = await fetch("/.well-known/farcaster.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Missing /.well-known/farcaster.json");

    const j = await res.json();

    const { homeUrl, imageUrl } = getManifestHomeAndImage(j);

    if (!homeUrl) throw new Error("miniapp.homeUrl missing");
    if (normalizeUrl(homeUrl) !== EXPECTED_HOME) throw new Error("homeUrl mismatch");

    if (!imageUrl) throw new Error("miniapp.imageUrl missing");
    if (!String(imageUrl).endsWith(EXPECTED_EMBED_SUFFIX)) {
      throw new Error("miniapp.imageUrl missing/incorrect");
    }
  } catch (e) {
    document.body.innerHTML = `<div style="padding:18px;color:#00ff88;font-family:monospace;background:#000;min-height:100vh">
      <div style="font-weight:800;margin-bottom:8px">Mini App detection FAILED</div>
      <div style="opacity:.9">Fix: ensure /.well-known/farcaster.json exists and homeUrl matches ${EXPECTED_HOME} exactly.</div>
      <div style="opacity:.7;margin-top:10px">Details: ${String(e?.message || e)}</div>
    </div>`;
    throw e;
  }

  // 2) meta tags existence + valid JSON + launch_frame
  const names = ["fc:miniapp", "fc:frame"];
  for (const name of names) {
    const tag = document.querySelector(`meta[name="${name}"]`);
    if (!tag) throw new Error(`Missing <meta name="${name}">`);

    const content = tag.getAttribute("content");
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`${name} JSON parse failed`);
    }

    const action = parsed?.button?.action;
    if (action?.type !== "launch_frame") {
      throw new Error(`${name} action.type must be launch_frame`);
    }
    if (normalizeUrl(action?.url) !== EXPECTED_HOME) {
      throw new Error(`${name} action.url must be ${EXPECTED_HOME}`);
    }
  }

  // 3) embed image exists
  const imgRes = await fetch(EXPECTED_EMBED_SUFFIX, { method: "HEAD" });
  if (!imgRes.ok) throw new Error(`Missing ${EXPECTED_EMBED_SUFFIX}`);
}

(async function boot() {
  await detectionGate();
  let fcUser = null;
  try { fcUser = sdk?.context?.user || null; } catch {}
  initGame({ toast, fcUser });
  initTip({ toast });
})();
