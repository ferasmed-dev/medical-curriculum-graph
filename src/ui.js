// Interface: canvas rendering, pointer/touch interaction, detail panels, search, filters, data table,
// deep links and language switching. The model (model.js) and layout (physics.js) are pure.
import {
  TYPES, YEARS, GROUPS, R, defaultFilters, rowShare, aggregate, similarity, mostSimilar, buildGraph, radius,
  isUniVisible, normalize, searchSubjects, groupMatches, yearLabel, parseLink, serializeLink,
} from './model.js';
import { step, DEFAULT_FORCES } from './physics.js';
import { STRINGS, detectLang, numberFormat } from './i18n.js';

// ---------- colours ----------
const PALETTES = {
  dark: {
    groups: { basic: '#7aa2f7', methods: '#9ece6a', humanities: '#e0af68', clinical: '#bb9af7', systems: '#f7768e', senses: '#ff9e64', lifecycle: '#2ac3de', public: '#73daca', training: '#a9b1d6' },
    types: { FB: '#7aa2f7', OB: '#bb9af7', OP: '#e0af68', PE: '#73daca', TFG: '#f7768e' },
    regions: ['#7aa2f7', '#f7768e', '#9ece6a', '#e0af68', '#bb9af7', '#2ac3de', '#ff9e64', '#73daca', '#c0caf5', '#f4b8e4', '#a6da95', '#eed49f', '#8bd5ca', '#f5a97f', '#b7bdf8', '#ed8796', '#91d7e3'],
    uni: '#dfe3ea', uniRing: '#0e1014', link: '#9aa3b5', simLit: '#c7b8ff', bg0: '#141824', bg1: '#0b0d11',
    label: '#f1f3f7', labelUni: '#ffffff', labelSub: '#cfd5e2', labelDim: 'rgba(150,158,175,.35)', labelBg: 'rgba(11,13,17,', selected: '#ffffff',
  },
  light: {
    groups: { basic: '#3d6fd9', methods: '#4f9a2e', humanities: '#c07c12', clinical: '#7c4ddb', systems: '#d6455d', senses: '#e0702a', lifecycle: '#0f97b8', public: '#1f9e85', training: '#6b7280' },
    types: { FB: '#3d6fd9', OB: '#7c4ddb', OP: '#c07c12', PE: '#1f9e85', TFG: '#d6455d' },
    regions: ['#3d6fd9', '#d6455d', '#4f9a2e', '#c07c12', '#7c4ddb', '#0f97b8', '#e0702a', '#1f9e85', '#5864a8', '#c04fa0', '#3f8f5a', '#a8861a', '#2b8c8c', '#c8643a', '#6a5fd0', '#b8324f', '#2f7fb0'],
    uni: '#2b2f38', uniRing: '#f4f5f8', link: '#7d8597', simLit: '#6d4fd8', bg0: '#fbfbfd', bg1: '#e9ebf1',
    label: '#1b1e26', labelUni: '#0f1115', labelSub: '#3a4050', labelDim: 'rgba(90,98,115,.4)', labelBg: 'rgba(250,251,253,', selected: '#111318',
  },
};
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
let P = darkQuery.matches ? PALETTES.dark : PALETTES.light;
darkQuery.addEventListener('change', () => { P = darkQuery.matches ? PALETTES.dark : PALETTES.light; renderLegend(); refreshPanel(); });
// Pills are drawn with dark text, so they always use the brighter palette.
const PILL = PALETTES.dark.types;

// ---------- state ----------
let DATA, U, DISC;
let lang = 'es', T = STRINGS.es, fmt = numberFormat('es');
const S = {
  view: 'network', filters: defaultFilters(), colour: 'plain', labels: true, weight: true,
  forces: { ...DEFAULT_FORCES }, size: 1, expanded: new Set(), selected: null, hover: null, query: null,
};
let agg, sims, nodes = [], links = [], byId = new Map(), adj = new Map(), maxW = 1;
const pos = new Map();
let alpha = 1, dragNode = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//.test(u) ? esc(u) : '#');
const discName = (j) => DISC[j][lang];
const regions = () => [...new Set(U.map((u) => u.region))].sort((a, b) => a.localeCompare(b, 'es'));
const regionColour = (r) => P.regions[regions().indexOf(r) % P.regions.length];
const uniVisible = (i) => isUniVisible(DATA, agg, S.filters, i);

// ---------- canvas ----------
const stage = $('stage'), cv = $('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const view = { k: 1, x: 0, y: 0 };
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = stage.clientWidth; H = stage.clientHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  kick(0.05);
}
window.addEventListener('resize', resize);
function kick(a) { alpha = Math.max(alpha, a); }

