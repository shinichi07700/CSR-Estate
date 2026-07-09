/* Palm Oil Executive Dashboard - Director / GM view */
const SHEET_ID = "1abTx2Ahfwa3-ZqnB4CY9FHSP41TdGY6z7HkSaITXiL8";
const GIDS = { harvest: 0, fert: 1757651789, ops: 881602558 };
const csvUrl = gid => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
const proxy  = u => `https://corsproxy.io/?${encodeURIComponent(u)}`;

const state = { rows: [], fert: [], ops: [], preset: "thisMonth", from: null, to: null, kebun: "__all", tab: "harvest" };
const charts = {};

/* ---------- Thresholds & benchmarks (single source of truth) ---------- */
const THRESHOLDS = {
  bjr:   { red: 8,   amber: 10, blue: 12 },   // kg/jjg; ≥blue = green
  loss:  { good: 5,  warn: 8 },                // % of jjg panen
  hk:    { low: 130, high: 180 },              // jjg/HK/day
  concentration: 50                            // % of total tonnage from one estate
};
function bjrColor(v){
  if(v < THRESHOLDS.bjr.red)   return "#ef4444";
  if(v < THRESHOLDS.bjr.amber) return "#f59e0b";
  if(v < THRESHOLDS.bjr.blue)  return "#3b82f6";
  return "#22c55e";
}

/* ---------- CSV parsing ---------- */
function parseCSV(text){
  const rows=[]; let i=0, field="", row=[], inQ=false;
  while(i<text.length){
    const c=text[i];
    if(inQ){
      if(c==='"' && text[i+1]==='"'){ field+='"'; i+=2; continue; }
      if(c==='"'){ inQ=false; i++; continue; }
      field+=c; i++;
    } else {
      if(c==='"'){ inQ=true; i++; continue; }
      if(c===','){ row.push(field); field=""; i++; continue; }
      if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=""; i++; continue; }
      if(c==='\r'){ i++; continue; }
      field+=c; i++;
    }
  }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  const [hdr,...body]=rows;
  return body.filter(r=>r.length>1).map(r=>Object.fromEntries(hdr.map((h,idx)=>[h.trim(),(r[idx]||"").trim()])));
}
const num = v => { if(v===null||v===undefined||v==="") return 0; const n=parseFloat(String(v).replace(/,/g,'')); return isFinite(n)?n:0; };
function parseLocalDate(dateStr){
  if(!dateStr) return null;
  const parts = dateStr.split("-").map(Number);
  if(parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1]-1, parts[2]);
}
const fmt = (v,d=0) => {
  if(!isFinite(v)) return "—";
  if(Math.abs(v)>=1e6) return (v/1e6).toFixed(2)+"M";
  if(Math.abs(v)>=1e3) return (v/1e3).toFixed(1)+"k";
  return v.toFixed(d);
};
const pct = (a,b) => (!b || !isFinite(b)) ? null : ((a-b)/Math.abs(b))*100;

async function fetchCsv(gid){
  const tryUrls = [csvUrl(gid), proxy(csvUrl(gid))];
  let text=null, lastErr=null;
  for(const u of tryUrls){
    try{ const r = await fetch(u,{cache:"no-store"}); if(r.ok){ text=await r.text(); break; } }
    catch(e){ lastErr=e; }
  }
  if(!text) throw lastErr || new Error("fetch failed for gid "+gid);
  return parseCSV(text);
}
/* ---------- Data load ---------- */
async function loadData(){
  const [rawH, rawF, rawO] = await Promise.all([fetchCsv(GIDS.harvest), fetchCsv(GIDS.fert), fetchCsv(GIDS.ops)]);
  const rows = rawH.map(r=>({
    id: r.id_trans, date: r.tanggal, kebun: r.kebun_code||"UNKNOWN",
    hk: num(r.hk_panen), luas: num(r.luas_panen),
    jjgPanen: num(r.jjg_panen), jjgKirim: num(r.jjg_kirim),
    restan: num(r.jjg_restan), afkir: num(r.jjg_afkir),
    tonase: num(r.tonase_kirim), brond: num(r.brondolan), bjr: num(r.bjr),
  })).filter(r=>r.date);
  rows.forEach(r=>{ const [Y,Mo,D]=r.date.split("-").map(Number); r.d = new Date(Y,Mo-1,D); });
  rows.sort((a,b)=>a.d-b.d);

  const fert = rawF.map(r=>({
    date: r.tanggal, kebun: r.kebun_code||"UNKNOWN",
    status: (r.status_tanaman||"").trim(),
    product: (r.nama_pupuk||"").replace(/^Pemupukan\s+/i,"").replace(/\s+TM$|\s+TBM$/i,"").trim() || "Unknown",
    haHi: num(r.ha_hi), kgHi: num(r.kg_hi),
    haSdhi: num(r.ha_sdhi), kgSdhi: num(r.kg_sdhi),
    haSdbi: num(r.ha_sdbi), kgSdbi: num(r.kg_sdbi),
  })).filter(r=>r.date);
  fert.forEach(r=>{ const [Y,Mo,D]=r.date.split("-").map(Number); r.d = new Date(Y,Mo-1,D); });

  const ops = rawO.map(r=>({
    date: r.tanggal, kebun: r.kebun_code||"UNKNOWN",
    hadir: num(r.tk_hadir_pct), mangkir: num(r.tk_mangkir_pct),
    rainHi: num(r.curah_hujan_hi),
    rainSdhi: num(r.curah_hujan_sdhi), rainDaysSdhi: num(r.hari_hujan_sdhi),
    rainSdbi: num(r.curah_hujan_sdbi), rainDaysSdbi: num(r.hari_hujan_sdbi),
    security: (r.situasi_keamanan||"").trim(), weather: (r.cuaca||"").trim(),
    note: r.catatan_perawatan||"",
  })).filter(r=>r.date);
  ops.forEach(r=>{ const [Y,Mo,D]=r.date.split("-").map(Number); r.d = new Date(Y,Mo-1,D); });

  state.rows = rows; state.fert = fert; state.ops = ops;

  const estates = Array.from(new Set([
    ...rows.map(r=>r.kebun), ...fert.map(r=>r.kebun), ...ops.map(r=>r.kebun)
  ])).sort();
  const sel = document.getElementById("kebunSel");
  sel.innerHTML = `<option value="__all">All Estates</option>` + estates.map(e=>`<option value="${e}">${e}</option>`).join("");
}

