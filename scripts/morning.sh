#!/bin/zsh
# Morning run: pull yesterday and today from VALD and Catapult, then build
# the live site in data/live/site. Documented in the README; not installed.
#
# Settings are read from the macOS Keychain, never from a file. Store each
# one once (the -w with no value makes macOS ask for it, so it stays out of
# your shell history):
#   security add-generic-password -a "$USER" -s lineup-card.VALD_CLIENT_SECRET -w
set -e
cd "${0:A:h}/.."
for name in VALD_CLIENT_ID VALD_CLIENT_SECRET VALD_TENANT_ID VALD_REGION VALD_CMJ_TEST_TYPE \
            VALD_JUMP_RESULT VALD_RSI_RESULT CATAPULT_TOKEN CATAPULT_HOST \
            CATAPULT_LOAD_SLUG CATAPULT_THROW_SLUG CATAPULT_PITCH_SLUG; do
  if value=$(security find-generic-password -a "$USER" -s "lineup-card.$name" -w 2>/dev/null); then
    export "$name=$value"
  fi
done
.venv/bin/python scripts/pull.py --date yesterday --to today --data data/live
.venv/bin/python scripts/build_site.py --data data/live
