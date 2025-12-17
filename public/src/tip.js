import { Attribution } from "https://esm.sh/ox/erc8021";

const BUILDER_CODE = "bc_4pl9badj";
const RECIPIENT = "0x5eC6AF0798b25C563B102d3469971f1a8d598121";

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

const BASE_MAINNET = "0x2105";
const BASE_SEPOLIA = "0x14a34";

function isHexString(v){ return typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v); }

function isProbablyValidAddress(a){
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

function isDisabled(){
  // Disable if builder code still TODO or recipient invalid/zero
  if(!BUILDER_CODE || BUILDER_CODE === "TODO_REPLACE_BUILDER_CODE") return true;
  if(!isProbablyValidAddress(RECIPIENT)) return true;
  if(RECIPIENT.toLowerCase() === "0x0000000000000000000000000000000000000000") return true;
  return false;
}
// Manual ERC-20 transfer encoding: selector a9059cbb + padded recipient + padded amount
function encodeTransfer(to, amountUnits){
  if(!isProbablyValidAddress(to)) throw new Error("Invalid recipient");
  if(typeof amountUnits !== "bigint") throw new Error("Amount must be BigInt");
  if(amountUnits <= 0n) throw new Error("Amount must be > 0");
  const selector = "a9059cbb";
  const paddedTo = to.slice(2).padStart(64, "0");
  const paddedAmt = amountUnits.toString(16).padStart(64, "0");
  return "0x" + selector + paddedTo + paddedAmt;
}

function dollarsToUnits(dollars){
  // dollars is string (e.g. "1.25"), convert to USDC units (6 decimals)
  const s = String(dollars).trim();
  if(!s) throw new Error("Enter amount");
  if(!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid amount");
  const [a,b=""] = s.split(".");
  const frac = (b + "000000").slice(0, USDC_DECIMALS);
  const units = BigInt(a) * 1000000n + BigInt(frac);
  if(units <= 0n) throw new Error("Amount must be > 0");
  return units;
}

async function ensureBase(toast){
  const chainId = await ethereum.request({ method:"eth_chainId" });
  if(chainId === BASE_MAINNET || chainId === BASE_SEPOLIA) return chainId;

  try{
    await ethereum.request({
      method:"wallet_switchEthereumChain",
      params:[{ chainId: BASE_MAINNET }]
    });
    return BASE_MAINNET;
  }catch(e){
    toast("Please switch to Base Mainnet in your wallet to tip.");
    throw e;
  }
}

function makeModal(){
  const modal = document.getElementById("tipModal");
  modal.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Tip modal">
      <div class="sheetHeader">
        <div class="sheetTitle">TIP (USDC on Base)</div>
        <button class="xBtn" id="closeTip" type="button">Close</button>
      </div>
      <div class="sheetBody">
        <div class="presetRow" id="presetRow">
          <button class="preset" data-amt="1" type="button">$1</button>
          <button class="preset" data-amt="5" type="button">$5</button>
          <button class="preset" data-amt="10" type="button">$10</button>
          <button class="preset" data-amt="25" type="button">$25</button>
        </div>

        <div class="inputRow">
          <input class="usd" id="customAmt" inputmode="decimal" placeholder="Custom amount (USD)" />
        </div>

        <button class="cta" id="cta" type="button">Send USDC</button>

        <div id="progress" class="progressWrap" hidden>
          <div id="bar" class="progressBar"></div>
        </div>

        <div class="subtle" id="hint">
          Tip uses ERC-5792 <span style="opacity:.85">(wallet_sendCalls)</span>.
          If builder config is missing, sending is disabled.
        </div>
      </div>
    </div>
  `;
  return modal;
}

export function initTip({ toast }){
  const tipBtn = document.getElementById("tipBtn");
  const modal = makeModal();

  let selected = "1";
  let state = "idle"; // idle | preparing | confirmReady | confirm | sending | done
  let allowWallet = false; // idle | preparing | confirm | sending | done

  function open(){
    modal.hidden = false;
    state = "idle";
    allowWallet = false;
    render();
  }
  function close(){
    modal.hidden = true;
    allowWallet = false;
    state = "idle";
  }

  tipBtn.addEventListener("click", open);
  modal.addEventListener("click", (e)=>{
    if(e.target === modal) close();
  });
  modal.querySelector("#closeTip").addEventListener("click", close);

  modal.querySelector("#presetRow").addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-amt]");
    if(!btn) return;
    selected = btn.getAttribute("data-amt");
    modal.querySelector("#customAmt").value = "";
    render();
  });

  modal.querySelector("#customAmt").addEventListener("input", ()=>{
    // when typing custom, prefer that
    render();
  });

  function setBar(p){
    const bar = modal.querySelector("#bar");
    bar.style.width = `${Math.max(0, Math.min(100, p))}%`;
  }

  function setProgress(on){
    modal.querySelector("#progress").hidden = !on;
    if(!on) setBar(0);
  }

  function render(){
    const cta = modal.querySelector("#cta");
    const custom = modal.querySelector("#customAmt").value.trim();
    const amt = custom || selected;

    const disabled = isDisabled() || !window.ethereum;

    if(!window.ethereum){
      cta.disabled = true;
      cta.textContent = "Wallet not available";
      return;
    }

    if(disabled){
      cta.disabled = true;
      cta.textContent = "Send USDC";
      return;
    }

    cta.disabled = false;

    if(state === "idle") cta.textContent = "Send USDC";
    if(state === "preparing") cta.textContent = "Preparing tip…";
    if(state === "confirmReady") cta.textContent = "Confirm in wallet";
    if(state === "confirm") cta.textContent = "Confirm in wallet";
    if(state === "sending") cta.textContent = "Sending…";
    if(state === "done") cta.textContent = "Send again";

    // Basic validation hint (non-blocking)
    try{
      dollarsToUnits(amt);
      modal.querySelector("#hint").textContent = `You will send $${amt} USDC to ${RECIPIENT.slice(0,6)}…${RECIPIENT.slice(-4)} on Base.`;
    }catch{
      modal.querySelector("#hint").textContent = "Enter a valid amount > 0.";
    }
  }

  async function animatePrepare(ms=1200){
    state = "preparing";
    setProgress(true);
    render();
    const start = performance.now();
    return new Promise((resolve)=>{
      function tick(now){
        const t = (now-start)/ms;
        setBar(t*100);
        if(t >= 1) return resolve();
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  async function sendTip(){
    const custom = modal.querySelector("#customAmt").value.trim();
    const amt = custom || selected;

    if(isDisabled()){
      toast("Tips disabled: set BUILDER_CODE + RECIPIENT in src/tip.js");
      return;
    }

    if(!window.ethereum){
      toast("Wallet not available in this context.");
      return;
    }

    let amountUnits;
    try{
      amountUnits = dollarsToUnits(amt);
    }catch(e){
      toast(String(e.message || e));
      return;
    }

    // Two-step flow to preserve user gesture:
    // 1st tap: animate 1–1.5s (pre-wallet UX requirement)
    // 2nd tap: open wallet immediately (wallet popups often require a direct user gesture)
    if(state === "idle"){
      allowWallet = true;
      await animatePrepare(1200 + Math.floor(Math.random()*250)); // 1–1.5s
      setProgress(false);
      state = "confirmReady";
      render();
      return;
    }

    if(state !== "confirmReady"){
      return;
    }

    try{
      state = "confirm";
      render();

      await ensureBase(toast);

      const [from] = await ethereum.request({ method:"eth_requestAccounts" });

      const dataSuffix = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

      const data = encodeTransfer(RECIPIENT, amountUnits);

      state = "sending";
      render();

      // ERC-5792 wallet_sendCalls with ALL required fields
      await ethereum.request({
        method: "wallet_sendCalls",
        params: [{
          version: "2.0.0",
          from,
          chainId: BASE_MAINNET,
          atomicRequired: true,
          calls: [{
            to: USDC_CONTRACT,
            value: "0x0",
            data
          }],
          capabilities: {
            dataSuffix
          }
        }]
      });

      state = "done";
      render();
      toast("Tip sent. Thanks!");
    }catch(e){
      const msg = (e && (e.message || e.shortMessage)) ? (e.message || e.shortMessage) : String(e);
      if(/user rejected|rejected|denied/i.test(msg)){
        toast("Tip cancelled.");
      }else{
        toast("Tip failed. Check wallet + Base network.");
      }
      state = "idle";
      render();
    }
  }modal.querySelector("#cta").addEventListener("click", ()=>{
    if(state === "sending" || state === "preparing") return;
    if(state === "done") state = "idle";
    sendTip();
  });
render();
}
