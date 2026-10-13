#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec bash "${script_dir}/sites-env.sh" -- bash "$0" "$@"
fi

for tool in flock timeout node; do
  command -v "${tool}" >/dev/null || {
    echo "Managed dependency setup requires Linux flock, GNU timeout, and Node.js." >&2
    exit 69
  }
done
runtime_root="${SITES_RUNTIME_ROOT:-${SITES_PROJECT_ROOT}/.sites-runtime}"
if [[ "${HOME}" != "${runtime_root}/home" || "${npm_config_cache:-}" != "${runtime_root}/npm-cache" ]]; then
  echo "Managed dependency setup requires a project-owned writable HOME and cache." >&2
  exit 78
fi
touch "${HOME}/.sites-write-test" "${npm_config_cache}/.sites-write-test"
rm -f "${HOME}/.sites-write-test" "${npm_config_cache}/.sites-write-test"

exec 9>"${runtime_root}/install.lock"
if ! flock -n 9; then
  echo "Another dependency install is already running for ${SITES_PROJECT_ROOT}." >&2
  exit 75
fi

# The same pinned pnpm/frozen lockfile is used on every host. The managed wrapper
# retains its writable environment, single-install lease, and bounded lifetime.
export SITES_INSTALL_LOCK_HELD=1
export NPM_CONFIG_FETCH_RETRIES=0
export NPM_CONFIG_FETCH_TIMEOUT=30000
timeout --signal=TERM --kill-after="${SITES_INSTALL_KILL_AFTER:-15s}" \
  "${SITES_INSTALL_TIMEOUT:-8m}" node "${script_dir}/install-ci.mjs" "$@"