// ---------- graph ----------
function rebuild() {
  agg = aggregate(DATA, S.filters);
  sims = similarity(agg.uniVec, agg.uniTot);
  const g = buildGraph(DATA, agg, sims, S.filters, { view: S.view, expanded: S.expanded });
  const maxDisc = Math.max(1, ...g.nodes.filter((n) => n.type === 'disc').map((n) => n.val));
  for (const n of g.nodes) {
    const p = pos.get(n.id);
    if (p) Object.assign(n, p);
    else {
      const parent = n.type === 'subj' ? pos.get('u' + DATA.rows[n.i][R.UNI]) : null;
      const a = Math.random() * 6.283, rr = parent ? 40 : 150 + Math.random() * 250;
      n.x = (parent ? parent.x : 0) + Math.cos(a) * rr; n.y = (parent ? parent.y : 0) + Math.sin(a) * rr; n.vx = n.vy = 0;
    }
    n.r0 = radius(n, S.view, maxDisc);
    n.r = n.r0 * S.size;
  }
  nodes = g.nodes;
  byId = new Map(nodes.map((n) => [n.id, n]));
  links = g.links.map((l) => ({ ...l, a: byId.get(l.s), b: byId.get(l.t) }));
  adj = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const l of links) if (l.kind !== 'ghost') { adj.get(l.s).add(l.t); adj.get(l.t).add(l.s); }
  maxW = Math.max(1, ...links.filter((l) => l.kind === 'ects').map((l) => l.w));
  if (S.selected && !byId.has(S.selected)) closePanel();
  updateStats(); renderLegend(); renderTable(); kick(0.9);
  refreshPanel();
  writeLink();
}
function label(n) {
  if (n.type === 'uni') return U[n.i].short;
  if (n.type === 'disc') return discName(n.i);
  return DATA.rows[n.i][R.NAME];
}
function nodeColour(n) {
  if (n.type === 'uni') return S.colour === 'region' ? regionColour(U[n.i].region) : P.uni;
  if (n.type === 'disc') return P.groups[DISC[n.i].group];
  return P.types[DATA.rows[n.i][R.TYPE]];
}
function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function focusSet() {
  const f = S.hover || S.selected;
  if (S.query && !f) return S.query.nodes;
  if (!f || !byId.has(f)) return null;
  const s = new Set([f]);
  adj.get(f).forEach((x) => s.add(x));
  return s;
}

// ---------- drawing ----------
let lastKey = '', focusT = 1;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const grd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
  grd.addColorStop(0, P.bg0); grd.addColorStop(1, P.bg1);
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);

  const F = focusSet(), key = F ? [...F].join() : '';
  if (key !== lastKey) { lastKey = key; focusT = reduceMotion.matches ? 1 : 0; }
  focusT = Math.min(1, focusT + 0.12);
  const dimA = F ? 1 - 0.86 * focusT : 1;
  const centre = S.hover || S.selected;

  ctx.setTransform(DPR * view.k, 0, 0, DPR * view.k, DPR * view.x, DPR * view.y);
  ctx.lineCap = 'round';
  for (const l of links) {
    const on = F && F.has(l.s) && F.has(l.t) && (!centre || l.s === centre || l.t === centre);
    let a, w, col = P.link;
    if (l.kind === 'sim') { a = 0.15 + 0.6 * l.wn; w = 0.6 + 2.4 * l.wn; }
    else if (l.kind === 'subject') { a = 0.35; w = 0.8; col = nodeColour(l.b); }
    else if (l.kind === 'ghost') { a = 0.06; w = 0.5; }
    else { const t = l.w / maxW; a = 0.08 + 0.32 * t; w = S.weight ? 0.4 + 3.2 * t : 0.7; }
    if (F) {
      if (on) { a = Math.min(0.95, a * 2.2 + 0.25); col = l.kind === 'sim' ? P.simLit : l.b.type === 'disc' ? nodeColour(l.b) : col; }
      else a *= dimA * 0.5;
    }
    ctx.strokeStyle = rgba(col, a); ctx.lineWidth = w / Math.sqrt(view.k) + (on ? 0.3 : 0);
    ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
  }
  for (const n of nodes) {
    n.r = n.r0 * S.size;
    const lit = !F || F.has(n.id), c = nodeColour(n), a = lit ? 1 : dimA;
    const isFocus = n.id === centre;
    if (lit && isFocus) { ctx.fillStyle = rgba(c, 0.22); ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 2.4, 0, 6.283); ctx.fill(); }
    ctx.fillStyle = rgba(c, a); ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.fill();
    if (n.type === 'uni') { ctx.lineWidth = 1.6 / view.k; ctx.strokeStyle = rgba(P.uniRing, a); ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 0.55, 0, 6.283); ctx.stroke(); }
    if (n.id === S.selected) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = P.selected; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 / view.k, 0, 6.283); ctx.stroke(); }
    if (n.type === 'uni' && S.expanded.has(n.i)) {
      ctx.setLineDash([3 / view.k, 3 / view.k]); ctx.lineWidth = 1.2 / view.k; ctx.strokeStyle = rgba(P.selected, 0.6 * a);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 6 / view.k, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // labels in screen space, highest priority first, skipping overlaps
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const placed = [];
  const order = nodes.map((n) => [n, priority(n, F, centre)]).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
  for (const [n] of order) {
    const sx = n.x * view.k + view.x, sy = n.y * view.k + view.y + n.r * view.k + 3;
    if (sx < -100 || sx > W + 100 || sy < -40 || sy > H + 40) continue;
    const big = n.id === centre;
    const fs = big ? 13.5 : n.type === 'subj' ? 10.5 : n.type === 'uni' ? 12 : 11.5;
    ctx.font = `${big || n.type === 'uni' ? 600 : 500} ${fs}px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif`;
    let text = label(n);
    if (n.type === 'subj' && text.length > 34 && !big) text = text.slice(0, 32) + '…';
    const tw = ctx.measureText(text).width, box = { x: sx - tw / 2 - 3, y: sy - 1, w: tw + 6, h: fs + 3 };
    if (!big && placed.some((b) => b.x < box.x + box.w && box.x < b.x + b.w && b.y < box.y + box.h && box.y < b.y + b.h)) continue;
    placed.push(box);
    const lit = !F || F.has(n.id);
    ctx.fillStyle = P.labelBg + (lit ? 0.6 : 0.25) + ')'; ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = lit ? (n.type === 'disc' ? P.label : n.type === 'uni' ? P.labelUni : P.labelSub) : P.labelDim;
    ctx.fillText(text, sx, sy);
  }
}
function priority(n, F, centre) {
  if (n.id === centre) return 100;
  if (F && F.has(n.id)) return n.type === 'subj' ? 40 : 60 + n.r;
  if (F && !S.labels) return 0;
  const sr = n.r * view.k;
  if (n.type === 'subj') return view.k > 1.6 && !F ? 5 + sr : 0;
  if (!S.labels) return sr > 11 ? sr : 0;
  if (F) return n.type === 'uni' ? 3 : 0;
  return (n.type === 'disc' ? 10 : 8) + sr;
}
function loop() {
  if (alpha > 0.003 || dragNode) {
    alpha = step(nodes, links, alpha, S.forces, dragNode, maxW);
    for (const n of nodes) pos.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
  }
  draw();
  requestAnimationFrame(loop);
}

