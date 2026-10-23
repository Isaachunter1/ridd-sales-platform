// ──────────────────────────────────────────────────────────────────────────
// SLACK INTEGRATION
// ──────────────────────────────────────────────────────────────────────────
// Two paths:
//   1. CHANNEL WEBHOOKS — "https://hooks.slack.com/services/..." URLs configured
//      in Settings → Slack → Channels. Slack incoming webhooks are CORS-enabled,
//      so the browser can POST to them directly. Used for: Sale Broadcast,
//      First Blood, Weekly Digest (when wired), Competition Updates.
//   2. DIRECT MESSAGES — require the bot token (xoxb-...) which CANNOT live in
//      the browser (CORS + token-leak). slack.sendDM POSTs to a Netlify Function
//      at /api/slack-paystub that holds the token server-side. In DEMO mode we
//      log the would-be sends to the activity trail and toast the count.
const slack = {
  // Promise-returning POST to a Slack incoming webhook. Slack returns "ok"
  // (200, body "ok") on success. Never throws — callers fan out and rely on
  // the returned { ok, error } shape.
  async postWebhook(url, payload) {
    if (!url) return { ok: false, error: 'No webhook URL configured' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => '');
      return res.ok
        ? { ok: true,  error: null }
        : { ok: false, error: 'HTTP ' + res.status + (text ? ' · ' + text.slice(0, 80) : '') };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  },

  // Look up a configured channel's webhook URL by name (e.g. "#insidesales").
  webhookFor(channelName) {
    if (!channelName) return null;
    const ch = (state.appSettings?.slack_channels || []).find(c => c.name === channelName);
    return ch?.webhook || null;
  },

  // Post to a named channel — webhook lookup + POST + audit-log entry. Quietly
  // no-ops (with a console warn) if the channel has no webhook yet so a missing
  // config doesn't break the call site (e.g. logging a sale).
  async sendChannel(channelName, payload, kind) {
    const url = this.webhookFor(channelName);
    if (!url) {
      console.warn('[slack] no webhook for channel ' + channelName);
      return { ok: false, error: 'No webhook for ' + channelName };
    }
    const res = await this.postWebhook(url, payload);
    logActivity('slack_post', {
      new_status: kind || 'channel post',
      detail: channelName + (res.ok ? ' · sent' : ' · ' + res.error),
    });
    return res;
  },

  // Send a DM to one or more reps. In DEMO mode this is a stub: it logs the
  // intent to the activity trail and toasts a summary. In real mode it POSTs
  // to /api/slack-paystub which fans out via chat.postMessage server-side.
  async sendDM(repIds, payload, kind) {
    const ids = Array.isArray(repIds) ? repIds : [repIds];
    const profiles = (state.allProfiles || []).filter(p => ids.includes(p.id));
    // slack_member_id = the self-service column (⚙ My Settings); the old
    // slack_user_id column had NO write path — kept only as a fallback.
    const _sidOf = (p) => p.slack_member_id || p.slack_user_id || null;
    const withSlack = profiles.filter(p => _sidOf(p));
    const without = profiles.length - withSlack.length;

    if (DEMO) {
      withSlack.forEach(p => {
        logActivity('slack_dm_sent', {
          new_status: kind || 'dm',
          rep_name: p.full_name,
          detail: 'Demo · would DM ' + _sidOf(p),
        });
      });
      const sent = withSlack.length;
      if (sent > 0) {
        toast('Slack DM (demo): ' + sent + ' rep' + (sent === 1 ? '' : 's')
          + (without > 0 ? ' · ' + without + ' missing Slack ID' : ''),
          'success');
      } else if (without > 0) {
        toast('No reps have Slack User IDs configured', 'warn');
      }
      return { sent, skipped: without, errors: [] };
    }

    if (withSlack.length === 0) return { sent: 0, skipped: without, errors: [] };
    try {
      const res = await fetch('/api/slack-paystub', {
        method: 'POST',
        headers: await _apiAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          recipients: withSlack.map(p => ({ slack_user_id: _sidOf(p), full_name: p.full_name })),
          payload,
          kind: kind || 'dm',
        }),
      });
      const data = await res.json().catch(() => ({}));
      withSlack.forEach(p => {
        logActivity('slack_dm_sent', {
          new_status: kind || 'dm',
          rep_name: p.full_name,
          detail: data.errors?.[_sidOf(p)] ? 'Failed · ' + data.errors[_sidOf(p)] : 'Sent',
        });
      });
      return {
        sent: data.sent || 0,
        skipped: (data.failed || 0) + without,
        errors: data.errors || {},
      };
    } catch (err) {
      toast('Slack relay failed: ' + (err.message || err), 'error');
      return { sent: 0, skipped: profiles.length, errors: { transport: err.message } };
    }
  },

  // ── Block Kit formatters ─────────────────────────────────────────────────
  formatPayStub(profile, period, summary, kind) {
    const moneyLine = (label, val) => '*' + label + ':* $' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isBackend = kind === 'backend';
    return {
      text: (isBackend ? 'Backend pay run' : 'Pay run') + ' · ' + period.label,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: (isBackend ? '🏦 Backend Pay' : '💰 Pay Stub') + ' · ' + period.label } },
        { type: 'section', text: { type: 'mrkdwn', text:
          'Hi *' + profile.full_name + '* — your ' + (isBackend ? 'backend ' : '') + 'payroll just ran.\n\n' +
          (summary.salesPay != null ? moneyLine('Sales Pay', summary.salesPay) + '\n' : '') +
          (summary.belowPay != null && summary.below > 0 ? moneyLine('Below-Min Pay', summary.belowPay) + '\n' : '') +
          (summary.bonuses  != null ? moneyLine('Bonuses', summary.bonuses) + '\n' : '') +
          (summary.total    != null ? '\n' + moneyLine(isBackend ? 'Backend Total' : 'Total Pay', summary.total) : '')
        } },
        { type: 'context', elements: [
          { type: 'mrkdwn', text:
            (summary.serviced != null ? summary.serviced + ' serviced' : '') +
            (summary.below ? ' · ' + summary.below + ' below-min' : '') +
            ' · pay period ' + period.label
          },
        ] },
      ],
    };
  },

  formatSaleBroadcast(profile, sale) {
    const repName = profile?.full_name || 'A rep';
    const office  = (state.offices || []).find(o => o.id === sale.office_id)?.name || '';
    const service = (state.serviceTypes || []).find(t => t.id === sale.service_type_id)?.name || '';
    const acv     = Number(sale.revenue_amount || 0);
    const customer = sale.customer_name || 'a customer';
    return {
      text: repName + ' just sold ' + customer + ' — $' + acv.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ACV',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text:
          '🎯 *' + repName + '* just closed *' + customer + '*' +
          (office ? ' · ' + office : '') +
          (service ? '\n_' + service + '_' : '') +
          '\n*ACV:* $' + acv.toLocaleString('en-US')
        } },
      ],
    };
  },

  formatFirstBlood(profile, settings) {
    const tmpl = settings?.message || '[Rep name] first blood today!';
    const text = tmpl.replace(/\[Rep name\]/gi, profile.full_name || 'A rep');
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: '🩸 *' + text + '*' } },
    ];
    if (settings?.image_url) {
      blocks.push({ type: 'image', image_url: settings.image_url, alt_text: 'First blood' });
    }
    return { text, blocks };
  },
};

