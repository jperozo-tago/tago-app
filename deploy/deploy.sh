#!/bin/bash
# Ensambla y despliega el ecosistema TAGO a Firebase Hosting (proyecto "tago").
# Todas las apps quedan bajo el MISMO dominio (tago.web.app) para compartir sesión:
#   /            -> Home (app madre)
#   /calculadora -> Calculadora 3D
#   /inventario  -> Control de Inventario
#   /pedidos     -> Seguimiento de Pedidos (en desarrollo, no visible como activa aún)
#   /tablero     -> Tablero de negocio (lee sus datos de tago_tablero en Realtime Database)
#
# Uso (desde la carpeta deploy/):
#   ./deploy.sh                     arma public/ y publica Hosting en producción
#   ./deploy.sh --preview [nombre]  arma public/ igual, pero lo sube a un canal de vista
#                                   previa (URL temporal que expira en 7 días; el nombre
#                                   por defecto es "tablero"). No toca el sitio en vivo.
#   ./deploy.sh --solo-reglas       publica solo database.rules.json (no arma ni sube Hosting)
#   Requiere haber corrido antes:  firebase login
set -e

# ── qué se pidió ──────────────────────────────────────────────────────────
MODO="produccion"
CANAL="tablero"
case "${1:-}" in
  "") ;;
  --preview)
    MODO="preview"
    if [ -n "${2:-}" ]; then CANAL="$2"; fi
    ;;
  --solo-reglas) MODO="reglas" ;;
  *)
    echo "Uso: ./deploy.sh [--preview [nombre] | --solo-reglas]" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# nvm (por si firebase está bajo una versión de node gestionada por nvm)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# ── solo reglas: no hace falta armar public/ ──────────────────────────────
if [ "$MODO" = "reglas" ]; then
  echo "→ Publicando reglas de Realtime Database (database.rules.json)..."
  firebase deploy --only database
  echo ""
  echo "✓ Reglas publicadas en tago-app-489c1."
  exit 0
fi

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
# Tablero de negocio bajo /tablero. La carpeta vive en la rama `tablero`, así que en un
# checkout sin ella el deploy de las demás apps tiene que seguir funcionando igual.
# Se publica SOLO index.html: cualquier otro archivo que quede en Tablero/ (un .json de
# datos, por ejemplo) saldría público sin login, y los datos del tablero viven en la base.
CON_TABLERO="no"
if [ -d "../Tablero" ]; then
  CON_TABLERO="si"
  mkdir -p public/tablero
  cp "../Tablero/index.html" "public/tablero/index.html"
  OTROS="$(find ../Tablero -mindepth 1 -maxdepth 1 ! -name index.html ! -name '.*' | wc -l | tr -d ' ')"
  if [ "$OTROS" != "0" ]; then
    echo "  Aviso: en Tablero/ hay $OTROS archivo(s) además de index.html; solo se publica index.html."
  fi
else
  echo "  (sin Tablero/ en este checkout: se publica sin /tablero)"
fi

# ── vista previa: canal temporal, el sitio en vivo no cambia ──────────────
if [ "$MODO" = "preview" ]; then
  echo "→ Subiendo public/ al canal de vista previa \"$CANAL\" (expira en 7 días)..."
  firebase hosting:channel:deploy "$CANAL" --expires 7d
  echo ""
  echo "✓ Vista previa lista (la URL la imprime firebase arriba). Producción no se tocó."
  echo "  Ojo: el login con Google solo funciona en dominios autorizados. Para probar el"
  echo "  login en el canal hay que agregar su dominio una vez en Firebase → Authentication"
  echo "  → Settings → Authorized domains; la URL se mantiene mientras exista el canal."
  exit 0
fi

echo "→ Desplegando Hosting a Firebase (proyecto tago)..."
firebase deploy --only hosting

echo ""
echo "✓ Listo. Ecosistema en: https://tago-app-489c1.web.app"
echo "  Home:        https://tago-app-489c1.web.app/"
echo "  Calculadora: https://tago-app-489c1.web.app/calculadora"
echo "  Inventario:  https://tago-app-489c1.web.app/inventario"
echo "  Pedidos:     https://tago-app-489c1.web.app/pedidos (en desarrollo, no visible como activa aún)"
if [ "$CON_TABLERO" = "si" ]; then
  echo "  Tablero:     https://tago-app-489c1.web.app/tablero"
fi
