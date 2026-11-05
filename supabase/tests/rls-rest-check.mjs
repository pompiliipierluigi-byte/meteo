// Verifica della RLS sul progetto Supabase reale, con chiamate dirette all'API REST e la chiave
// publishable/anon (criterio di "fatto" della fase 2). Servono due account di prova già confermati.
//
//   SB_URL=https://<id>.supabase.co SB_KEY=sb_publishable_… \
//   A_EMAIL=… A_PASSWORD=… B_EMAIL=… B_PASSWORD=… node supabase/tests/rls-rest-check.mjs
//
// Crea una barca di prova con l'utente A, verifica che B non la veda né la modifichi, poi la elimina.

const { SB_URL, SB_KEY, A_EMAIL, A_PASSWORD, B_EMAIL, B_PASSWORD } = process.env;
if (!SB_URL || !SB_KEY || !A_EMAIL || !A_PASSWORD || !B_EMAIL || !B_PASSWORD) {
  console.error('Variabili mancanti: SB_URL, SB_KEY, A_EMAIL, A_PASSWORD, B_EMAIL, B_PASSWORD');
  process.exit(2);
}

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok' : 'FALLITO'}: ${msg}`);
  if (!cond) failed++;
};

async function login(email, password) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Login ${email}: ${j.msg || j.error_description || r.status}`);
  return j.access_token;
}

/** @param {string | null} token */
const rest = (token) => async (method, path, body) => {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
};

const A = rest(await login(A_EMAIL, A_PASSWORD));
const B = rest(await login(B_EMAIL, B_PASSWORD));
const anon = rest(null);

const polar = { version: 1, tws: [6, 10], twa: [52, 90], bsp: [[5, 6], [6, 7]] };
const created = await A('POST', 'boats', { name: 'Prova RLS', source: 'manual' });
ok(created.status === 201, 'A crea una barca');
const boat = created.data[0];
ok((await A('POST', 'polars', { boat_id: boat.id, kind: 'full', data: polar, source: 'manual' })).status === 201, 'A aggiunge la polare');

try {
  ok((await A('GET', `boats?id=eq.${boat.id}`)).data.length === 1, 'A vede la propria barca');
  ok((await B('GET', `boats?id=eq.${boat.id}`)).data.length === 0, 'B non vede la barca di A');
  ok((await B('GET', `polars?boat_id=eq.${boat.id}`)).data.length === 0, 'B non vede le polari di A');
  ok((await B('PATCH', `boats?id=eq.${boat.id}`, { name: 'rubata' })).data.length === 0, 'B non modifica la barca di A');
  ok((await B('DELETE', `boats?id=eq.${boat.id}`)).data.length === 0, 'B non elimina la barca di A');
  ok((await B('POST', 'polars', { boat_id: boat.id, kind: 'white', data: polar, source: 'manual' })).status >= 400, 'B non aggiunge polari alla barca di A');
  ok((await B('POST', 'boats', { user_id: boat.user_id, name: 'x', source: 'manual' })).status >= 400, 'B non crea barche a nome di A');
  ok((await B('GET', 'profiles')).data.length === 1, 'B vede solo il proprio profilo');
  ok((await B('PATCH', `profiles?id=eq.${boat.user_id}`, { upwind_eff_pct: 50 })).data.length === 0, 'B non modifica il profilo di A');
  const an = await anon('GET', 'boats');
  ok(an.status >= 400 || (Array.isArray(an.data) && an.data.length === 0), 'senza login nessuna barca visibile');
  ok((await A('GET', `boats?id=eq.${boat.id}`)).data[0]?.name === 'Prova RLS', 'la barca di A è intatta');
} finally {
  await A('DELETE', `boats?id=eq.${boat.id}`);
}
console.log(failed ? `${failed} controlli FALLITI` : 'RLS verificata: tutti i controlli superati');
process.exit(failed ? 1 : 0);
