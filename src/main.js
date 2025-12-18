import { sdk } from "@farcaster/miniapp-sdk";
import { Attribution } from "https://esm.sh/ox/erc8021";
import "./style.css";

/** ============================================================
 *  DOMAIN DISCIPLINE
 *  ============================================================
 *  Hard-coded domain: https://rekt-runner.vercel.app/
 *  (Do NOT replace with placeholders.)
 */
const DOMAIN = "https://rekt-runner.vercel.app/";

/** ============================================================
 *  TIP CONFIG (REQUIRED)
 *  ============================================================ */
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base mainnet USDC
const USDC_DECIMALS = 6;

// IMPORTANT: replace in production
const RECIPIENT = "0x5eC6AF0798b25C563B102d3469971f1a8d598121"; // disabled if zero-address
const BUILDER_CODE = "bc_4pl9badj";

function isZeroAddress(addr) {
  return /^0x0{40}$/i.test(addr);
}
function isChecksummedOrAllLower(addr) {
  // Accept proper checksum OR all lowercase; we'll still reject zero address.
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  }, 2400);
}

function hapticsLight() {
  try { sdk.actions.haptics?.impact?.({ style: "light" }); } catch {}
}

/** ============================================================
 *  Mini App Gate (NO browser-mode gameplay)
 *  ============================================================ */
async function ensureMiniAppOrBlock() {
  let inMiniApp = false;
  try {
    inMiniApp = await sdk.isInMiniApp();
  } catch {
    inMiniApp = false;
  }

  if (!inMiniApp) {
    document.body.innerHTML = `
      <div class="blocked">
        <div class="blocked-card">
          <div class="blocked-title">The Rekt Runner</div>
          <div class="blocked-sub">This experience is built for Farcaster Mini App chrome (no address bar).</div>
          <div class="blocked-sub">Open this URL from within a Farcaster client to play:</div>
          <div class="blocked-url">${DOMAIN}</div>
        </div>
      </div>
    `;
    return false;
  }
  return true;
}

/** ============================================================
 *  Game Data / Persistence
 *  ============================================================ */
const LS_KEY = "rektRunner.v1";
const todayISO = () => new Date().toISOString().slice(0, 10);

const DEFAULT_SAVE = {
  credits: 0,
  lastPlayedDate: null,
  streak: 0,
  unlocked: { bull: true, mega: false, cyber: false, diamond: false },
  selected: "bull",
  bestAllTime: 0,
  bestWeek: 0,
  weekKey: null,
};

