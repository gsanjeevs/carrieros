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

  if ! current="$(aws ecs describe-express-gateway-service \
      --service-arn "$arn" --region "$REGION" \
      --query 'service.activeConfigurations[0].scalingTarget' \
      --output json 2>/dev/null)"; then
    echo "  ${service}: SKIPPED — service not found (has the CDK stack been deployed?)"
    exit_code=1
    continue
  fi

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
echo "Scale-down is asynchronous. Confirm tasks have actually drained with:"
for service in "${SERVICES[@]}"; do
  echo "  aws ecs describe-express-gateway-service --region ${REGION} \\"
  echo "    --service-arn arn:aws:ecs:${REGION}:${ACCOUNT_ID}:service/${CLUSTER}/${service} \\"
  echo "    --query 'service.activeConfigurations[0].scalingTarget'"
done
echo
echo "Re-start them with ./scripts/staging-resume.sh (note: minTaskCount=0 never"
echo "wakes on its own — see that script's comments)."

exit "$exit_code"
