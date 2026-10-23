// ──────────────────────────────────────────────────────────────────────────
// USER EDITOR MODAL (admin)
// ──────────────────────────────────────────────────────────────────────────
// `prefill` lets "Add to app" from the FieldRoutes roster seed a NEW user with
// the CRM's name/email/phone (+ the fieldroutes_employee_id link) so nothing is
// re-typed. It only applies when existing == null.
// Click-to-change avatar straight from the Users table — no need to open the
// editor. Pops a file picker, center-crops to the same 80×80 JPEG thumbnail the
// editor uses, persists to the profile, and re-renders. App users only (a
// CRM-only person has no profiles row to save to yet).
// ── Avatar crop modal — drag + zoom behind a fixed circle guide ──────────
// Shared by every avatar upload path. The photo sits under a circular
// cut-out (exactly how avatars render app-wide); drag to position, slide to
// zoom, Save exports the same compact 80×80 JPEG the old auto-crop produced.
function openAvatarCropModal(file, onDone) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read that image', 'error'); };
  img.onload = () => {
    const V = Math.min(300, Math.max(220, Math.floor(window.innerWidth * 0.7)));   // viewport px (square)
    const baseScale = V / Math.min(img.width, img.height);                          // "cover" at zoom 1
    let zoom = 1;
    let offX = (V - img.width * baseScale) / 2;                                     // centered start
    let offY = (V - img.height * baseScale) / 2;
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => { overlay.remove(); URL.revokeObjectURL(url); document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);

    const canvas = el('canvas', { width: String(V), height: String(V), style: { display: 'block', touchAction: 'none', cursor: 'grab' } });
    const ctx = canvas.getContext('2d');
    const clamp = () => {
      const s = baseScale * zoom;
      offX = Math.min(0, Math.max(V - img.width * s, offX));
      offY = Math.min(0, Math.max(V - img.height * s, offY));
    };
    const draw = () => {
      clamp();
      const s = baseScale * zoom;
      ctx.clearRect(0, 0, V, V);
      ctx.drawImage(img, offX, offY, img.width * s, img.height * s);
    };
    // Drag to reposition (pointer events cover mouse + touch).
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - offX, y: e.clientY - offY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; offX = e.clientX - drag.x; offY = e.clientY - drag.y; draw(); });
    const endDrag = () => { drag = null; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    const zoomInput = el('input', {
      type: 'range', min: '1', max: '3', step: '0.01', value: '1', class: 'w-full',
      title: 'Zoom',
      oninput: (e) => {
        // Zoom around the viewport center so the framed subject stays put.
        const next = parseFloat(e.target.value) || 1;
        const s0 = baseScale * zoom, s1 = baseScale * next;
        const cx = V / 2, cy = V / 2;
        offX = cx - ((cx - offX) / s0) * s1;
        offY = cy - ((cy - offY) / s0) * s1;
        zoom = next;
        draw();
      },
    });

    const card = el('div', { class: 'card p-5 flex flex-col gap-4 items-center', style: { width: (V + 40) + 'px', maxWidth: '94vw' } },
      el('div', { class: 'w-full flex items-center justify-between' },
        el('div', {},
          el('h2', { class: 'text-base font-bold' }, 'Position Your Photo'),
          el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Drag to move · slide to zoom — the circle is what everyone sees')),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
      el('div', { class: 'relative rounded-xl overflow-hidden', style: { width: V + 'px', height: V + 'px', background: '#111' } },
        canvas,
        // Circle guide — dark everywhere except the circular window, plus a
        // crisp ring so the crop line is unmistakable.
        el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none',
          background: 'radial-gradient(circle ' + (V / 2 - 8) + 'px at 50% 50%, transparent 98%, rgba(0,0,0,.55) 100%)' } }),
        el('div', { style: { position: 'absolute', left: '8px', top: '8px', right: '8px', bottom: '8px', pointerEvents: 'none',
          border: '2px solid rgba(255,255,255,.9)', borderRadius: '50%', boxShadow: '0 0 0 1px rgba(0,0,0,.35)' } })),
      el('div', { class: 'w-full flex items-center gap-3' },
        el('span', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, '🔍'),
        zoomInput),
      el('div', { class: 'w-full flex gap-2 justify-end' },
        el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-semibold border', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: close }, 'Cancel'),
        el('button', {
          class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => {
            // Export the circle's bounding square. 160px (≈8-15KB) — big
            // enough that the profile-card lightbox looks clean, still small
            // enough that a full roster of avatars loads instantly.
            const SIZE = 160;
            const s = baseScale * zoom;
            const out = document.createElement('canvas');
            out.width = SIZE; out.height = SIZE;
            out.getContext('2d').drawImage(img, -offX / s, -offY / s, V / s, V / s, 0, 0, SIZE, SIZE);
            const dataUrl = out.toDataURL('image/jpeg', 0.6);
            close();
            onDone(dataUrl);
          },
        }, 'Save Photo')));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.append(card);
    document.body.append(overlay);
    draw();
  };
  img.src = url;
}

function changeProfileAvatar(p) {
  if (!p || !p.id) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/png,image/gif,image/webp';
  inp.style.display = 'none';
  inp.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    inp.remove();
    if (!file) return;
    openAvatarCropModal(file, async (dataUrl) => {
      p.avatar_url = dataUrl;
      if (state.profile && p.id === state.profile.id) state.profile.avatar_url = dataUrl;
      if (typeof DEMO !== 'undefined' && DEMO) {
        saveDemoData(); toast('Photo updated', 'success'); mountApp(); return;
      }
      try {
        const { error } = await supabase.from('profiles').update({ avatar_url: dataUrl }).eq('id', p.id);
        if (error) throw error;
        logActivity('user_edited', { detail: (p.full_name || 'user') + ' photo updated' });
        toast('Photo updated', 'success');
      } catch (err) {
        console.warn('[ridd] avatar update failed', err);
        toast('Photo save failed — ' + (err.message || err), 'error');
      }
      mountApp();
    });
  };
  document.body.append(inp);
  inp.click();
}

