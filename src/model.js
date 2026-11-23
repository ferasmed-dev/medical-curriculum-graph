// Pure functions over the curriculum data. No DOM access, so everything here is testable with node:test.
//
// Data shape (data/graph-data.json, built by scripts/build_data.py):
//   universities: [{key, short, name, region, campus, url, version:{es,en}, notes:{es,en}}]
//   disciplines:  [{key, group, es, en}]
//   rows:         [[uniIndex, years[], semester, subject, type, ects, disciplineIndexes[]]]

export const TYPES = ['FB', 'OB', 'OP', 'PE', 'TFG'];
export const YEARS = [1, 2, 3, 4, 5, 6];
export const GROUPS = ['basic', 'methods', 'humanities', 'clinical', 'systems', 'senses', 'lifecycle', 'public', 'training'];
export const VIEWS = ['network', 'similarity'];
export const TOTAL_ECTS = 360; // every Grado en Medicina has 360 ECTS (Orden ECI/332/2008)

// Row field positions
export const R = { UNI: 0, YEARS: 1, SEM: 2, NAME: 3, TYPE: 4, ECTS: 5, DISC: 6 };

export function defaultFilters() {
  return { years: new Set(YEARS), types: new Set(TYPES), hiddenGroups: new Set(), hiddenRegions: new Set() };
}

/** ECTS of a row that fall inside the filters. A row spread over several years counts in proportion. */
export function rowShare(row, filters) {
  if (!filters.types.has(row[R.TYPE])) return 0;
  const ys = row[R.YEARS];
  let k = 0;
  for (const y of ys) if (filters.years.has(y)) k++;
  return k ? (row[R.ECTS] * k) / ys.length : 0;
}

/** Totals per university, per type and per discipline under the filters. */
export function aggregate(data, filters) {
  const nU = data.universities.length, nD = data.disciplines.length;
  const uniVec = Array.from({ length: nU }, () => new Array(nD).fill(0));
  const uniTot = new Array(nU).fill(0);
  const uniType = Array.from({ length: nU }, () => Object.fromEntries(TYPES.map((t) => [t, 0])));
  const discTot = new Array(nD).fill(0);
  for (const row of data.rows) {
    const s = rowShare(row, filters);
    if (!s) continue;
    const u = row[R.UNI];
    uniTot[u] += s;
    uniType[u][row[R.TYPE]] += s;
    const part = s / row[R.DISC].length;
    for (const d of row[R.DISC]) { uniVec[u][d] += part; discTot[d] += part; }
  }
  return { uniVec, uniTot, uniType, discTot };
}

/**
 * Similarity between plans: Pearson-style correlation of each plan's deviation from the mean plan,
 * so blocks every faculty shares (54 ECTS of placements, 6 of TFG…) do not make every pair look alike.
 * Returns a matrix in [-1, 1]; inactive universities (0 ECTS under the filters) get 0.
 */
export function similarity(uniVec, uniTot) {
  const n = uniVec.length, nD = n ? uniVec[0].length : 0;
  const active = uniTot.map((t) => t > 0);
  const nAct = active.filter(Boolean).length || 1;
  const mean = new Array(nD).fill(0);
  uniVec.forEach((v, i) => { if (active[i]) v.forEach((w, d) => { mean[d] += w / nAct; }); });
  const dev = uniVec.map((v) => v.map((w, d) => w - mean[d]));
  const norms = dev.map((v) => Math.sqrt(v.reduce((a, b) => a + b * b, 0)));
  return dev.map((a, i) => dev.map((b, j) => {
    if (i === j) return 1;
    if (!active[i] || !active[j] || !norms[i] || !norms[j]) return 0;
    let s = 0;
    for (let d = 0; d < nD; d++) s += a[d] * b[d];
    return s / (norms[i] * norms[j]);
  }));
}

