// Barbe meteorologiche del vento (alternativa alle frecce, SPEC §2.2): asta dalla posizione verso la
// provenienza, alette sul lato orario (emisfero nord). Pennone = 50 kn, aletta = 10 kn, mezza = 5 kn.

/**
 * Scomposizione dell'intensità (arrotondata ai 5 kn) in pennoni, alette e mezze alette.
 * @param {number} speedKn
 * @returns {{calm: boolean, pennants: number, full: number, half: number}}
 */
export function barbCounts(speedKn) {
  const r = Math.round(Math.max(0, speedKn) / 5) * 5;
  if (r < 5) return { calm: true, pennants: 0, full: 0, half: 0 };
  const pennants = Math.floor(r / 50);
  const full = Math.floor((r % 50) / 10);
  const half = (r % 10) >= 5 ? 1 : 0;
  return { calm: false, pennants, full, half };
}

/** Lunghezza dell'asta (pixel CSS). */
export const BARB_STAFF_PX = 24;

/**
 * Geometria di una barba in pixel: segmenti (asta, alette), triangoli (pennoni) o cerchio di calma.
 * @param {number} x posizione (pixel)
 * @param {number} y
 * @param {number} dx verso in cui soffia il vento (schermo, normalizzato)
 * @param {number} dy
 * @param {number} speedKn
 * @returns {{calm: boolean, lines: number[][], triangles: number[][]}}
 */
export function barbGeometry(x, y, dx, dy, speedKn) {
  const c = barbCounts(speedKn);
  /** @type {number[][]} */
  const lines = [];
  /** @type {number[][]} */
  const triangles = [];
  if (c.calm) return { calm: true, lines, triangles };
  // Asta verso la provenienza (sx, sy); alette sul lato orario guardando dalla posizione all'estremo.
  const sx = -dx;
  const sy = -dy;
  const px = -sy;
  const py = sx;
  const L = BARB_STAFF_PX;
  const feather = 10;
  const gap = 4;
  const tipX = x + sx * L;
  const tipY = y + sy * L;
  lines.push([x, y, tipX, tipY]);
  const at = (d) => [tipX - sx * d, tipY - sy * d];
  let d = 0;
  for (let i = 0; i < c.pennants; i++) {
    const [ax, ay] = at(d);
    const [bx, by] = at(d + gap * 1.5);
    triangles.push([ax, ay, ax + px * feather + sx * 2, ay + py * feather + sy * 2, bx, by]);
    d += gap * 1.5 + 1;
  }
  if (c.pennants && (c.full || c.half)) d += 1;
  for (let i = 0; i < c.full; i++) {
    const [ax, ay] = at(d);
    lines.push([ax, ay, ax + px * feather + sx * 3, ay + py * feather + sy * 3]);
    d += gap;
  }
  if (c.half) {
    // Mezza aletta da sola: rientrata dall'estremo, per non confonderla con un'aletta intera.
    if (!c.pennants && !c.full) d += gap;
    const [ax, ay] = at(d);
    lines.push([ax, ay, ax + px * feather * 0.5 + sx * 1.5, ay + py * feather * 0.5 + sy * 1.5]);
  }
  return { calm: false, lines, triangles };
}

/**
 * Aggiunge una barba ai percorsi: `stroke` per asta, alette e cerchio di calma, `fill` per i pennoni.
 * @param {Path2D | CanvasRenderingContext2D} stroke
 * @param {Path2D | CanvasRenderingContext2D} fill
 * @param {number} x
 * @param {number} y
 * @param {number} dx
 * @param {number} dy
 * @param {number} speedKn
 */
export function traceBarb(stroke, fill, x, y, dx, dy, speedKn) {
  const g = barbGeometry(x, y, dx, dy, speedKn);
  if (g.calm) {
    stroke.moveTo(x + 4, y);
    stroke.arc(x, y, 4, 0, Math.PI * 2);
    return;
  }
  for (const [x1, y1, x2, y2] of g.lines) {
    stroke.moveTo(x1, y1);
    stroke.lineTo(x2, y2);
  }
  for (const [x1, y1, x2, y2, x3, y3] of g.triangles) {
    fill.moveTo(x1, y1);
    fill.lineTo(x2, y2);
    fill.lineTo(x3, y3);
    fill.closePath();
    // Anche il contorno del pennone, per il bordo scuro.
    stroke.moveTo(x1, y1);
    stroke.lineTo(x2, y2);
    stroke.lineTo(x3, y3);
  }
}