/* ---------- Period logic ---------- */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function periodFor(preset, rows){
  if(!rows.length) return {curFrom:new Date(), curTo:new Date(), cmpFrom:null, cmpTo:null, label:"no data"};
  const maxD = rows[rows.length-1].d;
  const y = maxD.getFullYear(), m = maxD.getMonth();
  const som = new Date(y,m,1), eom = new Date(y,m+1,0);
  const lm_som = new Date(y,m-1,1), lm_eom = new Date(y,m,0);
  const ly_som = new Date(y-1,m,1), ly_eom = new Date(y-1,m+1,0);
  const soy = new Date(y,0,1), soy_prev = new Date(y-1,0,1);
  const ytd_prev_end = new Date(y-1, m, maxD.getDate());
  const fmtRng = (a,b)=>`${ymd(a)} → ${ymd(b)}`;

  switch(preset){
    case "thisMonth":  return {curFrom:som,curTo:eom,cmpFrom:lm_som,cmpTo:lm_eom, label:`${monthName(som)} ${y}`, cmpLabel:`${monthName(lm_som)}`};
    case "lastMonth":  return {curFrom:lm_som,curTo:lm_eom,cmpFrom:new Date(y,m-2,1),cmpTo:new Date(y,m-1,0), label:`${monthName(lm_som)} ${lm_som.getFullYear()}`, cmpLabel:"prior month"};
    case "mom":        return {curFrom:som,curTo:eom,cmpFrom:lm_som,cmpTo:lm_eom, label:`MoM: ${monthName(som)} vs ${monthName(lm_som)}`, cmpLabel:monthName(lm_som)};
    case "yoy":        return {curFrom:som,curTo:eom,cmpFrom:ly_som,cmpTo:ly_eom, label:`YoY: ${monthName(som)} ${y} vs ${y-1}`, cmpLabel:`${monthName(som)} ${y-1}`};
    case "ytd":        return {curFrom:soy,curTo:maxD,cmpFrom:soy_prev,cmpTo:ytd_prev_end, label:`YTD ${y} vs YTD ${y-1}`, cmpLabel:`YTD ${y-1}`};
    case "custom": {
      const f = parseLocalDate(state.from) || som;
      const t = parseLocalDate(state.to)   || eom;
      const days = Math.max(1, Math.round((t-f)/86400000));
      const cmpTo = new Date(f); cmpTo.setDate(cmpTo.getDate()-1);
      const cmpFrom = new Date(cmpTo); cmpFrom.setDate(cmpFrom.getDate()-days);
      return {curFrom:f,curTo:t,cmpFrom,cmpTo, label:`Custom: ${fmtRng(f,t)}`, cmpLabel:"prior equal window"};
    }
  }
  return {curFrom:som,curTo:eom,cmpFrom:lm_som,cmpTo:lm_eom, label:`${monthName(som)} ${y}`, cmpLabel:monthName(lm_som)};
}
function monthName(d){ return d.toLocaleDateString("en-US",{month:"short"}); }

/* ---------- Aggregations ---------- */
function filter(rows,from,to,kebun){
  const t0 = new Date(from); t0.setHours(0,0,0,0);
  const t1 = new Date(to); t1.setHours(23,59,59,999);
  return rows.filter(r => r.d>=t0 && r.d<=t1 && (kebun==="__all"||r.kebun===kebun));
}
function metrics(rows){
  const ton = rows.reduce((a,r)=>a+r.tonase,0);
  const jjgP = rows.reduce((a,r)=>a+r.jjgPanen,0);
  const jjgK = rows.reduce((a,r)=>a+r.jjgKirim,0);
  const restan = rows.reduce((a,r)=>a+r.restan,0);
  const afkir  = rows.reduce((a,r)=>a+r.afkir,0);
  const luas  = rows.reduce((a,r)=>a+r.luas,0);
  const hk    = rows.reduce((a,r)=>a+r.hk,0);
  const brond = rows.reduce((a,r)=>a+r.brond,0);
  // BJR should be weighted by jjg_kirim (kg / jjg). Fallback to average bjr of rows if jjgK is 0.
  const tonKg = ton; const tonT = ton/1000;
  const bjrKg = jjgK ? tonKg/jjgK : (rows.length ? rows.reduce((a,r)=>a+r.bjr,0)/rows.length : 0);
  const yieldTHa = luas ? tonT/luas : 0;
  const hkProd = hk ? jjgP/hk : 0;
  const loss = jjgP ? ((restan+afkir)/jjgP)*100 : 0;
  const brondPct = tonKg ? (brond/tonKg)*100 : 0;
  const estates = new Set(rows.map(r=>r.kebun)).size;
  return { tonT, tonKg, jjgP, jjgK, restan, afkir, luas, hk, brond, bjr:bjrKg, yieldTHa, hkProd, loss, brondPct, estates };
}
function byDay(rows){
  const m = new Map();
  rows.forEach(r=>{
    const k = r.date;
    if(!m.has(k)) m.set(k,{date:k,ton:0});
    m.get(k).ton += r.tonase;
  });
  return Array.from(m.values()).sort((a,b)=>a.date.localeCompare(b.date));
}
function byEstate(rows){
  const m = new Map();
  rows.forEach(r=>{
    if(!m.has(r.kebun)) m.set(r.kebun,{kebun:r.kebun,ton:0,jjgK:0,luas:0,restan:0,afkir:0,jjgP:0,hk:0});
    const o=m.get(r.kebun);
    o.ton+=r.tonase; o.jjgK+=r.jjgKirim; o.luas+=r.luas; o.restan+=r.restan; o.afkir+=r.afkir; o.jjgP+=r.jjgPanen; o.hk+=r.hk;
  });
  return Array.from(m.values()).map(o=>({
    ...o,
    tonT: o.ton/1000,
    bjr: o.jjgK ? o.ton/o.jjgK : 0,
    yieldTHa: o.luas ? (o.ton/1000)/o.luas : 0,
    loss: o.jjgP ? ((o.restan+o.afkir)/o.jjgP)*100 : 0
  })).sort((a,b)=>b.tonT-a.tonT);
}

