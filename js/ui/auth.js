// Accesso all'account: pulsante nella barra, finestra di login/registrazione (email + password, Google),
// stato dell'utente nel menu e logout. Senza login restano disponibili mappa e meteo (SPEC §2.9).

import { it } from '../i18n/it.js';
import { getClient, isConfigured, errorMessage } from '../data/supabase.js';

/**
 * @typedef {Object} AuthUi
 * @property {() => any} user utente corrente (null se non autenticato)
 * @property {(fn: (user: any) => void) => void} onChange
 */

/**
 * @param {HTMLElement} topbar
 * @param {HTMLElement} menuSection corpo della sezione "Account" del menu
 * @returns {AuthUi}
 */
export function initAuth(topbar, menuSection) {
  const t = it.auth;
  /** @type {any} */
  let user = null;
  /** @type {((u: any) => void)[]} */
  const listeners = [];

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn account-btn';
  btn.setAttribute('aria-label', t.account);
  btn.title = t.account;
  btn.innerHTML = '<span aria-hidden="true">👤</span>';
  // Senza progetto Supabase configurato il pulsante non compare (lo stato è spiegato nel menu).
  if (isConfigured()) topbar.append(btn);

  const status = document.createElement('p');
  status.className = 'account-status';
  const actions = document.createElement('div');
  actions.className = 'account-actions';
  menuSection.append(status, actions);

  function render() {
    btn.classList.toggle('signed-in', Boolean(user));
    actions.replaceChildren();
    if (!isConfigured()) {
      status.textContent = t.notConfigured;
      return;
    }
    if (user) {
      status.textContent = `${t.signedInAs} ${user.email ?? ''}`;
      actions.append(button(t.signOut, signOut));
    } else {
      status.textContent = t.signedOut;
      actions.append(button(t.signIn, openDialog));
    }
  }

  /** @param {any} u */
  function setUser(u) {
    const changed = (u?.id ?? null) !== (user?.id ?? null);
    user = u;
    render();
    if (changed) listeners.forEach((fn) => fn(user));
  }

  async function signOut() {
    try {
      const sb = await getClient();
      await sb.auth.signOut();
    } catch (err) {
      console.warn(err);
    }
    setUser(null);
  }

  btn.addEventListener('click', () => {
    if (user) {
      // Con l'utente già collegato il pulsante apre il menu (lì c'è il logout).
      document.querySelector('.menu-btn')?.dispatchEvent(new MouseEvent('click'));
    } else {
      openDialog();
    }
  });

  /** Finestra di accesso. */
  function openDialog() {
    if (!isConfigured()) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <form class="modal auth-modal" novalidate>
        <div class="auth-head">
          <h2>${t.title}</h2>
          <button type="button" class="icon-btn auth-close" aria-label="${t.close}">✕</button>
        </div>
        <p class="auth-intro">${t.intro}</p>
        <button type="button" class="btn-google">${t.google}</button>
        <div class="auth-sep"><span>${t.or}</span></div>
        <label>${t.email}<input type="email" name="email" autocomplete="email" required></label>
        <label>${t.password}<input type="password" name="password" autocomplete="current-password" minlength="8" required></label>
        <p class="auth-msg" role="alert"></p>
        <button type="submit" class="btn-primary">${t.signIn}</button>
        <div class="auth-links">
          <button type="button" class="link-btn" data-act="signup">${t.signUp}</button>
          <button type="button" class="link-btn" data-act="reset">${t.forgot}</button>
        </div>
      </form>`;
    const form = /** @type {HTMLFormElement} */ (backdrop.querySelector('form'));
    const msg = /** @type {HTMLElement} */ (form.querySelector('.auth-msg'));
    const email = /** @type {HTMLInputElement} */ (form.elements.namedItem('email'));
    const password = /** @type {HTMLInputElement} */ (form.elements.namedItem('password'));
    const close = () => backdrop.remove();
    form.querySelector('.auth-close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    /** @param {string} text @param {'error'|'ok'} [kind] */
    const show = (text, kind = 'error') => {
      msg.textContent = text;
      msg.dataset.kind = kind;
    };
    const busy = (on) => form.querySelectorAll('button, input').forEach((el) => { /** @type {any} */ (el).disabled = on; });

    /** @param {() => Promise<void>} fn */
    const run = async (fn) => {
      busy(true);
      show('');
      try {
        await fn();
      } catch (err) {
        show(errorMessage(err));
      } finally {
        busy(false);
      }
    };

    const validEmail = () => {
      if (!email.value || !email.checkValidity()) {
        show(t.errEmail);
        return false;
      }
      return true;
    };
    const validPassword = () => {
      if (password.value.length < 8) {
        show(t.errWeakPassword);
        return false;
      }
      return true;
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validEmail() || !validPassword()) return;
      run(async () => {
        const sb = await getClient();
        const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw error;
        setUser(data.user);
        close();
      });
    });

    form.querySelector('[data-act="signup"]').addEventListener('click', () => {
      if (!validEmail() || !validPassword()) return;
      run(async () => {
        const sb = await getClient();
        const { data, error } = await sb.auth.signUp({
          email: email.value.trim(),
          password: password.value,
          options: { emailRedirectTo: appUrl() },
        });
        if (error) throw error;
        if (data.session) {
          setUser(data.user);
          close();
        } else {
          show(t.checkEmail, 'ok');
        }
      });
    });

    form.querySelector('[data-act="reset"]').addEventListener('click', () => {
      if (!validEmail()) return;
      run(async () => {
        const sb = await getClient();
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: appUrl() });
        if (error) throw error;
        show(t.resetSent, 'ok');
      });
    });

    form.querySelector('.btn-google').addEventListener('click', () => run(async () => {
      const sb = await getClient();
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
      if (error) throw error;
      // Il browser viene reindirizzato a Google e poi torna all'app.
    }));

    document.body.append(backdrop);
    email.focus();
  }

  // Sessione esistente (o ritorno da Google / link email) e cambiamenti successivi.
  if (isConfigured()) {
    getClient().then(async (sb) => {
      sb.auth.onAuthStateChange((event, session) => {
        setUser(session?.user ?? null);
        if (event === 'PASSWORD_RECOVERY') promptNewPassword(sb);
      });
      const { data } = await sb.auth.getSession();
      setUser(data.session?.user ?? null);
      cleanUrl();
    }).catch((err) => {
      console.warn('Supabase non disponibile:', err);
      status.textContent = errorMessage(err);
    });
  }

  /** Dopo il link "password dimenticata": chiede la nuova password. */
  async function promptNewPassword(sb) {
    const pw = prompt(t.newPassword);
    if (!pw) return;
    const { error } = await sb.auth.updateUser({ password: pw });
    alert(error ? errorMessage(error) : t.passwordUpdated);
  }

  render();
  return {
    user: () => user,
    onChange: (fn) => { listeners.push(fn); },
  };
}

/** Indirizzo dell'app per i ritorni da Google e dalle email (stessa pagina, senza query). */
function appUrl() {
  return `${location.origin}${location.pathname}`;
}

/** Toglie dall'indirizzo i parametri del ritorno OAuth (code, error…). */
function cleanUrl() {
  const url = new URL(location.href);
  let changed = false;
  for (const k of ['code', 'error', 'error_code', 'error_description']) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k);
      changed = true;
    }
  }
  if (url.hash.includes('access_token') || url.hash.includes('error=')) {
    url.hash = '';
    changed = true;
  }
  if (changed) history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/**
 * @param {string} label
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function button(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-secondary';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
