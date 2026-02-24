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
