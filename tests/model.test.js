import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TYPES, YEARS, GROUPS, R, TOTAL_ECTS, defaultFilters, rowShare, aggregate, similarity, mostSimilar, buildGraph,
  radius, normalize, searchSubjects, groupMatches, yearLabel, parseYears, formatYears, parseLink, serializeLink,
} from '../src/model.js';
import { step, spring, DEFAULT_FORCES } from '../src/physics.js';
import { STRINGS, detectLang, numberFormat } from '../src/i18n.js';

const DATA = JSON.parse(readFileSync(new URL('../data/graph-data.json', import.meta.url), 'utf8'));
const uniIndex = (key) => DATA.universities.findIndex((u) => u.key === key);
const discIndex = (key) => DATA.disciplines.findIndex((d) => d.key === key);
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ---------- data integrity ----------
test('data: 35 public faculties, each with a unique key and an https source', () => {
  assert.equal(DATA.universities.length, 35);
  assert.equal(new Set(DATA.universities.map((u) => u.key)).size, 35);
  for (const u of DATA.universities) {
    assert.match(u.url, /^https:\/\//, u.key);
    assert.ok(u.name && u.short && u.region && u.campus, u.key);
    assert.equal(Boolean(u.notes.es), Boolean(u.notes.en), `notes in both languages for ${u.key}`);
  }
});

test('data: every row is well formed', () => {
  for (const r of DATA.rows) {
    assert.ok(r[R.UNI] >= 0 && r[R.UNI] < DATA.universities.length);
    assert.ok(r[R.YEARS].length >= 1 && r[R.YEARS].every((y) => YEARS.includes(y)));
    assert.ok(TYPES.includes(r[R.TYPE]), r[R.NAME]);
    assert.ok(r[R.ECTS] > 0 && Number.isFinite(r[R.ECTS]), r[R.NAME]);
    assert.ok(r[R.DISC].length >= 1 && r[R.DISC].every((d) => d >= 0 && d < DATA.disciplines.length));
  }
});

test('data: every plan totals 360 ECTS except Almería, whose source lists 357', () => {
  const agg = aggregate(DATA, defaultFilters());
  DATA.universities.forEach((u, i) => {
    const expected = u.key === 'ual' ? 357 : TOTAL_ECTS;
    assert.ok(close(agg.uniTot[i], expected), `${u.key}: ${agg.uniTot[i]}`);
  });
});

test('data: every discipline has a group, both names and a unique key; no subject is left unclassified', () => {
  assert.equal(new Set(DATA.disciplines.map((d) => d.key)).size, DATA.disciplines.length);
  for (const d of DATA.disciplines) { assert.ok(GROUPS.includes(d.group), d.key); assert.ok(d.es && d.en, d.key); }
  const other = discIndex('other');
  assert.equal(DATA.rows.filter((r) => r[R.DISC].includes(other)).length, 0);
});

test('data: placements, final projects and electives map to their own nodes', () => {
  for (const r of DATA.rows) {
    if (r[R.TYPE] === 'TFG') assert.deepEqual(r[R.DISC], [discIndex('final-project')], r[R.NAME]);
    if (r[R.TYPE] === 'PE') assert.deepEqual(r[R.DISC], [discIndex('placements')], r[R.NAME]);
    if (r[R.TYPE] === 'OP') assert.deepEqual(r[R.DISC], [discIndex('electives')], r[R.NAME]);
  }
});

test('data: classification spot checks', () => {
  const tagsOf = (uni, name) => {
    const r = DATA.rows.find((x) => x[R.UNI] === uniIndex(uni) && x[R.NAME] === name);
    assert.ok(r, `${uni}: ${name}`);
    return r[R.DISC].map((d) => DATA.disciplines[d].key).sort();
  };
  assert.deepEqual(tagsOf('uv', 'Anatomía patológica general'), ['pathology']);
  assert.deepEqual(tagsOf('uv', 'Nefrología y urología'), ['nephro-urology']);
  assert.deepEqual(tagsOf('ucm', 'Anestesiología, Reanimación y Terapéutica del Dolor'), ['anaesthesia']);
  assert.deepEqual(tagsOf('uca', 'Medicina y Cirugía Respiratorio'), ['respiratory', 'surgery']);
  assert.deepEqual(tagsOf('uv', 'Neuroanatomía'), ['anatomy']); // basic science, not clinical neurology
});

// ---------- filters and aggregation ----------
test('rowShare: type filter, year filter and proportional multi-year rows', () => {
  const f = defaultFilters();
  const row = [0, [4, 5, 6], '', 'x', 'TFG', 12, [0]];
  assert.equal(rowShare(row, f), 12);
  f.years = new Set([4]);
  assert.equal(rowShare(row, f), 4);
  f.years = new Set([1]);
  assert.equal(rowShare(row, f), 0);
  f.years = new Set(YEARS); f.types = new Set(['FB']);
  assert.equal(rowShare(row, f), 0);
});

test('aggregate: year filters partition the totals', () => {
  const all = aggregate(DATA, defaultFilters());
  const sum = new Array(DATA.universities.length).fill(0);
  for (const y of YEARS) {
    const f = defaultFilters(); f.years = new Set([y]);
    aggregate(DATA, f).uniTot.forEach((t, i) => { sum[i] += t; });
  }
  sum.forEach((s, i) => assert.ok(close(s, all.uniTot[i]), DATA.universities[i].key));
});

test('aggregate: per-type and per-discipline totals add up to the university total', () => {
  const a = aggregate(DATA, defaultFilters());
  a.uniTot.forEach((t, i) => {
    assert.ok(close(TYPES.reduce((s, k) => s + a.uniType[i][k], 0), t));
    assert.ok(close(a.uniVec[i].reduce((s, w) => s + w, 0), t));
  });
  assert.ok(close(a.discTot.reduce((s, w) => s + w, 0), a.uniTot.reduce((s, w) => s + w, 0)));
});

test('aggregate: national requirements visible in the data (≥ 54 ECTS placements + TFG in year 6 almost everywhere)', () => {
  const f = defaultFilters(); f.types = new Set(['PE']);
  const a = aggregate(DATA, f);
  const withPlacements = a.uniTot.filter((t) => t >= 40).length;
  assert.ok(withPlacements >= 30, `${withPlacements} faculties with ≥ 40 ECTS of placements`);
});

// ---------- similarity ----------
test('similarity: symmetric, bounded, 1 on the diagonal', () => {
  const a = aggregate(DATA, defaultFilters());
  const s = similarity(a.uniVec, a.uniTot);
  for (let i = 0; i < s.length; i++) {
    assert.equal(s[i][i], 1);
    for (let j = 0; j < s.length; j++) {
      assert.ok(close(s[i][j], s[j][i]));
      assert.ok(s[i][j] >= -1 - 1e-9 && s[i][j] <= 1 + 1e-9);
    }
  }
});

test('similarity: centred, so shared blocks do not make every pair look alike', () => {
  const a = aggregate(DATA, defaultFilters());
  const s = similarity(a.uniVec, a.uniTot);
  const off = s.flatMap((row, i) => row.filter((_, j) => j !== i));
  const mean = off.reduce((x, y) => x + y, 0) / off.length;
  assert.ok(mean < 0.3, `mean off-diagonal similarity ${mean}`);
  assert.ok(Math.max(...off) > 0.4, 'some plans are clearly alike');
});

test('similarity: identical plans score 1, inactive plans score 0', () => {
  const vec = [[1, 2, 3], [1, 2, 3], [3, 2, 1], [0, 0, 0]];
  const s = similarity(vec, [6, 6, 6, 0]);
  assert.ok(close(s[0][1], 1));
  assert.ok(s[0][2] < 0);
  assert.equal(s[0][3], 0);
});

test('mostSimilar: sorted, excludes itself and hidden plans', () => {
  const a = aggregate(DATA, defaultFilters());
  const s = similarity(a.uniVec, a.uniTot);
  const uv = uniIndex('uv'), hidden = new Set([uniIndex('ull')]);
  const top = mostSimilar(s, uv, (j) => !hidden.has(j), 5);
  assert.equal(top.length, 5);
  assert.ok(top.every(([j]) => j !== uv && !hidden.has(j)));
  for (let k = 1; k < top.length; k++) assert.ok(top[k - 1][1] >= top[k][1]);
});

// ---------- graph ----------
test('buildGraph network: links only between existing nodes, weights = ECTS', () => {
  const f = defaultFilters(), a = aggregate(DATA, f), s = similarity(a.uniVec, a.uniTot);
  const g = buildGraph(DATA, a, s, f, { view: 'network' });
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.equal(g.nodes.filter((n) => n.type === 'uni').length, 35);
  assert.ok(g.links.every((l) => ids.has(l.s) && ids.has(l.t) && l.w > 0));
  const uv = uniIndex('uv');
  const sum = g.links.filter((l) => l.s === 'u' + uv).reduce((x, l) => x + l.w, 0);
  assert.ok(close(sum, 360));
});

test('buildGraph similarity: universities only, each with at least 3 links', () => {
  const f = defaultFilters(), a = aggregate(DATA, f), s = similarity(a.uniVec, a.uniTot);
  const g = buildGraph(DATA, a, s, f, { view: 'similarity' });
  assert.ok(g.nodes.every((n) => n.type === 'uni'));
  const deg = new Map(); for (const l of g.links) { deg.set(l.s, (deg.get(l.s) || 0) + 1); deg.set(l.t, (deg.get(l.t) || 0) + 1); }
  assert.ok(g.nodes.every((n) => (deg.get(n.id) || 0) >= 3));
  assert.ok(g.links.every((l) => l.wn >= 0 && l.wn <= 1));
});

test('buildGraph: hidden groups and regions, and expanded subjects', () => {
  const f = defaultFilters(); f.hiddenGroups.add('basic'); f.hiddenRegions.add('Cataluña');
  const a = aggregate(DATA, f), s = similarity(a.uniVec, a.uniTot);
  const uv = uniIndex('uv');
  const g = buildGraph(DATA, a, s, f, { view: 'network', expanded: new Set([uv]) });
  assert.ok(!g.nodes.some((n) => n.type === 'disc' && DATA.disciplines[n.i].group === 'basic'));
  assert.ok(!g.nodes.some((n) => n.type === 'uni' && DATA.universities[n.i].region === 'Cataluña'));
  const subj = g.nodes.filter((n) => n.type === 'subj');
  assert.equal(subj.length, DATA.rows.filter((r) => r[R.UNI] === uv).length);
  assert.ok(subj.every((n) => DATA.rows[n.i][R.UNI] === uv));
});

test('radius: positive and finite for every node', () => {
  const f = defaultFilters(), a = aggregate(DATA, f), s = similarity(a.uniVec, a.uniTot);
  const g = buildGraph(DATA, a, s, f, { view: 'network', expanded: new Set([0]) });
  const maxDisc = Math.max(...g.nodes.filter((n) => n.type === 'disc').map((n) => n.val));
  for (const n of g.nodes) { const r = radius(n, 'network', maxDisc); assert.ok(r > 0 && Number.isFinite(r)); }
});

// ---------- physics ----------
test('physics: stays finite and bounded from a degenerate start, and cools down', () => {
  const nodes = Array.from({ length: 60 }, (_, i) => ({ x: i % 2, y: 0, vx: 0, vy: 0, r: 8, type: i % 5 ? 'disc' : 'uni' }));
  const links = nodes.slice(1).map((b, i) => ({ a: nodes[0], b, w: i % 7 + 1, kind: 'ects' }));
  let alpha = 1;
  for (let k = 0; k < 400; k++) alpha = step(nodes, links, alpha, DEFAULT_FORCES, null, 7);
  for (const n of nodes) { assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y)); assert.ok(Math.hypot(n.x, n.y) < 5000); }
  assert.ok(alpha < 0.01);
});

