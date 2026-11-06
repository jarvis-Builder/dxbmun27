#!/usr/bin/env bash
set -euo pipefail

ulimit -n 4096
docker compose up --build --detach
docker compose ps