/** The k most similar visible plans to university i. */
export function mostSimilar(sims, i, visible, k = 5) {
  return sims[i].map((s, j) => [j, s]).filter(([j]) => j !== i && visible(j)).sort((a, b) => b[1] - a[1]).slice(0, k);
}

export function isUniVisible(data, agg, filters, i) {
  return !filters.hiddenRegions.has(data.universities[i].region) && agg.uniTot[i] > 0;
}
export function isDiscVisible(data, agg, filters, d) {
  return !filters.hiddenGroups.has(data.disciplines[d].group) && agg.discTot[d] > 0.01;
}

/**
 * Nodes and links for a view.
 *  network:    universities ↔ disciplines, link weight = ECTS the university gives that discipline
 *  similarity: universities ↔ their 3 most similar plans
 * Expanded universities add one node per subject, linked to its university (and, in the network view,
 * weakly to its disciplines).
 */
export function buildGraph(data, agg, sims, filters, { view = 'network', expanded = new Set(), neighbours = 3 } = {}) {
  const nodes = [], links = [];
  data.universities.forEach((u, i) => {
    if (isUniVisible(data, agg, filters, i)) nodes.push({ id: 'u' + i, type: 'uni', i, val: agg.uniTot[i] });
  });
  const has = new Set(nodes.map((n) => n.id));
  if (view === 'network') {
    data.disciplines.forEach((d, j) => {
      if (isDiscVisible(data, agg, filters, j)) { nodes.push({ id: 'd' + j, type: 'disc', i: j, val: agg.discTot[j] }); has.add('d' + j); }
    });
    data.universities.forEach((u, i) => {
      if (!has.has('u' + i)) return;
      agg.uniVec[i].forEach((w, j) => { if (w > 0.01 && has.has('d' + j)) links.push({ s: 'u' + i, t: 'd' + j, w, kind: 'ects' }); });
    });
  } else {
    const ids = nodes.map((n) => n.i), seen = new Set();
    for (const i of ids) {
      ids.filter((j) => j !== i).map((j) => [j, sims[i][j]]).sort((a, b) => b[1] - a[1]).slice(0, neighbours)
        .forEach(([j, s]) => {
          const key = i < j ? i + '-' + j : j + '-' + i;
          if (seen.has(key)) return;
          seen.add(key);
          links.push({ s: 'u' + i, t: 'u' + j, w: s, kind: 'sim' });
        });
    }
    const sl = links;
    if (sl.length) {
      const lo = Math.min(...sl.map((l) => l.w)), hi = Math.max(...sl.map((l) => l.w));
      sl.forEach((l) => { l.wn = hi > lo ? (l.w - lo) / (hi - lo) : 1; });
    }
  }
  for (const ui of expanded) {
    if (!has.has('u' + ui)) continue;
    data.rows.forEach((r, ri) => {
      if (r[R.UNI] !== ui) return;
      const s = rowShare(r, filters);
      if (!s) return;
      nodes.push({ id: 's' + ri, type: 'subj', i: ri, val: s });
      links.push({ s: 'u' + ui, t: 's' + ri, w: s, kind: 'subject' });
      if (view === 'network') for (const d of r[R.DISC]) if (has.has('d' + d)) links.push({ s: 's' + ri, t: 'd' + d, w: s / r[R.DISC].length, kind: 'ghost' });
    });
  }
  return { nodes, links };
}

/** Node radius in world units (before the user's size factor). */
export function radius(node, view, maxDisc) {
  if (node.type === 'uni') return view === 'similarity' ? 9 : 7 + 5 * Math.sqrt(node.val / TOTAL_ECTS);
  if (node.type === 'disc') return 4 + 15 * Math.sqrt(node.val / (maxDisc || 1));
  return 2.5 + Math.sqrt(node.val) * 1.1;
}