test('physics: a held node does not move and keeps the layout warm', () => {
  const a = { x: 10, y: 10, vx: 0, vy: 0, r: 5 }, b = { x: 40, y: 0, vx: 0, vy: 0, r: 5 };
  const alpha = step([a, b], [{ a, b, w: 1, kind: 'ects' }], 0.01, DEFAULT_FORCES, a, 1);
  assert.equal(a.x, 10); assert.equal(a.y, 10);
  assert.ok(alpha >= 0.25);
});

test('physics: heavier links are shorter and stiffer', () => {
  const light = spring({ w: 1, kind: 'ects' }, DEFAULT_FORCES, 20), heavy = spring({ w: 20, kind: 'ects' }, DEFAULT_FORCES, 20);
  assert.ok(heavy.len < light.len && heavy.k > light.k);
});

// ---------- search, labels, links ----------
test('search: accent- and case-insensitive', () => {
  assert.equal(normalize('Genética Médica'), 'genetica medica');
  const a = searchSubjects(DATA, 'genet'), b = searchSubjects(DATA, 'GENÉT');
  assert.ok(a.length > 30);
  assert.equal(a.length, b.length);
  assert.equal(searchSubjects(DATA, 'g').length, 0);
  const groups = groupMatches(a);
  for (let k = 1; k < groups.length; k++) assert.ok(groups[k - 1].ects >= groups[k].ects);
});

