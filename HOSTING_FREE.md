# Free Hosting Plan (No Local Machine Needed)

This is the easiest fully online setup for your personal use.

## Goal

- Max `10` posts per day
- Every `1 hour`: do up to `2` randomized engagement actions with variable timing
- Everything runs online (your PC can stay off)

## Best Free Architecture

1. Host app UI/API on `Vercel` (free)
2. Run automation worker on `GitHub Actions` (free)
3. Store queue/history/counters in a cloud DB (`Supabase` free or `Upstash Redis` free)

## Why this is needed

- Vercel free cron is not suitable for reliable hourly bot runs.
- Browser bot automation needs a worker that can run on schedule.
- GitHub Actions supports scheduled jobs (hourly is fine).

## Setup Steps

### 1) Deploy app to Vercel

- Connect GitHub repo to Vercel
- Deploy with production env vars

### 2) Add secrets in GitHub repo

- `APP_BASE_URL` = your Vercel URL (example: `https://your-app.vercel.app`)
- `AUTOMATION_SECRET` = long random string
- `PINTEREST_SESSION_COOKIE` = current `_pinterest_sess`
- `AI_API_KEY` (or your provider key)

### 3) Enable included hourly workflow

- Workflow file: `.github/workflows/hourly-automation.yml`
- Schedule: every 1 hour
- It runs `node scripts/run-hourly-automation.js` directly on GitHub runner
- This avoids Vercel execution limits for long browser automation

### 4) Worker logic per hour

- Step A: post from queue until daily counter reaches `10`
- Step B: select `2` random targets (max cap)
- Step C: perform randomized like/comment actions with human-like delays
- Step D: save results and updated counters

### 5) Daily counter reset

- Reset `postsToday` at date change (UTC or your preferred timezone)

## Required App Env Vars

- `NODE_ENV=production`
- `PINTEREST_POSTING_MODE=api` (recommended for dashboard deployment on Vercel)
- `AUTOMATION_SECRET=...`
- `UPSTASH_REDIS_REST_URL=...`
- `UPSTASH_REDIS_REST_TOKEN=...`
- `APP_STATE_KEY=pinterest_autopost_state_v1`

## Required GitHub Actions Secrets

- `PINTEREST_SESSION_COOKIE`
- `AI_API_KEY`
- `AI_MODEL` (optional)
- `AI_BASE_URL` (optional)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `AUTOMATION_TIMEZONE` (example: `Asia/Calcutta`)
- `AUTOMATION_MAX_POSTS_PER_DAY` (set `10`)
- `AUTOMATION_MAX_POSTS_PER_RUN` (recommended `2`)
- `AUTOMATION_ENGAGEMENTS_PER_HOUR` (set `2`)
- `AUTOMATION_ENGAGEMENTS_HARD_CAP` (keep `2`)
- `AUTOMATION_ENGAGEMENT_START_JITTER_MIN_MS` / `AUTOMATION_ENGAGEMENT_START_JITTER_MAX_MS`
- `AUTOMATION_ENGAGEMENT_MIN_GAP_MS` / `AUTOMATION_ENGAGEMENT_MAX_GAP_MS`
- `AUTOMATION_COMMENT_PROBABILITY` (example `0.85`)

If using API fallback mode:

- `PINTEREST_POSTING_MODE=api`

## Security

- Protect automation endpoint with `Authorization: Bearer <AUTOMATION_SECRET>`
- Reject request if token is invalid
- Endpoint available: `POST /api/automation/run-hourly`
- Status endpoint: `GET /api/automation/status`

## Monitoring Checklist

- `GET /api/health` returns `success=true`
- Hourly workflow runs in GitHub Actions
- Daily post counter stops at `10`
- Engagement log shows up to `2` randomized actions each hour

## Known Maintenance

- Pinterest session cookie can expire; update it in GitHub Secrets when needed.