// ---------- pointer interaction ----------
const ptrs = new Map();
let panStart = null, pinch = null, downAt = null, moved = false;
const toWorld = (x, y) => ({ x: (x - view.x) / view.k, y: (y - view.y) / view.k });
function hit(x, y) {
  const p = toWorld(x, y);
  let best = null, bd = 1e9;
  for (const n of nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y), tol = n.r + Math.max(4, 10 / view.k);
    if (d < tol && d < bd) { bd = d; best = n; }
  }
  return best;
}
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  hideSugg();
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: view.x, vy: view.y };
    dragNode = null; panStart = null; return;
  }
  downAt = { x: e.clientX, y: e.clientY }; moved = false;
  const n = hit(e.clientX, e.clientY);
  if (n) { dragNode = n; kick(0.3); } else { panStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; stage.classList.add('dragging'); }
});
stage.addEventListener('pointermove', (e) => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const k = Math.max(0.15, Math.min(6, (pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d));
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    view.x = cx - ((pinch.cx - pinch.vx) * k) / pinch.k; view.y = cy - ((pinch.cy - pinch.vy) * k) / pinch.k; view.k = k;
    return;
  }
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) moved = true;
  if (dragNode && moved) { const p = toWorld(e.clientX, e.clientY); dragNode.x = p.x; dragNode.y = p.y; kick(0.25); hideTip(); return; }
  if (panStart) { view.x = panStart.vx + e.clientX - panStart.x; view.y = panStart.vy + e.clientY - panStart.y; return; }
  if (e.pointerType === 'mouse') {
    const n = hit(e.clientX, e.clientY);
    S.hover = n ? n.id : null;
    stage.classList.toggle('hovering', !!n);
    if (n) showTip(n, e.clientX, e.clientY); else hideTip();
  }
});
function endPointer(e) {
  ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) pinch = null; downAt = null; return; }
  if (downAt && !moved) {
    const n = hit(e.clientX, e.clientY);
    if (n) select(n.id);
    else if (S.query) clearQuery();
    else closePanel();
  }
  dragNode = null; panStart = null; downAt = null; stage.classList.remove('dragging');
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { S.hover = null; hideTip(); } });
stage.addEventListener('dblclick', (e) => { const n = hit(e.clientX, e.clientY); if (n && n.type === 'uni') toggleExpand(n.i); });
stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
function zoomAt(x, y, f) {
  const k = Math.max(0.15, Math.min(6, view.k * f));
  view.x = x - ((x - view.x) * k) / view.k; view.y = y - ((y - view.y) * k) / view.k; view.k = k;
}
$('zIn').onclick = () => zoomAt(W / 2, H / 2, 1.35);
$('zOut').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.35);
$('zFit').onclick = () => fit(true);
function panelWidth() { return W >= 720 && $('panel').classList.contains('on') ? 400 : 0; }
function animateView(target, ms) {
  if (reduceMotion.matches) { Object.assign(view, target); return; }
  const s = { ...view }, t0 = performance.now();
  (function tick() {
    const p = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    view.k = s.k + (target.k - s.k) * e; view.x = s.x + (target.x - s.x) * e; view.y = s.y + (target.y - s.y) * e;
    if (p < 1) requestAnimationFrame(tick);
  })();
}
function fit(anim) {
  if (!nodes.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of nodes) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
  const padT = W < 720 ? 120 : 90, padB = W < 720 ? 70 : 80, aw = W - 40 - panelWidth(), ah = H - padT - padB;
  const k = Math.max(0.2, Math.min(2.2, Math.min(aw / (x1 - x0 || 1), ah / (y1 - y0 || 1))));
  const target = { k, x: 20 + aw / 2 - ((x0 + x1) / 2) * k, y: padT + ah / 2 - ((y0 + y1) / 2) * k };
  if (anim) animateView(target, 450); else Object.assign(view, target);
}
function centreOn(id) {
  const n = byId.get(id);
  if (!n) return;
  const k = Math.max(view.k, 0.9), tx = (W - panelWidth()) / 2, ty = W < 720 ? H * 0.22 : H / 2;
  animateView({ k, x: tx - n.x * k, y: ty - n.y * k }, 400);
}

