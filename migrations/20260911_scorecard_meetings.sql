-- Scorecards: 1:1 meeting log (per Isaac, Sep 2026).
-- Team leads meet each agent every two weeks: the first meeting of the
-- month is the performance / metric review, the second is coaching
-- (training + what to actively work on). Every meeting is logged here so
-- the history reads as a story per agent. Run once in the Supabase SQL editor.

create table if not exists public.scorecard_meetings (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null,                       -- the agent
  dept          text not null default 'inside_sales',
  period        text not null,                       -- 'YYYY-MM' the meeting belongs to
  kind          text not null default 'coaching',    -- 'review' | 'coaching'
  meeting_date  date not null,
  lead_id       uuid,                                -- who ran it
  lead_name     text,
  notes         text,                                -- discussion / what we covered
  wins          text,                                -- what went well since last time
  focus         jsonb not null default '[]'::jsonb,  -- ["Save %", "Tone on objections"]
  action_items  jsonb not null default '[]'::jsonb,  -- [{ text, done, carried_from }]
  score_snapshot numeric,                            -- composite for the period at log time
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists scorecard_meetings_profile_idx on public.scorecard_meetings (profile_id, meeting_date desc);
create index if not exists scorecard_meetings_period_idx  on public.scorecard_meetings (period);

alter table public.scorecard_meetings enable row level security;
drop policy if exists scorecard_meetings_rw on public.scorecard_meetings;
create policy scorecard_meetings_rw on public.scorecard_meetings
  for all to authenticated using (true) with check (true);
