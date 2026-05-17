#!/usr/bin/env bash
# CalmDriver – FAQ Auto-Generator (cron wrapper)
#
# KONFIGURACJA CRONA (2x w tygodniu) – wklej do: crontab -e
# ─────────────────────────────────────────────────────────
# 0 9 * * 2 /opt/calmdriver/scripts/faq-cron.sh
# 0 9 * * 5 /opt/calmdriver/scripts/faq-cron.sh
# ─────────────────────────────────────────────────────────
# Efekt: ~2 nowe pytania FAQ tygodniowo.
# Gdy faq-queue.json się wyczerpie → skrypt działa dalej
# wybierając tematy autonomicznie (bez przerwy).
#
# Wymagania na VPS:
#   - Node.js 20+
#   - /opt/calmdriver/.env  (zawiera GEMINI_API_KEY)
#   - Deploy key GitHub z uprawnieniami write (ssh-keygen + GitHub repo settings)

set -euo pipefail

# ── Ścieżki ───────────────────────────────────────────────────────────────────
REPO_DIR="/opt/calmdriver"
ENV_FILE="${REPO_DIR}/.env"
LOG_FILE="/opt/calmdriver/faq-cron.log"
SCRIPT="${REPO_DIR}/scripts/generate-faq.mjs"

# ── Logging ───────────────────────────────────────────────────────────────────
exec >> "${LOG_FILE}" 2>&1
echo ""
echo "════════════════════════════════════════"
echo "▶ $(date '+%Y-%m-%d %H:%M:%S')  faq-cron start"
echo "════════════════════════════════════════"

# ── Env vars z pliku .env ─────────────────────────────────────────────────────
if [ ! -f "${ENV_FILE}" ]; then
  echo "❌ Brak pliku ${ENV_FILE} – przerwano."
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "❌ GEMINI_API_KEY nie ustawiony w ${ENV_FILE} – przerwano."
  exit 1
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
export PATH="/usr/local/bin:/usr/bin:${HOME}/.nvm/versions/node/$(ls ${HOME}/.nvm/versions/node 2>/dev/null | tail -1)/bin:${PATH}"

NODE_BIN=$(command -v node 2>/dev/null || true)
if [ -z "${NODE_BIN}" ]; then
  echo "❌ node nie znaleziony w PATH – przerwano."
  exit 1
fi
echo "ℹ node: $(${NODE_BIN} --version)  path: ${NODE_BIN}"

# ── Uruchom generator ─────────────────────────────────────────────────────────
cd "${REPO_DIR}"
"${NODE_BIN}" "${SCRIPT}"
EXIT_CODE=$?

if [ ${EXIT_CODE} -eq 0 ]; then
  echo "✅ Generator zakończony sukcesem"
else
  echo "⚠️  Generator zakończony kodem ${EXIT_CODE}"
fi

echo "▶ $(date '+%Y-%m-%d %H:%M:%S')  faq-cron end"
exit ${EXIT_CODE}