// ---------- tooltip ----------
const tip = $('tip');
function showTip(n, x, y) {
  let h;
  if (n.type === 'uni') h = `<b>${esc(U[n.i].name)}</b><span>${esc(T.tooltipUni(U[n.i].region, fmt(agg.uniTot[n.i])))}</span>`;
  else if (n.type === 'disc') h = `<b>${esc(discName(n.i))}</b><span>${esc(T.tooltipDisc(T.groups[DISC[n.i].group], adj.get(n.id).size, fmt(agg.discTot[n.i])))}</span>`;
  else { const r = DATA.rows[n.i]; h = `<b>${esc(r[R.NAME])}</b><span>${esc(U[r[R.UNI]].short)} · ${yearLabel(r[R.YEARS])} · ${r[R.TYPE]} · ${fmt(r[R.ECTS])} ECTS</span>`; }
  tip.innerHTML = h; tip.style.display = 'block';
  tip.style.left = Math.min(W - tip.offsetWidth - 8, x + 14) + 'px';
  tip.style.top = Math.min(H - tip.offsetHeight - 8, y + 14) + 'px';
}
function hideTip() { tip.style.display = 'none'; }

// ---------- selection and detail panel ----------
const panel = $('panel'), pBody = $('pBody');
function select(id) {
  S.query = null; S.selected = id;
  openPanel(id);
  $('welcome').style.opacity = 0;
  writeLink();
}
function closePanel() { S.selected = null; S.query = null; panel.classList.remove('on'); writeLink(); }
$('pClose').onclick = closePanel;
function refreshPanel() {
  if (S.selected && byId.has(S.selected)) openPanel(S.selected, true);
  else if (S.query) runQuery(S.query.term, true);
}
function openPanel(id, keepScroll) {
  const n = byId.get(id);
  if (!n) return;
  const st = keepScroll ? pBody.scrollTop : 0;
  panel.classList.add('on');
  const kind = $('pKind'), title = $('pTitle'), sub = $('pSub');
  let html = '';
  if (n.type === 'uni') {
    const u = U[n.i], tp = agg.uniType[n.i], tot = agg.uniTot[n.i];
    kind.innerHTML = `<i style="background:${nodeColour(n)}"></i>${esc(T.faculty)}`;
    title.textContent = u.name; sub.textContent = `${u.region} · ${u.campus}`;
    const nSubj = DATA.rows.filter((r) => r[R.UNI] === n.i && rowShare(r, S.filters) > 0).length;
    const nDisc = agg.uniVec[n.i].filter((w) => w > 0.01).length;
    html += `<div class="kpis"><div class="kpi"><b>${fmt(tot)}</b><span>${T.ectsFiltered}</span></div><div class="kpi"><b>${nSubj}</b><span>${T.subjects}</span></div><div class="kpi"><b>${nDisc}</b><span>${T.disciplines}</span></div></div>`;
    html += `<h3>${T.creditsByType}</h3>` + stackBar(tp, tot);
    html += `<div style="margin-top:12px"><button class="btn" data-act="expand">${S.expanded.has(n.i) ? T.collapse : T.expand}</button><a class="btn" href="${safeUrl(u.url)}" target="_blank" rel="noopener">${T.source}</a></div>`;
    if (u.notes[lang]) html += `<div class="note">${esc(u.notes[lang])}</div>`;
    html += `<p class="small-note">${T.version}: ${esc(u.version[lang])}</p>`;
    const sim = mostSimilar(sims, n.i, uniVisible, 5);
    html += `<h3>${T.similarPlans}</h3><div class="bars">` + sim.map(([j, s]) => barRow(U[j].short, Math.max(0, s) * 100, 100, P.simLit, String(Math.round(s * 100)), 'u' + j)).join('') + `</div><p class="small-note">${T.affinityNote}</p>`;
    const top = agg.uniVec[n.i].map((w, j) => [j, w]).filter((x) => x[1] > 0.01).sort((a, b) => b[1] - a[1]);
    const mx = top.length ? top[0][1] : 1;
    const row = ([j, w]) => barRow(discName(j), w, mx, P.groups[DISC[j].group], fmt(w), 'd' + j);
    html += `<h3>${T.weightByDiscipline}</h3><div class="bars">` + top.slice(0, 14).map(row).join('') + '</div>';
    if (top.length > 14) html += `<details><summary>${T.showRest(top.length - 14)}</summary><div class="bars">` + top.slice(14).map(row).join('') + '</div></details>';
    html += `<h3>${T.studyPlan}</h3>` + subjectsByYear(DATA.rows.filter((r) => r[R.UNI] === n.i));
  } else if (n.type === 'disc') {
    const d = DISC[n.i], c = P.groups[d.group];
    kind.innerHTML = `<i style="background:${c}"></i>${esc(T.discipline)} · ${esc(T.groups[d.group])}`;
    title.textContent = discName(n.i);
    const list = U.map((_, i) => [i, agg.uniVec[i][n.i]]).filter(([i, w]) => w > 0.01 && uniVisible(i)).sort((a, b) => b[1] - a[1]);
    const nUni = U.filter((_, i) => uniVisible(i)).length;
    const mean = list.reduce((a, b) => a + b[1], 0) / (list.length || 1);
    sub.textContent = T.presentIn(list.length, nUni);
    html += `<div class="kpis"><div class="kpi"><b>${list.length}</b><span>${T.faculties}</span></div><div class="kpi"><b>${fmt(mean)}</b><span>${T.meanEcts}</span></div><div class="kpi"><b>${list.length ? fmt(list[0][1]) : '—'}</b><span>${T.max}</span></div></div>`;
    const mx = list.length ? list[0][1] : 1;
    html += `<h3>${T.ectsByFaculty}</h3><div class="bars">` + list.map(([i, w]) => barRow(U[i].short, w, mx, c, fmt(w), 'u' + i)).join('') + '</div>';
    const missing = U.map((_, i) => i).filter((i) => uniVisible(i) && !(agg.uniVec[i][n.i] > 0.01));
    if (missing.length) html += `<h3>${T.noSubject}</h3><p style="font-size:12.5px;color:var(--muted);margin:0">${missing.map((i) => esc(U[i].short)).join(' · ')}</p><p class="small-note">${T.noSubjectNote}</p>`;
    html += `<h3>${T.includedSubjects}</h3>`;
    const byU = new Map();
    DATA.rows.forEach((r) => {
      if (r[R.DISC].includes(n.i) && rowShare(r, S.filters) > 0 && uniVisible(r[R.UNI])) {
        if (!byU.has(r[R.UNI])) byU.set(r[R.UNI], []);
        byU.get(r[R.UNI]).push(r);
      }
    });
    [...byU.entries()].sort((a, b) => U[a[0]].short.localeCompare(U[b[0]].short, 'es')).forEach(([ui, rows]) => {
      html += `<details><summary>${esc(U[ui].short)} <span style="color:var(--dim)">(${rows.length})</span></summary>` + rows.map((r) => subjectRow(r, 'year')).join('') + '</details>';
    });
  } else {
    const r = DATA.rows[n.i];
    kind.innerHTML = `<i style="background:${P.types[r[R.TYPE]]}"></i>${esc(T.subject)} · ${esc(T.types[r[R.TYPE]])}`;
    title.textContent = r[R.NAME]; sub.textContent = U[r[R.UNI]].name;
    html += `<div class="kpis"><div class="kpi"><b>${fmt(r[R.ECTS])}</b><span>ECTS</span></div><div class="kpi"><b>${yearLabel(r[R.YEARS])}</b><span>${T.yearShort}</span></div><div class="kpi"><b>${esc(r[R.SEM] || '—')}</b><span>${T.semester}</span></div></div>`;
    const part = r[R.ECTS] / r[R.DISC].length;
    html += `<h3>${T.disciplines}</h3><div class="bars">` + r[R.DISC].map((d) => barRow(discName(d), part, r[R.ECTS], P.groups[DISC[d].group], fmt(part), 'd' + d)).join('') + '</div>';
    html += `<div style="margin-top:12px"><button class="btn" data-go="u${r[R.UNI]}">${T.viewFaculty}</button></div>`;
    const d0 = r[R.DISC][0];
    const others = DATA.rows.filter((x) => x !== r && x[R.DISC].includes(d0) && x[R.UNI] !== r[R.UNI] && x[R.TYPE] === r[R.TYPE]).slice(0, 40);
    if (others.length) html += `<h3>${T.equivalents}</h3>` + others.map((x) => subjectRow(x, 'uni')).join('');
  }
  pBody.innerHTML = html;
  pBody.scrollTop = st;
}
pBody.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { const id = go.dataset.go; if (byId.has(id)) { select(id); centreOn(id); } return; }
  const act = e.target.closest('[data-act="expand"]');
  if (act) { const n = byId.get(S.selected); if (n) toggleExpand(n.i); }
});
function toggleExpand(ui) {
  if (S.expanded.has(ui)) S.expanded.delete(ui); else S.expanded.add(ui);
  rebuild();
}
function stackBar(tp, tot) {
  const keys = TYPES.filter((k) => tp[k] > 0.01);
  return '<div class="stack" role="img" aria-label="' + esc(keys.map((k) => `${T.types[k]} ${fmt(tp[k])}`).join(', ')) + '">'
    + keys.map((k) => `<div style="width:${(tp[k] / tot) * 100}%;background:${P.types[k]}"></div>`).join('')
    + '</div><div class="stackleg">' + keys.map((k) => `<span title="${esc(T.types[k])}"><i style="background:${P.types[k]}"></i>${k} ${fmt(tp[k])}</span>`).join('') + '</div>';
}
function barRow(name, v, mx, c, value, go) {
  return `<button class="b" ${go ? `data-go="${go}"` : ''}><span class="n" title="${esc(name)}">${esc(name)}</span><span class="track"><span class="fill" style="width:${Math.max(2, (v / mx) * 100)}%;background:${c}"></span></span><span class="v">${value}</span></button>`;
}
function subjectRow(r, extra) {
  const meta = extra === 'uni' ? `${esc(U[r[R.UNI]].short)} · ${yearLabel(r[R.YEARS])}`
    : extra === 'year' ? yearLabel(r[R.YEARS]) + (r[R.SEM] ? ' · ' + esc(r[R.SEM]) : '')
    : r[R.SEM] ? esc(r[R.SEM]) : '';
  const off = rowShare(r, S.filters) ? '' : ' off';
  return `<div class="subj${off}"><span class="pill" style="background:${PILL[r[R.TYPE]]}" title="${esc(T.types[r[R.TYPE]])}">${r[R.TYPE]}</span><span>${esc(r[R.NAME])}${meta ? `<small>${meta}</small>` : ''}</span><span class="e">${fmt(r[R.ECTS])}</span></div>`;
}
function subjectsByYear(rows) {
  const groups = new Map();
  for (const r of rows) {
    const ys = r[R.YEARS];
    const k = ys.length === 1 ? ys[0] + 'º' : ys.length === 6 ? '*' : yearLabel(ys);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const keys = [...groups.keys()].sort((a, b) => (parseInt(a) || 9) - (parseInt(b) || 9));
  return keys.map((k) => {
    const rs = groups.get(k), t = rs.reduce((a, r) => a + r[R.ECTS], 0);
    const head = k === '*' ? T.severalYears : T.yearHeading(k);
    return `<div class="curso"><div><span>${esc(head)}</span><span>${fmt(t)} ECTS</span></div>` + rs.map((r) => subjectRow(r)).join('') + '</div>';
  }).join('');
}

// ---------- search ----------
const q = $('q'), sugg = $('sugg');
let items = [], idx = -1;
q.addEventListener('input', () => {
  const t = normalize(q.value.trim());
  if (t.length < 2) { hideSugg(); return; }
  items = [];
  nodes.filter((n) => n.type !== 'subj' && normalize(label(n) + ' ' + (n.type === 'uni' ? U[n.i].name + ' ' + U[n.i].region : DISC[n.i].es + ' ' + DISC[n.i].en)).includes(t))
    .sort((a, b) => (normalize(label(b)).includes(t) - normalize(label(a)).includes(t)) || (a.type === 'uni' ? -1 : 1))
    .slice(0, 8)
    .forEach((n) => items.push({ kind: 'node', id: n.id, label: n.type === 'uni' ? U[n.i].name : label(n), c: nodeColour(n), meta: n.type === 'uni' ? T.faculty : T.discipline }));
  const m = searchSubjects(DATA, q.value);
  if (m.length) items.push({ kind: 'subjects', label: T.subjectsContaining(q.value.trim()), meta: T.inFaculties(m.length, new Set(m.map(([r]) => r[R.UNI])).size), c: P.types.OP });
  idx = -1;
  sugg.innerHTML = items.length
    ? items.map((it, k) => `<div role="option" id="opt${k}" data-k="${k}"><i style="background:${it.c}"></i><span>${esc(it.label)}</span><em>${esc(it.meta)}</em></div>`).join('')
    : `<div class="empty">${T.noResults}</div>`;
  sugg.classList.add('on'); q.setAttribute('aria-expanded', 'true');
});
q.addEventListener('keydown', (e) => {
  if (!sugg.classList.contains('on')) return;
  if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); mark(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); mark(); e.preventDefault(); }
  else if (e.key === 'Enter') { pick(items[idx < 0 ? 0 : idx]); e.preventDefault(); }
  else if (e.key === 'Escape') { hideSugg(); }
});
function mark() {
  [...sugg.children].forEach((c, k) => c.classList.toggle('act', k === idx));
  q.setAttribute('aria-activedescendant', idx >= 0 ? 'opt' + idx : '');
}
sugg.addEventListener('pointerdown', (e) => { const d = e.target.closest('[data-k]'); if (d) { e.preventDefault(); pick(items[+d.dataset.k]); } });
function hideSugg() { sugg.classList.remove('on'); q.setAttribute('aria-expanded', 'false'); }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) hideSugg(); });
function pick(it) {
  if (!it) return;
  hideSugg(); q.blur();
  if (it.kind === 'node') { select(it.id); centreOn(it.id); return; }
  runQuery(q.value.trim());
}
function runQuery(term, keepScroll) {
  const matches = searchSubjects(DATA, term);
  if (!matches.length) return;
  const ns = new Set();
  for (const [r] of matches) { ns.add('u' + r[R.UNI]); r[R.DISC].forEach((d) => ns.add('d' + d)); }
  S.selected = null; S.query = { nodes: ns, term };
  const st = keepScroll ? pBody.scrollTop : 0;
  panel.classList.add('on');
  $('pKind').innerHTML = `<i style="background:${P.types.OP}"></i>${esc(T.search)}`;
  $('pTitle').textContent = lang === 'en' ? `“${term}”` : `«${term}»`;
  const groups = groupMatches(matches);
  $('pSub').textContent = T.matchSummary(matches.length, groups.length);
  const mx = groups.length ? groups[0].ects : 1;
  let html = `<h3>${T.ectsByFaculty}</h3><div class="bars">` + groups.map((g) => barRow(U[g.u].short, g.ects, mx, P.types.OP, fmt(g.ects), 'u' + g.u)).join('') + `</div><h3>${T.subjects}</h3>`;
  for (const g of groups) html += `<details open><summary>${esc(U[g.u].short)}</summary>` + g.rows.map((r) => subjectRow(r, 'year')).join('') + '</details>';
  pBody.innerHTML = html; pBody.scrollTop = st;
  $('welcome').style.opacity = 0;
  writeLink();
}
function clearQuery() { S.query = null; closePanel(); }

