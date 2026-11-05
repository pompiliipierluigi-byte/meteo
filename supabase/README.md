# Supabase: creazione del progetto passo passo

Serve una volta sola. Tempo: circa 20 minuti (10 senza il login Google).
Alla fine mi servono due valori pubblici: **Project URL** e **chiave publishable/anon** (passo 5).

> La chiave publishable/anon è pubblica per costruzione: finisce nel codice dell'app.
> La protezione dei dati è affidata alla Row Level Security creata dalla migrazione.
> **Non** copiare mai nel repository la chiave `service_role` / `secret`.

## 1. Account e progetto

1. Vai su https://supabase.com e accedi (anche con GitHub).
2. **New project**:
   - *Organization*: quella personale (piano **Free**).
   - *Project name*: `meteo`.
   - *Database password*: generala e salvala in un gestore di password (non serve all'app).
   - *Region*: **Central EU (Frankfurt)** (più vicina all'Adriatico).
3. **Create new project** e attendi 1–2 minuti.

## 2. Tabelle e sicurezza (migrazione SQL)

1. Menu a sinistra → **SQL Editor** → **New query**.
2. Copia tutto il contenuto di [`migrations/0001_init.sql`](migrations/0001_init.sql) e incollalo.
3. **Run**. Deve comparire *Success. No rows returned*.
4. Controllo: menu → **Table Editor**: ci sono `boats`, `polars`, `profiles`, ciascuna con l'etichetta **RLS enabled**
   (se compare *RLS disabled* o *Unrestricted* su una di queste, fermati e avvisami).

La migrazione va eseguita **una volta sola**: una seconda esecuzione dà errore perché le tabelle esistono già.

## 3. Autenticazione: indirizzi dell'app

Menu → **Authentication** → **URL Configuration**:

- *Site URL*: `https://pompiliipierluigi-byte.github.io/meteo/`
- *Redirect URLs* → **Add URL**, una per riga:
  - `https://pompiliipierluigi-byte.github.io/meteo/`
  - `http://localhost:8000/meteo/` (prove in locale)

Salva.

## 4. Metodi di accesso

### Email e password

Menu → **Authentication** → **Sign In / Providers** → **Email**: deve essere attivo (lo è di default).
Lascia attivo *Confirm email*: alla registrazione arriva una mail di conferma.

> Il servizio email integrato di Supabase invia **pochissime email all'ora** (adatto a 2–4 utenti, non di più).
> Se le conferme non arrivano, si può configurare un SMTP proprio (Authentication → Emails → SMTP Settings).

### Google (facoltativo, si può fare anche dopo)

1. Vai su https://console.cloud.google.com → crea un progetto (es. `meteo`).
2. **APIs & Services** → **OAuth consent screen** (o *Google Auth Platform* → *Branding*):
   - tipo **External**, nome app `Meteo Adriatico`, tua email come supporto e contatto;
   - *Audience*: aggiungi come **Test users** gli indirizzi Gmail tuoi e dell'equipaggio
     (in modalità test funzionano solo loro, sufficiente per uso personale).
3. **APIs & Services** → **Credentials** (o *Clients*) → **Create credentials** → **OAuth client ID**:
   - *Application type*: **Web application**;
   - *Authorized JavaScript origins*: `https://pompiliipierluigi-byte.github.io`;
   - *Authorized redirect URIs*: l'indirizzo **Callback URL** che Supabase mostra nella pagina del provider Google
     (forma `https://<id-progetto>.supabase.co/auth/v1/callback`).
4. Copia **Client ID** e **Client secret**.
5. In Supabase: **Authentication** → **Sign In / Providers** → **Google** → attiva, incolla Client ID e Client secret → **Save**.

Il *Client secret* resta su Supabase: non va nel repository né mandato in chat.

## 5. Valori da passarmi

Menu → **Project Settings** → **API Keys** (o **Data API** / **API**):

- **Project URL**: `https://<id-progetto>.supabase.co`
- **Publishable key** (`sb_publishable_…`); se non c'è, la chiave legacy **anon** (`eyJ…`).

Questi due valori vanno in `js/config.js` (`SUPABASE.url`, `SUPABASE.anonKey`).

## Note di esercizio

- **Pausa dopo 7 giorni senza attività** (piano Free): il progetto si ferma; login e salvataggi non funzionano,
  mappa e meteo sì. Per riattivarlo: dashboard Supabase → progetto → **Restore project**.
- Limiti Free: 500 MB di database (le polari pesano pochi KB), 50 000 utenti attivi al mese.
- Nuove migrazioni: file numerati in `migrations/` (`0002_routes.sql`, …), da eseguire in ordine nel SQL Editor.

## Prova locale delle migrazioni

Con PostgreSQL ≥ 15 installato, senza toccare Supabase:

```sh
sh supabase/tests/run-local.sh
```

Crea un database temporaneo con un'imitazione dello schema `auth` di Supabase (`tests/auth-stub.sql`),
applica le migrazioni ed esegue i controlli di trigger e RLS con due utenti e il ruolo anon (`tests/rls.sql`).
