// Track It — team mailbox
// POST: a team member sends their counts { team, name, days }
// GET:  the lead fetches all counts ?team=CODE
import { put, list, head } from '@vercel/blob';

const keyFor = team => 'teams/' + team.toLowerCase().replace(/[^a-z0-9-]/g, '') + '.json';

async function readTeam(team) {
  const { blobs } = await list({ prefix: keyFor(team) });
  if (!blobs.length) return { reports: {} };
  // private store: get a signed download URL via head(), then fetch it
  let url;
  try {
    const info = await head(blobs[0].url);
    url = (info && info.downloadUrl) || blobs[0].downloadUrl || blobs[0].url;
  } catch (e) {
    url = blobs[0].downloadUrl || blobs[0].url;
  }
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
    return await r.json();
  } catch (e) {
    return { reports: {} };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST') {
      const { team, name, days } = req.body || {};
      if (!team || String(team).length < 4 || !name || typeof days !== 'object') {
        return res.status(400).json({ error: 'bad request' });
      }
      // sanitize: only YYYY-MM-DD keys with positive integer counts
      const clean = {};
      for (const [d, c] of Object.entries(days)) {
        const n = parseInt(c, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && n > 0 && n < 10000) clean[d] = n;
      }
      if (!Object.keys(clean).length) return res.status(400).json({ error: 'no counts' });

      const data = await readTeam(team);
      data.reports = data.reports || {};
      data.reports[String(name).slice(0, 20)] = clean;
      data.updated = Date.now();

      await put(keyFor(team), JSON.stringify(data), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      return res.json({ ok: true });
    }

    if (req.method === 'GET') {
      const team = req.query.team;
      if (!team || String(team).length < 4) return res.status(400).json({ error: 'bad request' });
      const data = await readTeam(team);
      return res.json(data);
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'storage unavailable' });
  }
}