/** Accent- and case-insensitive text for search. */
export function normalize(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Subjects whose name contains the term (accent-insensitive). Returns [[row, rowIndex]]. */
export function searchSubjects(data, term) {
  const t = normalize(term.trim());
  if (t.length < 2) return [];
  return data.rows.map((r, ri) => [r, ri]).filter(([r]) => normalize(r[R.NAME]).includes(t));
}

/** Matching subjects grouped by university, ordered by ECTS (largest first). */
export function groupMatches(matches) {
  const by = new Map();
  for (const [r] of matches) {
    if (!by.has(r[R.UNI])) by.set(r[R.UNI], []);
    by.get(r[R.UNI]).push(r);
  }
  return [...by.entries()].map(([u, rows]) => ({ u, ects: rows.reduce((a, r) => a + r[R.ECTS], 0), rows }))
    .sort((a, b) => b.ects - a.ects);
}

export function yearLabel(ys) {
  if (ys.length === 1) return ys[0] + 'º';
  return ys[0] + 'º–' + ys[ys.length - 1] + 'º';
}

/** Parse "1-3", "1,2,5" or "" into a set of years (all years when empty or invalid). */
export function parseYears(s) {
  if (!s) return new Set(YEARS);
  const out = new Set();
  for (const part of String(s).split(',')) {
    const m = part.trim().match(/^(\d)(?:-(\d))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let y = Math.min(a, b); y <= Math.max(a, b); y++) if (YEARS.includes(y)) out.add(y);
  }
  return out.size ? out : new Set(YEARS);
}

/** Compact form of a set of years: [1,2,3,5] → "1-3,5". */
export function formatYears(set) {
  const ys = [...set].sort((a, b) => a - b), parts = [];
  for (let i = 0; i < ys.length; i++) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    parts.push(i === j ? String(ys[i]) : ys[i] + '-' + ys[j]);
    i = j;
  }
  return parts.join(',');
}

/**
 * Read a shareable state from a URL query string.
 *   ?view=network|similarity  ?focus=<university or discipline key>  ?expand=<university key>
 *   ?years=1-3  ?types=FB,OB  ?q=<subject search>  ?lang=es|en
 */
export function parseLink(search, data) {
  const p = new URLSearchParams(search);
  const view = VIEWS.includes(p.get('view')) ? p.get('view') : 'network';
  const types = new Set((p.get('types') || '').split(',').map((t) => t.trim().toUpperCase()).filter((t) => TYPES.includes(t)));
  const uniKey = (k) => data.universities.findIndex((u) => u.key === k);
  const discKey = (k) => data.disciplines.findIndex((d) => d.key === k);
  let focus = null;
  const f = p.get('focus');
  if (f) {
    if (uniKey(f) >= 0) focus = 'u' + uniKey(f);
    else if (discKey(f) >= 0) focus = 'd' + discKey(f);
  }
  const expanded = new Set((p.get('expand') || '').split(',').map(uniKey).filter((i) => i >= 0));
  const lang = ['es', 'en'].includes(p.get('lang')) ? p.get('lang') : null;
  return { view, years: parseYears(p.get('years')), types: types.size ? types : new Set(TYPES), focus, expanded, q: p.get('q') || '', lang };
}

/** Inverse of parseLink: only non-default values are written. */
export function serializeLink(state, data) {
  const p = new URLSearchParams();
  if (state.view && state.view !== 'network') p.set('view', state.view);
  if (state.focus) {
    const i = +state.focus.slice(1);
    if (state.focus[0] === 'u') p.set('focus', data.universities[i].key);
    if (state.focus[0] === 'd') p.set('focus', data.disciplines[i].key);
  }
  if (state.expanded && state.expanded.size) p.set('expand', [...state.expanded].map((i) => data.universities[i].key).join(','));
  if (state.years && state.years.size < YEARS.length) p.set('years', formatYears(state.years));
  if (state.types && state.types.size < TYPES.length) p.set('types', TYPES.filter((t) => state.types.has(t)).join(','));
  if (state.q) p.set('q', state.q);
  if (state.lang) p.set('lang', state.lang);
  const s = p.toString().replace(/%2C/g, ',');
  return s ? '?' + s : '';
}