// ---------- controls ----------
$('mode').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setView(b.dataset.m);
  setTimeout(() => fit(true), 900);
});
function setView(v) {
  S.view = v;
  [...$('mode').children].forEach((x) => { x.classList.toggle('on', x.dataset.m === v); x.setAttribute('aria-pressed', x.dataset.m === v); });
  if (v === 'similarity' && S.selected && S.selected[0] === 'd') S.selected = null;
  rebuild();
}
function togglePanel(btn, el, on) {
  const open = on ?? !el.classList.contains('on');
  el.classList.toggle('on', open); btn.setAttribute('aria-expanded', open);
}
$('filtersBtn').onclick = () => togglePanel($('filtersBtn'), $('drawer'));
$('tableBtn').onclick = () => { togglePanel($('tableBtn'), $('tablePanel')); renderTable(); };
$('tClose').onclick = () => togglePanel($('tableBtn'), $('tablePanel'), false);
function renderFilterChips() {
  $('fYears').innerHTML = YEARS.map((y) => `<button class="chip${S.filters.years.has(y) ? ' on' : ''}" data-v="${y}" aria-pressed="${S.filters.years.has(y)}">${y}º</button>`).join('');
  $('fTypes').innerHTML = TYPES.map((t) => `<button class="chip${S.filters.types.has(t) ? ' on' : ''}" data-v="${t}" aria-pressed="${S.filters.types.has(t)}"><i style="background:${P.types[t]}"></i>${t} · ${esc(T.types[t])}</button>`).join('');
}
function toggleSet(set, v) { if (set.has(v)) { if (set.size > 1) set.delete(v); } else set.add(v); }
$('fYears').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; toggleSet(S.filters.years, +b.dataset.v); renderFilterChips(); rebuild(); };
$('fTypes').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; toggleSet(S.filters.types, b.dataset.v); renderFilterChips(); rebuild(); };
$('fColour').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  S.colour = b.dataset.c;
  [...$('fColour').children].forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
  renderLegend(); refreshPanel();
};
$('sLabels').onchange = (e) => { S.labels = e.target.checked; };
$('sWeight').onchange = (e) => { S.weight = e.target.checked; };
const sliders = [['sRep', 'repulsion', 1], ['sDist', 'distance', 1], ['sLink', 'strength', 0.01], ['sGrav', 'gravity', 0.01]];
for (const [id, k, m] of sliders) $(id).oninput = (e) => { S.forces[k] = +e.target.value * m; kick(0.5); };
$('sSize').oninput = (e) => { S.size = +e.target.value / 100; kick(0.3); };
$('resetBtn').onclick = () => {
  S.filters = defaultFilters(); S.forces = { ...DEFAULT_FORCES }; S.size = 1; S.expanded.clear();
  $('sRep').value = 1100; $('sDist').value = 110; $('sLink').value = 35; $('sGrav').value = 25; $('sSize').value = 100;
  renderFilterChips(); rebuild(); setTimeout(() => fit(true), 700);
};
$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); toast(T.copied); } catch { toast(location.href); }
};
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1800); }