/* ---------- Rendering ---------- */
const baseOpt = {
  textStyle:{color:"#cbd5e1",fontFamily:"Inter"},
  tooltip:{trigger:"axis",backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}},
  grid:{left:40,right:20,top:24,bottom:28,containLabel:true},
};
function delta(el, cur, cmp, unit="", inverse=false){
  const p = pct(cur,cmp);
  if(p===null){ el.textContent="—"; el.className="mono delta-flat"; return; }
  const arrow = p>0 ? "▲" : (p<0 ? "▼" : "▬");
  const good = inverse ? p<0 : p>0;
  el.textContent = `${arrow} ${Math.abs(p).toFixed(1)}%${unit}`;
  el.className = "mono " + (p===0?"delta-flat": (good?"delta-up":"delta-down"));
}
function spark(id, values, color){
  const el = document.getElementById(id);
  const c = charts[id] || (charts[id]=echarts.init(el));
  c.setOption({
    grid:{left:0,right:0,top:2,bottom:2},
    xAxis:{type:"category",show:false,data:values.map((_,i)=>i)},
    yAxis:{type:"value",show:false},
    series:[{type:"line",data:values,smooth:true,symbol:"none",areaStyle:{opacity:0.25,color},lineStyle:{color,width:2}}],
    tooltip:{show:false}
  });
}

function render(){
  const {curFrom,curTo,cmpFrom,cmpTo,label,cmpLabel} = periodFor(state.preset, state.rows);
  document.getElementById("rangeLabel").textContent = `${ymd(curFrom)} → ${ymd(curTo)}`;
  document.getElementById("hlPeriodLabel").textContent = label;

  const cur = filter(state.rows, curFrom, curTo, state.kebun);
  const cmp = cmpFrom ? filter(state.rows, cmpFrom, cmpTo, state.kebun) : [];
  const M = metrics(cur), C = metrics(cmp);

  // KPI values
  document.getElementById("kpiTon").textContent = fmt(M.tonT,1);
  document.getElementById("kpiTonCmp").textContent = cmp.length ? `vs ${cmpLabel} (${fmt(C.tonT,1)}t)` : "no comparison data";
  delta(document.getElementById("kpiTonDelta"), M.tonT, C.tonT);

  document.getElementById("kpiBjr").textContent = M.bjr.toFixed(2);
  delta(document.getElementById("kpiBjrDelta"), M.bjr, C.bjr);

  document.getElementById("kpiYield").textContent = M.yieldTHa.toFixed(2);
  delta(document.getElementById("kpiYieldDelta"), M.yieldTHa, C.yieldTHa);

  document.getElementById("kpiLoss").textContent = M.loss.toFixed(1);
  delta(document.getElementById("kpiLossDelta"), M.loss, C.loss, "", true);

  document.getElementById("kpiHk").textContent = M.hkProd.toFixed(1);
  document.getElementById("kpiBrond").textContent = M.brondPct.toFixed(2);
  document.getElementById("kpiLuas").textContent = fmt(M.luas,0);
  document.getElementById("kpiEst").textContent = M.estates;

  // Sparklines
  const dCur = byDay(cur);
  spark("kpiTonSpark", dCur.map(x=>x.ton/1000), "#60a5fa");
  spark("kpiBjrSpark", dCur.map((_,i)=>{const s=cur.filter(r=>r.date===dCur[i].date); const tK=s.reduce((a,r)=>a+r.tonase,0); const jK=s.reduce((a,r)=>a+r.jjgKirim,0); return jK?tK/jK:0;}), "#a78bfa");
  spark("kpiYieldSpark", dCur.map((x)=>{const s=cur.filter(r=>r.date===x.date); const tK=s.reduce((a,r)=>a+r.tonase,0)/1000; const lu=s.reduce((a,r)=>a+r.luas,0); return lu?tK/lu:0;}), "#2dd4bf");
  spark("kpiLossSpark", dCur.map((x)=>{const s=cur.filter(r=>r.date===x.date); const jp=s.reduce((a,r)=>a+r.jjgPanen,0); const rs=s.reduce((a,r)=>a+r.restan+r.afkir,0); return jp?(rs/jp)*100:0;}), "#f59e0b");

  // Trend
  const dCmp = byDay(cmp);
  const trend = charts.trend || (charts.trend = echarts.init(document.getElementById("chartTrend")));
  trend.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>(v/1000).toFixed(1)+" t"},
    legend:{show:false},
    xAxis:{type:"category",data:dCur.map(x=>x.date.slice(5)),axisLine:{lineStyle:{color:"#334155"}},axisLabel:{color:"#94a3b8",fontSize:11}},
    yAxis:{type:"value",axisLabel:{color:"#94a3b8",formatter:v=>(v/1000)+"t"},splitLine:{lineStyle:{color:"#1e293b"}}},
    series:[
      {name:"Current",type:"bar",data:dCur.map(x=>x.ton),itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:"#60a5fa"},{offset:1,color:"#1e3a8a"}]),borderRadius:[4,4,0,0]},barWidth:"45%"},
      {name:"Compare",type:"line",smooth:true,data:dCmp.map(x=>x.ton),symbol:"circle",symbolSize:6,lineStyle:{color:"#64748b",type:"dashed",width:2},itemStyle:{color:"#94a3b8"}}
    ]
  }, true);

  // Loss donut
  const loss = charts.loss || (charts.loss = echarts.init(document.getElementById("chartLoss")));
  const shipped = Math.max(0, M.jjgK), rst=M.restan, afk=M.afkir;
  loss.setOption({
    tooltip:{trigger:"item",backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}},
    legend:{bottom:0,textStyle:{color:"#94a3b8"}},
    series:[{
      type:"pie", radius:["55%","78%"], center:["50%","46%"], avoidLabelOverlap:true,
      itemStyle:{borderColor:"#0b1220",borderWidth:2},
      label:{color:"#e5edff",formatter:"{b}\n{d}%"},
      data:[
        {name:"Shipped (Kirim)", value:shipped, itemStyle:{color:"#22c55e"}},
        {name:"Restan", value:rst, itemStyle:{color:"#f59e0b"}},
        {name:"Afkir (Rejected)", value:afk, itemStyle:{color:"#ef4444"}}
      ]
    }]
  }, true);

  // Estate bar+line
  const E = byEstate(cur);
  const est = charts.est || (charts.est = echarts.init(document.getElementById("chartEstate")));
  est.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",axisPointer:{type:"shadow"},backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}},
    legend:{data:["Tonnage (t)","Yield (t/Ha)"],textStyle:{color:"#94a3b8"},top:0},
    grid:{left:40,right:50,top:34,bottom:60,containLabel:true},
    xAxis:{type:"category",data:E.map(e=>e.kebun),axisLabel:{color:"#94a3b8",fontSize:10,rotate:30,interval:0},axisLine:{lineStyle:{color:"#334155"}}},
    yAxis:[
      {type:"value",name:"Tonnage",nameTextStyle:{color:"#64748b"},axisLabel:{color:"#94a3b8"},splitLine:{lineStyle:{color:"#1e293b"}}},
      {type:"value",name:"Yield t/Ha",nameTextStyle:{color:"#64748b"},axisLabel:{color:"#94a3b8"},splitLine:{show:false}}
    ],
    series:[
      {name:"Tonnage (t)",type:"bar",data:E.map(e=>+e.tonT.toFixed(1)),itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:"#2dd4bf"},{offset:1,color:"#0f766e"}]),borderRadius:[6,6,0,0]},barWidth:"50%"},
      {name:"Yield (t/Ha)",type:"line",yAxisIndex:1,data:E.map(e=>+e.yieldTHa.toFixed(2)),smooth:true,symbolSize:8,itemStyle:{color:"#f59e0b"},lineStyle:{width:3}}
    ]
  }, true);

  // BJR estate
  const bjr = charts.bjr || (charts.bjr = echarts.init(document.getElementById("chartBjr")));
  const sortedByBjr = [...E].sort((a,b)=>a.bjr-b.bjr);
  bjr.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",axisPointer:{type:"shadow"},backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>v.toFixed(2)+" kg"},
    grid:{left:80,right:20,top:10,bottom:20,containLabel:true},
    xAxis:{type:"value",axisLabel:{color:"#94a3b8"},splitLine:{lineStyle:{color:"#1e293b"}}},
    yAxis:{type:"category",data:sortedByBjr.map(e=>e.kebun),axisLabel:{color:"#94a3b8",fontSize:11},axisLine:{lineStyle:{color:"#334155"}}},
    series:[{
      type:"bar",
      data:sortedByBjr.map(e=>({value:+e.bjr.toFixed(2), itemStyle:{color: bjrColor(e.bjr)}})),
      barWidth:"60%",
      label:{show:true,position:"right",color:"#cbd5e1",formatter:"{c}"}
    }]
  }, true);

  // Radar
  const rad = charts.rad || (charts.rad = echarts.init(document.getElementById("chartRadar")));
  const bounds = {ton:Math.max(M.tonT,C.tonT,1), bjr:15, yield:5, hk:250, invLoss:100, invBrond:20};
  const scoreCur = [
    Math.min(100, M.tonT/bounds.ton*100),
    Math.min(100, M.bjr/bounds.bjr*100),
    Math.min(100, M.yieldTHa/bounds.yield*100),
    Math.min(100, M.hkProd/bounds.hk*100),
    Math.max(0, 100 - M.loss),
    Math.max(0, 100 - M.brondPct*5)
  ];
  const scoreCmp = [
    Math.min(100, C.tonT/bounds.ton*100),
    Math.min(100, C.bjr/bounds.bjr*100),
    Math.min(100, C.yieldTHa/bounds.yield*100),
    Math.min(100, C.hkProd/bounds.hk*100),
    Math.max(0, 100 - C.loss),
    Math.max(0, 100 - C.brondPct*5)
  ];
  rad.setOption({
    tooltip:{backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}},
    legend:{data:["Current","Compare"],textStyle:{color:"#94a3b8"},top:0},
    radar:{
      indicator:[
        {name:"Tonnage",max:100},{name:"BJR",max:100},{name:"Yield/Ha",max:100},
        {name:"HK Prod",max:100},{name:"Low Loss",max:100},{name:"Low Brondolan",max:100}
      ],
      axisName:{color:"#94a3b8",fontSize:11},
      splitLine:{lineStyle:{color:"#1e293b"}},
      splitArea:{areaStyle:{color:["#0f172a","#111a2e"]}},
      axisLine:{lineStyle:{color:"#1e293b"}}
    },
    series:[{
      type:"radar",
      data:[
        {value:scoreCur,name:"Current",areaStyle:{color:"rgba(59,130,246,0.35)"},lineStyle:{color:"#60a5fa",width:2},itemStyle:{color:"#60a5fa"}},
        {value:scoreCmp,name:"Compare",areaStyle:{color:"rgba(148,163,184,0.15)"},lineStyle:{color:"#64748b",width:2,type:"dashed"},itemStyle:{color:"#94a3b8"}}
      ]
    }]
  }, true);

  // Estate mix
  const mix = charts.mix || (charts.mix = echarts.init(document.getElementById("chartMix")));
  mix.setOption({
    tooltip:{trigger:"item",backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>fmt(v,1)+" t"},
    series:[{
      type:"pie", roseType:"radius", radius:["25%","72%"],
      itemStyle:{borderRadius:6,borderColor:"#0b1220",borderWidth:2},
      label:{color:"#cbd5e1",formatter:"{b}\n{d}%"},
      data: E.map((e,i)=>({name:e.kebun,value:+e.tonT.toFixed(1), itemStyle:{color:["#60a5fa","#2dd4bf","#a78bfa","#f59e0b","#22c55e","#ef4444","#38bdf8","#f472b6","#eab308"][i%9]}}))
    }]
  }, true);

  // Highlights
  renderHighlights(M, C, E, label, cmpLabel);

  // Also refresh the other two tabs so switching is instant
  renderFert(curFrom, curTo, cmpFrom, cmpTo, label, cmpLabel);
  renderOps(curFrom, curTo, cmpFrom, cmpTo, label, cmpLabel);
}

