#!/bin/zsh
# Double-click this file in Finder to open the local scan workspace.
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22.13 or later from https://nodejs.org, then open this file again."
  read "?Press Enter to close…"
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci --include=dev || { read "?Setup failed. Press Enter to close…"; exit 1; }
fi
npm run browser:install && npm start
read "?Press Enter to close…"