// ---------- legend ----------
const legend = $('legend'), legendItems = $('legendItems');
function renderLegend() {
  let h = '';
  const showRegions = S.colour === 'region' || S.view === 'similarity';
  if (S.view === 'network') h += GROUPS.map((g) => `<button data-g="${g}" class="${S.filters.hiddenGroups.has(g) ? 'off' : ''}" aria-pressed="${!S.filters.hiddenGroups.has(g)}"><i style="background:${P.groups[g]}"></i>${esc(T.groups[g])}</button>`).join('');
  if (showRegions) h += regions().map((r) => `<button data-r="${esc(r)}" class="${S.filters.hiddenRegions.has(r) ? 'off' : ''}" aria-pressed="${!S.filters.hiddenRegions.has(r)}"><i style="background:${S.colour === 'region' ? regionColour(r) : P.uni}"></i>${esc(r)}</button>`).join('');
  else h += `<button disabled><i style="background:${P.uni};box-shadow:inset 0 0 0 2px ${P.uniRing}"></i>${esc(T.faculty)}</button>`;
  $('legendTitle').textContent = S.view === 'network' ? T.areasLegend : T.regionsLegend;
  legendItems.innerHTML = h;
  $('legendTog').textContent = legend.classList.contains('collapsed') ? T.show : T.hide;
}
legendItems.onclick = (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const f = S.filters;
  if (b.dataset.g) f.hiddenGroups.has(b.dataset.g) ? f.hiddenGroups.delete(b.dataset.g) : f.hiddenGroups.add(b.dataset.g);
  if (b.dataset.r) f.hiddenRegions.has(b.dataset.r) ? f.hiddenRegions.delete(b.dataset.r) : f.hiddenRegions.add(b.dataset.r);
  rebuild();
};
$('legendTog').onclick = () => {
  legend.classList.toggle('collapsed');
  $('legendTog').setAttribute('aria-expanded', !legend.classList.contains('collapsed'));
  renderLegend();
};