/* ---------- FERTILIZER ---------- */
function renderFert(curFrom,curTo,cmpFrom,cmpTo,label,cmpLabel){
  const cur = filter(state.fert, curFrom, curTo, state.kebun);
  const cmp = cmpFrom ? filter(state.fert, cmpFrom, cmpTo, state.kebun) : [];
  const sum = a => a.reduce((s,r)=>s+r,0);
  const kgHi = sum(cur.map(r=>r.kgHi));
  const haHi = sum(cur.map(r=>r.haHi));
  const kgHiCmp = sum(cmp.map(r=>r.kgHi));
  const rate = haHi ? kgHi/haHi : 0;
  const types = new Set(cur.filter(r=>r.kgHi>0||r.kgSdbi>0).map(r=>r.product)).size;

  document.getElementById("fKpiKg").textContent = (kgHi/1000).toFixed(2);
  document.getElementById("fKpiHa").textContent = fmt(haHi,1);
  document.getElementById("fKpiRate").textContent = fmt(rate,0);
  document.getElementById("fKpiTypes").textContent = types;
  const dEl = document.getElementById("fKpiKgDelta");
  if(kgHiCmp){ const p = pct(kgHi,kgHiCmp); dEl.textContent = `${p>=0?"▲":"▼"} ${Math.abs(p).toFixed(1)}% vs ${cmpLabel}`; dEl.className = "mono " + (p>=0?"delta-up":"delta-down"); }
  else dEl.textContent = "";

  // By product (use s/d BI to always show meaningful data when HI is 0)
  const prodMap = new Map();
  cur.forEach(r=>{
    const key = r.product;
    if(!prodMap.has(key)) prodMap.set(key,{p:key,kgHi:0,kgSdbi:0});
    const o = prodMap.get(key); o.kgHi += r.kgHi; o.kgSdbi += r.kgSdbi;
  });
  const prodsAll = Array.from(prodMap.values());
  const usingHi = prodsAll.some(p=>p.kgHi>0);
  const sortKey = usingHi ? "kgHi" : "kgSdbi";
  let prods = prodsAll.sort((a,b)=>b[sortKey]-a[sortKey]).slice(0,12);
  const chartProd = charts.fProd || (charts.fProd = echarts.init(document.getElementById("fChartProduct")));
  chartProd.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",axisPointer:{type:"shadow"},backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>fmt(v,0)+" kg"},
    grid:{left:120,right:20,top:10,bottom:20,containLabel:true},
    xAxis:{type:"value",axisLabel:{color:"#94a3b8"},splitLine:{lineStyle:{color:"#1e293b"}}},
    yAxis:{type:"category",data:prods.map(p=>p.p).reverse(),axisLabel:{color:"#94a3b8",fontSize:10},axisLine:{lineStyle:{color:"#334155"}}},
    series:[{
      type:"bar",
      data: prods.map(p=> usingHi ? p.kgHi : p.kgSdbi).reverse(),
      itemStyle:{color:new echarts.graphic.LinearGradient(1,0,0,0,[{offset:0,color:"#a78bfa"},{offset:1,color:"#4c1d95"}]),borderRadius:[0,4,4,0]},
      label:{show:true,position:"right",color:"#cbd5e1",formatter:v=>fmt(v.value,0)}
    }]
  }, true);

  // TM vs TBM
  let tm=0, tbm=0;
  cur.forEach(r=>{ const k = r.kgHi||r.kgSdbi; if(/TBM/i.test(r.status)) tbm+=k; else tm+=k; });
  const chartStatus = charts.fStatus || (charts.fStatus = echarts.init(document.getElementById("fChartStatus")));
  chartStatus.setOption({
    tooltip:{trigger:"item",backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>fmt(v,0)+" kg"},
    legend:{bottom:0,textStyle:{color:"#94a3b8"}},
    series:[{
      type:"pie", radius:["55%","78%"], center:["50%","46%"],
      itemStyle:{borderColor:"#0b1220",borderWidth:2},
      label:{color:"#e5edff",formatter:"{b}\n{d}%"},
      data:[
        {name:"TM (Mature)", value:tm, itemStyle:{color:"#22c55e"}},
        {name:"TBM (Immature)", value:tbm, itemStyle:{color:"#f59e0b"}}
      ]
    }]
  }, true);

  // By estate
  const estMap = new Map();
  cur.forEach(r=>{ if(!estMap.has(r.kebun)) estMap.set(r.kebun,{k:r.kebun,kg:0}); estMap.get(r.kebun).kg += (r.kgHi||r.kgSdbi); });
  const ests = Array.from(estMap.values()).sort((a,b)=>b.kg-a.kg);
  const chartEst = charts.fEst || (charts.fEst = echarts.init(document.getElementById("fChartEstate")));
  chartEst.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",axisPointer:{type:"shadow"},backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>fmt(v,0)+" kg"},
    grid:{left:40,right:20,top:10,bottom:40,containLabel:true},
    xAxis:{type:"category",data:ests.map(e=>e.k),axisLabel:{color:"#94a3b8",rotate:20,fontSize:10}},
    yAxis:{type:"value",axisLabel:{color:"#94a3b8"},splitLine:{lineStyle:{color:"#1e293b"}}},
    series:[{type:"bar",data:ests.map(e=>e.kg),itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:"#38bdf8"},{offset:1,color:"#0369a1"}]),borderRadius:[6,6,0,0]},barWidth:"55%"}]
  }, true);

  // Progress: sum HI / SDHI / SDBI (kg)
  const totHi   = sum(cur.map(r=>r.kgHi));
  const totSdhi = sum(cur.map(r=>r.kgSdhi));
  const totSdbi = sum(cur.map(r=>r.kgSdbi));
  const chartProg = charts.fProg || (charts.fProg = echarts.init(document.getElementById("fChartProgress")));
  chartProg.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>fmt(v,0)+" kg"},
    grid:{left:60,right:20,top:20,bottom:30,containLabel:true},
    xAxis:{type:"category",data:["Hari Ini","s/d HI","s/d BI"],axisLabel:{color:"#94a3b8"}},
    yAxis:{type:"value",axisLabel:{color:"#94a3b8",formatter:v=>fmt(v,0)},splitLine:{lineStyle:{color:"#1e293b"}}},
    series:[{
      type:"bar",
      data:[totHi,totSdhi,totSdbi],
      itemStyle:{color:function(p){return ["#60a5fa","#a78bfa","#22c55e"][p.dataIndex];},borderRadius:[6,6,0,0]},
      label:{show:true,position:"top",color:"#cbd5e1",formatter:p=>fmt(p.value,0)},
      barWidth:"45%"
    }]
  }, true);

  // Highlights
  const list = [];
  if(kgHi===0 && totSdbi>0){
    list.push({tone:"warn",t:"No fertilizer applied today",b:`No kg_hi logged in this period. Cumulative s/d BI is ${(totSdbi/1000).toFixed(1)}t — plan next application to stay on schedule.`});
  } else if(kgHi>0){
    list.push({tone:"good",t:"Active application",b:`${(kgHi/1000).toFixed(2)}t applied across ${fmt(haHi,1)} Ha (${fmt(rate,0)} kg/Ha blended rate).`});
  }
  if(tm+tbm>0){
    const tmShare = tm/(tm+tbm)*100;
    if(tmShare>=85) list.push({tone:"good",t:"Nutrition focused on TM",b:`${tmShare.toFixed(0)}% of fertilizer went to mature blocks — directly supports current-year FFB yield.`});
    else if(tbm/(tm+tbm)>0.30) list.push({tone:"warn",t:"Heavy TBM nutrition",b:`${(tbm/(tm+tbm)*100).toFixed(0)}% going to immature blocks — good for future yield, but check that TM is not under-fertilized.`});
  }
  if(prods.length){
    list.push({tone:"good",t:`Top product: ${prods[0].p}`,b:`Accounts for the largest share of consumption in this period. Confirm supply chain and price coverage.`});
  }
  if(ests.length>=2){
    const totKg = ests.reduce((s,e)=>s+e.kg,0);
    const share = totKg ? ests[0].kg/totKg*100 : 0;
    if(share>THRESHOLDS.concentration) list.push({tone:"warn",t:"Fertilizer concentrated",b:`${ests[0].k} consumed ${share.toFixed(0)}% of period fertilizer — verify allocation matches Ha ratio.`});
  }
  const dK = pct(kgHi,kgHiCmp);
  if(dK!==null){
    if(dK<=-30) list.push({tone:"warn",t:"Application pace slowing",b:`Down ${Math.abs(dK).toFixed(0)}% vs ${cmpLabel} — risk of falling behind budget schedule.`});
    else if(dK>=30) list.push({tone:"good",t:"Application pace accelerating",b:`Up ${dK.toFixed(0)}% vs ${cmpLabel} — good if catching up to budget; watch cash outflow.`});
  }
  document.getElementById("fHighlights").innerHTML = list.map(h=>`
    <div class="highlight-item ${h.tone}">
      <div class="font-semibold text-slate-100">${h.t}</div>
      <div class="text-slate-400 text-xs mt-0.5">${h.b}</div>
    </div>`).join("") || `<div class="text-slate-500 text-xs">No fertilizer activity in the selected period.</div>`;
}

