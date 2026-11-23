// Force-directed layout: pairwise repulsion, springs along links, gravity to the centre, collision.
// Works on plain objects {x, y, vx, vy, r, type}; links are {a, b, w, wn?, kind}. No DOM.

export const DEFAULT_FORCES = { repulsion: 1100, distance: 110, strength: 0.35, gravity: 0.25 };

const MAX_FORCE = 40;   // per pair per tick: keeps overlapping nodes from launching each other
const MAX_SPEED = 40;   // world units per tick
const FRICTION = 0.62;

/** One simulation step. Returns the new alpha (cooling factor). `fixed` is a node held by the pointer. */
export function step(nodes, links, alpha, forces = DEFAULT_FORCES, fixed = null, maxW = 1) {
  const n = nodes.length, g = forces.gravity * 0.02;
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy + 0.01; }
      if (d2 > 360000) continue;
      const light = a.type === 'subj' || b.type === 'subj' ? 0.35 : 1;
      const d = Math.sqrt(d2), f = Math.min(MAX_FORCE, (forces.repulsion * light * alpha) / Math.max(d2, 64));
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      const min = a.r + b.r + 3;
      if (d < min) {
        const p = Math.min(2, ((min - d) / d) * 0.5);
        a.x += dx * p; a.y += dy * p; b.x -= dx * p; b.y -= dy * p;
      }
    }
  }
  for (const l of links) {
    const a = l.a, b = l.b;
    let dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const { len, k } = spring(l, forces, maxW);
    const m = ((d - len) / d) * k * alpha * 0.5;
    dx *= m; dy *= m;
    a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
  }
  for (const a of nodes) {
    a.vx -= a.x * g * alpha; a.vy -= a.y * g * alpha;
    if (a === fixed) { a.vx = a.vy = 0; continue; }
    a.vx *= FRICTION; a.vy *= FRICTION;
    const sp = Math.hypot(a.vx, a.vy);
    if (sp > MAX_SPEED) { a.vx *= MAX_SPEED / sp; a.vy *= MAX_SPEED / sp; }
    a.x += a.vx; a.y += a.vy;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) { a.x = (Math.random() - 0.5) * 200; a.y = (Math.random() - 0.5) * 200; a.vx = a.vy = 0; }
  }
  return fixed ? Math.max(alpha, 0.25) : alpha * 0.985;
}

/** Rest length and stiffness of a link: heavier links are shorter and stiffer. */
export function spring(l, forces, maxW) {
  const D = forces.distance, S = forces.strength;
  switch (l.kind) {
    case 'sim': return { len: D * (1.8 - 1.1 * (l.wn ?? 0.5)), k: S * (0.3 + 0.7 * (l.wn ?? 0.5)) };
    case 'subject': return { len: D * 0.45, k: S * 1.2 };
    case 'ghost': return { len: D * 1.4, k: S * 0.08 };
    default: {
      const t = Math.min(1, l.w / (maxW || 1));
      return { len: D * (1.6 - 0.9 * t), k: S * (0.15 + 0.85 * t) * 0.5 };
    }
  }
}
