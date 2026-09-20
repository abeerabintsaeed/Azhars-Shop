#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed yet. Opening the download page."
  echo "  Install the LTS version, then run this file again."
  (open https://nodejs.org || xdg-open https://nodejs.org) 2>/dev/null
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi
node check.js || { read -n 1 -s -r -p "Press any key to close..."; exit 1; }
[ -d node_modules ] || { echo "Setting things up for the first time..."; npm install --omit=dev; }
( sleep 3; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1 ) &
node --no-warnings server.js
