# TAGO App

Ecosistema de apps internas de TAGO, todas bajo el mismo proyecto de Firebase Hosting.

## Estructura

- `Home/` — página de inicio del ecosistema (`/`)
- `Cotizador 3D/` — calculadora (`/calculadora`)
- `Control de inventario/` — control de inventario (`/inventario`)
- `Pedidos/` — seguimiento de pedidos (`/pedidos`)
- `deploy/` — script y configuración para publicar todo a Firebase Hosting

## Desplegar

Requiere tener `firebase-tools` instalado y haber corrido `firebase login` con una cuenta que tenga acceso al proyecto `tago-app-489c1`.

```bash
cd deploy
./deploy.sh
```

Esto empaqueta las 4 apps en `deploy/public/` y las publica en `https://tago-app-489c1.web.app`.