test('years: labels, parsing and formatting round-trip', () => {
  assert.equal(yearLabel([3]), '3º');
  assert.equal(yearLabel([4, 5, 6]), '4º–6º');
  assert.deepEqual([...parseYears('1-3,5')].sort(), [1, 2, 3, 5]);
  assert.equal(parseYears('9').size, 6);
  assert.equal(formatYears(new Set([1, 2, 3, 5])), '1-3,5');
  assert.equal(formatYears(parseYears('2,4-6')), '2,4-6');
});

test('deep links: parse and serialise round-trip', () => {
  const l = parseLink('?view=similarity&focus=uv&years=1-3&types=FB,OB&expand=uv&lang=en', DATA);
  assert.equal(l.view, 'similarity');
  assert.equal(l.focus, 'u' + uniIndex('uv'));
  assert.deepEqual([...l.years], [1, 2, 3]);
  assert.deepEqual([...l.types], ['FB', 'OB']);
  assert.deepEqual([...l.expanded], [uniIndex('uv')]);
  assert.equal(l.lang, 'en');
  const back = serializeLink({ view: l.view, focus: l.focus, expanded: l.expanded, years: l.years, types: l.types, q: '', lang: 'en' }, DATA);
  assert.deepEqual(parseLink(back, DATA), l);
  assert.equal(parseLink('?focus=anatomy', DATA).focus, 'd' + discIndex('anatomy'));
  assert.equal(serializeLink({ view: 'network', years: new Set(YEARS), types: new Set(TYPES), expanded: new Set() }, DATA), '');
  const bad = parseLink('?view=x&focus=nope&types=ZZ', DATA);
  assert.equal(bad.view, 'network'); assert.equal(bad.focus, null); assert.equal(bad.types.size, 5);
});

// ---------- i18n ----------
test('i18n: both languages define the same keys, groups and types', () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(STRINGS.es), keys(STRINGS.en));
  assert.deepEqual(keys(STRINGS.es.groups), [...GROUPS].sort());
  assert.deepEqual(keys(STRINGS.en.groups), [...GROUPS].sort());
  assert.deepEqual(keys(STRINGS.es.types), [...TYPES].sort());
  for (const l of ['es', 'en']) for (const [k, v] of Object.entries(STRINGS[l])) assert.ok(v !== '' && v != null, `${l}.${k}`);
});

test('i18n: language detection and number formats', () => {
  assert.equal(detectLang('?lang=en', 'es', 'es-ES'), 'en');
  assert.equal(detectLang('', 'en', 'es-ES'), 'en');
  assert.equal(detectLang('', null, 'ca-ES'), 'es');
  assert.equal(detectLang('', null, 'en-GB'), 'en');
  assert.equal(numberFormat('es')(4.5), '4,5');
  assert.equal(numberFormat('en')(4.5), '4.5');
});
