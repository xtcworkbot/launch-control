/* Lab: Configure, Results, Compare, Import & Match (batch runs). Shared helpers: eng(), storage, charts. */


const TOOL_COLORS={deploy:"#ffffff",dev_buy:"#f0b429",front_mev:"#e5484d",back_mev:"#f76b15",temp_transfer:"#ffb224",holder_buy:"#d6409f",manual_buy:"#ab4aba",
 cleanup:"#8e4ec6",streamflow:"#6e56cf",volume_bot:"#3e63dd",autobuy:"#0091ff",autosell:"#00b8d9",sniper_guard:"#ff2d2d",manual_sell:"#ff7a7a",
 sniper:"#a18072",organic:"#46a758",copy_trade:"#12a594",real:"#e6edf3"};
const GROUP_COLORS={"dev":"#f0b429","front MEV":"#e5484d","back MEV":"#f76b15","temp holders":"#ffb224","holders (plan)":"#d6409f","volume wallets":"#3e63dd",
 "snipers":"#a18072","organic":"#46a758","copy-traders":"#12a594","Streamflow escrow":"#6e56cf","withdraw route":"#00b8d9","other":"#6b7280"};
const PAL=["#e5484d","#3e63dd","#f0b429","#12a594","#d6409f","#8e4ec6","#f76b15","#0091ff","#46a758","#ffb224","#ab4aba","#00b8d9"];
let SCHEMA=[],DEFAULTS={},cur={},curOrigin=null,LIB=[],RUN=null,hiddenTools=new Set(),hiddenGroups=new Set(),CMP=null,G=null,MATCH=null,cmpPick=new Set();
const $=id=>document.getElementById(id);
const fmt=(x,d=2)=>x==null||isNaN(x)?"–":(+x).toLocaleString(undefined,{maximumFractionDigits:d});
const mmss=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// ---------------- SOL/USD: market caps are shown in USD. Live price (CoinGecko, Coinbase as backup), refreshed every
// 5 min and cached; a manual price overrides it (e.g. the SOL price on the day a real launch happened). The simulation
// itself stays in SOL.
let SOLUSD=null,SOLSRC="",MCUSD=null;   // MCUSD: the SOL price on the day of a real launch being viewed (historical USD market caps)
const lsGet=(k,d)=>{try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},lsSet=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
async function refreshSolPrice(force){
  const man=lsGet("lc-solusd-manual",null);if(man>0){SOLUSD=man;SOLSRC="manual";return onSolPrice()}
  const fresh=lsGet("lc-solusd-live",null);if(!force&&fresh&&fresh.p>0&&Date.now()-fresh.at<300000){SOLUSD=fresh.p;SOLSRC=fresh.src;return onSolPrice()}   // reuse a price under 5 min old
  const tries=[["Coinbase","https://api.coinbase.com/v2/prices/SOL-USD/spot",j=>+j.data.amount],["CoinGecko","https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",j=>j.solana.usd]];
  for(const [n,u,f] of tries){try{const r=await fetch(u,{cache:"no-store"});const p=f(await r.json());if(p>0){SOLUSD=p;SOLSRC=n;lsSet("lc-solusd-live",{p,at:Date.now(),src:n});return onSolPrice()}}catch(e){}}
  const c=lsGet("lc-solusd-live",null);if(c&&c.p>0){SOLUSD=c.p;SOLSRC=`${c.src}, cached ${new Date(c.at).toLocaleDateString()}`}onSolPrice()}
function onSolPrice(){if(typeof window.solPriceChanged==="function")window.solPriceChanged()}
const usdFmt=v=>{const a=Math.abs(v);return "$"+(a>=1e9?(v/1e9).toFixed(2)+"B":a>=1e6?(v/1e6).toFixed(2)+"M":a>=1e4?(v/1e3).toFixed(1)+"K":a>=1e3?(v/1e3).toFixed(2)+"K":v.toFixed(0))};
// Market cap given in SOL -> "$12.3K" (falls back to SOL if no price is known yet)
const mcFmt=sol=>sol==null||isNaN(sol)?"–":(MCUSD||SOLUSD)?usdFmt(sol*(MCUSD||SOLUSD)):fmt(sol,sol<10?1:0)+" SOL";
const mcUnit=()=>SOLUSD?"USD":"SOL";
refreshSolPrice();setInterval(()=>{if(lsGet("lc-solusd-manual",null)==null)refreshSolPrice(true)},300000);
function err(m){const e=$("err");e.textContent=m;e.style.display="block";clearTimeout(err.t);err.t=setTimeout(()=>e.style.display="none",7000)}
// ---------------- engine worker (all simulation runs in the browser)
const W=new Worker("engine.js?v="+(window.LC_BUILD||"1"));let _id=0;const _wait=new Map();
W.onmessage=e=>{const m=e.data,p=_wait.get(m.id);if(!p)return;if(m.progress){p.prog&&p.prog(...m.progress);return}_wait.delete(m.id);m.ok?p.ok(m.result):p.no(new Error(m.error))};
W.onerror=e=>err("The simulation engine failed to load. Reload the page.");
function eng(op,payload={},prog,quiet){if(!quiet)$("busy").style.display="inline";return new Promise((ok,no)=>{const id=++_id;_wait.set(id,{ok,no,prog});W.postMessage({id,op,payload})})
  .catch(e=>{err(e.message);throw e}).finally(()=>{if(!_wait.size)$("busy").style.display="none"})}
