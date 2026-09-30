#!/usr/bin/env bash
#
# staging-resume.sh — bring the CDK-managed staging services back up.
#
# =============================================================================
# WHY THIS SETS minTaskCount=1 AND NOT THE CONFIGURED VALUE OF 0
# =============================================================================
# `infra/config/staging.ts` declares `minTaskCount: 0`, because staging should
# cost nothing at rest. A naive "resume" that restored the configured value
# would set the minimum back to 0 — and the service would stay dead.
#
# ECS Express Gateway autoscaling here is CPU-based (`AVERAGE_CPU`). CPU cannot
# be measured across zero running tasks, and there is no request-triggered cold
# start the way some serverless platforms provide. So a service sitting at
# `minTaskCount: 0` with no traffic has nothing that can ever scale it up: it
# stays at zero indefinitely and the gateway returns 503 forever. This was hit
# for real during the original hand-built staging deploy — see
# `architecture/deployment.md` and the carrieros-mcp README's deployment notes.
#
# Therefore "resume" means: set minTaskCount=1 so a task actually starts, and
# LEAVE IT AT 1. This is a deliberate, documented divergence from the config
# file's 0, not a bug and not drift to be "corrected" back. The config's 0 is the
# at-rest/paused state; 1 is the serving state. `cdk deploy` will reset the
# minimum to the configured 0, so re-run this script after any deploy you expect
# to actually serve traffic.
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

# See the comment block above: 1, deliberately, not the configured 0.
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
echo "NOTE: these services are now at minTaskCount=1 and will stay there,"
echo "billing for a running task. Run ./scripts/staging-pause.sh when done."

exit "$exit_code"
