#!/bin/bash
# Redespliega la app TAGO - Control de Inventario a Firebase Hosting.
# Uso: ./deploy.sh   (ejecutar desde dentro de la carpeta "Control de inventario")
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "Copiando archivos actualizados a public/..."
mkdir -p public
cp index.html public/index.html
rm -rf public/assets
cp -R assets public/assets

echo "Desplegando a Firebase Hosting..."
firebase deploy --only hosting

echo "Listo. https://tago-inventario.web.app"
