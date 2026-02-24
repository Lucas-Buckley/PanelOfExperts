# PanelOfExperts

## Deployment Smoke Script

Run deployed smoke checks without hardcoding tokens:

```bash
SMOKE_BASE_URL="https://panel-of-experts-production.vercel.app" \
SMOKE_EXPECT_MODE="live" \
SMOKE_EXPERT_COUNT="1" \
npm run smoke:deploy
```

For protected preview deployments, set:

```bash
export VERCEL_BYPASS_TOKEN="your-rotated-bypass-token"
```

## Operations Readiness Checks

Run lightweight endpoint health checks:

```bash
HEALTH_BASE_URL="https://panel-of-experts-production.vercel.app" \
npm run health:deploy
```

Run rollback-readiness verification (workflows/scripts/env contracts + optional remote probes):

```bash
ROLLBACK_BASE_URL="https://panel-of-experts-production.vercel.app" \
npm run rollback:verify
```

## Cost And Safety Guardrails

Verify guardrails before release:

```bash
npm run safety:verify
```

Key emergency toggles:

```bash
# Soft fallback (keep app functional with zero API spend)
LLM_MODE="simulated"

# Hard stop (disable all LLM calls)
LLM_ENABLED="false"
```
