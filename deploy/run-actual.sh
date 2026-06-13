#!/bin/sh
set -a
. /Users/angellopez/prod/actual-budget/deploy/.env
set +a
export ACTUAL_LOGIN_METHOD=openid
export ACTUAL_DATA_DIR=/Users/angellopez/prod/actual-budget/deploy/data/actual
export ACTUAL_PORT=5006
export ACTUAL_HOSTNAME=127.0.0.1
export NODE_ENV=production
exec /opt/homebrew/opt/node@22/bin/node /Users/angellopez/prod/actual-budget/packages/sync-server/build/app.js