function updateStats() {
  const nu = nodes.filter((n) => n.type === 'uni').length, nd = nodes.filter((n) => n.type === 'disc').length;
  const tot = agg.uniTot.reduce((a, b, i) => a + (uniVisible(i) ? b : 0), 0);
  $('stats').textContent = T.stats(nu, nd, links.filter((l) => l.kind !== 'ghost').length, fmt(tot));
  cv.setAttribute('aria-label', T.canvasLabel + '. ' + T.stats(nu, nd, links.length, fmt(tot)));
}

// ---------- data table (accessible view of the graph) ----------
let tableTab = 'unis', sortKey = null, sortDir = -1;
$('tableTabs').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  tableTab = b.dataset.t; sortKey = null;
  [...$('tableTabs').children].forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
  renderTable();
};
function renderTable() {
  if (!$('tablePanel').classList.contains('on') || !agg) return;
  let cols, rows;
  if (tableTab === 'unis') {
    cols = [['name', T.colFaculty, 'l'], ['region', T.colRegion, 'l'], ...TYPES.map((t) => [t, t, '']), ['total', T.colTotal, '']];
    rows = U.map((u, i) => ({ id: 'u' + i, name: u.short, region: u.region, ...agg.uniType[i], total: agg.uniTot[i] })).filter((r) => uniVisible(+r.id.slice(1)));
  } else {
    cols = [['name', T.colDiscipline, 'l'], ['area', T.colArea, 'l'], ['n', T.colFaculties, ''], ['mean', T.colMean, ''], ['min', T.colMin, ''], ['max', T.colMax, '']];
    rows = DISC.map((d, j) => {
      const ws = U.map((_, i) => agg.uniVec[i][j]).filter((w, i) => w > 0.01 && uniVisible(i));
      return { id: 'd' + j, name: discName(j), area: T.groups[d.group], n: ws.length, mean: ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : 0, min: ws.length ? Math.min(...ws) : 0, max: ws.length ? Math.max(...ws) : 0 };
    }).filter((r) => r.n > 0);
  }
  if (sortKey) rows.sort((a, b) => (typeof a[sortKey] === 'string' ? a[sortKey].localeCompare(b[sortKey], lang) : a[sortKey] - b[sortKey]) * sortDir);
  const cell = (r, [k, , cls]) => {
    if (k === 'name') return `<td class="l"><button data-go="${r.id}">${esc(r.name)}</button></td>`;
    const v = r[k];
    return `<td class="${cls}">${typeof v === 'number' ? (k === 'n' ? v : fmt(v)) : esc(v)}</td>`;
  };
  $('tBody').innerHTML = `<div class="tscroll"><table class="data"><thead><tr>${cols.map(([k, h, cls]) => `<th class="${cls}" data-k="${k}" scope="col" aria-sort="${sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(h)}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => cell(r, c)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
$('tBody').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (th) { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (['name', 'region', 'area'].includes(k) ? 1 : -1); sortKey = k; renderTable(); return; }
  const go = e.target.closest('[data-go]');
  if (go && byId.has(go.dataset.go)) {
    togglePanel($('tableBtn'), $('tablePanel'), false);
    select(go.dataset.go); centreOn(go.dataset.go);
  }
});