// ---------------- storage: shared library (db) when available, else this browser
let DB=null,BUILTIN={},SAVED={},IMPORTS={};
const slug=n=>String(n).replace(/[^A-Za-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"untitled";
// theme: canvas charts read their greys from the CSS tokens, so they follow the light/dark toggle
let TH={};function readTheme(){const st=getComputedStyle(document.documentElement),v=k=>st.getPropertyValue(k).trim();
  TH={grid:v("--cv-grid"),grid2:v("--cv-grid2"),cross:v("--cv-cross"),truth:v("--cv-truth"),text:v("--text"),muted:v("--muted"),dim:v("--dim"),line2:v("--line-2"),bg:v("--bg")}}
function themeNow(){return document.documentElement.dataset.theme||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark")}
function setTheme(m){if(m)document.documentElement.dataset.theme=m;else delete document.documentElement.dataset.theme;try{m?localStorage.setItem("lc-theme",m):localStorage.removeItem("lc-theme")}catch(e){}
  readTheme();const b=$("st-theme");if(b)b.innerHTML=`<svg class="i"><use href="#i-${themeNow()==="light"?"moon":"sun"}"/></svg>${themeNow()==="light"?"Dark":"Light"}`;
  if(typeof window.redrawCharts==="function")window.redrawCharts()}
function toggleTheme(){setTheme(themeNow()==="light"?"dark":"light")}
try{const t=localStorage.getItem("lc-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}
matchMedia("(prefers-color-scheme: light)").addEventListener("change",()=>{if(!document.documentElement.dataset.theme)setTheme(null)});
const ls={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
function libMode(){$("libmode").textContent=DB?"Saved configurations are shared with everyone who can open this page.":"Saved configurations are kept in this browser only."}
async function connectDb(){try{if(!window.claude||!window.claude.use)return;const db=await window.claude.use("db");if(!db)return;DB=db;libMode();
  DB.collection("configs").onSnapshot(s=>{const o={};s.docs.forEach(d=>{const v=d.data();if(v&&v.config)o[v.config.name]=v.config});SAVED=o;loadLib()},()=>{DB=null;SAVED=ls.get("lab-configs",{});libMode();loadLib()})}catch(e){}}
// ---------------- tooltip
function tip(e,html){const t=$("tip");if(!html){t.style.display="none";return}t.innerHTML=html;t.style.display="block";
  const x=Math.min(e.clientX+14,innerWidth-t.offsetWidth-8),y=Math.min(e.clientY+14,innerHeight-t.offsetHeight-8);t.style.left=x+"px";t.style.top=y+"px"}
// ---------------- config form
function visible(f){const s=f[4].show;if(!s)return true;const neg=s.includes("!=");const [k,v]=s.split(neg?"!=":"=");
  if(v===undefined)return !!cur[k]&&visibleKey(k);const ok=String(cur[k])==v;return (neg?!ok:ok)&&visibleKey(k)}
function visibleKey(k){for(const [,fs] of SCHEMA)for(const f of fs)if(f[0]==k)return visible(f);return true}
function fieldHTML(f){const [k,label,typ,,ex]=f;const v=cur[k];const h=ex.help?`<span class="help">${esc(ex.help)}</span>`:"";
  if(typ=="bool")return `<label class="chk"><input type="checkbox" data-k="${k}" ${v?"checked":""}> ${esc(label)}</label>${h?`<div>${h}</div>`:""}`;
  if(typ=="select")return `<label>${esc(label)}<select data-k="${k}">${ex.options.map(o=>{const [ov,ol]=Array.isArray(o)?o:[o,o];return `<option value="${ov}" ${ov==v?"selected":""}>${esc(ol)}</option>`}).join("")}</select>${h}</label>`;
  if(typ=="multi")return `<label>${esc(label)}<div class="legend">${ex.options.map(o=>`<label class="chk"><input type="checkbox" data-m="${k}" value="${o}" ${(v||[]).includes(o)?"checked":""}> ${o}</label>`).join("")}</div>${h}</label>`;
  const rng=ex.range?` min="${ex.range[0]}" max="${ex.range[1]}"`:"";
  return `<label>${esc(label)}<input data-k="${k}" type="${typ=="text"?"text":"number"}" step="any" value="${esc(v??"")}"${rng}>${h}</label>`}
function renderForm(){$("cfgname").value=cur.name||"";
  const open=new Set([...document.querySelectorAll("details.sec[open]")].map(d=>d.dataset.s));const first=!document.querySelector("details.sec");
  $("form").innerHTML=SCHEMA.filter(([s])=>s!="Run"||true).map(([sec,fs],i)=>{const vis=fs.filter(f=>f[0]!="name"&&visible(f));
    return `<details class="sec" data-s="${esc(sec)}" ${(first?i<3:open.has(sec))?"open":""}><summary>${esc(sec)}</summary><div class="fields">${vis.map(f=>`<div>${fieldHTML(f)}</div>`).join("")}</div></details>`}).join("");
  $("form").querySelectorAll("[data-k]").forEach(el=>el.addEventListener("change",()=>{const k=el.dataset.k,t=fieldType(k);
    cur[k]=t=="bool"?el.checked:(t=="int"||t=="float")?+el.value:el.value;renderForm()}));
  $("form").querySelectorAll("[data-m]").forEach(el=>el.addEventListener("change",()=>{const k=el.dataset.m;
    cur[k]=[...$("form").querySelectorAll(`[data-m="${k}"]:checked`)].map(x=>x.value)}))}
function fieldType(k){for(const [,fs] of SCHEMA)for(const f of fs)if(f[0]==k)return f[2]}
async function loadLib(){LIB=[...Object.keys(BUILTIN).map(n=>({name:n,builtin:true})),...Object.keys(SAVED).sort().filter(n=>!BUILTIN[n]).map(n=>({name:n,builtin:false}))];
  $("lib").innerHTML=LIB.map(c=>{const nj=JSON.stringify(c.name).replace(/"/g,"&quot;");return `<div class="it ${c.name==curOrigin?"cur":""}"><input type="checkbox" aria-label="compare" ${cmpPick.has(c.name)?"checked":""} onchange="this.checked?cmpPick.add(${nj}):cmpPick.delete(${nj})">
   <span class="nm" title="${esc(c.name)}" onclick="loadCfg(${nj})">${esc(c.name)}</span>${c.builtin?'<span class="pill">built-in</span>':`<button class="g s" onclick="delCfg(${nj},this)">✕</button>`}</div>`}).join("");if($("t-compare").classList.contains("on"))renderPick()}
async function loadCfg(n){const c=BUILTIN[n]||SAVED[n];if(!c)return err("That configuration no longer exists.");cur=JSON.parse(JSON.stringify(c));curOrigin=n;renderForm();loadLib()}
async function delCfg(n,btn){if(btn.dataset.armed!="1"){btn.dataset.armed="1";btn.textContent="Delete?";setTimeout(()=>{btn.dataset.armed="";btn.textContent="✕"},3000);return}
  if(DB){try{await DB.doc("configs/"+slug(n)).delete()}catch(e){return err("You can't delete shared configurations with your access level.")}}else{delete SAVED[n];ls.set("lab-configs",SAVED);loadLib()}}
function loadDefaults(){cur=JSON.parse(JSON.stringify(DEFAULTS));curOrigin=null;renderForm();loadLib()}
async function saveCurrent(){cur.name=($("cfgname").value||"Untitled").trim();if(BUILTIN[cur.name])return err("That name belongs to a built-in configuration. Pick another name.");
  const c=await eng("normalise",{config:cur});cur=c;curOrigin=c.name;renderForm();
  if(DB){try{await DB.doc("configs/"+slug(c.name)).set({config:c,savedAt:new Date().toISOString()})}catch(e){err(e&&e.code=="invalid_argument"?"Your access level can't save to the shared library, so this was saved in your browser only.":"Saving to the shared library failed, so this was saved in your browser only.");SAVED[c.name]=c;ls.set("lab-configs",SAVED);loadLib()}}
  else{SAVED[c.name]=c;ls.set("lab-configs",SAVED);loadLib()}
  if(typeof toast==="function")toast(`Saved "${c.name}"`)}
async function cloneCurrent(){let n=($("cfgname").value||"Untitled")+" (copy)";while(BUILTIN[n]||SAVED[n])n+=" (copy)";$("cfgname").value=n;cur.name=n;await saveCurrent()}
async function runCurrent(){cur.name=$("cfgname").value||cur.name;RUN=await eng("run",{config:cur});show("results");renderResult()}
function compareSelected(){if(cmpPick.size<2)return err("Tick 2-4 configurations in the list first");show("compare");runCompare()}
// ---------------- canvas helpers
function prep(cv,h){const dpr=devicePixelRatio||1,W=cv.clientWidth;cv.width=W*dpr;cv.height=h*dpr;cv.style.height=h+"px";const x=cv.getContext("2d");x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,W,h);return [x,W,h]}
function scaleY(lo,hi,log,top,bot){if(log){lo=Math.max(lo,1e-3);const a=Math.log10(lo),b=Math.log10(hi);return v=>bot-(Math.log10(Math.max(v,1e-3))-a)/(b-a||1)*(bot-top)}return v=>bot-(v-lo)/(hi-lo||1)*(bot-top)}
function ticks(lo,hi,log){if(log){const out=[];for(let e=Math.floor(Math.log10(Math.max(lo,1e-3)));e<=Math.ceil(Math.log10(hi));e++)[1,2,5].forEach(m=>{const v=m*10**e;if(v>=lo&&v<=hi)out.push(v)});return out}
  const st=10**Math.floor(Math.log10((hi-lo)/4||1));const s=[1,2,5,10].map(m=>m*st).find(s=>(hi-lo)/s<=6)||st;const out=[];for(let v=Math.ceil(lo/s)*s;v<=hi;v+=s)out.push(v);return out}
// candles: bars [{t,o,h,l,c,v,tools}], markers [[t,mc,side,sol,tool,w]], overlays [{pts,color,label}]
function drawCandles(cv,data,o){const H=o.h||420;const [x,W]=prep(cv,H);const L=58,R=10,T=10,VB=o.novol?0:70,B=22;const pb=H-B-VB-(VB?8:0);
  let bars=data.bars;const xmax=o.xmax||Math.max(...bars.map(b=>b.t+data.step),1);bars=bars.filter(b=>b.t<=xmax);
  let lo=Infinity,hi=0;bars.forEach(b=>{lo=Math.min(lo,b.l);hi=Math.max(hi,b.h)});(o.overlays||[]).forEach(ov=>ov.pts.forEach(p=>{if(p[0]<=xmax){lo=Math.min(lo,p[1]);hi=Math.max(hi,p[1])}}));
  if(o.yr){lo=o.yr[0];hi=o.yr[1]}if(!isFinite(lo)){lo=1;hi=10}if(o.log){lo*=0.85;hi*=1.15}else{lo=Math.max(0,lo-(hi-lo)*0.05);hi*=1.05}
  const X=t=>L+(W-L-R)*t/xmax,Y=scaleY(lo,hi,o.log,T,pb);
  x.font="11px system-ui";x.fillStyle=TH.dim;x.strokeStyle=TH.grid;x.lineWidth=1;
  ticks(lo,hi,o.log).forEach(v=>{const y=Y(v);x.beginPath();x.moveTo(L,y);x.lineTo(W-R,y);x.stroke();x.fillText(mcFmt(v),4,y+4)});
  const nx=Math.min(8,Math.floor((W-L)/80));for(let i=0;i<=nx;i++){const t=xmax*i/nx;x.fillText(mmss(t),X(t)-12,H-6)}
  const bw=Math.max(1,(W-L-R)/(xmax/data.step)*0.7);
  bars.forEach(b=>{const cx=X(b.t+data.step/2),up=b.c>=b.o;x.strokeStyle=x.fillStyle=up?"#2ea043":"#e5484d";x.beginPath();x.moveTo(cx,Y(b.h));x.lineTo(cx,Y(b.l));x.stroke();
    const y1=Y(Math.max(b.o,b.c)),y2=Y(Math.min(b.o,b.c));x.fillRect(cx-bw/2,y1,bw,Math.max(1,y2-y1))});
  (o.overlays||[]).forEach(ov=>{x.strokeStyle=ov.color;x.lineWidth=1.6;x.setLineDash(ov.dash||[]);x.beginPath();let s=false;ov.pts.forEach(p=>{if(p[0]>xmax)return;const px=X(p[0]),py=Y(p[1]);s?x.lineTo(px,py):x.moveTo(px,py);s=true});x.stroke();x.setLineDash([]);x.lineWidth=1});
  if(o.markers){(o.markers||[]).forEach(m=>{if(m[0]>xmax||hiddenTools.has(m[4]))return;const c=TOOL_COLORS[m[4]]||"#999";const r=Math.min(6,1.5+Math.sqrt(m[3])*1.6);
    x.beginPath();x.arc(X(m[0]),Y(m[1]),r,0,7);if(m[2]=="b"){x.fillStyle=c+"cc";x.fill()}else{x.strokeStyle=c;x.stroke()}})}
  if(VB){const vt=H-B-VB,vmax=Math.max(...bars.map(b=>Object.entries(b.tools).filter(([k])=>!hiddenTools.has(k)).reduce((a,[,v])=>a+v,0)),1e-9);
    bars.forEach(b=>{let y=H-B;Object.entries(b.tools).forEach(([k,v])=>{if(hiddenTools.has(k))return;const h=v/vmax*VB;x.fillStyle=TOOL_COLORS[k]||"#777";x.fillRect(X(b.t+data.step/2)-bw/2,y-h,bw,h);y-=h})});
    x.fillStyle=TH.dim;x.fillText("vol",4,vt+10)}
  cv.onmousemove=e=>{const r=cv.getBoundingClientRect(),mx=e.clientX-r.left;const t=(mx-L)/(W-L-R)*xmax;const b=bars.find(b=>t>=b.t&&t<b.t+data.step);
    if(!b)return tip(e,null);const tools=Object.entries(b.tools).sort((a,c)=>c[1]-a[1]).map(([k,v])=>`<div><i style="display:inline-block;width:8px;height:8px;background:${TOOL_COLORS[k]||"#777"}"></i> ${k} ${fmt(v,3)} SOL</div>`).join("");
    const ov=(o.overlays||[]).map(v=>{const p=v.pts.filter(p=>p[0]<=t).pop();return p?`<div style="color:${v.color}">${esc(v.label)}: ${fmt(p[1],1)}</div>`:""}).join("");
    tip(e,`<b>${mmss(b.t)}–${mmss(b.t+data.step)}</b><br>MC O ${mcFmt(b.o)} H ${mcFmt(b.h)} L ${mcFmt(b.l)} C ${mcFmt(b.c)}<br>volume ${fmt(b.v,3)} SOL${tools}${ov}`)};cv.onmouseleave=e=>tip(e,null)}
function rebinCandles(c,step){if(!step)return c;const out={};let prev=null;c.bars.forEach(b=>{const k=Math.floor(b.t/step);let o=out[k];if(!o){o=out[k]={t:k*step,o:b.o,h:b.h,l:b.l,c:b.c,v:0,tools:{}}}
  o.h=Math.max(o.h,b.h);o.l=Math.min(o.l,b.l);o.c=b.c;o.v+=b.v;for(const [t,v] of Object.entries(b.tools))o.tools[t]=(o.tools[t]||0)+v});return {step,bars:Object.values(out).sort((a,b)=>a.t-b.t)}}
// lines: series [{pts,color,label,axis,dash}], stack: [{key,color,pts}]
function drawLines(cv,series,o){const H=o.h||300;const [x,W]=prep(cv,H);const L=46,R=46,T=10,B=22,pb=H-B;
  const xmax=o.xmax||Math.max(...series.flatMap(s=>s.pts.map(p=>p[0])),1);
  const ly=series.filter(s=>s.axis!="r").flatMap(s=>s.pts.map(p=>p[1])),ry=series.filter(s=>s.axis=="r").flatMap(s=>s.pts.map(p=>p[1]));
  let lmax=Math.max(o.lmax||0,...ly,1);if(o.stack)lmax=Math.max(lmax,...o.stack.reduce((acc,s)=>s.pts.map((p,i)=>(acc[i]||0)+p[1]),[]));lmax*=1.08;const rmax=Math.max(...ry,1)*1.08;
  const X=t=>L+(W-L-R)*t/xmax,YL=v=>pb-(v/lmax)*(pb-T),YR=v=>pb-(v/rmax)*(pb-T);
  x.font="11px system-ui";x.strokeStyle=TH.grid;x.fillStyle=TH.dim;
  ticks(0,lmax,false).forEach(v=>{const y=YL(v);x.beginPath();x.moveTo(L,y);x.lineTo(W-R,y);x.stroke();x.fillText(fmt(v,0)+(o.lunit||""),2,y+4)});
  if(ry.length)ticks(0,rmax,false).forEach(v=>x.fillText(fmt(v,0),W-R+4,YR(v)+4));
  const nx=Math.min(8,Math.floor((W-L)/80));for(let i=0;i<=nx;i++){const t=xmax*i/nx;x.fillText(mmss(t),X(t)-12,H-6)}
  if(o.stack){let base=null;o.stack.forEach(s=>{const top=s.pts.map((p,i)=>(base?base[i]:0)+p[1]);x.fillStyle=s.color+"aa";x.beginPath();
    s.pts.forEach((p,i)=>{const px=X(p[0]),py=YL(top[i]);i?x.lineTo(px,py):x.moveTo(px,py)});for(let i=s.pts.length-1;i>=0;i--)x.lineTo(X(s.pts[i][0]),YL(base?base[i]:0));x.closePath();x.fill();base=top})}
  series.forEach(s=>{x.strokeStyle=s.color;x.lineWidth=s.w||1.8;x.setLineDash(s.dash||[]);x.beginPath();s.pts.forEach((p,i)=>{const px=X(p[0]),py=(s.axis=="r"?YR:YL)(p[1]);i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke();x.setLineDash([]);x.lineWidth=1});
  cv.onmousemove=e=>{const r=cv.getBoundingClientRect(),t=(e.clientX-r.left-L)/(W-L-R)*xmax;if(t<0||t>xmax)return tip(e,null);
    const rows=series.map(s=>{const p=s.pts.filter(p=>p[0]<=t).pop();return p?`<div style="color:${s.color}">${esc(s.label)}: ${fmt(p[1],1)}${s.axis=="r"?"":(o.lunit||"")}</div>`:""}).join("");
    const st=(o.stack||[]).map(s=>{const p=s.pts.filter(p=>p[0]<=t).pop();return p&&p[1]>0.05?`<div style="color:${s.color}">${esc(s.key)}: ${fmt(p[1],1)}%</div>`:""}).join("");tip(e,`<b>${mmss(t)}</b>${rows}${st}`)};
  cv.onmouseleave=e=>tip(e,null)}
// ---------------- results
function renderResult(){if(!RUN)return;$("noresult").style.display="none";$("result").style.display="block";const s=RUN.summary,op=s.operator;
  $("rtitle").textContent=RUN.config.name;
  const st=[["Peak MC",mcFmt(s.peak_mc_sol)],["Peak at",mmss(s.peak_t)],["Graduated",s.graduated_t==null?"no":mmss(s.graduated_t)],["Final MC",mcFmt(s.final_mc_sol)],
    ["Trades",fmt(s.trades,0)],["Volume",fmt(s.volume_sol,0)+" SOL"],["Plan supply",fmt(s.plan.plan_supply_pct,1)+"%"],["Operator P&L",`<span class="${op.pnl_sol>=0?"up":"down"}">${op.pnl_sol>=0?"+":""}${fmt(op.pnl_sol,1)} SOL</span>`],
    ["Organic P&L",`<span class="${(s.pnl_by_group.organic||0)>=0?"up":"down"}">${fmt(s.pnl_by_group.organic||0,1)} SOL</span>`]];
  $("rstats").innerHTML=st.map(([k,v])=>`<div class="stat"><small>${k}</small><span>${v}</span></div>`).join("");
  const tools=[...new Set(RUN.markers.map(m=>m[4]))];
  $("lg-tools").innerHTML=tools.map(t=>`<span class="${hiddenTools.has(t)?"off":""}" onclick="hiddenTools.has('${t}')?hiddenTools.delete('${t}'):hiddenTools.add('${t}');renderResult()"><i style="background:${TOOL_COLORS[t]||"#777"}"></i>${esc((typeof TOOL_NAMES!=="undefined"&&TOOL_NAMES[t])||t)} (${RUN.markers.filter(m=>m[4]==t).length})</span>`).join("")+`<span class="mute">● buy ○ sell · click to hide</span>`;
  $("report").innerHTML=RUN.report.map(r=>`<div class="sig"><span class="lv ${r.level}">${r.level.toUpperCase()}</span><b>${esc(r.name)}</b><div>${esc(r.value)}</div><div class="help">${esc(r.detail)}</div>${r.evidence.length?`<ul>${r.evidence.map(e=>`<li>${esc(e)}</li>`).join("")}</ul>`:""}</div>`).join("");
  $("timeline").innerHTML="<table>"+RUN.timeline.map(([t,m])=>`<tr><td class="mute">${mmss(t)}</td><td>${esc(m)}</td></tr>`).join("")+"</table>";
  const pl=s.plan;$("econ").innerHTML=`<table><tr><td>Funding sent to plan wallets</td><td>${fmt(pl.funding_total_sol,2)} SOL</td></tr><tr><td>Funding started before launch</td><td>${fmt(pl.funding_hours_before_launch,1)} h</td></tr>
   <tr><td>Operator bought / sold</td><td>${fmt(op.bought_sol,1)} / ${fmt(op.sold_sol,1)} SOL</td></tr><tr><td>Tool's 5% sell fee</td><td>${fmt(op.proxima_fee_sol,2)} SOL</td></tr><tr><td>Creator fees accrued</td><td>${fmt(op.creator_fees_sol,2)} SOL</td></tr>
   <tr><td>Operator tokens left</td><td>${fmt(op.tokens_left_pct,2)}%</td></tr>${Object.entries(s.pnl_by_group).map(([g,v])=>`<tr><td>P&L ${esc(g)}</td><td class="${v>=0?"up":"down"}">${fmt(v,2)} SOL</td></tr>`).join("")}</table><p class="help">Gas and Jito tips are included in balances. Organic traders' losses fund most of the operator's profit.</p>`;
  $("tophold").innerHTML="<tr><th>Wallet</th><th>%</th><th>Group (truth)</th></tr>"+RUN.holders.top.map(h=>`<tr><td>${h.wallet}</td><td>${fmt(h.pct,2)}</td><td>${esc(h.group)}</td></tr>`).join("");
  GC={src:()=>RUN&&RUN.graph,cv:"cv-graph",mode:"gmode",lg:"lg-graph",org:"gorg",tab:"t-results",h:560};G=null;drawResult();relayout()}
function drawResult(){if(!RUN||!$("t-results").classList.contains("on"))return;const xr=+$("xr").value,dur=RUN.config.duration_min*60;
  drawCandles($("cv-candles"),rebinCandles(RUN.candles,+$("ivl").value),{log:$("logy").checked,markers:$("mk").checked?RUN.markers:null,xmax:xr||dur});
  const ser=RUN.holders.series,xmax=xr||dur;const groups=[...new Set(ser.flatMap(s=>Object.keys(s.groups)))];
  const stack=$("stack").checked?groups.filter(g=>!hiddenGroups.has(g)).map(g=>({key:g,color:GROUP_COLORS[g]||"#777",pts:ser.filter(s=>s.t<=xmax).map(s=>[s.t,s.groups[g]||0])})):null;
  drawLines($("cv-holders"),[{label:"top-10 share",color:TH.text,pts:ser.filter(s=>s.t<=xmax).map(s=>[s.t,s.top10])},{label:"holders",color:TH.dim,axis:"r",dash:[4,3],pts:ser.filter(s=>s.t<=xmax).map(s=>[s.t,s.holders])}],{stack,lunit:"%",xmax});
  $("lg-holders").innerHTML=`<span><i style="background:#fff"></i>top-10 share (%)</span><span><i style="background:#8b949e"></i>holder count (right axis)</span>`+(stack?groups.map(g=>`<span class="${hiddenGroups.has(g)?"off":""}" onclick="hiddenGroups.has('${g}')?hiddenGroups.delete('${g}'):hiddenGroups.add('${g}');drawResult()"><i style="background:${GROUP_COLORS[g]||"#777"}"></i>${esc(g)}</span>`).join(""):"")}
// ---------------- funding graph (force layout)
let GC={src:()=>RUN&&RUN.graph,cv:"cv-graph",mode:"gmode",lg:"lg-graph",org:"gorg",tab:"t-results",h:560};
function relayout(){const g=GC.src();if(!g)return;const keep=g.nodes.filter(n=>n.hub||n.cluster>0||!n.trader||$(GC.org).checked||n.size>0.5||n.truth!="organic");
  const ids=new Set(keep.map(n=>n.id));const edges=g.edges.filter(e=>ids.has(e[0])&&ids.has(e[1]));
  const deg={};edges.forEach(e=>{deg[e[0]]=(deg[e[0]]||0)+1;deg[e[1]]=(deg[e[1]]||0)+1});
  const nodes=keep.filter(n=>deg[n.id]||n.size>0.05);const idx={};nodes.forEach((n,i)=>{idx[n.id]=i;const a=(n.cluster||i)*2.399;n.x=Math.cos(a)*(100+(n.cluster?60:220))+Math.random()*30;n.y=Math.sin(a)*(100+(n.cluster?60:220))+Math.random()*30;n.vx=n.vy=0;n.r=n.hub?9:2.5+Math.sqrt(n.size)*4;n.deg=deg[n.id]||0});
  const E=edges.filter(e=>idx[e[0]]!=null&&idx[e[1]]!=null).map(e=>[idx[e[0]],idx[e[1]],e[2],e[3],e[4]]);
  for(let it=0;it<160;it++){const k=1-it/160;for(let i=0;i<nodes.length;i++){const a=nodes[i];for(let j=i+1;j<nodes.length;j++){const b=nodes[j];let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+0.01;if(d2>40000)continue;const f=(a.hub||b.hub?900:300)/d2;dx*=f;dy*=f;a.vx+=dx;a.vy+=dy;b.vx-=dx;b.vy-=dy}}
    E.forEach(([i,j])=>{const a=nodes[i],b=nodes[j];const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01,L=(a.hub||b.hub)?90:28,f=(d-L)*0.02;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f});
    nodes.forEach(n=>{n.vx-=n.x*0.004;n.vy-=n.y*0.004;n.x+=Math.max(-12,Math.min(12,n.vx))*k;n.y+=Math.max(-12,Math.min(12,n.vy))*k;n.vx*=0.5;n.vy*=0.5})}
  G={nodes,E};drawGraph()}
function drawGraph(){if(!G||!$(GC.tab).classList.contains("on"))return;const [x,W,H]=prep($(GC.cv),GC.h);const mode=$(GC.mode).value;
  const xs=G.nodes.map(n=>n.x),ys=G.nodes.map(n=>n.y);const minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);
  const s=Math.min((W-40)/(maxx-minx||1),(H-40)/(maxy-miny||1));const P=n=>[20+(n.x-minx)*s+((W-40)-(maxx-minx)*s)/2,20+(n.y-miny)*s+((H-40)-(maxy-miny)*s)/2];
  const col=n=>n.hub?TH.dim:mode=="truth"?(GROUP_COLORS[n.truth]||TH.muted):(n.cluster?PAL[(n.cluster-1)%PAL.length]:TH.line2);
  G.E.forEach(([i,j,t])=>{const [x1,y1]=P(G.nodes[i]),[x2,y2]=P(G.nodes[j]);x.strokeStyle=t=="tok"?"#8e4ec6aa":"#55606e66";x.setLineDash(t=="tok"?[4,3]:[]);x.beginPath();x.moveTo(x1,y1);x.lineTo(x2,y2);x.stroke()});x.setLineDash([]);
  G.nodes.forEach(n=>{const [px,py]=P(n);x.beginPath();x.arc(px,py,n.r,0,7);x.fillStyle=col(n);x.fill();if(n.hub){x.fillStyle=TH.text;x.font="11px system-ui";x.fillText(n.label,px+11,py+4)}});
  const cl=[...new Set(G.nodes.filter(n=>n.cluster).map(n=>n.cluster))].sort((a,b)=>a-b);
  $(GC.lg).innerHTML=mode=="truth"?Object.entries(GROUP_COLORS).map(([g,c])=>`<span><i style="background:${c}"></i>${esc(g)}</span>`).join("")+`<span><i style="background:#9aa4b2"></i>relays/proxies/funders</span>`
    :cl.slice(0,12).map(c=>{const m=G.nodes.filter(n=>n.cluster==c);return `<span><i style="background:${PAL[(c-1)%PAL.length]}"></i>cluster ${c}: ${m.filter(n=>n.trader).length} traders, ${fmt(m.reduce((a,n)=>a+n.size,0),1)}% peak</span>`}).join("")+`<span><i style="background:#3a4350"></i>not linked</span><span><i style="background:#6b7280"></i>public hub</span>`;
  $(GC.cv).onmousemove=e=>{const r=$(GC.cv).getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;let best=null,bd=144;
    G.nodes.forEach(n=>{const [px,py]=P(n),d=(px-mx)**2+(py-my)**2;if(d<bd+n.r*n.r){bd=d;best=n}});if(!best)return tip(e,null);
    tip(e,`<b>${esc(best.label)}</b>${best.hub?" (public hub)":""}<br>peak holding ${fmt(best.size,2)}% · ${best.deg} links<br>${best.cluster?`linked cluster ${best.cluster}`:"not linked"}${mode=="truth"?`<br>truth: ${esc(best.truth)}`:""}`)};$(GC.cv).onmouseleave=e=>tip(e,null)}
// ---------------- compare
function renderPick(){$("cmp-pick").innerHTML=LIB.map(c=>`<label class="chk"><input type="checkbox" ${cmpPick.has(c.name)?"checked":""} onchange='this.checked?cmpPick.add(${JSON.stringify(c.name).replace(/'/g,"&#39;")}):cmpPick.delete(${JSON.stringify(c.name).replace(/'/g,"&#39;")})'> ${esc(c.name)}</label>`).join("")}
async function runCompare(){const items=[...cmpPick].filter(n=>BUILTIN[n]||SAVED[n]).slice(0,4);if(items.length<2)return err("Pick 2 to 4 configurations.");CMP=await eng("compare",{configs:items.map(n=>BUILTIN[n]||SAVED[n])});drawCompare()}
function drawCompare(){if(!CMP)return;const runs=CMP.runs;const shared=$("cmpy").checked;let lo=Infinity,hi=0;runs.forEach(r=>r.candles.bars.forEach(b=>{lo=Math.min(lo,b.l);hi=Math.max(hi,b.h)}));
  const sigIds=runs[0].report.map(s=>s.id);const fpKeys=["b0_supply","grid","bundle_pairs","rt_wallets","cb_ratio","cs_ratio","buyback","lpeak","ltpeak","top10_300"];
  $("cmpout").innerHTML=`<div class="cmpcols">${runs.map((r,i)=>`<div class="card"><h3>${esc(r.config.name)}</h3><div class="stats"><div class="stat"><small>Peak MC</small><span>${mcFmt(r.summary.peak_mc_sol)}</span></div><div class="stat"><small>at</small><span>${mmss(r.summary.peak_t)}</span></div><div class="stat"><small>Final MC</small><span>${mcFmt(r.summary.final_mc_sol)}</span></div><div class="stat"><small>Op P&L</small><span class="${r.summary.operator.pnl_sol>=0?"up":"down"}">${fmt(r.summary.operator.pnl_sol,1)} SOL</span></div></div><canvas id="cmp-c${i}" height="260"></canvas></div>`).join("")}</div>
   <div class="card" style="margin-top:12px"><h3>Top-10 holder share over time</h3><canvas id="cmp-h" height="260"></canvas><div class="legend">${runs.map((r,i)=>`<span><i style="background:${PAL[i]}"></i>${esc(r.config.name)}</span>`).join("")}</div></div>
   <div class="grid two" style="margin-top:12px"><div class="card"><h3>Detection signals</h3><div class="scroll"><table><tr><th>Signal</th>${runs.map(r=>`<th>${esc(r.config.name)}</th>`).join("")}</tr>
   ${sigIds.map(id=>`<tr><td>${esc(runs[0].report.find(s=>s.id==id).name)}</td>${runs.map(r=>{const s=r.report.find(s=>s.id==id);return `<td title="${esc(s.value)}"><span class="lv ${s.level}" style="font-size:10px;padding:1px 5px;border-radius:3px">${s.level}</span></td>`}).join("")}</tr>`).join("")}</table></div>
   <h3 style="margin-top:14px">Fingerprint features</h3><div class="scroll"><table><tr><th>Feature</th>${runs.map(r=>`<th>${esc(r.config.name)}</th>`).join("")}</tr>${fpKeys.map(k=>`<tr><td>${k}</td>${runs.map(r=>`<td>${fmt(r.fingerprint[k],2)}</td>`).join("")}</tr>`).join("")}</table></div></div>
   <div class="card"><h3>Settings that differ</h3><div class="scroll"><table><tr><th>Setting</th>${runs.map(r=>`<th>${esc(r.config.name)}</th>`).join("")}</tr>${CMP.diff.map(d=>`<tr><td title="${esc(d[0])}">${esc(d[1])}</td>${d.slice(2).map(v=>`<td>${esc(Array.isArray(v)?v.join(","):typeof v=="number"?fmt(v,2):v)}</td>`).join("")}</tr>`).join("")}</table></div></div></div>`;
  runs.forEach((r,i)=>drawCandles($("cmp-c"+i),r.candles,{log:true,h:260,yr:shared?[lo,hi]:null,novol:false,xmax:r.candles.bars.length?0:(r.config.duration_min||30)*60}));
  drawLines($("cmp-h"),runs.map((r,i)=>({label:r.config.name,color:PAL[i],pts:r.holders.series.map(s=>[s.t,s.top10])})),{lunit:"%",h:260})}
// ---------------- import & match
const readFile=f=>new Promise((ok,no)=>{if(!f)return ok("");const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsText(f)});
async function doImport(){const t=$("ftrades").files[0];if(!t)return err("Choose a trades CSV first.");
  const name=($("impname").value||t.name.replace(/\.csv$/i,"")).trim();
  const rec=await eng("import",{name,trades_csv:await readFile(t),holders_csv:await readFile($("fholders").files[0]),transfers_csv:await readFile($("ftransfers").files[0])});
  IMPORTS[name]=rec;saveImports();loadImports();viewImport(name)}
// Imports carry their trades for the chart. If the browser's storage is full, drop stored trades from the biggest imports first (the read and fingerprint stay).
function saveImports(){if(ls.set("lab-imports",IMPORTS))return;const big=Object.values(IMPORTS).filter(i=>i.trades).sort((a,b)=>b.trades.length-a.trades.length);
  for(const i of big){delete i.trades;i.trades_dropped=true;if(ls.set("lab-imports",IMPORTS))return}}
async function loadImports(){if($("caselist"))$("caselist").innerHTML=caseList()||`<span class="mute">No cases bundled.</span>`;const l=Object.values(IMPORTS);$("implist").innerHTML=l.length?"<table>"+l.map(i=>{const nj=JSON.stringify(i.name).replace(/"/g,"&quot;");return `<tr><td>${esc(i.name)}</td><td class="mute">${i.n_trades} trades · ${mmss(i.duration_s)}</td><td><button class="g s" onclick="viewImport(${nj})">View</button> <button class="b s" onclick="doMatch(${nj})">Match</button> <button class="g s" onclick="dropImport(${nj},this)">✕</button></td></tr>`}).join("")+"</table>":`<p class="mute">Nothing imported yet. Import a CSV, or <button class="g s" onclick="demoImport()">load a demo</button> (a simulated launch exported as CSV, with its settings hidden).</p>`}
function dropImport(n,btn){if(btn.dataset.armed!="1"){btn.dataset.armed="1";btn.textContent="Delete?";return}delete IMPORTS[n];saveImports();loadImports()}
async function demoImport(){const cfg=Object.assign({},BUILTIN["Organic mode + Bundle volume"],{seed:99,duration_min:20});
  const csv=await eng("demo_csv",{config:cfg});const rec=await eng("import",{name:"Demo: mystery launch",trades_csv:csv});IMPORTS[rec.name]=rec;saveImports();loadImports();viewImport(rec.name)}
function viewImport(n){MATCH={import:IMPORTS[n],top:null,best_run:null};drawMatch()}
async function doMatch(n){const imp=IMPORTS[n];$("matchprog").hidden=false;$("matchbar").style.width="0";
  const lib=[...Object.values(BUILTIN),...Object.values(SAVED)];
  try{const res=await eng("match",{import:imp,library:lib,extra:+$("depth").value},(k,tot)=>{$("matchtxt").textContent=`${k} of ${tot} configurations tried`;$("matchbar").style.width=(k/tot*100)+"%"});
    MATCH=Object.assign({import:imp},res);drawMatch()}finally{$("matchprog").hidden=true}}
function readTimeline(r){if(!r)return"";const rows=[...r.phases.map(p=>[p.t0,`<b style="color:${PHASE_COLORS[p.kind]}">${PHASE_NAMES[p.kind]}</b>`,`${mmss(p.t0)}–${mmss(p.t1)}${p.drop?` · insider-held supply −${p.drop.toFixed(1)} pts`:""}`]),
  ...r.marks.map(k=>[k.t,`<b style="color:${MARK_COLORS[k.kind]||"#f4b23e"}">${esc(k.label)}</b>`,esc(k.text)])].sort((a,b)=>a[0]-b[0]);
  return `<div class="card" style="margin-top:12px"><h3>What the chart spotted, in order <span class="pill">${rows.length} events</span><span class="sp help">from the trades alone${r.linked?" and money links":""}</span></h3><div class="scroll" style="max-height:320px"><table><tbody>${rows.map(x=>`<tr><td class="data mute" style="width:60px">${mmss(x[0])}</td><td style="width:190px">${x[1]}</td><td>${x[2]}</td></tr>`).join("")}</tbody></table></div></div>`}
function chartCard(p,name,extra=""){return `<div class="card chart-card" style="margin-bottom:12px"><div class="chart-bar"><div class="seg" id="${p}tf"></div>${extra}<button class="btn sm ghost" id="${p}b-bubbles" onclick="${name}.toggleBubbles()"><svg class="i"><use href="#i-circles"/></svg><span>Hide bubbles</span></button>
  <button class="btn sm ghost on" onclick="${name}.toggleLog()" id="${p}b-log"><svg class="i"><use href="#i-log"/></svg><span>Log</span></button><button class="btn sm ghost" onclick="${name}.reset()"><svg class="i"><use href="#i-fit"/></svg>Fit</button>
  <span class="sp"></span><div class="legend" id="${p}tool-legend" style="margin:0"></div></div>${p==="i-"?`<div id="i-rp"></div>`:""}<div class="readbar" id="${p}readbar"></div>
  <div class="chart-wrap" id="${p}chartwrap"><div class="ohlc" id="${p}ohlc"></div><canvas id="${p}chart"></canvas><button class="btn sm golive" id="${p}golive" hidden onclick="${name}.reset()">Fit</button><div class="insp" id="${p}insp" hidden></div></div></div>`}
function drawMatch(){const m=MATCH,imp=m.import;const has=!!m.top;
  rpStop();MCUSD=imp.sol_usd||null;const lab=!!imp.story;
  $("matchout").innerHTML=caseHead(imp)+(imp.trades?chartCard("i-","ICH",lab?`<div class="seg" id="i-b-color" title="Colour bubbles and volume by"><button class="on" data-v="tool" onclick="ICH.setColor('tool')">Who it was</button><button data-v="read" onclick="ICH.setColor('read')">Detector read</button></div>`:""):`<div class="card" style="margin-bottom:12px"><p class="help" style="margin:0">${imp.trades_dropped?"This import's trades were dropped to fit the browser's storage. Import the CSV again to see the trade chart.":"Imported before the trade chart existed. Import the CSV again to see it."}</p></div>`)
    +`<div class="card"><h3>${esc(imp.name)} ${has?`vs best match: ${esc(m.top[0].name)} <span class="pill">distance ${fmt(m.top[0].distance,3)}</span> <span class="pill">${m.evaluated} configurations tried</span>`:""}</h3>
    <canvas id="m-c" height="380"></canvas><div class="legend"><span><i style="background:#2ea043"></i>real launch candles</span>${has?`<span><i style="background:#ffb224"></i>best match (sim, seed 1)</span>`:""}<span class="mute">real launch volume shown in white</span></div></div>
    ${imp.verdict?verdictCard(imp):""}${imp.wallets?whoCard(imp):""}${lab?storyCard(imp):""}${readTimeline(imp.read)}${glossary(imp)}
    ${imp.notes&&imp.notes.length?`<div class="card" style="margin-top:12px"><h3>About this data</h3>${imp.notes.map(n=>`<p class="help" style="margin:4px 0">${esc(n)}</p>`).join("")}</div>`:""}
    ${imp.signals?`<div class="card" style="margin-top:12px"><h3>Signals from the imported transfers <span class="pill">${imp.n_transfers} transfers</span><span class="sp help">public ledger only</span></h3>${imp.signals.map(r=>`<div class="sigrow"><span class="lv ${r.level}">${r.level.toUpperCase()}</span><b>${esc(r.name)}</b><span class="v">${esc(r.value)}</span></div><p class="help" style="margin:4px 0 0">${esc(r.detail)}${r.evidence&&r.evidence.length?` Address: <code>${esc(r.evidence[0])}</code>`:""}</p>`).join("")}</div>`:""}
    ${imp.holders||has?`<div class="card" style="margin-top:12px"><h3>Top-10 holder share</h3><canvas id="m-h" height="240"></canvas></div>`:""}
    ${has?`<div class="card" style="margin-top:12px"><h3>Closest configurations</h3><div class="scroll"><table><tr><th>#</th><th>Configuration</th><th>Distance</th><th>Mode / preset</th><th>Biggest mismatches (real → sim)</th><th></th></tr>
    ${m.top.map((t,i)=>`<tr><td>${i+1}</td><td>${esc(t.name)}</td><td>${fmt(t.distance,3)}</td><td>${t.config.mode} / ${t.config.preset}</td><td class="mute">${t.mismatch.map(x=>`${esc(x[1])} ${fmt(x[2],2)}→${fmt(x[3],2)}`).join(" · ")}</td><td><button class="g s" onclick="adopt(${i})">Open in Configure</button></td></tr>`).join("")}</table></div>
    <p class="help">Distance compares fingerprints (lower = closer). Matches are averaged over 2 seeds. A close match means the sim can produce a similar trace, not proof that this configuration was used.</p></div>`:`<p class="help">Press Match in the list to search configurations.</p>`}`;
  if(imp.trades){ICH=new LiveChart($("i-chart"),$("i-chartwrap"),"i-","ICH");ICH.title=imp.name;ICH.color=lab?"tool":"read";ICH.add(imp.trades);ICH.setNow(imp.trades[imp.trades.length-1][0],[]);ICH.setRead(imp.read);ICH.renderLegend();ICH.reset();ICH.followMode=false;rpInit(imp)}
  const real=imp.candles;const ov=has?[{label:"best match",color:"#ffb224",pts:m.best_run.candles.bars.map(b=>[b.t+m.best_run.candles.step/2,b.c])}]:[];
  drawCandles($("m-c"),real,{log:true,h:380,overlays:ov,xmax:imp.duration_s});
  if($("m-h")){const s=[];if(imp.holders)s.push({label:"real (holders CSV)",color:"#2ea043",pts:imp.holders.map(h=>[h.t,h.top10])});
    if(has)s.push({label:"best match",color:"#ffb224",pts:m.best_run.holders.series.map(h=>[h.t,h.top10])});drawLines($("m-h"),s,{lunit:"%",h:240,xmax:imp.duration_s})}}
function adopt(i){cur=JSON.parse(JSON.stringify(MATCH.top[i].config));cur.name=MATCH.top[i].name;curOrigin=null;renderForm();show("config")}


// ---------------- research cases (real launches shipped with the app) and the trade-by-trade replay
async function loadCase(k){const c=CASES[k];if(!c)return;toast("Loading "+c.name+"…");
  const rec=await eng("import",{name:c.name,trades_csv:c.csv,sol_usd:c.sol_usd});Object.assign(rec,{case:k,about:c.about,labels:c.labels,links:c.links,wallets:c.wallets,verdict:c.verdict,checks:c.checks});
  IMPORTS[rec.name]=rec;saveImports();loadImports();viewImport(rec.name)}
function caseList(){return typeof CASES==="undefined"?"":Object.entries(CASES).map(([k,c])=>`<button class="btn" onclick="loadCase('${k}')">${ICON("flag")}${esc(c.name)}</button>`).join(" ")}
function caseHead(imp){if(!imp.story&&!imp.about)return"";const g=imp.groups||{};
  return `<div class="card" style="margin-bottom:12px"><h3>${esc(imp.name)} <span class="pill">real on-chain trades</span><span class="pill">${imp.n_trades.toLocaleString()} swaps</span><span class="pill">${mmss(imp.duration_s)}</span>${imp.sol_usd?`<span class="pill">USD at $${imp.sol_usd.toFixed(2)}/SOL (launch day)</span>`:""}</h3>
  ${(imp.about||[]).map(a=>`<p class="help" style="margin:4px 0">${esc(a)}</p>`).join("")}
  ${Object.keys(g).length?`<div class="case-groups">${Object.entries(g).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<span data-tip="${esc((imp.labels||{})[k]||"")}"><i style="background:${TOOL_COLORS[k]||"#777"}"></i><b>${n}</b> ${esc(TOOL_NAMES[k]||k)}</span>`).join("")}</div>`:""}
  ${imp.links?`<p class="help" style="margin:6px 0 0">${imp.links.map(([t,u])=>`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join(" · ")}</p>`:""}</div>`}
function storyCard(imp){
  return `<div class="card" style="margin-top:12px"><h3>What happened, in order <span class="pill">${imp.story.length} events</span><span class="sp help">from the research labels: who each wallet is</span></h3><div class="scroll" id="rp-story" style="max-height:360px"><table><tbody>${imp.story.map((x,i)=>`<tr data-t="${x.t}" data-i="${i}" onclick="rpSeek(${x.t+0.4})" style="cursor:pointer"><td class="data mute" style="width:60px">${mmss(x.t)}</td><td style="width:210px"><span class="ctx"><i style="background:${x.who==="migration"?"#46a758":TOOL_COLORS[x.who]||"#777"}"></i><b>${esc(x.who==="migration"?"Migration":TOOL_NAMES[x.who]||x.who)}</b></span></td><td>${x.side?`<span class="${x.side==="buy"?"up":"down"}">${x.side==="buy"?"Buy":"Sell"}</span> `:""}${esc(x.text)}</td></tr>`).join("")}</tbody></table></div><p class="help" style="margin:6px 0 0">Click a row to jump the replay there. Lines group trades by the same kind of wallet within 2 s; outside traders are summed per 30 s.</p></div>`}
function glossary(imp){const L=imp.labels||{};const row=(c,n,t)=>`<tr><td style="width:230px"><span class="ctx"><i style="background:${c}"></i><b>${esc(n)}</b></span></td><td class="help">${esc(t)}</td></tr>`;
  return `<div class="card" style="margin-top:12px"><h3>What the labels mean</h3><table><tbody>
  ${Object.keys(L).length?`<tr><td colspan="2" class="mute" style="padding-top:2px">Who it was (research labels for this case)</td></tr>`+Object.entries(L).map(([k,t])=>row(TOOL_COLORS[k]||"#777",TOOL_NAMES[k]||k,t)).join(""):""}
  <tr><td colspan="2" class="mute" style="padding-top:8px">The chart's guess (from the trades alone, no inside knowledge)</td></tr>
  ${row(READ_COLORS.insider,READ_NAMES.insider,READ_HELP.insider)}
  ${row(READ_COLORS.bot,READ_NAMES.bot,READ_HELP.bot)}
  ${row(READ_COLORS.other,READ_NAMES.other,READ_HELP.other)}
  <tr><td colspan="2" class="mute" style="padding-top:8px">Marks under the chart</td></tr>
  ${row(MARK_COLORS.bundle,"Bought at launch","Buys in the moment the coin was created. In the launch tool this is the Block-0 bundle: the dev buy and the Front MEV wallets, sent together.")}
  ${row(MARK_COLORS.burst,"Bought together","3 or more new wallets buying in the same block (0.2 s). Real buyers arrive scattered; this is one script.")}
  ${row(MARK_COLORS.grid,"Buys on a timer","New wallets buying at a steady beat: a scheduled Buy Delay, like the launch tool's holder buys.")}
  ${row(MARK_COLORS.sell,"Team sold","Suspected team wallets selling 1% or more of the coin within a few seconds.")}
  ${row(MARK_COLORS.sweep,"Money collected","Many trading wallets sending their SOL to one address at once: the team cashing out.")}
  <tr><td colspan="2" class="mute" style="padding-top:8px">What's happening (coloured band above the chart)</td></tr>
  ${Object.keys(PHASE_NAMES).map(k=>row(PHASE_COLORS[k],PHASE_NAMES[k],PHASE_HELP[k])).join("")}
  </tbody></table><p class="help" style="margin:6px 0 0">The lower pane shows how much of the coin the suspected team holds.${imp.story?" The dashed line is what the labelled crew wallets really held, so you can see how much the trades-only read misses.":""}</p></div>`}
let RP=null;
function rpStop(){if(RP&&RP.timer){clearInterval(RP.timer);RP.timer=null}rpUI()}
function rpInit(imp){const T=imp.trades,dur=T[T.length-1][0];RP={imp,now:dur,i:T.length,timer:null,dur};
  const box=$("i-rp");if(!box)return;
  box.innerHTML=`<div class="replay"><button class="btn sm" id="rp-play" onclick="rpToggle()"></button><select id="rp-speed" title="Replay speed">${[1,2,5,10,30,60].map(v=>`<option value="${v}"${v===5?" selected":""}>${v}×</option>`).join("")}</select>
    <input type="range" id="rp-pos" min="0" max="${dur}" step="0.4" value="${dur}" oninput="rpSeek(+this.value)"><span class="data" id="rp-clock"></span><button class="btn sm ghost" onclick="rpEnd()">Show all</button></div><div class="rp-now" id="rp-now"></div>`;rpUI()}
// the read as it stood at time t: marks and phases so far, supply series up to t
function rpRead(r,t){if(!r)return null;const S=r.series.filter(b=>b.t<=t),z=S[S.length-1]||r.series[0];
  return Object.assign({},r,{stamp:"rp"+Math.round(t*4),series:S.length?S:r.series.slice(0,1),marks:r.marks.filter(m=>m.t<=t),phases:r.phases.filter(p=>p.t0<=t).map(p=>Object.assign({},p,{t1:Math.min(p.t1,t)})),
    held_now:z.held,truth_now:z.truth,held_peak:Math.max(0,...S.map(b=>b.held))})}
function rpSeek(t){if(!RP||!ICH)return;t=Math.max(0,Math.min(RP.dur,t));const c=ICH.color;ICH.clear();ICH.color=c;ICH.title=RP.imp.name;RP.i=0;ICH.view={x0:0,x1:Math.max(60,Math.min(240,t*1.1))};rpFeed(t)}
function rpFeed(t){const T=RP.imp.trades;let j=RP.i;while(j<T.length&&T[j][0]<=t)j++;if(j>RP.i){ICH.add(T.slice(RP.i,j));RP.i=j}
  RP.now=t;ICH.setNow(t,[]);ICH.setRead(rpRead(RP.imp.read,t));ICH.renderLegend();rpUI()}
function rpToggle(){if(!RP)return;if(RP.timer)return rpStop();if(RP.now>=RP.dur-0.01)rpSeek(0);
  RP.timer=setInterval(()=>{const sp=+(($("rp-speed")||{}).value||5),t=Math.min(RP.dur,RP.now+0.1*sp);rpFeed(t);if(t>=RP.dur)rpStop()},100);rpUI()}
function rpEnd(){if(!RP)return;rpStop();if(RP.i<RP.imp.trades.length||RP.now<RP.dur)rpFeed(RP.dur);ICH.reset();ICH.followMode=false;rpUI()}
function rpUI(){if(!RP||!$("rp-play"))return;const b=$("rp-play");b.innerHTML=RP.timer?"❚❚ Pause":"▶ "+(RP.now>=RP.dur-0.01?"Replay from start":"Play");
  $("rp-pos").value=RP.now;$("rp-clock").textContent=`${mmss(RP.now)} / ${mmss(RP.dur)} · ${RP.i.toLocaleString()} trades`;
  const st=RP.imp.story;if(!st)return;let k=-1;for(let i=0;i<st.length&&st[i].t<=RP.now;i++)k=i;const x=st[k];
  $("rp-now").innerHTML=RP.now>=RP.dur-0.01&&!RP.timer?`<span class="mute">Press Play to watch every real trade arrive in order, coloured by who made it. Click any row below to jump there.</span>`:x?`<b>${mmss(x.t)}</b> <span class="ctx"><i style="background:${x.who==="migration"?"#46a758":TOOL_COLORS[x.who]||"#777"}"></i>${esc(x.who==="migration"?"Migration":TOOL_NAMES[x.who]||x.who)}</span> ${esc(x.text)}`:`<span class="mute">Waiting for the first trade…</span>`;
  const box=$("rp-story");if(box)box.querySelectorAll("tr").forEach(tr=>{const on=+tr.dataset.i===k;tr.classList.toggle("future",+tr.dataset.t>RP.now);if(on&&!tr.classList.contains("cur")&&RP.timer){const y=tr.offsetTop-box.clientHeight/2;box.scrollTop=Math.max(0,y)}tr.classList.toggle("cur",on)})}

// ---------------- evidence: who each wallet is and how sure we are (research cases)
// wallets[addr] = [group label, level, behaviours[], evidence[[level, kind, text, sig]], buy SOL, sell SOL, % supply held at end, txs before first trade]
const LEVEL_NAMES={confirmed:"Confirmed link",likely:"Likely link",possible:"Pattern only",none:"No link found"};
const LEVEL_HELP={confirmed:"A direct on-chain tie: signed a swap together with another wallet, or moved SOL to/from it (including the one-use escrows). Not an opinion: anyone can open the transaction.",
  likely:"Funded just before its first trade by the same private wallet as another trader. Strong, but a shared funder could in principle be a service.",
  possible:"Only its trading looks coordinated (creation-block buy, first buy in a block with 2+ other new buyers). Timing alone can be coincidence or a public sniper bot.",
  none:"None of the checks found a tie. That is the closest the data gets to organic; it is not proof, because a careful operator can fund through an exchange."};
const LEVEL_COLORS={confirmed:"#e5484d",likely:"#f76b15",possible:"#f0b429",none:"#5f9cff"};
const BEH_NAMES={staged:"Staged",sniped_at_creation:"Sniped at creation",rotation_sell:"Rotation sell",rotation_buy:"Rotation buy",dumped:"Dumped",exited:"Exited",held_through_dump:"Held through dump"};
const BEH_HELP={staged:"Bought in the creation block as part of the launch: arranged before the token existed.",sniped_at_creation:"Bought in the creation block but no tie to the launch wallets was found: a sniper bot watching new tokens.",
  rotation_sell:"Sold, and the SOL went into a one-use escrow that another network wallet then spent on a buy: supply moving between their own wallets.",rotation_buy:"Bought with SOL taken from that escrow: a 'new buyer' paid for by another network wallet's sale.",
  dumped:"Sold inside the coordinated dump window.",exited:"Sold its whole position within the 30 minutes.",held_through_dump:"Bought before the dump and still held tokens after it: who absorbed the selling."};
const solscanTx=s=>`https://solscan.io/tx/${s}`,solscanAcc=a=>`https://solscan.io/account/${a}`;
function levelPill(l){return `<span class="lvpill" style="--c:${LEVEL_COLORS[l]||"#777"}" data-tip="${esc(LEVEL_HELP[l]||"")}">${esc(LEVEL_NAMES[l]||l)}</span>`}
function behChips(b){return b.map(x=>`<span class="beh" data-tip="${esc(BEH_HELP[x]||"")}">${esc(BEH_NAMES[x]||x)}</span>`).join("")}
function verdictCard(imp){const v=imp.verdict,row=(c,n,x)=>`<tr><td style="width:240px"><span class="ctx"><i style="background:${c}"></i><b>${esc(n)}</b></span></td><td>${x}</td></tr>`;
  return `<div class="card" style="margin-top:12px"><h3>What was staged, what was organic <span class="sp help">every line links back to transactions you can open on Solscan</span></h3>
  <div class="verdict-grid">${v.groups.map(g=>`<div class="vg" style="--c:${TOOL_COLORS[g.key]||"#777"}"><b>${esc(TOOL_NAMES[g.key]||g.key)}</b><span class="big">${g.wallets}</span><span class="mute">wallets · ${levelPill(g.level)}</span><span>bought <b>${solFmt(g.buy)}</b> · sold <b>${solFmt(g.sell)}</b> SOL</span><span class="${g.net>=0?"up":"down"}">net ${g.net>=0?"+":"−"}${solFmt(Math.abs(g.net))} SOL</span><span class="mute">${f2(g.buy_share,1)}% of all buying</span></div>`).join("")}</div>
  <table style="margin-top:10px"><tbody>
  ${v.steps.map(x=>row(x.color,x.name,`${esc(x.text)}${x.t!=null?` <button class="link" onclick="rpSeek(${x.t})">${mmss(x.t)} ›</button>`:""}`)).join("")}
  </tbody></table>
  <p class="help" style="margin:8px 0 0">${esc(v.note)}</p></div>`}
let WHO_F="all";
function whoCard(imp){return `<div class="card" style="margin-top:12px" id="who-card">${whoInner(imp)}</div>`}
function whoInner(imp){const W=imp.wallets,ks=Object.keys(W);
  const F={all:["All",()=>true],crew:["Crew",a=>/^crew/.test(W[a][0])],linked:["Other linked",a=>W[a][0]==="linked_other"],special:["Creator & snipers",a=>["creator","sniper","sniper_b5fm"].includes(W[a][0])],pattern:["Unlinked, pattern only",a=>W[a][0]==="outside_pattern"],nolink:["No link found",a=>W[a][0]==="outside"]};   // same groups as the chart legend
  const list=ks.filter(F[WHO_F][1]).sort((a,b)=>(W[b][4]+W[b][5])-(W[a][4]+W[a][5]));
  return `<h3>Who's who <span class="pill">${ks.length} wallets</span><span class="sp help">click a wallet for its evidence</span></h3>
  <div class="seg" style="margin-bottom:8px">${Object.entries(F).map(([k,[n,f]])=>`<button class="${WHO_F===k?"on":""}" onclick="WHO_F='${k}';$('who-card').innerHTML=whoInner(RP.imp)">${n} <span class="mute">${ks.filter(f).length}</span></button>`).join("")}</div>
  ${list.length>400?`<p class="help" style="margin:0 0 6px">Showing the 400 largest of ${list.length} (by SOL traded).</p>`:""}<div class="scroll" style="max-height:380px"><table><thead><tr><th>Wallet</th><th>Who</th><th>Evidence</th><th>What it did</th><th style="text-align:right">Bought</th><th style="text-align:right">Sold</th><th style="text-align:right">Net SOL</th><th style="text-align:right">Held at end</th></tr></thead><tbody>
  ${list.slice(0,400).map(a=>{const x=W[a],net=x[5]-x[4];return `<tr class="who-row" onclick="openCaseWallet('${a}')"><td class="data">${a.slice(0,6)}…${a.slice(-4)}</td><td><span class="ctx"><i style="background:${TOOL_COLORS[x[0]]||"#777"}"></i>${esc(TOOL_NAMES[x[0]]||x[0])}</span></td><td>${levelPill(x[1])}</td><td>${behChips(x[2])}</td><td class="data" style="text-align:right">${solFmt(x[4])}</td><td class="data" style="text-align:right">${solFmt(x[5])}</td><td class="data ${net>=0?"up":"down"}" style="text-align:right">${net>=0?"+":"−"}${solFmt(Math.abs(net))}</td><td class="data" style="text-align:right">${x[6]?f2(x[6],2)+"%":"–"}</td></tr>`}).join("")}</tbody></table></div>
`}
function openCaseWallet(a){const imp=RP&&RP.imp;if(!imp||!imp.wallets[a])return;const x=imp.wallets[a],T=imp.trades.filter(t=>t[8]===a);
  const lv={confirmed:0,likely:1,pattern:2,info:3};
  popup({title:"Wallet evidence",width:720,left:["Close"],head:`<b>${a.slice(0,6)}…${a.slice(-4)}</b> <span class="ctx" style="margin-left:8px"><i style="background:${TOOL_COLORS[x[0]]||"#777"}"></i>${esc(TOOL_NAMES[x[0]]||x[0])}</span> ${levelPill(x[1])}`,
    body:`<p class="help" style="margin:0 0 8px">${esc(LEVEL_HELP[x[1]])}</p>
    <p style="margin:0 0 10px"><a href="${solscanAcc(a)}" target="_blank" rel="noopener">${esc(a)}</a> ${x[7]!=null?`<span class="mute">· ${x[7]>=25?"25+":x[7]} transactions before its first SHARDS trade</span>`:""}</p>
    ${x[2].length?`<div style="margin-bottom:10px">${behChips(x[2])}</div>`:""}
    <h4 class="m0">Evidence</h4><table><tbody>${x[3].slice().sort((p,q)=>lv[p[0]]-lv[q[0]]).map(e=>`<tr><td style="width:110px">${e[0]==="info"?`<span class="mute">note</span>`:levelPill(e[0]==="pattern"?"possible":e[0])}</td><td>${esc(e[2])}${e[3]?` <a href="${solscanTx(e[3])}" target="_blank" rel="noopener">tx ›</a>`:""}</td></tr>`).join("")||`<tr><td class="mute">No link or pattern found by any check.</td></tr>`}</tbody></table>
    <h4 class="m0" style="margin-top:12px">Trades (${T.length})</h4><div class="scroll" style="max-height:220px"><table><tbody>${T.map(t=>`<tr><td class="data mute">${mmss(t[0])}</td><td class="${t[2]?"up":"down"}">${t[2]?"Buy":"Sell"}</td><td class="data" style="text-align:right">${solFmt(t[3])} SOL</td><td class="data" style="text-align:right">${f2(t[4]/1e7,2)}% supply</td><td class="data" style="text-align:right">MC ${mcFmt(t[1])}</td><td><button class="link" data-close onclick="rpSeek(${t[0]+0.4})">show ›</button></td></tr>`).join("")}</tbody></table></div>`})}
