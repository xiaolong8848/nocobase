#!/bin/sh
set -e

cd /app/nocobase

echo "NocoBase perf image: APP_ENV=${APP_ENV:-development}, APP_PORT=${APP_PORT:-80}, DB_HOST=${DB_HOST:-postgres16}, DB_DATABASE=${DB_DATABASE:-nocobase_perf_docker}"

exec yarn start
