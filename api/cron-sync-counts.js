// Track It — daily automatic sync: recompute every team member's day-by-day
// counts from their own saved track log and merge them into their lead's
// roster. Runs once a day via Vercel Cron (see vercel.json). Members' own
// track logs are already continuously saved to their profile blob as they
// use the app, so this needs no per-member action — it's the same
// aggregation /api/counts.js does for one member, just looped over all of
// them on a schedule.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
}
async function fetchMembers() {
  const url = SUPABASE_URL + '/rest/v1/profiles?role=eq.member&lead_id=not.is.null&select=id,name,email,lead_id,blob';
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error('sb get ' + r.status);
  return await r.json();
}
async function sbGetRoster(leadId) {
  const url = SUPABASE_URL + '/rest/v1/rosters?lead_id=eq.' + encodeURIComponent(leadId) + '&select=*';
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error('sb get ' + r.status);
  const rows = await r.json();
  return (rows && rows[0]) || null;
}
async function sbUpsertRoster(leadId, reports) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rosters?on_conflict=lead_id', {
    method: 'POST',
    headers: Object.assign(sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ lead_id: leadId, reports, updated: Date.now() }),
  });
  if (!r.ok) throw new Error('sb upsert ' + r.status + ' ' + (await r.text()));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'storage not configured' });
  }
  // if CRON_SECRET is set, only accept calls carrying it (Vercel sends this
  // automatically for scheduled invocations); if unset, run unauthenticated —
  // harmless either way since this only recomputes real counts, never writes
  // arbitrary data
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  try {
    const members = await fetchMembers();
    const byLead = {};
    for (const m of members) {
      if (!m.blob) continue;
      let data;
      try { data = JSON.parse(m.blob); } catch (e) { continue; }
      const songs = Array.isArray(data.songs) ? data.songs : [];
      const days = {};
      for (const s of songs) {
        if (s && s.date) days[s.date] = (days[s.date] || 0) + 1;
      }
      if (!Object.keys(days).length) continue;
      const name = String(m.name || m.email || 'Member').slice(0, 20);
      (byLead[m.lead_id] = byLead[m.lead_id] || []).push({ name, days });
    }
    let leadsUpdated = 0;
    for (const [leadId, entries] of Object.entries(byLead)) {
      const existing = await sbGetRoster(leadId);
      const reports = (existing && existing.reports) || {};
      for (const e of entries) reports[e.name] = e.days;
      await sbUpsertRoster(leadId, reports);
      leadsUpdated++;
    }
    return res.json({ ok: true, membersProcessed: members.length, leadsUpdated });
  } catch (e) {
    return res.status(500).json({ error: 'sync failed' });
  }
}
