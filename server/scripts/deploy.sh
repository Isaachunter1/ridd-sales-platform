#!/usr/bin/env bash
# One-shot Cloud Run deploy for the RIDD server — no Cloud Build trigger, no Artifact Registry setup.
# `gcloud run deploy --source` builds the container for you (Cloud Build does the build in the
# background, but there is nothing to configure). Safe to re-run: every step is idempotent.
#
#   Needs on this machine: gcloud (https://cloud.google.com/sdk/docs/install), signed in:
#     gcloud auth login
#   Then, from the repo root:
#     server/scripts/deploy.sh
#
# What it does, in order:
#   1. picks the project + region (defaults below; override with env vars)
#   2. enables the APIs
#   3. makes sure every secret exists — prompts for a value only when one is missing (never echoed, never logged)
#   4. deploys server/ to Cloud Run as ridd-server with the env vars + secrets attached
#   5. checks /health
#   6. writes the Cloud Scheduler entries from the jobs' own cron fields (server/scripts/schedules.js --apply)
set -euo pipefail

PROJECT="${GCP_PROJECT:-ridd-data}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-ridd-server}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
cd "$(dirname "$0")/../.."   # repo root

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/6  Project $PROJECT · region $REGION · service $SERVICE"
gcloud config set project "$PROJECT" >/dev/null
gcloud config set run/region "$REGION" >/dev/null

say "2/6  Enabling APIs (Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Cloud Scheduler)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com >/dev/null

say "3/6  Secrets"
# name | required | what it is
SECRETS=(
  "SUPABASE_SERVICE_ROLE_KEY|yes|Supabase → Settings → API → service_role key"
  "API_TOKEN|yes|any long random string (press Enter to generate one)"
  "PLAIBOOK_MCP_TOKEN|yes|the Plaibook MCP server token"
  "GCP_SA_JSON|no|the RevHawk service-account key file, whole JSON (needed by the BigQuery jobs; skip for Plaibook only)"
  "SLACK_ADMIN_WEBHOOK|no|admin Slack channel incoming webhook (job lines; skip = logs only)"
)
ATTACH=()
for row in "${SECRETS[@]}"; do
  IFS='|' read -r name req what <<<"$row"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    echo "  ✓ $name exists"
    ATTACH+=("$name=$name:latest")
    continue
  fi
  if [[ "$req" == "no" ]]; then
    read -r -p "  $name is optional ($what). Add it now? [y/N] " yn
    [[ "${yn:-n}" =~ ^[Yy]$ ]] || { echo "  – skipped $name"; continue; }
  fi
  if [[ "$name" == "API_TOKEN" ]]; then
    read -r -s -p "  $name — $what: " val; echo
    [[ -n "$val" ]] || val="$(openssl rand -hex 32)"
  elif [[ "$name" == "GCP_SA_JSON" ]]; then
    read -r -p "  Path to the service-account JSON file: " path
    gcloud secrets create "$name" --replication-policy=automatic --data-file="$path" >/dev/null
    echo "  ✓ $name created"; ATTACH+=("$name=$name:latest"); continue
  else
    read -r -s -p "  $name — $what: " val; echo
  fi
  [[ -n "$val" ]] || { echo "  ✗ $name is required"; exit 1; }
  printf '%s' "$val" | gcloud secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
  unset val
  echo "  ✓ $name created"
  ATTACH+=("$name=$name:latest")
done

if [[ -z "$SUPABASE_URL" ]]; then read -r -p "  Supabase project URL (https://<ref>.supabase.co): " SUPABASE_URL; fi
if [[ -z "$SUPABASE_ANON_KEY" ]]; then read -r -p "  Supabase anon (public) key: " SUPABASE_ANON_KEY; fi

# The Cloud Run runtime service account must be allowed to read the secrets.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for row in "${ATTACH[@]}"; do
  name="${row%%=*}"
  gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor >/dev/null 2>&1 || true
done

say "4/6  Deploying server/ to Cloud Run (builds the container; 3–5 minutes the first time)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
ENV_VARS="NODE_ENV=production,JOB_VERSION=$SHA,SUPABASE_URL=$SUPABASE_URL,SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY"
ENV_VARS="$ENV_VARS,REVHAWK_PROJECT_ID=revhawkdataconnect,REVHAWK_DATASET=org_ridd_pest_control_3f4149,GCP_JOB_PROJECT=$PROJECT,CORS_ORIGINS=*"
ENV_VARS="$ENV_VARS,PLAIBOOK_MCP_URL=https://app.plaibook.tech/api/mcp"
SECRET_ARGS="$(IFS=,; echo "${ATTACH[*]}")"
gcloud run deploy "$SERVICE" --source server --region "$REGION" --platform managed --port 8080 \
  --timeout 3600 --min-instances 1 --max-instances 3 --concurrency 10 --memory 2Gi --cpu 1 --no-cpu-throttling \
  --allow-unauthenticated --set-env-vars "$ENV_VARS" --set-secrets "$SECRET_ARGS" --quiet

say "5/6  Health"
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo "  $URL/health"
curl -sS "$URL/health" || true; echo

say "6/6  Cloud Scheduler (from each job's schedule field)"
( cd server && npm install --silent >/dev/null 2>&1 || true
  SERVICE_URL="$URL" GCP_PROJECT="$PROJECT" GCP_REGION="$REGION" npm run schedules -- --apply )

say "Done. Jobs run on their schedules now; Slack (if set) gets one line per run. Re-run this script after any server/ change to redeploy."