function openUserEditor(existing = null, prefill = null) {
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Modal-local state so we can track avatar changes + active toggle
  const modal = {
    avatar_url: existing?.avatar_url || '',
    is_active: existing ? (existing.is_active !== false) : true,
    // The CRM identity link — carried through Save onto the profile.
    fr_id: existing?.fieldroutes_employee_id || prefill?.fieldroutes_employee_id || null,
    // Role history (per Isaac, Oct 15): [{ role, start }] — when this person started each role.
    role_history: Array.isArray(existing?.role_history) ? existing.role_history.map(r => ({ ...r })) : null,
  };

  const form = el('form', {
    class: 'card w-full max-w-xl my-8 flex flex-col',
    style: { maxHeight: 'calc(100vh - 64px)' },
    onsubmit: async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      // "Admin - Owner" → an admin role + the owner flag (the DB trigger
      // enforces who may do this and moves the flag off the previous owner).
      const _wantOwner = data.role === 'admin_owner';
      if (_wantOwner) data.role = (existing && (existing.role === 'admin' || existing.role === 'admin_rep')) ? existing.role : 'admin_rep';
      // Commission: standard base rate is 7%. The "Commission Override" field
      // is a BUMP added on top of the base (e.g. 0.5 means 7.5% total).
      const BASE_COMMISSION = 0.07;
      // Commission Bump left Edit User (per Isaac — it lives in Settings →
      // Commissions → individual overrides now), so a save keeps whatever
      // rate the profile already carries.
      const bumpRaw = data.commission_override?.trim();
      const bumpPct = bumpRaw === '' || bumpRaw == null ? 0 : parseFloat(bumpRaw);
      const totalRate = ('commission_override' in data) ? BASE_COMMISSION + (bumpPct / 100)
        : (existing?.upfront_commission_rate != null ? Number(existing.upfront_commission_rate) : BASE_COMMISSION);
      // Annual goal only applies to sellers (rep / admin_rep). Non-sellers
      // (admin / auditor) get 0 — the column is NOT NULL, and 0 is treated
      // as "no goal" by the leaderboard rendering.
      const seller = isSellerRole(data.role);
      const goalParsed = parseFloat(data.annual_revenue_goal);
      // Blank keeps whatever the rep already has; a NEW user starts at 0,
      // which the app already renders as "no goal" (the column is NOT NULL).
      // The old 250k default is gone (per Isaac) - goals are set on purpose.
      const annualGoal = !seller ? 0
        : Number.isFinite(goalParsed) ? goalParsed
        : (existing?.annual_revenue_goal ?? 0);
      const payload = {
        full_name: data.full_name,
        email: data.email,
        role: data.role,
        // Initials input retired (per Isaac) - they only feed the avatar
        // fallback, so keep what's stored or derive from the name, same as
        // the leaderboard does for CRM-only sellers.
        initials: existing?.initials
          || String(data.full_name || '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
          || null,
        avatar_url: modal.avatar_url || null,
        annual_revenue_goal: annualGoal,
        is_active: modal.is_active,
        // Round to 4 decimal places to avoid float noise (0.07+0.005=0.074999...)
        upfront_commission_rate: Math.round(totalRate * 10000) / 10000,
        // Close rate is an admin-set, hand-maintained input per rep (per
        // Isaac — matches the sheet's SETTINGS tab; never derived).
        close_rate_target: Number.isFinite(parseFloat(data.close_rate_pct)) ? Math.max(0, Math.min(100, parseFloat(data.close_rate_pct))) / 100 : (existing?.close_rate_target ?? 0.50),
        // Pay Stub personalization (drives the Pay tab's Upfront Pay rows).
        rep_type: (data.role === 'rep_loyalty' || data.role === 'rep_loyalty_lead') ? 'loyalty_rep' : (data.rep_type || existing?.rep_type || 'sales_rep'),   // follows the role (no picker since Sep 22)
        // The field only shows for office-staff roles; a hidden input still
        // submits its (prefilled) value, and blank falls back to the record
        // so a save can never silently wipe a stored amount.
        golden_phone_amount:    Number.isFinite(parseFloat(data.golden_phone_amount)) ? parseFloat(data.golden_phone_amount) : (existing?.golden_phone_amount ?? 0),
        loyalty_royalty_amount: existing?.loyalty_royalty_amount ?? 0,   // editor retired — keep whatever is stored
        loyalty_pay_amount:     Number.isFinite(parseFloat(data.loyalty_pay_amount)) ? parseFloat(data.loyalty_pay_amount) : (existing?.loyalty_pay_amount ?? 0),
        other_pay_amount:       Number.isFinite(parseFloat(data.other_pay_amount)) ? parseFloat(data.other_pay_amount) : (existing?.other_pay_amount ?? 0),
        // CRM bridge — phone carried from FieldRoutes, plus the employee-ID link
        // that joins this app user to their CRM sales.
        phone: (data.phone || '').trim() || null,
        fieldroutes_employee_id: modal.fr_id || null,
        ...(modal.role_history ? { role_history: roleHistoryClean(modal.role_history) } : {}),
        ...(existing && (_wantOwner !== !!existing.is_owner) ? { is_owner: _wantOwner } : {}),
      };

      // Password field is admin-set: leave blank to keep existing /
      // skip during invite. Treat short strings as a typo rather than a
      // valid password so we don't silently set "abc" as someone's pw.
      const newPassword = (data.password || '').trim();
      if (newPassword && newPassword.length < 8) {
        toast('Password must be at least 8 characters (leave blank to skip).', 'error');
        return;
      }

      if (DEMO) {
        if (existing) {
          Object.assign(existing, payload);
          if (existing.id === state.profile.id) Object.assign(state.profile, payload);
        } else {
          const newId = 'demo-' + (state.allProfiles.length + 1);
          state.allProfiles.push({ id: newId, ...payload });
        }
        if (newPassword) {
          toast('Saved · password "' + newPassword + '" would be set in production', 'info');
        } else {
          logActivity('user_edited', { detail: (existing?.full_name || 'user') + ' profile updated' });
          toast('Saved', 'success');
        }
        saveDemoData();
        overlay.remove();
        mountApp();
        return;
      }

      // Instant feedback — the button reads Saving… for the whole round trip.
      const _submitBtn = form.querySelector('button[type="submit"]');
      if (_submitBtn) { _submitBtn.disabled = true; _submitBtn.textContent = 'Saving…'; }
      try {
        // Hoisted ABOVE the existing/create fork: it was declared inside the
        // if (existing) branch, so the two CREATE branches referenced a const
        // outside their scope and every new user failed with
        // "_stampNewProfile is not defined" (Dante Salgado, Aug 2026).
        // Stamp the FULL form payload onto the new profile row — the invite
        // row only carries a subset, and the old best-effort patch silently
        // dropped pay-affecting fields (commission bump, close-rate target,
        // rep type). Keyed by id + verified, so failure is LOUD.
        const _stampNewProfile = async (created) => {
          const uid = created && created.user_id;
          if (!uid) throw new Error('Create returned no user id — open the user and re-save their details.');
          const patch = { ...payload };
          delete patch.email;   // auth owns the login email; the trigger already copied it
          let { data: _row, error: _pErr } = await supabase.from('profiles')
            .update(patch).eq('id', uid).select('id').single();
          if (_pErr && /role_history/.test(_pErr.message || '') && 'role_history' in patch) {
            delete patch.role_history;
            ({ data: _row, error: _pErr } = await supabase.from('profiles').update(patch).eq('id', uid).select('id').single());
            if (!_pErr) toast('Created, but Role history needs the 20261015f migration run first', 'error');
          }
          if (_pErr || !_row) throw new Error('Login created, but saving the profile details failed'
            + (_pErr ? ' — ' + _pErr.message : '') + '. Open the user and re-save.');
        };
        if (existing) {
          let { error } = await supabase.from('profiles').update(payload).eq('id', existing.id);
          if (error && /role_history/.test(error.message || '') && 'role_history' in payload) {
            // Column not there yet (migrations/20261015f_profiles_role_history.sql) — save the rest.
            const { role_history: _rh, ...rest } = payload;
            ({ error } = await supabase.from('profiles').update(rest).eq('id', existing.id));
            if (!error) toast('Saved, but Role history needs the 20261015f migration run first', 'error');
          }
          if (error) throw error;
          // Email changed? The profile row alone isn't enough — LOGIN runs on
          // auth.users, so push the new address through the admin function
          // too. Otherwise the rep can only sign in with the OLD email (the
          // exact FieldRoutes-email lockout Isaac hit).
          const _emailChanged = payload.email && existing.email
            && payload.email.trim().toLowerCase() !== String(existing.email).trim().toLowerCase();
          if (newPassword || _emailChanged) {
            await callAdminSetPassword({
              mode: 'update', user_id: existing.id,
              ...(newPassword ? { password: newPassword } : {}),
              ...(_emailChanged ? { email: payload.email.trim() } : {}),
            });
            toast('Saved' + (_emailChanged ? ' · login email is now ' + payload.email.trim() : '') + (newPassword ? ' · password updated' : ''), 'success');
          } else {
            logActivity('user_edited', { detail: (existing?.full_name || 'user') + ' profile updated' });
          toast('Saved', 'success');
          }
        } else if (newPassword) {
          // Admin set a password on a NEW user — skip the magic-link
          // flow entirely and create the auth user with the password
          // directly. handle_new_user() picks up the pending_invites
          // row via the function, so the profiles row appears the same
          // way it would after a magic-link signup.
          const _created = await callAdminSetPassword({
            mode:                'create',
            email:               payload.email,
            password:            newPassword,
            full_name:           payload.full_name,
            role:                payload.role,
            office_id:           payload.office_id ?? null,
            initials:            payload.initials ?? null,
            avatar_url:          payload.avatar_url ?? null,
            annual_revenue_goal: payload.annual_revenue_goal ?? null,
          });
          await _stampNewProfile(_created);
          logActivity('user_edited', { detail: 'Created user ' + (payload.full_name || payload.email || '') });
          toast('Created · ' + payload.email + ' can sign in with that password', 'success');
        } else {
          // No password typed on a NEW user → create the account immediately
          // with a RANDOM throwaway password, then email a set-your-own-
          // password link. The set screen enforces the password policy
          // (8+ chars, a capital, a special character). This replaces the old
          // magic-link + "now go use Forgot password" dance.
          const _alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
          const _rnd = 'Aa1!' + Array.from(crypto.getRandomValues(new Uint8Array(20)))
            .map(b => _alphabet[b % _alphabet.length]).join('');
          const _created = await callAdminSetPassword({
            mode:                'create',
            email:               payload.email,
            password:            _rnd,
            full_name:           payload.full_name,
            role:                payload.role,
            office_id:           payload.office_id ?? null,
            initials:            payload.initials ?? null,
            avatar_url:          payload.avatar_url ?? null,
            annual_revenue_goal: payload.annual_revenue_goal ?? null,
          });
          await _stampNewProfile(_created);
          await sendPasswordResetLink(payload.email);
          logActivity('user_edited', { detail: 'Created user ' + (payload.full_name || payload.email || '') + ' — set-password email sent' });
          toast('Created — ' + payload.email + ' got an email to set their own password', 'success');
        }
        // Surgical refresh — the server write is already confirmed, so patch
        // the one row locally (edits) or pull just the profiles list (creates)
        // instead of re-fetching every table. One render, no screen bouncing.
        if (existing) {
          if (payload.is_owner === true) {
            (state.allProfiles || []).forEach(p => { p.is_owner = p.id === existing.id; });
            if (state._realProfile && state._realProfile.id !== existing.id) state._realProfile.is_owner = false;
          }
          Object.assign(existing, payload);
          const _i = state.allProfiles.findIndex(p => p.id === existing.id);
          if (_i >= 0) state.allProfiles[_i] = Object.assign({}, state.allProfiles[_i], payload);
          if (state._realProfile && existing.id === state._realProfile.id) {
            Object.assign(state._realProfile, payload);
            _applyViewAsOverlay();
          } else if (existing.id === state.profile.id) {
            Object.assign(state.profile, payload);
          }
        } else {
          await refreshProfilesData();
        }
        overlay.remove();
        mountApp();
      } catch (err) {
        // Duplicate login with a REAL owner: jump straight to that user's
        // editor instead of dead-ending on a toast that points at a user
        // the admin may not be able to find (their profile email can have
        // drifted from the login email, hiding them from the CRM match).
        const _dupId = err && err.body && err.body.existing_user_id;
        const _dupProf = _dupId && (state.allProfiles || []).find(x => x.id === _dupId);
        if (_dupProf) {
          overlay.remove();
          toast('That login belongs to ' + (_dupProf.full_name || 'an existing user') + ' — opening their profile. Link their FieldRoutes ID here to stop the CRM row showing separately.', 'warn');
          openUserEditor(_dupProf, prefill ? { fr_id: prefill.fieldroutes_employee_id || prefill.fr_id } : null);
        } else {
          toast(err.message || 'Save failed', 'error');
        }
      } finally {
        if (_submitBtn) { _submitBtn.disabled = false; _submitBtn.textContent = 'Save'; }
      }
    },
  });

  const inp = (name, attrs = {}) => el('input', { name, class: 'w-full rounded-lg border px-3 py-2 text-sm', ...attrs });
  const mk = (label, input) => el('label', { class: 'block text-sm' },
    el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' }, label),
    input,
  );

  // ── Avatar upload (click-to-upload) ──
  const hiddenFile = el('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/gif,image/webp',
    style: { display: 'none' },
    onchange: (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Crop modal — circle guide + drag/zoom; returns the compact 80×80
      // JPEG data URL (a few KB, safe for localStorage).
      openAvatarCropModal(file, (dataUrl) => {
        modal.avatar_url = dataUrl;
        renderAvatar();
      });
    },
  });

  const avatarDisplay = el('div', { class: 'relative cursor-pointer', onclick: () => hiddenFile.click() });
  function renderAvatar() {
    avatarDisplay.innerHTML = '';
    avatarDisplay.append(
      avatarNode(modal.avatar_url, existing?.initials || '??', 'w-20 h-20 text-base'),
      el('div', {
        class: 'absolute rounded-full flex items-center justify-center',
        style: {
          bottom: '0', right: '0',
          width: '26px', height: '26px',
          background: '#323230', border: '2px solid var(--card)',
        },
      }, el('span', { style: { color: '#F3F3F3', fontSize: '12px' } }, '📷')),
      hiddenFile,
    );
  }
  renderAvatar();

  // ── Active/Deactivate pill ──
  const activeToggle = el('button', {
    type: 'button',
    class: 'flex items-center gap-1.5 text-xs font-semibold transition',
    onclick: () => { modal.is_active = !modal.is_active; renderActiveToggle(); },
  });
  function renderActiveToggle() {
    activeToggle.innerHTML = '';
    if (modal.is_active) {
      activeToggle.style.color = 'var(--accent)';
      activeToggle.append(
        el('span', { style: { color: 'var(--accent)' } }, '☑'),
        el('span', {}, 'Active '),
        el('span', { class: 'font-normal text-muted-' }, '(click to deactivate)'),
      );
    } else {
      activeToggle.style.color = '#DC2626';
      activeToggle.append(
        el('span', { style: { color: '#DC2626' } }, '☒'),
        el('span', {}, 'Inactive '),
        el('span', { class: 'font-normal text-muted-' }, '(click to activate)'),
      );
    }
  }
  renderActiveToggle();

  // ── Header ──
  const header = el('div', { class: 'px-6 pt-6 pb-4' },
    el('div', { class: 'flex items-center justify-between mb-4' },
      el('h2', { class: 'text-xl font-bold' }, existing ? 'Edit User' : 'New User'),
      el('div', { class: 'flex items-center gap-4' },
        activeToggle,
        el('button', { type: 'button', class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '×')),
    ),
    el('button', {
      type: 'button',
      class: 'text-xs text-muted- hover:text-default transition',
      onclick: () => overlay.remove(),
    }, '← Back to Users'),
  );

  // ── Avatar section ──
  const avatarSection = el('div', { class: 'px-6 pb-4 flex items-center gap-4' },
    avatarDisplay,
    el('div', { class: 'flex-1' },
      el('div', { class: 'text-sm font-medium' }, 'Click avatar to upload photo'),
      el('div', { class: 'text-[11px] text-muted- mt-0.5' }, 'JPG, PNG, GIF supported'),
    ),
  );

  // ── Form body ──
  const body = el('div', { class: 'px-6 pb-4 overflow-y-auto flex-1 flex flex-col gap-4' },
    // CRM link badge — shown when this user is (or will be) tied to a
    // FieldRoutes employee, so their app sales reconcile against the CRM.
    modal.fr_id ? el('div', { class: 'rounded-lg px-3 py-2 text-xs flex items-center gap-2', style: { background: 'rgba(223,100,58,.12)', border: '1px solid rgba(223,100,58,.35)', color: 'var(--text)' } },
      el('span', { style: { color: 'var(--accent)', fontWeight: '700' } }, '↔ Linked to FieldRoutes'),
      el('span', { class: 'text-muted-' }, 'Employee #' + modal.fr_id + (prefill ? ' · details pre-filled from the CRM' : ''))) : null,
    // Last app login lives here now (was a whole column on the Users table).
    existing ? el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } },
      '🕐 Last app login: ' + (existing.last_login_at
        ? new Date(existing.last_login_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'never')) : null,
    (() => {
      // User Role sits at the very top (per Isaac) — everything below keys
      // off it. Legacy 'rep' accounts preselect Rep - Sales Rep here, so
      // saving them migrates to an explicit role.
      let seedRole = existing?.role || prefill?.role || 'rep_sales';
      if (seedRole === 'rep') seedRole = 'rep_sales';
      // "Admin - Owner" is a virtual option: the owner flag on top of an
      // admin role. Picking it on another admin transfers ownership; picking
      // it on yourself while nobody owns the app claims it.
      if (existing && existing.is_owner) seedRole = 'admin_owner';
      // Owner rules (per Isaac): only the owner admin can make or unmake an
      // admin. Everyone else sees the admin options greyed out, and an
      // existing admin's role is locked for them entirely.
      // Until an owner exists (migration not run yet / nobody has claimed
      // it), every admin keeps the old powers — nobody gets locked out.
      const _ownerExists = (state.allProfiles || []).some(p => p && p.is_owner);
      const _owner = isOwnerUser() || !_ownerExists;
      const _targetAdmin = !!existing && (existing.role === 'admin' || existing.role === 'admin_rep');
      const _lockRole = !_owner && _targetAdmin;
      const roleSelect = el('select', { name: 'role', class: 'w-full rounded-lg border px-3 py-2 text-sm', disabled: _lockRole,   // same box as the text inputs (per Isaac, Sep 22)
        title: _lockRole ? 'Only the Admin - Owner can change an admin\u2019s access' : '' },
        ...['rep_sales', 'rep_partner', 'rep_team_lead', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'office_staff', 'tech_regional', 'tech_branch', 'tech_senior_lead', 'tech_pro', 'developer'].map(v => el('option', { value: v, selected: seedRole === v }, ROLE_LABEL[v])),
        // ONE Admin option (per Isaac): an account already on admin_rep keeps
        // that value (it still sells / shows on boards); new picks are 'admin'.
        el('option', { value: seedRole === 'admin_rep' ? 'admin_rep' : 'admin', selected: seedRole === 'admin' || seedRole === 'admin_rep', disabled: !_owner && seedRole !== 'admin' && seedRole !== 'admin_rep' }, 'Admin'),
        el('option', { value: 'admin_owner', selected: seedRole === 'admin_owner', disabled: !_owner }, 'Admin - Owner'),
        el('option', { value: 'auditor',    selected: seedRole === 'auditor' },    'Auditor'),
      );
      // A disabled select drops out of FormData — carry the locked role along.
      const roleHidden = _lockRole ? el('input', { type: 'hidden', name: 'role', value: seedRole }) : null;
      // (Commission Bump, Revenue Goal, Close Rate, Other Pay and Loyalty Pay
      // left this modal per Isaac — pay lives in Settings → Commissions.)
      const wrapper = document.createDocumentFragment();
      wrapper.append(mk('User Role', roleSelect));
      if (roleHidden) wrapper.append(roleHidden);
      if (existing && existing.is_owner) wrapper.append(el('div', { class: 'text-[11px] -mt-2', style: { color: 'var(--accent)', fontWeight: '700' } }, '\u2605 Owner admin \u2014 the only login that can grant or remove admin access.'));
      else if (!_ownerExists && isAdminRole(state.profile?.role)) wrapper.append(el('div', { class: 'text-[11px] -mt-2', style: { color: 'var(--text-muted)' } }, 'No Admin - Owner yet \u2014 pick \u201cAdmin - Owner\u201d on your own account to claim it.'));
      else if (_lockRole) wrapper.append(el('div', { class: 'text-[11px] -mt-2', style: { color: 'var(--text-muted)' } }, 'This is an admin account \u2014 only the Admin - Owner can change its access.'));
      else if (!_owner) wrapper.append(el('div', { class: 'text-[11px] -mt-2', style: { color: 'var(--text-muted)' } }, 'Admin roles can only be granted by the Admin - Owner.'));
      // Transfer ownership — owner only, to another admin, two taps.
      if (_owner && existing && !existing.is_owner && _targetAdmin && existing.id !== (state._realProfile || state.profile || {}).id) {
        let armed = false;
        const xfer = el('button', {
          type: 'button',
          class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95 self-start',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          title: 'Hand the owner admin role to this person. You stay an admin; they become the only one who can change admin access.',
          onclick: async () => {
            if (!armed) { armed = true; xfer.textContent = 'Confirm \u2014 make ' + (existing.full_name || 'this user') + ' the Admin - Owner'; xfer.style.background = 'var(--accent)'; xfer.style.color = 'var(--accent-text)'; xfer.style.borderColor = 'var(--accent)'; return; }
            xfer.disabled = true; xfer.textContent = 'Transferring\u2026';
            try {
              const { error } = await supabase.from('profiles').update({ is_owner: true }).eq('id', existing.id);
              if (error) throw error;
              existing.is_owner = true;
              (state.allProfiles || []).forEach(p => { p.is_owner = p.id === existing.id; });
              if (state._realProfile) state._realProfile.is_owner = false;
              if (state.profile) state.profile.is_owner = state.profile.id === existing.id;
              logActivity('user_edited', { detail: 'Ownership transferred to ' + (existing.full_name || existing.email || '') });
              toast((existing.full_name || 'They') + ' is now the Admin - Owner', 'success');
              overlay.remove(); mountApp();
            } catch (err) { toast(err.message || 'Transfer failed', 'error'); xfer.disabled = false; armed = false; xfer.textContent = 'Make this user the Admin - Owner'; }
          },
        }, 'Make this user the Admin - Owner');
        wrapper.append(el('div', { class: 'flex' }, xfer));
      }
      // ── Team (per Isaac, Oct 4): the team this person SELLS on, shown while
      // onboarding so a new rep lands on the right team. Same map Manage Teams
      // writes (keyed by the sales-data spelling of the name, current team year).
      {
        const _nm = () => { const f = teamSel.closest('form') || document; const i = f.querySelector('[name="full_name"]'); return String((i && i.value) || existing?.full_name || prefill?.full_name || '').trim(); };
        const _keyFor = (name) => { const sg = _repNameSig(name); const hit = Object.keys(_activeTeamMap() || {}).find(k => _repNameSig(k) === sg); return hit || name; };
        const teamSel = el('select', { class: 'w-full rounded-lg border px-3 py-2 text-sm', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          onchange: (e) => { const n = _nm(); if (!n) { toast('Enter the name first', 'error'); e.target.value = ''; return; } setRepTeam(_keyFor(n), e.target.value); if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {}); toast(e.target.value ? n + ' is on ' + e.target.value : n + ' removed from their team', 'success'); } });
        const drawTeamSel = () => {
          const cur = getRepTeam(_keyFor(_nm())) || '';
          teamSel.innerHTML = '';
          teamSel.append(el('option', { value: '', selected: !cur }, cur ? 'No team' : 'Not on a team yet — pick one'), ...allTeamNames().map(t => el('option', { value: t, selected: t === cur }, t)));
          teamSel.style.borderColor = cur ? 'var(--border-2)' : '#DC2626';
        };
        const teamSection = el('div', { class: 'flex flex-col gap-1.5' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block font-semibold' }, 'Team · ' + _teamYearKey()),
          teamSel,
          el('p', { class: 'text-[11px] text-muted-' }, 'The door-to-door team this person sells on. Saves as you pick — the same assignment as Indicators → Manage Teams. Only their Sales Rep sales count toward it.'));
        // Teams are a Sales Rep thing (per Isaac, Oct 15) — office staff / technicians never get one. Someone who
        // moved inside from the doors (Javier) keeps showing the team he sold on, so it can be seen or cleared;
        // his door sales still count toward it and it stays off the Office Staff boards (_indTeamDepts).
        const _showTeam = () => { const on = allTeamNames().length > 0 && (['rep_sales', 'rep_partner', 'rep_team_lead'].includes(roleSelect.value) || !!(_nm() && getRepTeam(_keyFor(_nm())))); teamSection.style.display = on ? '' : 'none'; if (on) drawTeamSel(); };
        roleSelect.addEventListener('change', _showTeam);
        setTimeout(_showTeam, 0);   // after the form (and its name field) is in the page
        wrapper.append(teamSection);
        // Tier, set at onboarding (per Isaac, Oct 4): an experienced rep in their
        // first season here would otherwise read as an auto Rookie until
        // someone spots it in Manage Teams.
        const tierHost = el('div', {});
        const drawTier = () => { tierHost.innerHTML = ''; const n = _nm(); tierHost.append(n ? repTierSelect(_keyFor(n), drawTier, 'w-full rounded-lg border px-3 py-2 text-sm') : el('p', { class: 'text-[11px] text-muted-' }, 'Enter the name first.')); };
        const tierSection = el('div', { class: 'flex flex-col gap-1.5' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block font-semibold' }, 'Tier'),
          tierHost,
          el('p', { class: 'text-[11px] text-muted-' }, 'Rookie or Vet. Left alone it is guessed from sales history (first selling year = Rookie) and shows as \u201cauto\u201d until someone confirms it.'));
        const _showTier = () => { const on = ['rep_sales', 'rep_partner', 'rep_team_lead'].includes(roleSelect.value); tierSection.style.display = on ? '' : 'none'; if (on) drawTier(); };
        roleSelect.addEventListener('change', _showTier);
        setTimeout(() => { _showTier(); const f = teamSel.closest('form') || document; const ni = f.querySelector('[name="full_name"]'); if (ni) ni.addEventListener('change', () => { _showTier(); _showTeam(); }); }, 0);
        wrapper.append(tierSection);
        if (!(existing && existing.id)) {
          const ledNote = el('p', { class: 'text-[11px] text-muted-' }, 'Teams this partner leads can be picked once the user is saved (open them again from the Users list).');
          const _showLed = () => { ledNote.style.display = (roleSelect.value === 'rep_partner' || roleSelect.value === 'rep_team_lead') ? '' : 'none'; };
          roleSelect.addEventListener('change', _showLed); _showLed();
          wrapper.append(ledNote);
        }
      }
      // ── Teams led — right under the role, only once Partner (or Team
      // Lead) is picked. Drives leaderboard + player-card reach.
      if (existing && existing.id) {
        const teamsBox = el('div', { class: 'flex flex-wrap gap-1.5' });
        const drawTeams = () => {
          teamsBox.innerHTML = '';
          const chosen = new Set(partnerTeamsOf(existing.id));
          const names = allTeamNames();
          if (!names.length) { teamsBox.append(el('span', { class: 'text-[11px] text-muted-' }, 'No teams set up yet (Indicators \u2192 Manage Teams).')); return; }
          names.forEach(t => teamsBox.append(el('button', {
            type: 'button',
            class: 'rounded-full px-2.5 py-1 text-[11px] font-semibold border transition',
            style: chosen.has(t) ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
            onclick: () => { const c = new Set(partnerTeamsOf(existing.id)); if (c.has(t)) c.delete(t); else c.add(t); setPartnerTeams(existing.id, [...c]); drawTeams(); },
          }, t)));
        };
        drawTeams();
        const teamsSection = el('div', { class: 'flex flex-col gap-2' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block font-semibold' }, 'Teams led'),
          el('p', { class: 'text-[11px] text-muted-' }, 'This partner sees a team card, team trends and the drill-down for every rep on these teams. Saves as you click.'),
          teamsBox);
        const _showTeams = () => { teamsSection.style.display = (roleSelect.value === 'rep_partner' || roleSelect.value === 'rep_team_lead') ? '' : 'none'; };
        roleSelect.addEventListener('change', _showTeams);
        _showTeams();
        wrapper.append(teamsSection);
      }
      return wrapper;
    })(),
    mk('Full Name', inp('full_name', { required: true, value: existing?.full_name || prefill?.full_name || '' })),
    mk('Email', inp('email', { type: 'email', required: true, value: existing?.email || prefill?.email || '' })),
    mk('Phone', inp('phone', { type: 'tel', value: existing?.phone || prefill?.phone || '', placeholder: 'From FieldRoutes' })),
    // ── Role history (per Isaac, Oct 15) — for people who changed roles (Javier: Sales Rep → Technician →
    // Office Staff). Sales already file under the FieldRoutes login that sold them; this dates each role so
    // tenure reads from the CURRENT role: Rookie/Vet and the scorecard's working days start at its start date.
    (() => {
      const box = el('div', { class: 'flex flex-col gap-2' });
      const sel = (cls) => ({ class: cls, style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } });
      const nameNow = () => { const f = box.closest('form'); const n = f && f.querySelector('[name="full_name"]'); return n ? n.value.trim() : (existing?.full_name || ''); };
      const draw = () => {
        box.innerHTML = '';
        const rows = modal.role_history || [];
        rows.forEach((r, i) => box.append(el('div', { class: 'flex items-center gap-2' },
          el('select', { ...sel('flex-1 rounded-lg border px-3 py-2 text-sm'), onchange: (e) => { r.role = e.target.value; } },
            ...ROLE_HISTORY_ROLES.map(v => el('option', { value: v, selected: r.role === v }, v))),
          el('input', { type: 'date', value: r.start || '', ...sel('rounded-lg border px-3 py-2 text-sm'), onchange: (e) => { r.start = e.target.value; } }),
          el('button', { type: 'button', title: 'Remove', class: 'text-lg leading-none text-muted- px-1', onclick: () => { rows.splice(i, 1); modal.role_history = rows; draw(); } }, '\u00d7'))));
        if (!rows.length) box.append(el('p', { class: 'text-[11px] text-muted-' }, 'None yet \u2014 only needed for someone who has held more than one role.'));
        box.append(el('div', { class: 'flex flex-wrap gap-3' },
          el('button', { type: 'button', class: 'text-xs font-semibold', style: { color: 'var(--accent)' },
            onclick: () => { modal.role_history = [...(modal.role_history || []), { role: 'Office Staff', start: new Date().toISOString().slice(0, 10) }]; draw(); } }, '+ Add role'),
          el('button', { type: 'button', class: 'text-xs font-semibold', style: { color: 'var(--accent)' },
            onclick: () => { const h = roleHistoryFromSales(nameNow()); if (!h.length) { toast('No FieldRoutes sales found under that name yet', 'info'); return; } modal.role_history = h; draw(); toast('Filled from each login\u2019s first sale \u2014 fix any date that\u2019s off, then Save', 'success'); } },
            'Fill from FieldRoutes')));
      };
      draw();
      const section = el('div', { class: 'flex flex-col gap-1.5' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block font-semibold' }, 'Role history'),
        box,
        el('p', { class: 'text-[11px] text-muted-' }, 'When this person started each role. Sales already go to the board of the FieldRoutes login that sold them; these dates set tenure \u2014 Rookie/Vet counts from their Sales Rep start, and the scorecard\u2019s working days from the current role\u2019s start. A team only counts the sales they made as a Sales Rep.'));
      setTimeout(() => { const f = section.closest('form'); const rs = f && f.querySelector('[name="role"]'); const show = () => { section.style.display = !rs || isSellerRole(rs.value) ? '' : 'none'; }; if (rs) rs.addEventListener('change', show); show(); }, 0);
      return section;
    })(),
    el('label', { class: 'block text-sm' },
      el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' },
        'Password ',
        el('span', { class: 'normal-case text-muted- font-normal tracking-normal text-[10px]' },
          existing
            ? '— reset it here: type a new password + Save, then tell the user. Takes effect immediately, no email needed. Leave blank to keep current.'
            : '— optional; if set, the rep can sign in immediately with email + password'),
      ),
      inp('password', {
        type: 'password',
        placeholder: existing ? 'Leave blank to keep current' : 'Set an initial password (≥ 8 chars)',
        autocomplete: 'new-password',
        minlength: '8',
      }),
    ),
    // ── Pay Stub personalization ──
    // Drives which rows show on the rep's Pay tab + the manual additives that
    // flow into Total Upfront Pay each period. Hidden for auditors (no stub).
    (() => {
      const moneyInp = (name, value) => el('div', { class: 'relative' },
        el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '$'),
        inp(name, {
          type: 'number', step: '0.01', min: 0,
          placeholder: '0.00',
          value: value ? Number(value).toFixed(2) : '',
          class: 'w-full rounded-lg border pl-7 pr-3 py-2 text-sm',
        }),
      );

      // Rep Type select retired (per Isaac, Sep 22): the ROLE already says
      // loyalty vs. inside sales (rep_loyalty / rep_loyalty_lead), so the
      // stored rep_type follows the role on save instead of a second picker.

      // Pay Stub rows that live HERE in Edit User are the fixed quarterly
      // additives an admin sets ahead of time per rep. Golden Phone's input
      // was retired (per Isaac) - the stub still SHOWS any stored amount,
      // and the save path preserves it, but sales reps get no editor field.
      // Golden Phone is an OFFICE STAFF program (per Isaac) - the top
      // inside-sales royalty. Sales reps never see the field; office-staff
      // roles do, unless the rep is typed Loyalty (who get Loyalty Royalty
      // instead).
      // Golden Phone editor retired for now (per Isaac, Sep 22) — any stored amount is preserved by the save path.
      // Loyalty Royalty editor retired (per Isaac, Sep 24) — any stored amount is preserved by the save path.
      const loyaltyRoyaltyRow = el('div', { style: { display: 'none' } });
      // (Close Rate / Other Pay / Loyalty Pay moved to Settings → Commissions, per Isaac.)

      const LOYALTY_ROLES = new Set(['rep_loyalty', 'rep_loyalty_lead']);
      const grid = el('div', { class: 'flex flex-col gap-3' });
      const applyRepTypeVisibility = () => {
        const roleSel = form.querySelector('select[name="role"]');
        void roleSel;   // (nothing role-specific left in the pay stub block)
      };
      grid.append(loyaltyRoyaltyRow);

      const section = el('div', { class: 'flex flex-col gap-3 pt-3 border-t', style: { borderColor: 'var(--border)', display: 'none' } },   // Pay Stub block empty since Loyalty Royalty retired (per Isaac, Sep 24)
        el('h4', { class: 'text-[11px] uppercase tracking-widest font-bold text-muted-' }, 'Pay Stub'),
        grid,
      );

      // Auditors and Admin (no sales) don't get a pay stub — neither sells,
      // so Rep Type / Golden Phone are irrelevant. Hide the whole section.
      // Wired via the role select that lives in the IIFE above.
      setTimeout(() => {
        applyRepTypeVisibility();
        const roleSel = form.querySelector('select[name="role"]');
        if (!roleSel) return;
        const checkRole = () => {
          // Only loyalty roles have a stub field left here (Loyalty Royalty) — per Isaac, Sep 22.
          section.style.display = 'none';   // Pay Stub heading removed from the user form (per Isaac, Oct 15) — nothing left to edit in it
          applyRepTypeVisibility();   // Golden Phone visibility depends on the role too
        };
        roleSel.addEventListener('change', checkRole);
        checkRole();
      }, 0);

      return section;
    })(),
  );

  // ── Footer ──
  // (Remove User retired, per Isaac: users are deactivated and reactivated,
  // never removed - history and sales attribution stay intact.)

  // ── Send Password Reset — fires Supabase's recovery-email flow.
  // Different from Resend Invite: that gets a passwordless sign-in link
  // (good for first login); this lands the rep on a page where they
  // pick a new password themselves. Useful for "I forgot mine and the
  // Forgot Password link on the sign-in screen isn't working for me."
  const resetBtn = existing ? el('button', {
    type: 'button',
    class: 'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition hover:brightness-95',
    style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
    onclick: async (e) => {
      const btn = e.currentTarget;
      if (!existing.email) {
        toast('No email on file for this user.', 'error');
        return;
      }
      if (!confirm('Email ' + existing.email + ' a password-reset link?')) return;
      if (DEMO) {
        toast('Demo mode — would email a password reset link to ' + existing.email, 'info');
        return;
      }
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Sending…';
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(existing.email, {
          redirectTo: authEmailRedirectUrl(),
        });
        if (error) throw error;
        toast('Reset link sent to ' + existing.email, 'success');
      } catch (err) {
        toast(err.message || 'Could not send reset link', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    },
  }, 'Send Reset Link') : null;

  // (Resend Invite retired, per Isaac. It emailed a passwordless magic
  // sign-in link - the first-login flow from before admins created users
  // WITH passwords. Send Reset Link covers every remaining case: the rep
  // lands on a page and picks a password. A profile with NO auth login at
  // all is surfaced by the update path's 404, which points the admin at
  // create-with-password.)

  const footer = el('div', { class: 'px-6 py-4 border-t flex items-center gap-2 flex-wrap', style: { borderColor: 'var(--border)' } },
    el('button', { type: 'submit', class: 'px-2.5 py-1 rounded-lg font-semibold text-[11px]', style: { background: '#323230', color: '#F3F3F3' } }, 'Save'),
    el('button', { type: 'button', class: 'px-2.5 py-1 rounded-lg font-semibold text-[11px] border', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => overlay.remove() }, 'Cancel'),
    resetBtn,
  );

  form.append(header, avatarSection, body, footer);
  overlay.append(form);
  document.body.append(overlay);
}