/* ---------- OPS / WEATHER ---------- */
function renderOps(curFrom,curTo,cmpFrom,cmpTo,label,cmpLabel){
  const cur = filter(state.ops, curFrom, curTo, state.kebun);
  const rain = cur.reduce((a,r)=>a+r.rainHi,0);
  const rainDays = cur.reduce((m,r)=>Math.max(m,r.rainDaysSdbi||r.rainDaysSdhi||0),0);
  const withHadir = cur.filter(r=>r.hadir>0);
  const hadir = withHadir.length ? withHadir.reduce((a,r)=>a+r.hadir,0)/withHadir.length : 0;
  const withMang = cur.filter(r=>r.mangkir>0);
  const mang  = withMang.length ? withMang.reduce((a,r)=>a+r.mangkir,0)/withMang.length : 0;

  document.getElementById("oKpiRain").textContent = fmt(rain,0);
  document.getElementById("oKpiRainDays").textContent = rainDays.toFixed(0);
  document.getElementById("oKpiHadir").textContent = hadir? hadir.toFixed(0) : "—";
  document.getElementById("oKpiMangkir").textContent = mang? mang.toFixed(0) : "—";

  // Rain vs Ton
  const harvestCur = filter(state.rows, curFrom, curTo, state.kebun);
  const days = new Map();
  cur.forEach(r=>{ if(!days.has(r.date)) days.set(r.date,{d:r.date,rain:0,ton:0}); days.get(r.date).rain += r.rainHi; });
  harvestCur.forEach(r=>{ if(!days.has(r.date)) days.set(r.date,{d:r.date,rain:0,ton:0}); days.get(r.date).ton += r.tonase/1000; });
  const arr = Array.from(days.values()).sort((a,b)=>a.d.localeCompare(b.d));
  const chartRT = charts.oRT || (charts.oRT = echarts.init(document.getElementById("oChartRainTon")));
  chartRT.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}},
    legend:{data:["Rainfall (mm)","Tonnage (t)"],textStyle:{color:"#94a3b8"},top:0},
    grid:{left:40,right:50,top:34,bottom:30,containLabel:true},
    xAxis:{type:"category",data:arr.map(x=>x.d.slice(5)),axisLabel:{color:"#94a3b8",fontSize:10}},
    yAxis:[
      {type:"value",name:"mm",nameTextStyle:{color:"#64748b"},axisLabel:{color:"#94a3b8"},splitLine:{lineStyle:{color:"#1e293b"}}},
      {type:"value",name:"t",nameTextStyle:{color:"#64748b"},axisLabel:{color:"#94a3b8"},splitLine:{show:false}}
    ],
    series:[
      {name:"Rainfall (mm)",type:"bar",data:arr.map(x=>x.rain),itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:"#38bdf8"},{offset:1,color:"#0c4a6e"}]),borderRadius:[4,4,0,0]},barWidth:"45%"},
      {name:"Tonnage (t)",type:"line",yAxisIndex:1,data:arr.map(x=>x.ton),smooth:true,symbolSize:7,lineStyle:{color:"#22c55e",width:3},itemStyle:{color:"#22c55e"}}
    ]
  }, true);

  // Security
  const secMap = new Map();
  cur.forEach(r=>{ const k = r.security || "(no report)"; secMap.set(k,(secMap.get(k)||0)+1); });
  const secData = Array.from(secMap.entries()).map(([k,v])=>({name:k,value:v}));
  const chartSec = charts.oSec || (charts.oSec = echarts.init(document.getElementById("oChartSec")));
  chartSec.setOption({
    tooltip:{trigger:"item",backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}},
    legend:{bottom:0,textStyle:{color:"#94a3b8",fontSize:10}},
    series:[{
      type:"pie", radius:["45%","72%"], center:["50%","44%"],
      itemStyle:{borderColor:"#0b1220",borderWidth:2},
      label:{color:"#e5edff",formatter:"{b}\n{d}%",fontSize:10},
      data: secData.map((d,i)=>({...d, itemStyle:{color:["#22c55e","#f59e0b","#ef4444","#64748b","#a78bfa"][i%5]}}))
    }]
  }, true);

  // Rain by estate
  const rainEst = new Map();
  cur.forEach(r=>{ rainEst.set(r.kebun,(rainEst.get(r.kebun)||0)+r.rainHi); });
  const re = Array.from(rainEst.entries()).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v);
  const chartRE = charts.oRE || (charts.oRE = echarts.init(document.getElementById("oChartRainEstate")));
  chartRE.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",axisPointer:{type:"shadow"},backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>fmt(v,0)+" mm"},
    grid:{left:40,right:20,top:10,bottom:40,containLabel:true},
    xAxis:{type:"category",data:re.map(x=>x.k),axisLabel:{color:"#94a3b8",rotate:20,fontSize:10}},
    yAxis:{type:"value",axisLabel:{color:"#94a3b8"},splitLine:{lineStyle:{color:"#1e293b"}}},
    series:[{type:"bar",data:re.map(x=>x.v),itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:"#60a5fa"},{offset:1,color:"#1e40af"}]),borderRadius:[6,6,0,0]},barWidth:"55%",label:{show:true,position:"top",color:"#cbd5e1",formatter:p=>fmt(p.value,0)}}]
  }, true);

  // Attendance stacked
  const attMap = new Map();
  cur.forEach(r=>{
    if(!attMap.has(r.kebun)) attMap.set(r.kebun,{k:r.kebun,h:[],m:[]});
    if(r.hadir>0) attMap.get(r.kebun).h.push(r.hadir);
    if(r.mangkir>0) attMap.get(r.kebun).m.push(r.mangkir);
  });
  const att = Array.from(attMap.values()).map(o=>({
    k:o.k,
    hadir: o.h.length ? o.h.reduce((a,b)=>a+b,0)/o.h.length : 0,
    mang:  o.m.length ? o.m.reduce((a,b)=>a+b,0)/o.m.length : 0
  })).filter(o=>o.hadir>0 || o.mang>0);
  const chartAtt = charts.oAtt || (charts.oAtt = echarts.init(document.getElementById("oChartAttend")));
  chartAtt.setOption({
    ...baseOpt,
    tooltip:{trigger:"axis",axisPointer:{type:"shadow"},backgroundColor:"#0b1220",borderColor:"#1e293b",textStyle:{color:"#e5edff"}, valueFormatter:v=>v.toFixed(1)+"%"},
    legend:{data:["Hadir","Mangkir"],textStyle:{color:"#94a3b8"},top:0},
    grid:{left:40,right:20,top:34,bottom:30,containLabel:true},
    xAxis:{type:"category",data:att.map(x=>x.k),axisLabel:{color:"#94a3b8",rotate:15,fontSize:10}},
    yAxis:{type:"value",max:100,axisLabel:{color:"#94a3b8",formatter:"{value}%"},splitLine:{lineStyle:{color:"#1e293b"}}},
    series:[
      {name:"Hadir",type:"bar",stack:"a",data:att.map(x=>+x.hadir.toFixed(1)),itemStyle:{color:"#22c55e"}},
      {name:"Mangkir",type:"bar",stack:"a",data:att.map(x=>+x.mang.toFixed(1)),itemStyle:{color:"#ef4444"}}
    ]
  }, true);

  // Highlights
  const list = [];
  if(rain===0 && cur.length) list.push({tone:"good",t:"Dry window",b:"No rainfall logged in the period — good for harvest, spraying, and road access. Prioritise field work while conditions hold."});
  else if(rain>150) list.push({tone:"warn",t:"Heavy rainfall period",b:`${fmt(rain,0)} mm accumulated — expect BJR bump but higher restan & road disruption risk.`});
  else if(rain>0) list.push({tone:"good",t:"Normal rainfall",b:`${fmt(rain,0)} mm recorded across ${rainDays} rain-days — supportive for FFB.`});

  if(mang>5) list.push({tone:"bad",t:"Absenteeism elevated",b:`TK Mangkir averaging ${mang.toFixed(1)}% — above 5% action threshold. Escalate to HR / mandor.`});
  else if(hadir && hadir<85) list.push({tone:"warn",t:"Attendance below target",b:`TK Hadir ${hadir.toFixed(0)}% — target ≥90% for full harvest capacity.`});
  else if(hadir>=90) list.push({tone:"good",t:"Attendance healthy",b:`TK Hadir ${hadir.toFixed(0)}% — labour supply not a constraint.`});

  const insec = secData.filter(d=>d.name && !/aman/i.test(d.name) && d.name!=="(no report)");
  if(insec.length) list.push({tone:"bad",t:"Security incidents reported",b:insec.map(d=>`${d.name} × ${d.value}`).join(", ")+". Verify with security head today."});
  else if(secData.some(d=>/aman/i.test(d.name))) list.push({tone:"good",t:"All estates report 'Aman'",b:"No security escalations recorded."});

  // Rain-tonnage inverse check
  if(arr.length>=3){
    const rainy = arr.filter(x=>x.rain>0);
    const dry = arr.filter(x=>x.rain===0 && x.ton>0);
    if(rainy.length && dry.length){
      const rMean = rainy.reduce((a,b)=>a+b.ton,0)/rainy.length;
      const dMean = dry.reduce((a,b)=>a+b.ton,0)/dry.length;
      if(dMean>rMean*1.15) list.push({tone:"warn",t:"Rain suppressing output",b:`Dry-day avg ${dMean.toFixed(1)}t vs rainy-day ${rMean.toFixed(1)}t — plan wet-weather transport & TPH clearing.`});
    }
  }

  document.getElementById("oHighlights").innerHTML = list.map(h=>`
    <div class="highlight-item ${h.tone}">
      <div class="font-semibold text-slate-100">${h.t}</div>
      <div class="text-slate-400 text-xs mt-0.5">${h.b}</div>
    </div>`).join("") || `<div class="text-slate-500 text-xs">No ops/weather activity in the selected period.</div>`;
}