// ---------- language ----------
function applyLang(l) {
  lang = l; T = STRINGS[l]; fmt = numberFormat(l);
  document.documentElement.lang = l;
  document.title = T.title;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T[el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = T[el.dataset.i18nPlaceholder]; });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = T[el.dataset.i18nTitle]; });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', T[el.dataset.i18nAria]); });
  $('langBtn').textContent = T.langSwitch;
  $('langBtn').setAttribute('aria-label', T.langSwitch);
  try { localStorage.setItem('mcg-lang', l); } catch { /* storage unavailable */ }
  renderFilterChips();
  if (agg) { renderLegend(); updateStats(); renderTable(); refreshPanel(); writeLink(); }
}
$('langBtn').onclick = () => applyLang(lang === 'es' ? 'en' : 'es');

// ---------- deep links ----------
function writeLink() {
  if (!DATA) return;
  const s = serializeLink({
    view: S.view, focus: S.selected && S.selected[0] !== 's' ? S.selected : null, expanded: S.expanded,
    years: S.filters.years, types: S.filters.types, q: S.query ? S.query.term : '', lang,
  }, DATA);
  history.replaceState(null, '', location.pathname + s + location.hash);
}

// ---------- start ----------
async function start() {
  let stored = null;
  try { stored = localStorage.getItem('mcg-lang'); } catch { /* storage unavailable */ }
  applyLang(detectLang(location.search, stored, navigator.language));
  try {
    const res = await fetch('data/graph-data.json');
    DATA = await res.json();
  } catch {
    $('welcome').textContent = T.loadError; return;
  }
  U = DATA.universities; DISC = DATA.disciplines;
  const link = parseLink(location.search, DATA);
  S.view = link.view; S.filters.years = link.years; S.filters.types = link.types; S.expanded = link.expanded;
  [...$('mode').children].forEach((x) => { x.classList.toggle('on', x.dataset.m === S.view); x.setAttribute('aria-pressed', x.dataset.m === S.view); });
  if (window.innerWidth < 720) legend.classList.add('collapsed');
  renderFilterChips();
  resize();
  rebuild();
  for (let i = 0; i < 260; i++) alpha = step(nodes, links, alpha, S.forces, null, maxW);
  for (const n of nodes) pos.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
  if (link.focus && byId.has(link.focus)) { select(link.focus); }
  else if (link.q) { q.value = link.q; runQuery(link.q); }
  fit(false);
  if (link.focus && byId.has(link.focus)) centreOn(link.focus);
  requestAnimationFrame(loop);
  setTimeout(() => { $('welcome').style.opacity = 0; }, 4000);
  // Read-only handle for automated checks.
  window.__graph = { get state() { return S; }, get nodes() { return nodes; }, get links() { return links; }, get agg() { return agg; }, get lang() { return lang; }, data: DATA };
}
start();
