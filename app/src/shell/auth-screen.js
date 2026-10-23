// AUTH (login / forgot password / set new password)
// ──────────────────────────────────────────────────────────────────────────
// Password policy for user-chosen passwords (the "Set a new password"
// screen): at least 8 characters, one capital letter, one special character.
const PASSWORD_POLICY = [
  { label: 'At least 8 characters',           test: (p) => (p || '').length >= 8 },
  { label: 'At least one capital letter',     test: (p) => /[A-Z]/.test(p || '') },
  { label: 'At least one special character',  test: (p) => /[^A-Za-z0-9]/.test(p || '') },
];
const passwordPolicyErrors = (p) => PASSWORD_POLICY.filter(r => !r.test(p)).map(r => r.label);
// Sign-up is intentionally absent: accounts are created when an admin invites
// a rep (Admin → Users → Add). The invite email contains a magic link that
// creates the auth row on first click; the rep can later set a password via
// "Forgot password?" → email reset link.
// The SDK persists the session under sb-<project-ref>-auth-token. Reading /
// writing it directly is the lock-free fallback for the password-reset
// flow (the SDK's cross-tab lock has stalled getSession/setSession there).
function authStorageKey() {
  try { return 'sb-' + new URL(CFG.SUPABASE_URL).hostname.split('.')[0] + '-auth-token'; } catch { return null; }
}
function authStoredSession() {
  try {
    const k = authStorageKey(); if (!k) return null;
    const raw = localStorage.getItem(k); if (!raw) return null;
    const j = JSON.parse(raw);
    const sess = j && j.access_token ? j : (j && j.currentSession) || null;   // v2 stores the session itself; older builds wrapped it
    if (!sess || !sess.access_token) return null;
    if (sess.expires_at && sess.expires_at * 1000 < Date.now() - 60000) return null;
    return sess;
  } catch { return null; }
}
function authStoreSession(sess) {
  try {
    const k = authStorageKey(); if (!k || !sess || !sess.access_token) return false;
    const copy = { ...sess };
    if (!copy.expires_at && copy.expires_in) copy.expires_at = Math.floor(Date.now() / 1000) + Number(copy.expires_in);
    localStorage.setItem(k, JSON.stringify(copy));
    return true;
  } catch { return false; }
}
function mountAuth(opts = {}) {
  const initialMode = opts.mode || 'login'; // 'login' | 'forgot' | 'recover'
  // THE DOOR (Cam's design kit, Q-0275): every RIDDMADE login is the same
  // white room — wordmark top left, the app's name in mono top right, a
  // mono LOGIN eyebrow, mono labels over hairline inputs, one black plate.
  // Measured on white: black 21:1, black/70 8.59:1, white on the plate 21:1.
  const DOOR = {
    label: 'block text-[11px] uppercase',
    labelStyle: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.22em', color: 'rgba(0,0,0,.7)' },
    field: 'door-field w-full mt-2 pb-2 text-base',
    fieldStyle: { border: 0, borderBottom: '1px solid rgba(0,0,0,.3)', background: 'transparent', color: '#000', outline: 'none', borderRadius: 0, fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif' },
  };
  const form = el('form', {
    id: 'login-form', method: 'post', action: '#',   // a real, named form — what keychains attach a saved login to
    class: 'w-full flex flex-col gap-6',
    style: { maxWidth: '320px', color: '#000' },
    novalidate: true,   // our own checks below give real messages; native validation on a hidden field blocks submit with no feedback
    onsubmit: async (e) => {
      e.preventDefault();
      const email    = form.email?.value?.trim();
      const password = form.password?.value;
      const mode     = form.dataset.mode;

      let done = false;   // recover: success card is showing — don't reset the form in `finally`
      // Native validation is off (novalidate) — do the obvious checks here so
      // the rep always gets a message instead of a dead button.
      const _need = (cond, msg, field) => { if (!cond) { errLine.textContent = msg; errLine.style.display = 'block'; try { field && field.querySelector('input').focus(); } catch {} return false; } return true; };
      if (mode !== 'recover' && !_need(email && /\S+@\S+\.\S+/.test(email), 'Enter your email address.', emailField)) return;
      if (mode !== 'forgot' && !_need(password, mode === 'recover' ? 'Type a new password.' : 'Enter your password.', passField)) return;
      if (mode === 'recover' && !_need(form.confirm?.value, 'Type the new password again to confirm it.', confirmField)) return;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span>';
      errLine.style.display = 'none';
      try {
        if (mode === 'login') {
          // Sign in straight against the auth REST API — the SDK's
          // signInWithPassword sits behind a cross-tab auth lock that can
          // stall forever when the app is open in another tab (the "hit
          // Sign in and nothing happens" report, per Isaac). Same approach
          // the reset flow uses; hard timeouts so the button always answers.
          const withTimeout = (pr, ms, msg) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
          const tryPw = (pw) => withTimeout(fetch(CFG.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: { apikey: CFG.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pw }),
          }), 12000, 'Sign-in is taking too long — check your connection and try again.');
          let t = await tryPw(password);
          // Phone keyboards love sneaking a trailing space into typed or
          // pasted passwords — if the exact string failed and trimming
          // would change it, quietly retry once with the trimmed password.
          if (!t.ok && password && password.trim() !== password) t = await tryPw(password.trim());
          if (!t.ok) {
            let m = '';
            try { const j = await t.json(); m = j.error_description || j.msg || j.message || j.error || ''; } catch { /* no body */ }
            console.warn('[login] sign-in failed', t.status, m);
            if (/invalid login credentials|invalid_grant|invalid_credentials/i.test(m) || t.status === 400) m = 'Wrong email or password. If you just reset it, use the new password — or tap Forgot password? to set another.';
            else if (/email not confirmed/i.test(m)) m = 'This email hasn’t been confirmed yet — open the invite link in your email first.';
            else if (/rate limit|too many/i.test(m)) m = 'Too many attempts — wait a minute and try again.';
            throw new Error(m || 'Could not sign in (' + t.status + '). Try again.');
          }
          const fresh = await t.json();
          if (!fresh || !fresh.access_token) throw new Error('Sign-in did not return a session — try again.');
          // Hand the session to the SDK (bounded — the lock again), else
          // store it exactly where the SDK reads it on boot.
          try { await withTimeout(supabase.auth.setSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token }), 4000, 'lock'); }
          catch (e) { console.warn('[login] setSession stalled — storing the session directly', e && e.message); authStoreSession(fresh); }
          try { localStorage.setItem('ridd_last_auth_v1', String(Date.now())); } catch { /* private */ }
          console.log('[login] signed in');
          done = true;
          submitBtn.innerHTML = window.__riddNewVersion ? '\u2713 Signed in \u00b7 updating' : '\u2713 Signed in';
          // Boot from a clean load so the app comes up on the new session
          // every time (no dependence on the SDK's auth-change event firing).
          // A newer deploy found while on the login screen comes up here too
          // (per Isaac: the sign-in IS the refresh — no banner on login).
          // A fresh sign-in always opens on the Sales tab (per Isaac, Oct 9) — not the tab in the old URL
          // (#reporting etc.) and not the last-place resume. The flag is read once in boot().
          try { sessionStorage.setItem('ridd_fresh_login', '1'); localStorage.removeItem(RESUME_KEY); } catch { /* private mode */ }
          setTimeout(() => { if (window.__riddNewVersion) { try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* keep */ } location.reload(); } else location.replace(window.location.pathname + window.location.search); }, 250);
          return;
        } else if (mode === 'forgot') {
          // Only say "sent" for a REAL user (per Isaac, Sep 22): the server
          // looks the address up and sends the reset itself; anyone else is
          // told plainly there's no account, so they fix the email instead
          // of waiting on a message that will never come.
          let out;
          try {
            const res = await fetch('/api/auth-forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, redirectTo: authEmailRedirectUrl() }) });
            out = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(out.error || ('Reset request failed (' + res.status + ')'));
          } catch (e) {
            if (!/failed to fetch|networkerror/i.test(String(e && e.message))) throw e;
            // Function unreachable (offline / preview): fall back to the SDK's own send.
            const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authEmailRedirectUrl() });
            if (error) { if (/rate limit|security purposes/i.test(error.message || '')) throw new Error('Too many reset requests — wait a minute and try once more.'); throw error; }
            out = { exists: true, sent: true };
          }
          if (!out.exists) throw new Error('No account uses ' + email + '. Check the address you sign in with, or ask an admin to add you.');
          toast('Reset link sent — check your email. Open it on THIS device and browser.', 'success');
          form.dataset.mode = 'login';
          renderMode();
        } else if (mode === 'recover') {
          // Enforce the password policy before touching the network.
          const missing = passwordPolicyErrors(password);
          if (missing.length) {
            throw new Error('Password needs: ' + missing.join(' · ').toLowerCase() + '.');
          }
          if ((form.confirm?.value || '') !== password) {
            confirmField.querySelector('input').focus();
            throw new Error('The two passwords don’t match — type the same password in both boxes.');
          }
          // Every step is visible on the button and logged as [recover] so a
          // stuck save is never "nothing happens" (per Isaac).
          const step = (t) => { submitBtn.innerHTML = '<span class="spinner"></span> ' + t; console.log('[recover]', t); };
          const withTimeout = (pr, ms, msg) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
          // 1. The reset link must have established a recovery session. The
          //    SDK's cross-tab auth lock can stall getSession() when the app
          //    is open in another tab, so give it 4s then read the session
          //    the SDK persisted in storage instead.
          step('Checking your reset link…');
          let rec = null;
          try { rec = (await withTimeout(supabase.auth.getSession(), 4000, 'lock')).data.session; }
          catch (e) { console.warn('[recover] getSession stalled — reading the stored session instead', e && e.message); }
          if (!rec || !rec.access_token) rec = authStoredSession();
          if (!rec || !rec.access_token) {
            throw new Error('This reset link has expired or was already used. Request a new one, or ask an admin to set your password directly.');
          }
          // 2. Save the password straight to the auth REST API (same call the
          //    SDK's updateUser makes) — no SDK lock in the way, hard timeout.
          step('Saving password…');
          const r = await withTimeout(fetch(CFG.SUPABASE_URL + '/auth/v1/user', {
            method: 'PUT',
            headers: { apikey: CFG.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + rec.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          }), 15000, 'Saving is taking too long — check your connection and try again.');
          if (!r.ok) {
            let m = '';
            try { const j = await r.json(); m = j.msg || j.message || j.error_description || j.error || ''; } catch { /* no body */ }
            console.warn('[recover] password save failed', r.status, m);
            if (r.status === 401 || r.status === 403) m = 'This reset link has expired or was already used. Request a new one.';
            else if (/same password|different from the old/i.test(m)) m = 'That is already your password — pick a new one, or just sign in with it.';
            else if (/weak|easy to guess|pwned|leaked|compromised/i.test(m)) m = 'That password is too common — pick something less guessable.';
            throw new Error(m || 'Could not save the password (' + r.status + '). Try again.');
          }
          console.log('[recover] password saved');
          // 3. Sign in with the new password so the app runs on a normal
          //    session, not the one-time recovery session.
          step('Signing you in…');
          const recEmail = (rec.user && rec.user.email) || email || '';
          let fresh = null;
          if (recEmail) {
            try {
              const t = await withTimeout(fetch(CFG.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
                method: 'POST',
                headers: { apikey: CFG.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: recEmail, password }),
              }), 10000, 'sign-in timeout');
              if (t.ok) fresh = await t.json(); else console.warn('[recover] sign-in with the new password returned', t.status);
            } catch (e) { console.warn('[recover] sign-in skipped', e && e.message); }
          }
          if (fresh && fresh.access_token) {
            try { await withTimeout(supabase.auth.setSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token }), 4000, 'lock'); }
            catch (e) { console.warn('[recover] setSession stalled — storing the session directly', e && e.message); authStoreSession(fresh); }
            console.log('[recover] signed in with the new password');
          }
          // (No fresh session → the recovery session the SDK already persisted
          // still signs them in on reload; the password is saved either way.)
          // 4. Success screen, then the default dashboard.
          try {
            sessionStorage.removeItem('ridd_recovery_pending');
            sessionStorage.setItem('ridd_pw_saved', '1');
            localStorage.setItem('ridd_last_auth_v1', String(Date.now()));
          } catch { /* private mode — reload still works */ }
          done = true;
          heading.textContent = 'Password updated';
          subheading.textContent = 'You’re signed in — taking you to your dashboard…';
          subheading.style.display = '';
          backBtn.style.display = 'none';
          passField.style.display = 'none';
          confirmField.style.display = 'none';
          policyList.style.display = 'none';
          errLine.style.display = 'none';
          submitBtn.innerHTML = '✓ Password updated';
          // CLEAN url before the reload — keeping window.location.search
          // here preserved the PKCE reset link's `?code=` param, so the
          // reload re-ran the already-used code exchange and could bounce
          // the rep to the login screen instead of into the app. NO hash
          // either (per Isaac): an empty hash lets boot route each rep to
          // their role's DEFAULT screen (D2D → Sales group, office staff →
          // Sales tab, admins → Dashboard) instead of forcing Indicators.
          history.replaceState(null, '', window.location.pathname);
          setTimeout(() => location.replace(window.location.pathname), 900);   // let the success card paint
          return;
        }
      } catch (err) {
        // Inline + toast: the toast pops top-right and is easy to miss on a
        // phone (often behind the keyboard) — the red line under the button
        // is impossible to miss.
        errLine.textContent = err.message || 'Something went wrong — try again.';
        errLine.style.display = 'block';
        toast(err.message || 'Auth failed', 'error');
      } finally {
        if (!done) { submitBtn.disabled = false; renderMode(); }
      }
    },
  });
  const errLine = el('div', {
    class: 'font-semibold py-1 pl-3',
    style: { display: 'none', fontSize: '14px', color: '#000', borderLeft: '2px solid #DF643A', lineHeight: '1.5' },
  });

  form.dataset.mode = initialMode;

  const heading    = el('p', { class: 'text-[11px] uppercase', style: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.24em', color: '#000' } });
  const subheading = el('p', { class: 'text-[10px] uppercase', style: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.08em', lineHeight: '1.6', color: 'rgba(0,0,0,.7)', marginTop: '-12px' } });
  // Reset screen only: ← back to sign in. Drops the one-time recovery
  // session too, so a later refresh lands on the login page instead of
  // quietly signing them into the app with no password set.
  const backBtn = el('button', { type: 'button', class: 'inline-flex items-center gap-1 text-[10px] uppercase self-start', style: { display: 'none', fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.18em', color: 'rgba(0,0,0,.7)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }, title: 'Back to sign in',
    onclick: () => {
      try { sessionStorage.removeItem('ridd_recovery_pending'); } catch { /* private mode */ }
      history.replaceState(null, '', window.location.pathname);
      form.dataset.mode = 'login';
      form.password.value = ''; form.confirm.value = '';
      renderMode();
      Promise.race([supabase.auth.signOut(), new Promise(r => setTimeout(r, 3000))])
        .catch(() => {})
        .finally(() => { try { const k = authStorageKey(); if (k) localStorage.removeItem(k); } catch { /* ignore */ } state.session = null; });
    } },
    el('span', { 'aria-hidden': 'true' }, '←'), 'Back to sign in');
  const emailField = el('label', { class: 'block' },
    el('span', { class: DOOR.label, style: DOOR.labelStyle }, 'Email'),
    // Password-manager friendly (per Isaac, Sep 2026): the phone keychains
    // (iOS Passwords, Google) only offer a saved login when the username field
    // says autocomplete="username" and the form pairs it with a
    // current-password field — the same cue the desktop browsers key off.
    el('input', { id: 'login-email', name: 'email', type: 'email', required: true, autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', class: DOOR.field, style: DOOR.fieldStyle, placeholder: 'you@ridd.com', onfocus: (e) => { e.target.style.borderBottomColor = '#000'; }, onblur: (e) => { e.target.style.borderBottomColor = 'rgba(0,0,0,.3)'; } }));
  // Password input with a show/hide eye inside the box (per Isaac). One
  // eye per field; the confirm field gets its own so each can be peeked.
  const EYE_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a19.8 19.8 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a19.8 19.8 0 0 1-3.22 4.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const passwordBox = (name, label, placeholder) => {
    const input = el('input', { id: 'login-' + name, name, type: 'password', required: true, minlength: 6, autocomplete: name === 'password' ? 'current-password' : 'new-password', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', class: DOOR.field, style: { ...DOOR.fieldStyle, paddingRight: '32px' }, placeholder, onfocus: (e) => { e.target.style.borderBottomColor = '#000'; }, onblur: (e) => { e.target.style.borderBottomColor = 'rgba(0,0,0,.3)'; } });
    const eye = el('button', { type: 'button', tabindex: -1, title: 'Show password', 'aria-label': 'Show password',
      class: 'absolute right-0 flex items-center px-1 transition', style: { top: 0, bottom: 0, background: 'transparent', border: 0, cursor: 'pointer', color: 'rgba(0,0,0,.7)' },
      onclick: () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; eye.innerHTML = show ? EYE_OFF : EYE_OPEN; eye.title = eye.ariaLabel = show ? 'Hide password' : 'Show password'; input.focus(); } });
    eye.innerHTML = EYE_OPEN;
    return el('label', { class: 'block' },
      el('span', { class: DOOR.label, style: DOOR.labelStyle }, label),
      el('div', { class: 'relative' }, input, eye));
  };
  const passField    = passwordBox('password', 'Password', '••••••••');
  const confirmField = passwordBox('confirm', 'Confirm password', '••••••••');   // recover only — typed twice so a typo can't lock them out
  confirmField.style.display = 'none';
  confirmField.querySelector('input').required = false;
  // Live policy checklist — shown only on the "Set a new password" screen.
  const MATCH_LABEL = 'Both passwords match';
  const policyList = el('div', { class: 'text-[11px] flex flex-col gap-1', style: { display: 'none', lineHeight: '1.4' } },
    ...[...PASSWORD_POLICY, { label: MATCH_LABEL }].map(r => el('div', { 'data-req': r.label, style: { color: 'var(--text-subtle)', transition: 'color .15s' } }, '○ ' + r.label)));
  const refreshPolicy = () => {
    if (form.dataset.mode !== 'recover') return;
    const p = passField.querySelector('input').value, c = confirmField.querySelector('input').value;
    const checks = [...PASSWORD_POLICY.map(r => ({ label: r.label, ok: r.test(p) })), { label: MATCH_LABEL, ok: !!p && p === c }];
    checks.forEach(r => {
      const row = policyList.querySelector('[data-req="' + r.label + '"]');
      if (!row) return;
      row.textContent = (r.ok ? '✓ ' : '○ ') + r.label;
      row.style.color = r.ok ? '#DF643A' : 'var(--text-subtle)';
    });
    // Confirm box: neutral until something is typed in it, then red until it
    // matches the first box, then green (per Isaac).
    const ci = confirmField.querySelector('input');
    if (!c) { ci.style.borderColor = ''; ci.style.boxShadow = ''; ci.style.background = ''; }
    else if (p === c) { ci.style.borderColor = '#5F6C5B'; ci.style.boxShadow = '0 0 0 2px rgba(95,108,91,.18)'; ci.style.background = 'rgba(95,108,91,.05)'; }
    else { ci.style.borderColor = '#DC2626'; ci.style.boxShadow = '0 0 0 2px rgba(220,38,38,.15)'; ci.style.background = 'rgba(220,38,38,.04)'; }
  };
  // Password managers / iOS autofill can drop a value in without an
  // `input` event, which left the confirm box un-coloured until a click.
  // Listen to everything AND poll while the reset screen is up so the box
  // turns green the moment the two values agree, however they got there.
  for (const inp of [passField.querySelector('input'), confirmField.querySelector('input')]) {
    for (const ev of ['input', 'change', 'keyup', 'paste', 'blur', 'animationstart']) inp.addEventListener(ev, refreshPolicy);
  }
  let _policyTimer = null, _policyLast = '';
  const policyWatch = (on) => {
    if (_policyTimer) { clearInterval(_policyTimer); _policyTimer = null; }
    if (!on) return;
    _policyTimer = setInterval(() => {
      if (!form.isConnected) { clearInterval(_policyTimer); _policyTimer = null; return; }
      const sig = passField.querySelector('input').value + '\u0000' + confirmField.querySelector('input').value;
      if (sig !== _policyLast) { _policyLast = sig; refreshPolicy(); }
    }, 200);
  };
  // The plate: black, Archivo, uppercase — the market plate Cam signed.
  const submitBtn  = el('button', { type: 'submit', class: 'w-full uppercase cursor-pointer', style: { background: '#000', color: '#fff', fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif', fontWeight: 600, fontSize: '1.375rem', lineHeight: 1, letterSpacing: '.03em', padding: '16px 24px', border: 0, borderRadius: 0, marginTop: '8px' } });
  const forgotBtn  = el('button', { type: 'button', class: 'text-[10px] uppercase self-start', style: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.18em', color: 'rgba(0,0,0,.7)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' },
    onclick: () => { form.dataset.mode = form.dataset.mode === 'login' ? 'forgot' : 'login'; renderMode(); } });
  // Onboarding hint for invited reps. Accounts are admin-created; the invite
  // email contains a one-time magic link that signs the rep in but does NOT
  // set a password. To get a password (so they can sign in here next time),
  // the rep then has to use Forgot password. Without this hint a confused
  // rep types whatever password into the login form and gets back a bare
  // "Invalid credentials" from Supabase.
  const inviteHint = el('p', {
    class: 'text-[10px] uppercase',
    style: { lineHeight: '1.6', fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.08em', color: 'rgba(0,0,0,.7)' },
  }, 'First time here? An admin must invite you. Click the link in your invite email to get in — then use ',
    el('strong', {}, 'Forgot password?'),
    ' above to set a password for next time.');

  function renderMode() {
    const mode = form.dataset.mode;
    backBtn.style.display = 'none';
    policyWatch(mode === 'recover');
    if (mode === 'login') {
      heading.textContent    = 'Login';
      subheading.textContent = '';           // (dropped the 'RIDD Sales App' line per Isaac)
      subheading.style.display = 'none';
      emailField.style.display = 'block';
      emailField.querySelector('input').required = true;
      passField.style.display  = 'block';
      passField.querySelector('input').required = true;
      passField.querySelector('input').autocomplete = 'current-password';
      confirmField.style.display = 'none';
      confirmField.querySelector('input').required = false;
      confirmField.remove();   // iOS Passwords / Face ID only offer a saved login when NO new-password field is in the form — even a hidden one flips it to "sign-up" mode
      submitBtn.textContent = 'Login';
      forgotBtn.textContent = 'Forgot password?';
      forgotBtn.style.display = '';
      inviteHint.style.display = 'block';
    } else if (mode === 'forgot') {
      heading.textContent    = 'Reset password';
      subheading.textContent = 'Enter your email and we’ll send you a reset link.';
      subheading.style.display = '';
      emailField.style.display = 'block';
      emailField.querySelector('input').required = true;
      passField.style.display  = 'none';
      passField.querySelector('input').required = false;
      confirmField.style.display = 'none';
      confirmField.querySelector('input').required = false;
      confirmField.remove();
      submitBtn.textContent = 'Send reset link';
      forgotBtn.textContent = 'Back to sign in';
      forgotBtn.style.display = '';
      inviteHint.style.display = 'none';
    } else if (mode === 'recover') {
      backBtn.style.display = 'inline-flex';
      heading.textContent    = 'Set a new password';
      subheading.textContent = 'Pick the password you’ll use from now on.';
      subheading.style.display = '';
      emailField.style.display = 'none';
      emailField.querySelector('input').required = false;   // hidden + required = the browser blocks submit silently (the 'Set password does nothing' bug)
      passField.style.display  = 'block';
      passField.querySelector('input').required = true;
      passField.querySelector('input').minLength = 8;
      passField.querySelector('input').autocomplete = 'new-password';
      if (!confirmField.isConnected) passField.after(confirmField);
      confirmField.style.display = 'block';
      confirmField.querySelector('input').required = true;
      confirmField.querySelector('input').minLength = 8;
      submitBtn.textContent = 'Set password';
      refreshPolicy();
      forgotBtn.style.display = 'none';
      inviteHint.style.display = 'none';
      policyList.style.display = 'flex';
      return;
    }
    policyList.style.display = 'none';
  }

  form.append(backBtn, heading, subheading, emailField, passField, confirmField, policyList, submitBtn, errLine, forgotBtn, inviteHint);
  renderMode();

  // The room (design kit door.tsx): white, edge to edge, wordmark top left,
  // the app's name in mono top right, the form centred in a 320px column.
  // The room is its own fixed layer (per Isaac, Sep 2026): on phones a
  // swipe-up on the login screen could scroll to whatever sat under it in
  // the document. Fixed + inset 0 means the page itself has nothing to
  // scroll; the room scrolls internally only when the keyboard needs it.
  const room = el('main', { class: 'flex flex-col w-full', style: { position: 'fixed', inset: '0', overflowY: 'auto', overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch', background: '#fff', color: '#000', padding: '20px 20px', zIndex: '50' } },
    // Wordmark centred, no "Sales" tag (per Isaac, Sep 23) — desktop and phone alike.
    el('header', { class: 'flex items-center justify-center' },
      (typeof riddmadeWordmark === 'function') ? riddmadeWordmark(150) : el('div', { class: 'font-display text-2xl' }, 'RIDDMADE')),
    el('div', { class: 'flex flex-1 flex-col items-center justify-center', style: { padding: '64px 0' } }, form));
  mount(room);
}

// ──────────────────────────────────────────────────────────────────────────