function renderHighlights(M,C,E,label,cmpLabel){
  const list = [];
  const push = (tone,title,body)=>list.push({tone,title,body});

  const dTon = pct(M.tonT,C.tonT);
  if(dTon!==null){
    if(dTon>=5) push("good","Production up vs "+cmpLabel, `Tonnage ${dTon.toFixed(1)}% higher — ${fmt(M.tonT,1)}t vs ${fmt(C.tonT,1)}t. Sustain crew allocation and transport capacity.`);
    else if(dTon<=-5) push("bad","Production shortfall", `Tonnage ${Math.abs(dTon).toFixed(1)}% below ${cmpLabel}. Investigate weather, HK availability, and transport delays.`);
    else push("warn","Production broadly flat", `Change of ${dTon.toFixed(1)}% vs ${cmpLabel} — within noise. Focus on quality metrics.`);
  }

  if(M.bjr){
    if(M.bjr < THRESHOLDS.bjr.amber) push("bad",`BJR below ${THRESHOLDS.bjr.amber} kg`, `Weighted BJR is ${M.bjr.toFixed(2)} kg — bunches are small/immature. Review harvest interval and ripeness standards.`);
    else if(M.bjr >= THRESHOLDS.bjr.blue) push("good","Strong BJR", `BJR at ${M.bjr.toFixed(2)} kg indicates good ripeness discipline.`);
    if(C.bjr){
      const dB = pct(M.bjr,C.bjr);
      if(dB!==null && dB<=-5) push("warn","BJR trending down", `BJR fell ${Math.abs(dB).toFixed(1)}% — early sign of over-harvesting or age-mix shift.`);
    }
  }

  if(M.loss > THRESHOLDS.loss.warn) push("bad","Loss rate elevated", `Restan + afkir = ${M.loss.toFixed(1)}% of jjg panen. Every 1pp is real cash — target under ${THRESHOLDS.loss.good}%.`);
  else if(M.loss > THRESHOLDS.loss.good) push("warn","Losses above target", `${M.loss.toFixed(1)}% of harvested bunches lost. Deploy afternoon pickups and TPH audits.`);
  else push("good","Loss rate under control", `Loss rate at ${M.loss.toFixed(1)}% — within acceptable range (target <${THRESHOLDS.loss.good}%).`);

  // Estate leader / laggard
  if(E.length>=2){
    const top = E[0], bot = E[E.length-1];
    push("good", `Top estate: ${top.kebun}`, `${fmt(top.tonT,1)}t shipped · yield ${top.yieldTHa.toFixed(2)} t/Ha · BJR ${top.bjr.toFixed(2)} kg.`);
    push("warn", `Laggard: ${bot.kebun}`, `Only ${fmt(bot.tonT,1)}t · yield ${bot.yieldTHa.toFixed(2)} t/Ha · loss ${bot.loss.toFixed(1)}%. Schedule field visit.`);

    // Worst BJR estate
    const worstBjr = [...E].filter(e=>e.bjr>0).sort((a,b)=>a.bjr-b.bjr)[0];
    if(worstBjr && worstBjr.bjr < THRESHOLDS.bjr.amber) push("bad",`Ripeness concern: ${worstBjr.kebun}`,`BJR only ${worstBjr.bjr.toFixed(2)} kg — enforce ripeness grading at the block level.`);
  }

  // Yield gap
  const dY = pct(M.yieldTHa, C.yieldTHa);
  if(dY!==null){
    if(dY>=5) push("good","Yield/Ha improving", `Land productivity up ${dY.toFixed(1)}% — protect this gain in FY targets.`);
    else if(dY<=-5) push("warn","Yield/Ha declining", `Down ${Math.abs(dY).toFixed(1)}%. Root cause: fewer HK, weather, or block rotation?`);
  }

  // HK productivity
  if(M.hkProd && M.hkProd < THRESHOLDS.hk.low) push("warn","Low HK productivity", `${M.hkProd.toFixed(0)} jjg/HK — benchmark is ${THRESHOLDS.hk.low}–${THRESHOLDS.hk.high}. Review supervision & tools.`);
  else if(M.hkProd > THRESHOLDS.hk.high) push("good","HK productivity above benchmark", `${M.hkProd.toFixed(0)} jjg/HK — above the ${THRESHOLDS.hk.low}–${THRESHOLDS.hk.high} range. Recognise crew performance.`);

  // Concentration risk
  if(E.length>=3){
    const totalT = E.reduce((a,e)=>a+e.tonT,0);
    const topShare = totalT ? E[0].tonT/totalT*100 : 0;
    if(topShare > THRESHOLDS.concentration) push("warn","Concentration risk", `${E[0].kebun} accounts for ${topShare.toFixed(0)}% of tonnage (threshold >${THRESHOLDS.concentration}%) — diversify pickup contingency planning.`);
  }

  // Coverage
  push("good","Reporting coverage", `${M.estates} estate(s) submitted data in this period. Total luas panen ${fmt(M.luas,0)} Ha, HK deployed ${fmt(M.hk,0)}.`);

  const el = document.getElementById("highlights");
  el.innerHTML = list.map(h=>`
    <div class="highlight-item ${h.tone}">
      <div class="font-semibold text-slate-100">${h.title}</div>
      <div class="text-slate-400 text-xs mt-0.5">${h.body}</div>
    </div>
  `).join("");
}

