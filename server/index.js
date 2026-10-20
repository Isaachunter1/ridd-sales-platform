// RIDD Sales Platform — the server. One Express app, one container.
//
// Nothing is wired by hand: every folder under services/ exports { router, jobs }
// from its index.js; this file mounts each router under /api and registers
// POST /jobs/<name> for every job. Add a domain = add a folder.
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import env, { MISSING } from './config/env.js';
import { requestLog } from './middleware/log.js';
import { errorHandler, notFound } from './middleware/error.js';
import { requireSchedulerOrAdmin } from './middleware/auth.js';
import killSwitch from './runtime/killswitch.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadServices() {
  const dir = path.join(here, 'services');
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const idx = path.join(dir, name, 'index.js');
    if (!fs.existsSync(idx)) continue;
    const mod = await import(pathToFileURL(idx).href);
    out.push({ name, router: mod.router || null, jobs: Array.isArray(mod.jobs) ? mod.jobs : [] });
  }
  return out;
}

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cors({
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-API-TOKEN'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(requestLog);

  app.get('/healthz', (_req, res) => res.json({ ok: MISSING.length === 0, configured: MISSING.length === 0, missing: MISSING, version: env.JOB_VERSION, now: new Date().toISOString() }));
  // Not configured yet → every other route says so, plainly, instead of
  // throwing from deep inside a Supabase call.
  if (MISSING.length) app.use((req, res) => res.status(503).json({ error: 'server not configured — missing: ' + MISSING.join(', ') + '. Attach them in Cloud Run → Edit & deploy → Variables & Secrets (server/README.md step 5).' }));

  const services = await loadServices();
  const jobs = [killSwitch];
  for (const s of services) {
    if (s.router) app.use('/api', s.router);
    for (const j of s.jobs) {
      if (jobs.some(x => x.name === j.name)) throw new Error('duplicate job name: ' + j.name);
      jobs.push(j);
    }
  }
  app.locals.jobs = jobs;

  // GET /jobs — what exists and when it runs (admin or token).
  app.get('/jobs', requireSchedulerOrAdmin, (_req, res) => res.json(jobs.map(j => ({ name: j.name, schedule: j.schedule, description: j.description }))));

  // POST /jobs/<name> — Scheduler kick (X-API-TOKEN) or admin "Refresh now" (JWT).
  // Same path is also reachable as POST /api/jobs/<name> so the app's single
  // Netlify /api/* redirect covers it.
  const kick = async (req, res, next) => {
    const j = jobs.find(x => x.name === req.params.name);
    if (!j) return res.status(404).json({ error: 'no such job: ' + req.params.name });
    const trigger = req.caller.kind === 'scheduler' ? 'scheduler' : 'admin:' + (req.user && req.user.email || req.caller.id);
    try {
      const r = await j.run({ trigger, dryRun: req.query.dry === '1' ? true : undefined });
      res.json(r);
    } catch (e) {
      if (e.code === 'LOCKED') return res.status(409).json({ ok: false, error: e.message, message: 'A run is already in progress — give it a minute and reload.' });
      next(e);
    }
  };
  app.post('/jobs/:name', requireSchedulerOrAdmin, kick);
  app.post('/api/jobs/:name', requireSchedulerOrAdmin, kick);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

// Started directly (node index.js) → listen. Imported (tests, scripts) → no.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(env.PORT) || 8080;
  app.listen(port, () => console.log(JSON.stringify({ severity: 'INFO', msg: 'listening', port, version: env.JOB_VERSION, jobs: app.locals.jobs.map(j => j.name) })));
}
