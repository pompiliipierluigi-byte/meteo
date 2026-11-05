import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayEphemeris, nextPhases, moonPhase, crossings } from '../js/lib/astro.js';
import { startOfLocalDay } from '../js/lib/format.js';

// Riferimento: PyEphem 4.2.1 (metodo USNO: orizzonte −0°34′ senza altra rifrazione), giorni locali Europe/Rome.
// [giorno luogo, lat, lon, inizio giorno UTC, alba, tramonto, inizio crepuscolo civile, fine crepuscolo nautico, sorgere luna, tramonto luna]
const REF = [
  ['2026-01-15 giulianova', 42.75, 13.97, 1768431600000, 1768458712321, 1768492527345, 1768456836656, 1768496498314, 1768450216743, 1768480395951],
  ['2026-06-21 giulianova', 42.75, 13.97, 1781992800000, 1782012358565, 1782067552746, 1782010246948, 1782072402679, 1782038491275, 1781994783625],
  ['2026-11-05 giulianova', 42.75, 13.97, 1793833200000, 1793857380743, 1793893912359, 1793855600843, 1793897705417, 1793842494630, 1793886580104],
  ['2027-03-28 giulianova', 42.75, 13.97, 1806188400000, 1806209644659, 1806254710788, 1806207944604, 1806258429036, 1806190014923, 1806220535966],
  ['2026-01-15 venezia', 45.43, 12.33, 1768431600000, 1768459605879, 1768492422751, 1768457624063, 1768496605141, 1768451417269, 1768480000856],
  ['2026-06-21 venezia', 45.43, 12.33, 1781992800000, 1782012133721, 1782068564880, 1782009855467, 1782073887485, 1782038897147, 1781995257372],
  ['2026-11-05 venezia', 45.43, 12.33, 1793833200000, 1793858123500, 1793893954147, 1793856252913, 1793897932695, 1793842891276, 1793886925531],
  ['2027-03-28 venezia', 45.43, 12.33, 1806188400000, 1806209961988, 1806255185130, 1806208181155, 1806259087952, 1806191196143, 1806220164726],
  ['2026-01-15 brindisi', 40.64, 17.95, 1768431600000, 1768457396771, 1768491930847, 1768455593093, 1768495757510, 1768448662872, 1768479977629],
  ['2026-06-21 brindisi', 40.64, 17.95, 1781992800000, 1782011845060, 1782066155590, 1782009841139, 1782070713568, 1782037497485, 1781993758847],
  ['2026-11-05 brindisi', 40.64, 17.95, 1793833200000, 1793856171757, 1793893212889, 1793854454273, 1793896877841, 1793841507055, 1793885649185],
  ['2027-03-28 brindisi', 40.64, 17.95, 1806188400000, 1806208745305, 1806253696788, 1806207101342, 1806257287457, 1806188474175, 1806220100151],
];

const MIN = 60e3;

test('alba, tramonto e crepuscoli entro ±2 min, luna entro ±5 min', () => {
  for (const [name, lat, lon, start, rise, set, civil, naut, mrise, mset] of REF) {
    const e = dayEphemeris(start, lat, lon);
    const near = (a, b, tol, what) => {
      if (b === null) return assert.equal(a, null, `${name} ${what}`);
      assert.ok(a !== null && Math.abs(a - b) <= tol * MIN, `${name} ${what}: ${a === null ? 'null' : ((a - b) / MIN).toFixed(1)} min`);
    };
    near(e.sun.rise, rise, 2, 'alba');
    near(e.sun.set, set, 2, 'tramonto');
    near(e.civil.rise, civil, 2, 'crepuscolo civile');
    near(e.nautical.set, naut, 2, 'crepuscolo nautico');
    near(e.moon.rise, mrise, 5, 'sorgere luna');
    near(e.moon.set, mset, 5, 'tramonto luna');
  }
});

test('prossime fasi lunari dal 5/11/2026 entro ±30 min', () => {
  const ref = {"new": 1794207723113, "firstQuarter": 1794916065057, "full": 1795532009238, "lastQuarter": 1796105315454};
  const p = nextPhases(1793836800000);
  assert.equal(p.length, 4);
  for (const x of p) assert.ok(Math.abs(x.t - ref[x.name]) < 30 * MIN, `${x.name}`);
  assert.equal(moonPhase(ref.full).name, 'full');
  assert.ok(moonPhase(ref.full).illumination > 0.99);
  assert.equal(moonPhase(ref.new).name, 'new');
  assert.ok(moonPhase(ref.new + 4 * 86400e3).name === 'waxingCrescent');
});

test('ricerca degli attraversamenti', () => {
  const c = crossings((t) => Math.sin(t / 1000), 0, 10000, 300);
  assert.deepEqual(c.map((x) => x.rising), [false, true, false]);
  assert.ok(Math.abs(c[0].t - Math.PI * 1000) <= 1000);
});

test('inizio del giorno locale (Europe/Rome), anche al cambio d\'ora', () => {
  assert.equal(startOfLocalDay(Date.UTC(2026, 10, 5, 15)), Date.UTC(2026, 10, 4, 23));
  assert.equal(startOfLocalDay(Date.UTC(2026, 5, 21, 0, 30)), Date.UTC(2026, 5, 20, 22));
  assert.equal(startOfLocalDay(Date.UTC(2027, 2, 28, 12)), Date.UTC(2027, 2, 27, 23));
});
