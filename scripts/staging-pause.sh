#!/usr/bin/env bash
#
# staging-pause.sh — scale the CDK-managed staging services down to zero tasks.
#
# Targets ONLY the CDK-managed services (`carrieros-web-staging-cdk`,
# `carrieros-mcp-staging-cdk`). The original hand-built `carrieros-web-staging`
# and `carrieros-mcp-staging` are deliberately NOT touched by this script.
#
# Idempotent: re-running when already at zero is a no-op that reports "already
# paused" rather than registering a pointless new service deployment.
#
# PAUSING IS NOT IMMEDIATE. Setting minTaskCount=0 registers a new service
# revision and permits zero tasks; it does not kill the running ones. The
# previous revision's tasks drain on ECS's schedule, and the endpoint keeps
# returning 200 until they are gone. Measured on 2026-09-30: still serving 200
# four minutes after a successful pause, with the deployment reporting
# IN_PROGRESS and the older revisions still listed under activeConfigurations.
# Do not treat a 200 shortly after pausing as a failed pause.
#
# Pausing is a DEPARTURE from the configured state: since 2026-09-30
# `infra/config/staging.ts` declares `minTaskCount: 1` (always-on), so the next
# `cdk deploy` restores 1 and staging starts serving again. Treat pause as an
# on-demand parking brake, not a durable setting — if staging should be parked by
# default, change the config rather than relying on this script having been run.
#
# Paused services cost nothing for compute, but the Express-Gateway-managed load
# balancer still exists and still bills. Pausing is a compute-cost lever, not a
# teardown.
#
# Usage:
#   ./scripts/staging-pause.sh            # pause both services
#   ./scripts/staging-pause.sh --dry-run  # show what would change
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${ECS_CLUSTER:-default}"
SERVICES=("carrieros-web-staging-cdk" "carrieros-mcp-staging-cdk")
TARGET_MIN=0

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

command -v aws >/dev/null 2>&1 || { echo "error: aws CLI not found on PATH" >&2; exit 1; }
command -v jq  >/dev/null 2>&1 || { echo "error: jq not found on PATH" >&2; exit 1; }

# Fail fast and clearly on an expired session rather than emitting one opaque
# error per service. Session expiry here needs a human to re-run `aws login`.
if ! ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"; then
  echo "error: AWS credentials are missing or expired. Run 'aws login' and retry." >&2
  exit 1
fi

echo "account=${ACCOUNT_ID} region=${REGION} cluster=${CLUSTER}"

exit_code=0

for service in "${SERVICES[@]}"; do
  arn="arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/${CLUSTER}/${service}"

  # `activeConfigurations` holds ONE ENTRY PER OVERLAPPING SERVICE REVISION, not
  # one per service. Every `update-express-gateway-service` call registers a new
  # revision, so during a rollout the previous revision (carrying the previous
  # scaling target) is still listed as active while its tasks drain. The entries
  # are NOT ordered by age — observed live on this service: index 0 was 15:23:07,
  # index 1 was 15:14:45, index 2 was 15:19:13. So `activeConfigurations[0]` is
  # not reliably the current configuration. Pick the newest by `createdAt`; that
  # choice was checked against `describe-service-deployments`'s
  # `targetServiceRevision` for the in-progress deployment and matched.
  if ! configs="$(aws ecs describe-express-gateway-service \
      --service-arn "$arn" --region "$REGION" \
      --query 'service.activeConfigurations' \
      --output json 2>/dev/null)"; then
    echo "  ${service}: SKIPPED — service not found (has the CDK stack been deployed?)"
    exit_code=1
    continue
  fi

  # All timestamps come from a single CLI call against one region, so they share
  # a UTC offset and compare correctly as strings.
  current="$(echo "$configs" | jq -c 'max_by(.createdAt) | .scalingTarget')"
  current_min="$(echo "$current" | jq -r '.minTaskCount')"

  if [[ "$current_min" == "$TARGET_MIN" ]]; then
    echo "  ${service}: already paused (minTaskCount=${current_min})"
    continue
  fi

  # Preserve maxTaskCount, metric and target value; change ONLY the minimum, so
  # this script cannot quietly rewrite the environment's scaling policy.
  desired="$(echo "$current" | jq --argjson min "$TARGET_MIN" '.minTaskCount = $min')"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  ${service}: would set minTaskCount ${current_min} -> ${TARGET_MIN}"
    continue
  fi

  aws ecs update-express-gateway-service \
    --service-arn "$arn" \
    --scaling-target "$desired" \
    --region "$REGION" >/dev/null

  echo "  ${service}: minTaskCount ${current_min} -> ${TARGET_MIN} (pausing)"
done

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry run — nothing changed"
  exit "$exit_code"
fi

echo
echo "Scale-down is asynchronous and takes several minutes: the endpoint keeps"
echo "returning 200 while the previous revision's tasks drain. Check real progress"
echo "with the task count, not by curling the endpoint:"
for service in "${SERVICES[@]}"; do
  echo "  aws ecs list-tasks --cluster ${CLUSTER} --region ${REGION} \\"
  echo "    --service-name ${service} --query 'length(taskArns)'"
done
echo
echo "Re-start them with ./scripts/staging-resume.sh (note: minTaskCount=0 never"
echo "wakes on its own — see that script's comments)."

exit "$exit_code"
