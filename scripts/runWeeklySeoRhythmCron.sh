#!/usr/bin/env bash
set -euo pipefail

cd /opt/telegatask
mkdir -p reports logs

export SEO_WEEKLY_RHYTHM_CRON=1
export SEO_GLOBAL_REPORT_POST_CHAIN="${SEO_GLOBAL_REPORT_POST_CHAIN:-1}"
export SEO_MYSQL_DASHBOARD_POST_CHAIN="${SEO_MYSQL_DASHBOARD_POST_CHAIN:-1}"
export SEO_MYSQL_DASHBOARD_EXPORT="${SEO_MYSQL_DASHBOARD_EXPORT:-1}"

node -r ts-node/register/transpile-only scripts/runWeeklySeoRhythm.ts \
  --out-dir reports \
  --global-report-post-chain \
  --mysql-dashboard-post-chain
