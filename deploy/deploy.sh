#!/bin/bash
# Ensambla y despliega el ecosistema TAGO a Firebase Hosting (proyecto "tago").
# Todas las apps quedan bajo el MISMO dominio (tago.web.app) para compartir sesión:
#   /            -> Home (app madre)
#   /calculadora -> Calculadora 3D
#   /inventario  -> Control de Inventario
#   /pedidos     -> Seguimiento de Pedidos (en desarrollo, no visible como activa aún)
#
# Uso:  ./deploy.sh        (desde la carpeta deploy/)
#   Requiere haber corrido antes:  firebase login
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# nvm (por si firebase está bajo una versión de node gestionada por nvm)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "→ Ensamblando public/ ..."
rm -rf public
mkdir -p public/calculadora public/inventario public/pedidos

# Home en la raíz
cp -R "../Home/." "public/"
# Calculadora 3D bajo /calculadora
cp -R "../Cotizador 3D/." "public/calculadora/"
# Control de Inventario bajo /inventario (index.html + assets)
cp "../Control de inventario/index.html" "public/inventario/index.html"
cp -R "../Control de inventario/assets" "public/inventario/assets"
# Seguimiento de Pedidos bajo /pedidos
cp -R "../Pedidos/." "public/pedidos/"

echo "→ Desplegando Hosting a Firebase (proyecto tago)..."
firebase deploy --only hosting

echo ""
echo "✓ Listo. Ecosistema en: https://tago-app-489c1.web.app"
echo "  Home:        https://tago-app-489c1.web.app/"
echo "  Calculadora: https://tago-app-489c1.web.app/calculadora"
echo "  Inventario:  https://tago-app-489c1.web.app/inventario"
echo "  Pedidos:     https://tago-app-489c1.web.app/pedidos (en desarrollo, no visible como activa aún)"
