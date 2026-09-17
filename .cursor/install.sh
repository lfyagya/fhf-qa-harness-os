#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the fhf-qa-harness-os harness repo.
#
# This repository is a pure Node (ESM .mjs) harness with no package.json and no
# JavaScript dependencies to install, so there is nothing to "npm install".
#
# The only environment gap: several deterministic harness gates shell out to a
# bare "python" executable (for example the backend-automation validator, which
# ast-parses changed backend Python). The base image ships "python3" but not a
# bare "python", so we make "python" resolve to Python 3. Without this the
# backend-automation gate fails closed with
# "Python runtime is required to validate backend automation changes".
set -euo pipefail

if ! command -v python >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends python-is-python3
fi

echo "node    $(node --version)"
echo "python  $(python --version 2>&1)"