/* ---------- UI wiring ---------- */
function wireUI(){
  document.querySelectorAll("[data-preset]").forEach(b=>{
    b.addEventListener("click", ()=>{
      document.querySelectorAll("[data-preset]").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      state.preset = b.dataset.preset;
      document.getElementById("customBox").className = state.preset==="custom" ? "flex items-center gap-2" : "hidden items-center gap-2";
      render();
    });
  });
  document.getElementById("dFrom").addEventListener("change", e=>{ state.from=e.target.value; if(state.preset==="custom") render(); });
  document.getElementById("dTo").addEventListener("change", e=>{ state.to=e.target.value; if(state.preset==="custom") render(); });
  document.getElementById("kebunSel").addEventListener("change", e=>{ state.kebun=e.target.value; render(); });
  document.getElementById("refreshBtn").addEventListener("click", async ()=>{ await loadData(); render(); });
  window.addEventListener("resize", ()=>{ Object.values(charts).forEach(c=>c.resize()); });

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(b=>{
    b.addEventListener("click", ()=>{
      document.querySelectorAll(".tab-btn").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      const panel = document.querySelector(`.tab-panel[data-panel="${b.dataset.tab}"]`);
      panel.classList.add("active");
      state.tab = b.dataset.tab;
      // resize any charts that were hidden
      setTimeout(()=>Object.values(charts).forEach(c=>c.resize()), 50);
    });
  });
}