function weekKeyUTC(d = new Date()) {
  // ISO week number-ish key (year-week) good enough for streak rewards
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function loadSave() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const obj = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_SAVE), ...obj };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}
function saveSave(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

const CHARACTER_DEFS = {
  bull: { name: "Default Bull", desc: "Balanced.", cost: 0, bonus: { scoreMult: 1.0, speedMult: 1.0, cooldownMult: 1.0 } },
  mega: { name: "Mega Bull", desc: "+5% base speed.", cost: 2500, bonus: { scoreMult: 1.0, speedMult: 1.05, cooldownMult: 1.0 } },
  cyber: { name: "Cyber Bull", desc: "−10% power-up cooldowns.", cost: 4000, bonus: { scoreMult: 1.0, speedMult: 1.0, cooldownMult: 0.9 } },
  diamond: { name: "Diamond Bull", desc: "+8% score multiplier.", cost: 6000, bonus: { scoreMult: 1.08, speedMult: 1.0, cooldownMult: 1.0 } },
};

const SHOP_ITEMS = [
  { id: "extraLife", label: "Extra starting life (+1)", cost: 300, apply: (run) => { run.startLives += 1; } },
  { id: "startShield", label: "Starting shield", cost: 450, apply: (run) => { run.startShield = true; } },
  { id: "startMult", label: "Starting multiplier (x1.5)", cost: 700, apply: (run) => { run.startMultiplier = 1.5; } },
];

/** ============================================================
 *  UI Shell
 *  ============================================================ */
const app = document.getElementById("app");
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="dot"></div>
        <div>
          <div class="brand-title">THE REKT RUNNER</div>
          <div class="brand-sub">Run the chart. Chase Unrealized PnL.</div>
        </div>
      </div>
      <div class="top-actions">
        <button class="btn ghost" id="btnTip" aria-label="Tip">Tip</button>
        <button class="btn ghost" id="btnHow" aria-label="How">How</button>
        <button class="btn ghost" id="btnSettings" aria-label="Settings">⚙</button>
      </div>
    </header>

    <main class="main">
      <div class="panel left">
        <div class="card">
          <div class="card-title">Account</div>
          <div class="row">
            <div class="pfp" id="pfp"></div>
            <div class="col">
              <div class="big" id="who">@anon</div>
              <div class="muted" id="fid">FID: —</div>
            </div>
          </div>
          <div class="hr"></div>
          <div class="kv">
            <div class="k">Credits</div><div class="v" id="credits">0</div>
            <div class="k">Daily streak</div><div class="v" id="streak">0</div>
            <div class="k">Best (All-time)</div><div class="v" id="bestAll">0</div>
            <div class="k">Best (This week)</div><div class="v" id="bestWeek">0</div>
          </div>
          <div class="hr"></div>
          <button class="btn" id="btnAdd">Add Mini App</button>
        </div>

        <div class="card">
          <div class="card-title">Character</div>
          <div class="char-grid" id="charGrid"></div>
        </div>

        <div class="card">
          <div class="card-title">Leaderboard</div>
          <div class="muted small">Local demo leaderboard (optional server config in README).</div>
          <div class="tabs">
            <button class="tab active" data-tab="week">Weekly</button>
            <button class="tab" data-tab="all">All time</button>
          </div>
          <div class="lb" id="lb"></div>
          <button class="btn ghost" id="btnSubmit">Submit score</button>
        </div>
      </div>

      <div class="stage">
        <canvas id="c" width="420" height="740"></canvas>
        <div class="hud">
          <div class="hud-left">
            <div class="hud-item"><span class="label">Unrealized PnL</span><span class="value" id="hudScore">0</span></div>
            <div class="hud-item"><span class="label">Multiplier</span><span class="value" id="hudMult">x1.00</span></div>
          </div>
          <div class="hud-right">
            <div class="hud-item"><span class="label">Lives</span><span class="value" id="hudLives">❤❤❤</span></div>
            <div class="hud-item"><span class="label">Status</span><span class="value" id="hudStatus">—</span></div>
          </div>
        </div>

        <div class="overlay sheet" id="menu" data-collapsed="true">
          <div class="sheetHandle" id="sheetHandle" role="button" aria-label="Toggle panel"></div>
          <div class="menu-card">
            <div class="menu-title-row"><div class="menu-title">Ready to run the chart?</div><button class="btn ghost mini" id="toggleSheet" type="button" aria-label="Expand or collapse">Expand</button></div>
            <div class="menu-sub">Tap / click / space to jump. Max 3 consecutive jumps. Dodge red candles. Collect green momentum.</div>
            <div class="shop" id="shop"></div>
            <div class="menu-actions">
              <button class="btn" id="btnStart">Start Run</button>
              <button class="btn ghost" id="btnReset">Reset</button>
            </div>
            <div class="muted small">Tip: higher no-hit streak → higher multiplier → higher PnL.</div>
          </div>
        </div>

        <div class="overlay hidden" id="gameover">
          <div class="menu-card">
            <div class="menu-title">You got rekt.</div>
            <div class="menu-sub" id="goLine">PnL: 0</div>
            <div class="menu-actions">
              <button class="btn" id="btnRetry">Run Again</button>
              <button class="btn ghost" id="btnMenu">Main Menu</button>
            </div>
          </div>
        </div>

        <div class="modal hidden" id="modal">
          <div class="backdrop" data-close="1"></div>
          <div class="sheet">
            <div class="sheet-head">
              <div class="sheet-title" id="modalTitle">Modal</div>
              <button class="btn ghost" data-close="1">✕</button>
            </div>
            <div class="sheet-body" id="modalBody"></div>
          </div>
        </div>

        <div class="tip hidden" id="tip">
          <div class="backdrop" data-close="1"></div>
          <div class="sheet">
            <div class="sheet-head">
              <div class="sheet-title">Tip the builder (USDC on Base)</div>
              <button class="btn ghost" data-close="1">✕</button>
            </div>
            <div class="sheet-body">
              <div class="muted small">Your tip supports development. USDC transfer is encoded manually and sent via ERC-5792 wallet batching.</div>
              <div class="amounts">
                <button class="pill" data-amt="1">$1</button>
                <button class="pill" data-amt="5">$5</button>
                <button class="pill" data-amt="10">$10</button>
                <button class="pill" data-amt="25">$25</button>
              </div>
              <div class="field">
                <label>Custom amount (USDC)</label>
                <input id="customAmt" inputmode="decimal" placeholder="0.00" />
              </div>
              <div class="hr"></div>
              <button class="btn" id="tipCta">Send USDC</button>
              <div class="muted small" id="tipHint"></div>
            </div>
          </div>
        </div>

      </div>

      <div class="panel right">
        <div class="card">
          <div class="card-title">Controls</div>
          <div class="muted small">
            Tap / Click / Space = Jump<br/>
            3 consecutive jumps max<br/>
            Jump buffer + coyote time enabled
          </div>
        </div>
        <div class="card">
          <div class="card-title">Power-ups</div>
          <div class="muted small">
            <span class="tag green">Speed</span> faster chart = higher risk<br/>
            <span class="tag cyan">Shield</span> absorbs one hit<br/>
            <span class="tag gold">Combo</span> speed + shield (rare)<br/>
            <span class="tag pink">Heart</span> +1 life (rare)
          </div>
        </div>
        <div class="card">
          <div class="card-title">Trading Terminal</div>
          <div class="muted small">
            Floor = price line. Green candles = momentum (rewards). Red candles = crashes (danger).
          </div>
        </div>
      </div>
    </main>
  </div>
`;

/** ============================================================
 *  Styles
 *  ============================================================ */
const style = document.createElement("style");
style.textContent = `
  :root{
    --bg:#000;
    --panel:#070a0d;
    --panel2:#0b1116;
    --text:#e7f7ee;
    --muted:#8aa19b;
    --green:#39ff14;
    --red:#ff355e;
    --cyan:#00e5ff;
    --gold:#ffd166;
    --pink:#ff4fd8;
    --shadow: 0 18px 60px rgba(0,0,0,.55);
    --radius: 16px;
  }
  *{ box-sizing:border-box; }
  html,body{ height:100%; margin:0; background:var(--bg); color:var(--text); font-family: ui-sans-serif,system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
  #app{ height:100%; }
  .shell{ height:100%; display:flex; flex-direction:column; }
  .topbar{ display:flex; align-items:center; justify-content:space-between; padding:14px 14px 10px; border-bottom:1px solid rgba(57,255,20,.14); background:linear-gradient(180deg, rgba(57,255,20,.06), rgba(0,0,0,.0)); }
  .brand{ display:flex; gap:10px; align-items:center; }
  .dot{ width:10px; height:10px; background:var(--green); border-radius:999px; box-shadow: 0 0 20px rgba(57,255,20,.8); }
  .brand-title{ letter-spacing:.12em; font-weight:800; font-size:12px; }
  .brand-sub{ color:var(--muted); font-size:12px; margin-top:2px; }
  .top-actions{ display:flex; gap:8px; }
  .main{ flex:1; display:grid; grid-template-columns: 300px 1fr 300px; gap:12px; padding:12px; min-height:0; }
  .panel{ display:flex; flex-direction:column; gap:12px; min-height:0; overflow:auto; padding-bottom:12px; }
  .card{ background:linear-gradient(180deg, rgba(57,255,20,.06), rgba(0,0,0,0) 48%), var(--panel); border:1px solid rgba(57,255,20,.14); border-radius:var(--radius); padding:12px; box-shadow: var(--shadow); }
  .card-title{ font-weight:800; font-size:12px; letter-spacing:.12em; color:rgba(231,247,238,.92); margin-bottom:10px; text-transform:uppercase; }
  .row{ display:flex; gap:10px; align-items:center; }
  .col{ display:flex; flex-direction:column; gap:4px; }
  .pfp{ width:40px; height:40px; border-radius:12px; background:rgba(57,255,20,.08); border:1px solid rgba(57,255,20,.14); overflow:hidden; }
  .big{ font-weight:800; }
  .muted{ color:var(--muted); }
  .small{ font-size:12px; line-height:1.35; }
  .hr{ height:1px; background:rgba(57,255,20,.12); margin:10px 0; }
  .kv{ display:grid; grid-template-columns: 1fr auto; gap:8px; font-size:12px; }
  .k{ color:var(--muted); }
  .v{ font-weight:700; }
  .btn{ appearance:none; border:1px solid rgba(57,255,20,.35); background:rgba(57,255,20,.14); color:var(--text); padding:10px 12px; border-radius:14px; font-weight:800; cursor:pointer; transition: transform .06s ease, background .2s ease, border-color .2s ease; }
  .btn:hover{ background:rgba(57,255,20,.18); border-color:rgba(57,255,20,.55); }
  .btn:active{ transform: translateY(1px); }
  .btn.ghost{ background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.10); }
  .btn.ghost:hover{ background:rgba(255,255,255,.06); border-color:rgba(57,255,20,.35); }
  .btn:disabled{ opacity:.55; cursor:not-allowed; }
  .stage{ position:relative; display:flex; align-items:center; justify-content:center; min-height:0; }
  canvas{ width:min(420px, 100%); height:min(740px, 100%); border-radius:22px; border:1px solid rgba(57,255,20,.18); background: radial-gradient(1200px 700px at 60% 20%, rgba(57,255,20,.08), rgba(0,0,0,0)), linear-gradient(180deg, rgba(57,255,20,.04), rgba(0,0,0,0) 55%), #000; box-shadow: 0 24px 80px rgba(0,0,0,.6); }
  .hud{ position:absolute; top:14px; left:14px; right:14px; display:flex; justify-content:space-between; gap:12px; pointer-events:none; }
  .hud-left,.hud-right{ display:flex; flex-direction:column; gap:8px; }
  .hud-item{ background:rgba(7,10,13,.72); border:1px solid rgba(57,255,20,.12); border-radius:14px; padding:10px 12px; min-width:150px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
  .hud-item .label{ display:block; font-size:11px; color:var(--muted); letter-spacing:.12em; text-transform:uppercase; }
  .hud-item .value{ display:block; font-weight:900; margin-top:3px; }
  .overlay{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:18px; }
  .overlay.hidden{ display:none; }
  .menu-card{ width:min(520px, 100%); background:linear-gradient(180deg, rgba(57,255,20,.08), rgba(0,0,0,0) 60%), var(--panel2); border:1px solid rgba(57,255,20,.20); border-radius:22px; padding:16px; box-shadow: var(--shadow); }
  .menu-title{ font-weight:900; font-size:18px; }
  .menu-sub{ color:var(--muted); font-size:13px; line-height:1.35; margin-top:6px; }
  .menu-actions{ display:flex; gap:10px; margin-top:12px; }
  .shop{ margin-top:12px; display:flex; flex-direction:column; gap:10px; }
  .shop-item{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; border-radius:16px; border:1px solid rgba(57,255,20,.12); background:rgba(0,0,0,.25); }
  .shop-item .left{ display:flex; flex-direction:column; gap:3px; }
  .shop-item .label{ font-weight:800; font-size:12px; }
  .shop-item .cost{ color:var(--muted); font-size:12px; }
  .toggle{ display:flex; align-items:center; gap:8px; }
  .toggle input{ width:18px; height:18px; }
  .char-grid{ display:grid; grid-template-columns: 1fr; gap:8px; }
  .char{ padding:10px; border-radius:16px; border:1px solid rgba(57,255,20,.12); background:rgba(0,0,0,.25); display:flex; flex-direction:column; gap:4px; cursor:pointer; }
  .char.sel{ border-color: rgba(57,255,20,.55); box-shadow: 0 0 0 1px rgba(57,255,20,.35) inset; }
  .char-top{ display:flex; justify-content:space-between; gap:8px; }
  .char-name{ font-weight:900; font-size:13px; }
  .badge{ font-size:11px; padding:4px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04); color:var(--muted); }
  .badge.ok{ color:rgba(57,255,20,.95); border-color:rgba(57,255,20,.35); }
  .tabs{ display:flex; gap:8px; margin-bottom:8px; }
  .tab{ flex:1; border-radius:12px; padding:8px 10px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.10); color:var(--muted); font-weight:900; cursor:pointer; }
  .tab.active{ color:rgba(57,255,20,.95); border-color:rgba(57,255,20,.28); background:rgba(57,255,20,.10); }
  .lb{ display:flex; flex-direction:column; gap:6px; max-height:220px; overflow:auto; padding-right:6px; }
  .lb-row{ display:flex; justify-content:space-between; gap:10px; font-size:12px; padding:8px 10px; border-radius:12px; border:1px solid rgba(57,255,20,.10); background:rgba(0,0,0,.20); }
  .lb-row .name{ color:rgba(231,247,238,.92); font-weight:800; }
  .lb-row .score{ font-weight:900; }
  .tag{ display:inline-block; padding:2px 7px; border-radius:999px; font-size:11px; border:1px solid rgba(255,255,255,.12); margin-right:6px; }
  .tag.green{ border-color:rgba(57,255,20,.35); color:rgba(57,255,20,.95); }
  .tag.cyan{ border-color:rgba(0,229,255,.35); color:rgba(0,229,255,.95); }
  .tag.gold{ border-color:rgba(255,209,102,.35); color:rgba(255,209,102,.95); }
  .tag.pink{ border-color:rgba(255,79,216,.35); color:rgba(255,79,216,.95); }
  .modal,.tip{ position:absolute; inset:0; display:flex; align-items:flex-end; justify-content:center; }
  .modal.hidden,.tip.hidden{ display:none; }
  .backdrop{ position:absolute; inset:0; background:rgba(0,0,0,.55); }
  .sheet{ position:relative; width:min(560px, 100%); background:linear-gradient(180deg, rgba(57,255,20,.08), rgba(0,0,0,0) 70%), var(--panel2); border:1px solid rgba(57,255,20,.20); border-radius:22px 22px 0 0; box-shadow: var(--shadow); overflow:hidden; }
  .sheet-head{ display:flex; align-items:center; justify-content:space-between; padding:12px 12px 10px; border-bottom:1px solid rgba(57,255,20,.12); }
  .sheet-title{ font-weight:900; }
  .sheet-body{ padding:12px; }
  .amounts{ display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
  .pill{ border-radius:999px; padding:10px 12px; border:1px solid rgba(57,255,20,.22); background:rgba(57,255,20,.10); color:rgba(57,255,20,.95); font-weight:900; cursor:pointer; }
  .pill:hover{ background:rgba(57,255,20,.14); }
  .field{ margin-top:12px; display:flex; flex-direction:column; gap:6px; }
  .field label{ font-size:12px; color:var(--muted); }
  .field input{ border-radius:14px; padding:10px 12px; border:1px solid rgba(57,255,20,.16); background:rgba(0,0,0,.35); color:var(--text); outline:none; }
  .toast{ position:fixed; left:50%; bottom:18px; transform:translateX(-50%) translateY(20px); opacity:0; padding:10px 12px; border-radius:999px; background:rgba(7,10,13,.8); border:1px solid rgba(57,255,20,.22); box-shadow: var(--shadow); transition: all .25s ease; z-index:9999; }
  .toast.show{ transform:translateX(-50%) translateY(0); opacity:1; }
  .blocked{ height:100vh; display:flex; align-items:center; justify-content:center; padding:18px; }
  .blocked-card{ width:min(560px, 100%); background:var(--panel2); border:1px solid rgba(57,255,20,.18); border-radius:22px; padding:18px; box-shadow: var(--shadow); }
  .blocked-title{ font-weight:900; font-size:18px; }
  .blocked-sub{ color:var(--muted); margin-top:8px; line-height:1.35; }
  .blocked-url{ margin-top:10px; padding:10px 12px; border-radius:14px; border:1px dashed rgba(57,255,20,.25); color:rgba(57,255,20,.95); font-weight:900; word-break:break-all; }

  @media (max-width: 980px){
    .main{ grid-template-columns: 1fr; }
    .panel.left,.panel.right{ order:2; }
    .stage{ order:1; }
  }
`;
document.head.appendChild(style);

/** ============================================================
 *  Modal helpers
 *  ============================================================ */
const modal = document.getElementById("modal");
const tip = document.getElementById("tip");
function openModal(title, html) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = html;
  modal.classList.remove("hidden");
}
function closeModal() { modal.classList.add("hidden"); }
function openTip() { tip.classList.remove("hidden"); }
function closeTip() { tip.classList.add("hidden"); }

modal.addEventListener("click", (e) => {
  const t = e.target;
  if (t?.dataset?.close) closeModal();
});
tip.addEventListener("click", (e) => {
  const t = e.target;
  if (t?.dataset?.close) closeTip();
});

/** ============================================================
 *  Tip flow (REQUIRED)
 *  ============================================================ */
const tipCta = document.getElementById("tipCta");
const tipHint = document.getElementById("tipHint");
let tipState = "idle"; // idle|preparing|confirm|sending|done
let tipAmountUSDC = 0;

function setTipState(state, hint = "") {
  tipState = state;
  tipHint.textContent = hint;
  if (state === "idle") tipCta.textContent = "Send USDC";
  if (state === "preparing") tipCta.textContent = "Preparing tip…";
  if (state === "confirm") tipCta.textContent = "Confirm in wallet";
  if (state === "sending") tipCta.textContent = "Sending…";
  if (state === "done") tipCta.textContent = "Send again";
}

function parseAmountUSDC(v) {
  const s = String(v).trim();
  if (!s) return null;
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;
  const [a, b = ""] = s.split(".");
  const bi = BigInt(a) * (10n ** BigInt(USDC_DECIMALS)) + BigInt((b.padEnd(6, "0") || "0"));
  if (bi <= 0n) return null;
  return bi;
}

function pad32(hexNo0x) {
  return hexNo0x.padStart(64, "0");
}

function encodeErc20Transfer(recipient, amountBigInt) {
  // selector a9059cbb + padded recipient + padded amount
  const selector = "a9059cbb";
  const to = recipient.toLowerCase().replace(/^0x/, "");
  const amt = amountBigInt.toString(16);
  return "0x" + selector + pad32(to) + pad32(amt);
}

async function sendTip(usdcAmountStr) {
  if (!isChecksummedOrAllLower(RECIPIENT) || isZeroAddress(RECIPIENT) || !BUILDER_CODE || BUILDER_CODE.startsWith("TODO")) {
    toast("Tip disabled: set a valid RECIPIENT + BUILDER_CODE in src/main.js.");
    return;
  }
  const amount = parseAmountUSDC(usdcAmountStr);
  if (!amount) {
    toast("Enter a valid USDC amount (> 0, up to 6 decimals).");
    return;
  }

  const dataSuffix = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });
  const data = encodeErc20Transfer(RECIPIENT, amount);

  const ethProvider = await sdk.wallet.getEthereumProvider();

  setTipState("preparing", "Warming up…");
  // Pre-transaction UX (MANDATORY): animate 1–1.5s before wallet opens
  await new Promise((r) => setTimeout(r, 1150));

  try {
    const [from] = await ethProvider.request({ method: "eth_requestAccounts" });
    const chainId = await ethProvider.request({ method: "eth_chainId" });

    // Chain handling: require Base mainnet
    if (chainId !== "0x2105") {
      try {
        await ethProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x2105" }],
        });
      } catch {
        setTipState("idle");
        toast("Please switch to Base Mainnet (0x2105) in your wallet to tip.");
        return;
      }
    }

    setTipState("confirm", "Waiting for wallet confirmation…");

    const params = [{
      version: "2.0.0",
      from,
      chainId: "0x2105",
      atomicRequired: true,
      calls: [{
        to: USDC_CONTRACT,
        value: "0x0",
        data
      }],
      capabilities: { dataSuffix }
    }];

    setTipState("sending", "Submitting…");

    await ethProvider.request({
      method: "wallet_sendCalls",
      params
    });

    setTipState("done", "Thank you. 💚");
    toast("Tip sent (USDC on Base).");
  } catch (err) {
    // Graceful rejection handling
    setTipState("idle");
    const msg = (err && typeof err === "object" && "message" in err) ? String(err.message) : "Tip cancelled.";
    if (/user rejected|rejected|denied/i.test(msg)) toast("Tip cancelled.");
    else toast("Tip failed. Please try again.");
  }
}

document.querySelectorAll(".pill").forEach((b) => {
  b.addEventListener("click", () => {
    const amt = b.dataset.amt;
    tipAmountUSDC = Number(amt);
    document.getElementById("customAmt").value = "";
    toast(`Tip set to $${amt}`);
    hapticsLight();
  });
});
document.getElementById("customAmt").addEventListener("input", () => {
  tipAmountUSDC = 0;
});
tipCta.addEventListener("click", async () => {
  if (tipState === "preparing" || tipState === "confirm" || tipState === "sending") return;
  if (tipState === "done") setTipState("idle");
  const custom = document.getElementById("customAmt").value.trim();
  const amt = tipAmountUSDC ? String(tipAmountUSDC) : custom;
  await sendTip(amt);
});

/** ============================================================
 *  Small local leaderboard (demo)
 *  ============================================================ */
const LB_KEY = "rektRunner.lb.v1";
function loadLB() {
  try { return JSON.parse(localStorage.getItem(LB_KEY) || "[]"); } catch { return []; }
}
function saveLB(rows) { localStorage.setItem(LB_KEY, JSON.stringify(rows.slice(0, 50))); }

let lbTab = "week";
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  lbTab = t.dataset.tab;
  renderLB();
}));

function renderLB() {
  const box = document.getElementById("lb");
  const rows = loadLB();
  const wk = weekKeyUTC(new Date());
  const filtered = rows.filter(r => (lbTab === "week" ? r.weekKey === wk : true))
    .sort((a,b)=>b.score-a.score)
    .slice(0, 20);

  if (!filtered.length) {
    box.innerHTML = `<div class="muted small">No scores yet. Play a run and submit!</div>`;
    return;
  }
  box.innerHTML = filtered.map((r,i)=>`
    <div class="lb-row">
      <div class="name">${i+1}. ${escapeHtml(r.name)}</div>
      <div class="score">${formatScore(r.score)}</div>
    </div>
  `).join("");
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g,(c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c])); }
function formatScore(n){ return Math.floor(n).toLocaleString(); }

document.getElementById("btnSubmit").addEventListener("click", () => {
  if (!lastRunScore) return toast("No run to submit yet.");
  const name = (currentUser?.username ? "@"+currentUser.username : (currentWallet ? shortAddr(currentWallet) : "@anon"));
  const wk = weekKeyUTC(new Date());
  const rows = loadLB();
  rows.push({ name, score: Math.floor(lastRunScore), at: Date.now(), weekKey: wk });
  saveLB(rows);
  toast("Score submitted (local).");
  renderLB();
});

/** ============================================================
 *  Farcaster SDK: context + ready + addMiniApp
 *  ============================================================ */
let currentUser = null;
let currentWallet = null;

async function initSDK() {
  try {
    currentUser = await sdk.context;
    if (currentUser?.user?.pfpUrl) {
      document.getElementById("pfp").style.backgroundImage = `url(${currentUser.user.pfpUrl})`;
      document.getElementById("pfp").style.backgroundSize = "cover";
    }
    if (currentUser?.user?.username) document.getElementById("who").textContent = "@"+currentUser.user.username;
    if (currentUser?.user?.fid) document.getElementById("fid").textContent = "FID: " + currentUser.user.fid;
  } catch {}

  try { await sdk.actions.ready({ disableNativeGestures: false }); } catch {}
}

document.getElementById("btnAdd").addEventListener("click", async () => {
  try { await sdk.actions.addMiniApp(); toast("Added to your Mini Apps."); }
  catch { toast("Could not add Mini App."); }
});

document.getElementById("btnHow").addEventListener("click", () => {
  openModal("How to play", `
    <div class="small">
      <div class="muted">Goal</div>
      <div>Run as far as possible inside the chart. Red candles hurt. Green candles reward you.</div>
      <div class="hr"></div>
      <div class="muted">Controls</div>
      <div>Tap / Click / Space to jump. Max <b>3 consecutive jumps</b>. Jump buffering and coyote time are enabled.</div>
      <div class="hr"></div>
      <div class="muted">Multiplier</div>
      <div>No-hit streak increases your multiplier over time. Taking damage resets it.</div>
    </div>
  `);
});

document.getElementById("btnSettings").addEventListener("click", () => {
  openModal("Settings", `
    <div class="small">
      <button class="btn ghost" id="btnClearSave">Clear local save</button>
      <div class="muted small" style="margin-top:10px;">Clears credits, streak, unlocks, and local leaderboard on this device.</div>
    </div>
  `);
  setTimeout(()=>{
    document.getElementById("btnClearSave")?.addEventListener("click", () => {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LB_KEY);
      location.reload();
    });
  }, 0);
});

document.getElementById("btnTip").addEventListener("click", () => {
  setTipState("idle");
  openTip();
});

/** ============================================================
 *  Game Engine (unchanged from your file)
 *  ============================================================ */
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

function resizeCanvas() { canvas.width = 420; canvas.height = 740; }
resizeCanvas();

const hudScore = document.getElementById("hudScore");
const hudMult = document.getElementById("hudMult");
const hudLives = document.getElementById("hudLives");
const hudStatus = document.getElementById("hudStatus");

let save = loadSave();
updateSideStats();

function updateSideStats() {
  document.getElementById("credits").textContent = Math.floor(save.credits).toLocaleString();
  document.getElementById("streak").textContent = String(save.streak);
  document.getElementById("bestAll").textContent = formatScore(save.bestAllTime);
  document.getElementById("bestWeek").textContent = formatScore(save.bestWeek);
}

function handleDaily() {
  const t = todayISO();
  if (save.lastPlayedDate === t) return 0;

  const prev = save.lastPlayedDate ? new Date(save.lastPlayedDate + "T00:00:00Z") : null;
  const cur = new Date(t + "T00:00:00Z");
  let bonus = 0;

  if (!prev) { save.streak = 1; bonus = 150; }
  else {
    const diffDays = Math.round((cur - prev) / 86400000);
    if (diffDays === 1) save.streak += 1; else save.streak = 1;
    bonus = 100 + Math.min(900, save.streak * 30);
  }

  save.lastPlayedDate = t;
  save.credits += bonus;
  saveSave(save);
  updateSideStats();
  toast(`Daily bonus: +${bonus} credits (streak ${save.streak})`);
  return bonus;
}

const menu = document.getElementById("menu");
const toggleSheetBtn = document.getElementById("toggleSheet");
function setMenuCollapsed(v){
  if (!menu) return;
  menu.dataset.collapsed = v ? "true" : "false";
  if (toggleSheetBtn) toggleSheetBtn.textContent = v ? "Expand" : "Collapse";
}
setMenuCollapsed(true);
toggleSheetBtn?.addEventListener("click", () => { setMenuCollapsed(menu.dataset.collapsed !== "true"); });
document.getElementById("sheetHandle")?.addEventListener("click", () => { setMenuCollapsed(menu.dataset.collapsed !== "true"); });

const gameover = document.getElementById("gameover");
let lastRunScore = 0;
let selectedShop = new Set();

function renderShop() {
  const el = document.getElementById("shop");
  el.innerHTML = SHOP_ITEMS.map(item => {
    const on = selectedShop.has(item.id);
    return `
      <div class="shop-item">
        <div class="left">
          <div class="label">${item.label}</div>
          <div class="cost">${item.cost} credits</div>
        </div>
        <div class="toggle">
          <input type="checkbox" ${on ? "checked" : ""} data-shop="${item.id}" />
        </div>
      </div>
    `;
  }).join("");
  el.querySelectorAll("input[data-shop]").forEach(inp => {
    inp.addEventListener("change", () => {
      const id = inp.dataset.shop;
      if (inp.checked) selectedShop.add(id); else selectedShop.delete(id);
      hapticsLight();
    });
  });
}

function renderChars() {
  const grid = document.getElementById("charGrid");
  grid.innerHTML = Object.entries(CHARACTER_DEFS).map(([id, c]) => {
    const unlocked = !!save.unlocked[id];
    const sel = save.selected === id;
    const badge = unlocked ? `<span class="badge ok">Unlocked</span>` : `<span class="badge">${c.cost} cr</span>`;
    return `
      <div class="char ${sel ? "sel" : ""}" data-char="${id}">
        <div class="char-top">
          <div class="char-name">${c.name}</div>
          ${badge}
        </div>
        <div class="muted small">${c.desc}</div>
      </div>
    `;
  }).join("");
  grid.querySelectorAll(".char").forEach(el => el.addEventListener("click", () => {
    const id = el.dataset.char;
    const c = CHARACTER_DEFS[id];
    if (save.unlocked[id]) {
      save.selected = id;
      saveSave(save);
      renderChars();
      toast(`Selected: ${c.name}`);
      hapticsLight();
      return;
    }
    if (save.credits < c.cost) return toast("Not enough credits.");
    save.credits -= c.cost;
    save.unlocked[id] = true;
    save.selected = id;
    saveSave(save);
    updateSideStats();
    renderChars();
    toast(`Unlocked: ${c.name}`);
    hapticsLight();
  }));
}

renderChars();
renderShop();
renderLB();

let currentWallet = null;
async function loadWalletAddress() {
  try {
    const ethProvider = await sdk.wallet.getEthereumProvider();
    const [addr] = await ethProvider.request({ method: "eth_requestAccounts" });
    currentWallet = addr;
  } catch {}
}

/* -------- Game physics & rendering below (kept as-is from your file) -------- */
const world = { t:0, speed:340, speedMax:720, gravity:2600, floorY:585, camX:0 };
const player = { x:120, y:world.floorY-42, w:34, h:42, vy:0, onGround:true, jumpsLeft:3, coyote:0, jumpBuffer:0, invuln:0, shield:0 };
const run = { active:false, over:false, lives:3, maxLives:5, multiplier:1.0, comboTime:0, combo:0, distance:0, score:0, status:"", startLives:3, startShield:false, startMultiplier:1.0, speedBoost:0, shieldBoost:0 };
let entities = [];

function resetRun() {
  world.t=0; world.camX=0; world.speed=340;
  player.x=120; player.y=world.floorY-player.h; player.vy=0; player.onGround=true; player.jumpsLeft=3; player.coyote=0; player.jumpBuffer=0; player.invuln=0; player.shield=0;
  run.active=false; run.over=false; run.distance=0; run.score=0; run.multiplier=run.startMultiplier; run.combo=0; run.comboTime=0; run.lives=Math.min(run.maxLives, run.startLives); run.speedBoost=0; run.shieldBoost=0; run.status="—";
  entities=[];
  spawnInitial();
  updateHUD();
}
function spawnInitial(){ for(let i=0;i<6;i++) spawnChunk(world.camX+500+i*240); }
function rand(a,b){ return a+Math.random()*(b-a); }
function chance(p){ return Math.random()<p; }
function spawnChunk(xStart){
  const difficulty = Math.min(1, run.distance/22000);
  const obstacleProb = 0.35 + difficulty*0.35;
  const pickupProb = 0.22 + difficulty*0.10;
  const baseY = world.floorY;
  const lane = chance(0.5) ? "floor" : "air";
  const x = xStart + rand(0,120);

  if (chance(obstacleProb)) {
    const red=true;
    const tall=chance(0.25+difficulty*0.2);
    const h = tall ? rand(90,140) : rand(55,95);
    const y = baseY - h;
    entities.push({ type:"candle", red, x, y, w:26, h, hit:false });
  } else if (chance(0.25)) {
    const red=false;
    const h = rand(45,110);
    const y = baseY - h;
    entities.push({ type:"candle", red, x, y, w:22, h, hit:false, reward:1 });
  }

  if (chance(pickupProb)) {
    const kindRoll = Math.random();
    let kind="coin";
    if (kindRoll>0.90) kind="combo";
    else if (kindRoll>0.78) kind="shield";
    else if (kindRoll>0.64) kind="speed";
    else if (kindRoll>0.60) kind="heart";
    const y = lane==="air" ? baseY-rand(120,220) : baseY-40;
    entities.push({ type:"pickup", kind, x:x+rand(40,120), y, r:14, taken:false });
  }
}
function applyCharacterBonuses(){ const c = CHARACTER_DEFS[save.selected] || CHARACTER_DEFS.bull; return c.bonus; }
let bonuses = applyCharacterBonuses();

function startRun(){
  bonuses = applyCharacterBonuses();
  const temp = { startLives:3, startShield:false, startMultiplier:1.0 };
  for (const id of selectedShop) {
    const item = SHOP_ITEMS.find(s=>s.id===id);
    if (!item) continue;
    if (save.credits < item.cost) { toast(`Not enough credits for: ${item.label}`); continue; }
    save.credits -= item.cost;
    item.apply(temp);
  }
  saveSave(save); updateSideStats();
  run.startLives=temp.startLives; run.startShield=temp.startShield; run.startMultiplier=temp.startMultiplier;
  resetRun();
  run.active=true;
  menu.classList.add("hidden");
  handleDaily();
  if (run.startShield){ player.shield=1; run.status="Shield"; }
  loadWalletAddress().catch(()=>{});
}

function endRun(){
  run.active=false; run.over=true;
  gameover.classList.remove("hidden");
  lastRunScore = run.score;

  const earned = Math.max(0, Math.floor(run.score/120));
  save.credits += earned;

  const wk = weekKeyUTC(new Date());
  const isNewWeek = save.weekKey !== wk;
  if (isNewWeek){ save.weekKey=wk; save.bestWeek=0; }
  save.bestAllTime = Math.max(save.bestAllTime, Math.floor(run.score));
  save.bestWeek = Math.max(save.bestWeek, Math.floor(run.score));

  saveSave(save);
  updateSideStats();
  renderChars();
  renderLB();

  document.getElementById("goLine").textContent = `PnL: ${formatScore(run.score)}  •  Earned: +${earned} credits`;
}

function takeHit(){
  if (player.invuln>0) return;
  if (player.shield){
    player.shield=0;
    player.invuln=0.7;
    run.status="Shield broke";
    toast("Shield absorbed the hit.");
    hapticsLight();
    return;
  }
  run.lives -= 1;
  player.invuln=0.9;
  run.multiplier=1.0;
  run.combo=0;
  run.comboTime=0;
  run.status="Hit!";
  toast("Ouch. -1 life. Multiplier reset.");
  hapticsLight();
  if (run.lives<=0) endRun();
}

function gainLife(){
  if (run.lives>=run.maxLives) return;
  run.lives += 1;
  toast("+1 life");
  run.status="Healed";
  hapticsLight();
}

function addMultiplier(dt){
  run.comboTime += dt;
  if (run.comboTime>1.2){
    run.comboTime=0;
    run.combo += 1;
    const base = 1.0 + run.combo*0.04;
    run.multiplier = Math.min(4.0, base * bonuses.scoreMult);
    run.status = `Combo x${run.combo}`;
    if (run.combo%4===0) toast(`Combo up! x${run.multiplier.toFixed(2)}`);
  }
}

function applyPickup(kind){
  if (kind==="coin"){ run.score += 120 * run.multiplier; run.status="Green momentum"; }
  if (kind==="speed"){ run.speedBoost = 4.0 * bonuses.cooldownMult; run.status="Speed boost"; toast("Speed boost!"); }
  if (kind==="shield"){ player.shield=1; run.status="Shield"; toast("Shield up!"); }
  if (kind==="combo"){ run.speedBoost = 4.0 * bonuses.cooldownMult; player.shield=1; run.status="Combo power"; toast("Combo power-up!"); }
  if (kind==="heart"){ gainLife(); }
  hapticsLight();
}

function shortAddr(a){ return a ? a.slice(0,6)+"…"+a.slice(-4) : "—"; }

function updateHUD(){
  hudScore.textContent = formatScore(run.score);
  hudMult.textContent = "x" + run.multiplier.toFixed(2);
  hudLives.textContent = "❤".repeat(Math.max(0, run.lives)) + "♡".repeat(Math.max(0, 3-run.lives));
  const st=[];
  if (player.shield) st.push("Shield");
  if (run.speedBoost>0) st.push("Speed");
  hudStatus.textContent = st.length ? st.join(" + ") : (run.status || "—");
}

function requestJump(){ player.jumpBuffer=0.12; hapticsLight(); }
window.addEventListener("keydown",(e)=>{ if(e.code==="Space"){ e.preventDefault(); requestJump(); }});
canvas.addEventListener("pointerdown",(e)=>{ e.preventDefault(); requestJump(); });

function doJump(){
  if (player.jumpsLeft<=0) return false;
  player.vy = -860;
  player.onGround=false;
  player.jumpsLeft -= 1;
  player.coyote=0;
  player.jumpBuffer=0;
  run.status="Jump";
  return true;
}

function drawTerminalBG(){
  const w=canvas.width,h=canvas.height;
  ctx.fillStyle="#000"; ctx.fillRect(0,0,w,h);
  ctx.globalAlpha=0.18; ctx.strokeStyle="rgba(57,255,20,0.55)"; ctx.lineWidth=1;
  for(let x=0;x<w;x+=42){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=46){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.globalAlpha=1;
  ctx.strokeStyle="rgba(57,255,20,0.9)"; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(0,world.floorY); ctx.lineTo(w,world.floorY); ctx.stroke();
  ctx.globalAlpha=0.12; ctx.lineWidth=10;
  ctx.beginPath(); ctx.moveTo(0,world.floorY); ctx.lineTo(w,world.floorY); ctx.stroke();
  ctx.globalAlpha=1;
}
function drawCandle(ent){
  const sx = ent.x - world.camX;
  const w = ent.w;
  const color = ent.red ? "rgba(255,53,94,0.95)" : "rgba(57,255,20,0.95)";
  const glow = ent.red ? "rgba(255,53,94,0.22)" : "rgba(57,255,20,0.22)";
  ctx.strokeStyle=color; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(sx+w/2, ent.y-18); ctx.lineTo(sx+w/2, ent.y+ent.h+18); ctx.stroke();
  ctx.fillStyle=color; ctx.fillRect(sx, ent.y, w, ent.h);
  ctx.fillStyle=glow; ctx.fillRect(sx-6, ent.y-6, w+12, ent.h+12);
}
function drawPickup(ent){
  const sx=ent.x-world.camX; const y=ent.y;
  let col="rgba(57,255,20,0.95)";
  if(ent.kind==="shield") col="rgba(0,229,255,0.95)";
  if(ent.kind==="speed") col="rgba(255,209,102,0.95)";
  if(ent.kind==="combo") col="rgba(255,79,216,0.95)";
  if(ent.kind==="heart") col="rgba(255,53,94,0.95)";
  ctx.fillStyle=col; ctx.beginPath(); ctx.arc(sx,y,ent.r,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=0.18; ctx.beginPath(); ctx.arc(sx,y,ent.r+10,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
}
function drawBull(){
  const px=player.x, py=player.y;
  const g=(a)=>`rgba(57,255,20,${a})`; const r=(a)=>`rgba(255,53,94,${a})`;
  ctx.fillStyle=g(0.92);
  ctx.fillRect(px,py+10,28,22);
  ctx.fillRect(px+18,py,16,18);
  ctx.fillRect(px+2,py+32,8,10);
  ctx.fillRect(px+18,py+32,8,10);
  ctx.fillStyle="rgba(231,247,238,0.9)";
  ctx.fillRect(px+24,py-2,6,4);
  ctx.fillRect(px+30,py+2,6,4);
  ctx.fillStyle=r(0.95);
  ctx.fillRect(px+28,py+6,3,3);
  if(player.shield){
    ctx.strokeStyle="rgba(0,229,255,0.9)"; ctx.lineWidth=3; ctx.globalAlpha=0.8;
    ctx.beginPath(); ctx.arc(px+18,py+20,28,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=1;
  }
  if(player.invuln>0){ ctx.globalAlpha=(Math.floor(world.t*20)%2)?0.35:1; }
  ctx.globalAlpha=1;
}
function collideAABB(a,b){ return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y; }

let last = performance.now();
function tick(now){
  const dt = Math.min(0.033,(now-last)/1000);
  last = now;
  if(run.active && !run.over) update(dt);
  render();
  requestAnimationFrame(tick);
}
function update(dt){
  world.t += dt;
  const speedBoostFactor = run.speedBoost>0 ? 1.25 : 1.0;
  const target = Math.min(world.speedMax, 340 + run.distance/26);
  world.speed = target * bonuses.speedMult * speedBoostFactor;

  run.distance += world.speed*dt;
  world.camX += world.speed*dt;

  if(run.speedBoost>0) run.speedBoost -= dt;
  if(player.invuln>0) player.invuln -= dt;

  if(!player.onGround) player.coyote -= dt;
  if(player.jumpBuffer>0) player.jumpBuffer -= dt;

  player.vy += world.gravity*dt;
  player.y += player.vy*dt;

  if(player.y+player.h >= world.floorY){
    player.y = world.floorY - player.h;
    player.vy = 0;
    if(!player.onGround){ player.onGround=true; player.jumpsLeft=3; }
    player.coyote=0.10;
  } else {
    if(player.onGround){ player.onGround=false; player.coyote=0.10; }
  }

  if(player.jumpBuffer>0){
    if(player.onGround || player.coyote>0) doJump();
    else if(player.jumpsLeft>0) doJump();
  }

  const farX = world.camX + canvas.width + 600;
  const lastSpawnX = entities.length ? entities[entities.length-1].x : world.camX;
  if(lastSpawnX < farX) spawnChunk(farX);

  const pBox = { x: player.x, y: player.y, w: player.w, h: player.h };
  for(const ent of entities){
    if(ent.type==="candle"){
      const box = { x: ent.x-world.camX, y: ent.y, w: ent.w, h: ent.h };
      if(ent.red){
        if(collideAABB(pBox, box)) takeHit();
      } else {
        if(!ent.hit && collideAABB(pBox, box)){
          ent.hit=true;
          run.score += 250*run.multiplier;
          run.status="Momentum +";
          toast("Momentum candle!");
        }
      }
    } else if (ent.type==="pickup" && !ent.taken){
      const dx = (ent.x-world.camX) - (player.x+player.w/2);
      const dy = ent.y - (player.y+player.h/2);
      if(dx*dx+dy*dy < (ent.r+20)*(ent.r+20)){
        ent.taken=true;
        applyPickup(ent.kind);
      }
    }
  }

  addMultiplier(dt);
  run.score += (world.speed*dt)*0.18*run.multiplier;

  entities = entities.filter(ent => (ent.x-world.camX) > -220);
  updateHUD();
}
function render(){
  drawTerminalBG();
  for(const ent of entities){
    const sx = ent.x-world.camX;
    if(sx<-80 || sx>canvas.width+80) continue;
    if(ent.type==="candle") drawCandle(ent);
    else if(ent.type==="pickup" && !ent.taken) drawPickup(ent);
  }
  drawBull();
  ctx.globalAlpha=0.20;
  ctx.strokeStyle="rgba(57,255,20,1)";
  ctx.lineWidth=2;
  ctx.beginPath();
  const base = world.floorY - 90;
  for(let x=0;x<canvas.width;x+=14){
    const y = base + Math.sin((x+world.t*220)/60)*10 + Math.sin((x+world.t*120)/26)*3;
    if(x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.globalAlpha=1;
}

document.getElementById("btnStart").addEventListener("click", () => startRun());
document.getElementById("btnReset").addEventListener("click", () => { localStorage.removeItem(LS_KEY); localStorage.removeItem(LB_KEY); location.reload(); });
document.getElementById("btnRetry").addEventListener("click", () => { gameover.classList.add("hidden"); selectedShop = new Set(); renderShop(); menu.classList.remove("hidden"); });
document.getElementById("btnMenu").addEventListener("click", () => { gameover.classList.add("hidden"); selectedShop = new Set(); renderShop(); menu.classList.remove("hidden"); });

(async function boot(){
  const ok = await ensureMiniAppOrBlock();
  if(!ok) return;
  await initSDK();
  resetRun();
  menu.classList.remove("hidden");
  requestAnimationFrame(tick);
})();
