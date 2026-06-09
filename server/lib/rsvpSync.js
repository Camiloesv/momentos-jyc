import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { queries } from './db.js';
import { emitNew } from './events.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function endOfDayUtc(yyyyMmDd) {
  // 2026-06-20 → timestamp del 2026-06-20T23:59:59.999Z (inclusive)
  const [y, m, d] = yyyyMmDd.split('-').map((s) => parseInt(s, 10));
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999);
}

export function createRsvpSync({ url, key, until, log }) {
  if (!url || !key) {
    log?.warn?.('[rsvp-sync] disabled — falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
    return { syncOnce: async () => ({ skipped: 'not_configured' }), start: () => {}, stop: () => {} };
  }
  const cutoff = until ? endOfDayUtc(until) : null;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  let timer = null;

  async function syncOnce(opts = {}) {
    const now = Date.now();
    if (cutoff && now > cutoff && opts.trigger !== 'manual') {
      log?.info?.('[rsvp-sync] window closed, skipping');
      return { skipped: 'window_closed' };
    }
    let imported = 0;
    let scanned = 0;
    try {
      const { data, error } = await sb
        .from('rsvps')
        .select('id, name, message, submitted_at, attendance')
        .not('message', 'is', null)
        .eq('attendance', 'yes');
      if (error) throw error;
      scanned = data?.length ?? 0;

      const insert = queries.insertRsvpNote();
      for (const row of data ?? []) {
        const name = (row.name ?? '').trim();
        if (!name || name.length <= 1) continue;
        if (/test/i.test(name)) continue;
        const body = (row.message ?? '').toString().trim();
        if (!body) continue;
        const createdAt = row.submitted_at
          ? Math.floor(new Date(row.submitted_at).getTime() / 1000)
          : Math.floor(now / 1000);
        const itemId = randomUUID();
        const result = insert.run({
          id: itemId,
          size: Buffer.byteLength(body, 'utf8'),
          author: name,
          body,
          source_id: row.id,
          created_at: createdAt,
        });
        if (result.changes === 1) {
          imported += 1;
          emitNew({
            id: itemId,
            moment: 'general',
            kind: 'note',
            url: null,
            author: name,
            body,
            uploader_id: null,
            source: 'rsvp',
            created_at: createdAt,
          });
        }
      }
      log?.info?.({ scanned, imported }, '[rsvp-sync] ok');
      return { scanned, imported };
    } catch (err) {
      log?.error?.({ err }, '[rsvp-sync] failed');
      return { error: String(err?.message ?? err) };
    }
  }

  function start() {
    // 1 vez al boot + cada 24h
    syncOnce({ trigger: 'boot' }).catch(() => {});
    timer = setInterval(() => syncOnce({ trigger: 'interval' }).catch(() => {}), DAY_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { syncOnce, start, stop };
}