function renderThresholdLegend(){
  const el = document.getElementById("thresholdChips");
  if(!el) return;
  const b = THRESHOLDS.bjr, l = THRESHOLDS.loss, h = THRESHOLDS.hk, c = THRESHOLDS.concentration;
  const chip = (label, color) => `<span class="px-2 py-1 rounded-full border border-slate-700 text-slate-300"><i class="inline-block w-2 h-2 rounded-full mr-1 align-middle" style="background:${color}"></i>${label}</span>`;
  el.innerHTML = [
    chip(`BJR: <${b.red} red · ${b.red}-${b.amber} amber · ${b.amber}-${b.blue} blue · ≥${b.blue} green`, "#3b82f6"),
    chip(`Loss: <${l.good}% good · ${l.good}-${l.warn}% warn · >${l.warn}% bad`, "#f59e0b"),
    chip(`HK: ${h.low}-${h.high} jjg/HK benchmark`, "#a78bfa"),
    chip(`Concentration alert: >${c}% from one estate`, "#ef4444"),
  ].join("");
}

(async function init(){
  wireUI();
  renderThresholdLegend();
  try{
    await loadData();
    render();
  }catch(e){
    document.querySelector("main").innerHTML = `<div class="card p-6 text-red-400">Failed to load Google Sheet: ${e.message}. Make sure the sheet is shared as "Anyone with the link".</div>`;
  }
})();
