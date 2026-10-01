#!/usr/bin/env bash
#
# staging-resume.sh — bring the CDK-managed staging services back up.
#
# Sets `minTaskCount=1`, which since 2026-09-30 is also the value declared in
# `infra/config/staging.ts` — so this restores the configured state rather than
# diverging from it, and `cdk deploy` and this script now agree.
#
# (History, because the previous behavior was deliberately surprising: staging
# used to be configured at `minTaskCount: 0` to cost nothing at rest, and this
# script had to override that to 1 — a documented divergence — because ECS
# Express Gateway autoscaling is CPU-based (`AVERAGE_CPU`), CPU cannot be
# measured across zero running tasks, and there is no request-triggered cold
# start. A service at 0 with no traffic has nothing that can ever scale it up:
# it stays at zero and the gateway returns 503 forever. That bit the original
# hand-built staging deploy for real — see `architecture/deployment.md` and the
# carrieros-mcp README. The account owner chose always-on instead, so the
# override is gone and 0 is now only ever set deliberately, by
# staging-pause.sh.)
#
# Targets ONLY the CDK-managed services. The original hand-built
# `carrieros-web-staging` / `carrieros-mcp-staging` are not touched.
#
# Idempotent: re-running when already at 1 or more is a no-op.
#
# Usage:
#   ./scripts/staging-resume.sh            # resume both services
#   ./scripts/staging-resume.sh --dry-run  # show what would change
#   ./scripts/staging-resume.sh --wait     # also poll until endpoints answer
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${ECS_CLUSTER:-default}"
SERVICES=("carrieros-web-staging-cdk" "carrieros-mcp-staging-cdk")

# Matches `minTaskCount` in infra/config/staging.ts. Keep the two in step.
TARGET_MIN=1

DRY_RUN=0
WAIT=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --wait)    WAIT=1 ;;
    *) echo "error: unknown argument '$arg' (expected --dry-run or --wait)" >&2; exit 2 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "error: aws CLI not found on PATH" >&2; exit 1; }
command -v jq  >/dev/null 2>&1 || { echo "error: jq not found on PATH" >&2; exit 1; }

if ! ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"; then
  echo "error: AWS credentials are missing or expired. Run 'aws login' and retry." >&2
  exit 1
fi

echo "account=${ACCOUNT_ID} region=${REGION} cluster=${CLUSTER}"

exit_code=0
declare -a endpoints=()
declare -a endpoint_paths=()

for service in "${SERVICES[@]}"; do
  arn="arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/${CLUSTER}/${service}"

  # See the long comment in staging-pause.sh: `activeConfigurations` has one entry
  # per overlapping service revision and is NOT ordered by age, so indexing [0] is
  # unsafe. Select the newest by `createdAt`.
  if ! configs="$(aws ecs describe-express-gateway-service \
      --service-arn "$arn" --region "$REGION" \
      --query 'service.activeConfigurations' \
      --output json 2>/dev/null)"; then
    echo "  ${service}: SKIPPED — service not found (has the CDK stack been deployed?)"
    exit_code=1
    continue
  fi

  config_json="$(echo "$configs" | jq -c 'max_by(.createdAt)')"
  current="$(echo "$config_json" | jq -c '.scalingTarget')"
  current_min="$(echo "$current" | jq -r '.minTaskCount')"
  current_max="$(echo "$current" | jq -r '.maxTaskCount')"
  endpoint="$(echo "$config_json" | jq -r '.ingressPaths[0].endpoint // empty')"
  hc_path="$(echo "$config_json" | jq -r '.healthCheckPath // "/"')"

  if [[ -n "$endpoint" ]]; then
    endpoints+=("$endpoint")
    endpoint_paths+=("$hc_path")
  fi

  if [[ "$current_min" -ge "$TARGET_MIN" ]]; then
    echo "  ${service}: already running (minTaskCount=${current_min})"
    continue
  fi

  # A minimum above the maximum is rejected by the API; raise the ceiling too if
  # the configuration would otherwise be invalid.
  desired="$(echo "$current" | jq --argjson min "$TARGET_MIN" \
    '.minTaskCount = $min | if .maxTaskCount < $min then .maxTaskCount = $min else . end')"
  new_max="$(echo "$desired" | jq -r '.maxTaskCount')"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  ${service}: would set minTaskCount ${current_min} -> ${TARGET_MIN} (max ${current_max} -> ${new_max})"
    continue
  fi

  aws ecs update-express-gateway-service \
    --service-arn "$arn" \
    --scaling-target "$desired" \
    --region "$REGION" >/dev/null

  echo "  ${service}: minTaskCount ${current_min} -> ${TARGET_MIN} (resuming)"
done

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry run — nothing changed"
  exit "$exit_code"
fi

if [[ "$WAIT" == "1" && ${#endpoints[@]} -gt 0 ]]; then
  echo
  echo "Polling health endpoints (a cold task start typically takes 1-3 minutes)..."
  for i in "${!endpoints[@]}"; do
    host="${endpoints[$i]}"
    path="${endpoint_paths[$i]}"
    echo "  https://${host}${path}"
    for attempt in $(seq 1 20); do
      code="$(curl -sS -o /dev/null --max-time 10 -w '%{http_code}' \
        "https://${host}${path}" 2>/dev/null || echo "000")"
      if [[ "$code" == "200" ]]; then
        echo "    ready after ${attempt} attempt(s) (HTTP 200)"
        break
      fi
      # HTTP 000 right after a deploy is often DNS lag on a freshly created
      # *.ecs.*.on.aws name, not a dead service. See architecture/deployment.md.
      echo "    attempt ${attempt}: HTTP ${code}"
      if [[ "$attempt" == "20" ]]; then
        echo "    still not healthy — check: aws logs tail /aws/ecs/${CLUSTER}/<service> --since 10m"
        exit_code=1
      fi
      sleep 15
    done
  done
fi

echo
echo "NOTE: these services are at minTaskCount=1 (the configured default) and"
echo "will stay there, billing for a running task. Park them with"
echo "./scripts/staging-pause.sh if staging is not needed for a while — but note"
echo "the next 'cdk deploy' restores the configured 1."

exit "$exit_code"
