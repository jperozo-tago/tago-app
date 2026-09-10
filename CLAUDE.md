# TAGO — Contexto del proyecto

Este repo contiene el ecosistema de apps internas de TAGO. Está pensado para que
cualquiera (persona o un asistente como Claude Code) pueda seguir trabajando en
el código sin tener que redescubrir cómo está armado todo.

## Qué es esto

TAGO usa 4 apps internas, todas de una sola página HTML (sin build, sin
`npm install`, sin framework) que se editan directamente y se despliegan tal
cual a Firebase Hosting:

| App | Carpeta | URL | Notas |
|---|---|---|---|
| Home (portada del ecosistema) | `Home/` | `/` | enlaza a las demás |
| Cotizador 3D | `Cotizador 3D/` | `/calculadora` | |
| Control de inventario | `Control de inventario/` | — | **proyecto Firebase aparte** (`tago-inventario`), tiene su propio `deploy.sh` dentro de esa carpeta. No se publica junto con las demás. |
| Pedidos (seguimiento de producción) | `Pedidos/` | `/pedidos` | la más activa, ver detalle abajo |

Las 3 primeras (Home, Cotizador 3D, Pedidos) viven en el **mismo** proyecto de
Firebase (`tago-app-489c1`) y se publican juntas con un solo script.

## Cómo desplegar

Requisitos (una sola vez):
```bash
npm install -g firebase-tools
firebase login          # con una cuenta que tenga rol Editor en tago-app-489c1
```

Para publicar cualquier cambio:
```bash
cd deploy
./deploy.sh
```
Esto copia `Home/`, `Cotizador 3D/` y `Pedidos/` dentro de `deploy/public/`
(carpeta generada, no se sube a git) y corre `firebase deploy --only hosting`.

Si tocas `deploy/database.rules.json` (reglas de seguridad de la base de
datos), eso se despliega aparte:
```bash
firebase deploy --only database
```

**Antes de desplegar Pedidos, revisa que no haya errores de sintaxis** — es un
solo archivo gigante y un error ahí tumba toda la app:
```bash
python3 -c "
import re
with open('Pedidos/index.html') as f: c = f.read()
scripts = [m.group(2) for m in re.finditer(r'<script([^>]*)>(.*?)</script>', c, re.DOTALL) if 'src=' not in m.group(1)]
open('/tmp/_check.js','w').write('\n'.join(scripts))
"
node -c /tmp/_check.js && echo OK
```

## Pedidos — lo importante antes de tocarlo

`Pedidos/index.html` es un solo archivo (HTML+CSS+JS inline) de varios miles
de líneas. Todo el estado vive en Firebase **Realtime Database** (no
Firestore).

**Nodos principales de la base de datos:**
- `tago_pedidos` — cada pedido (id tipo `TG-0142`)
- `tago_categorias_custom` — categorías creadas por admins (aparte de las
  fijas "Impresiones"/"Personalizados")
- `tago_chats` / `tago_mensajes` — chat del equipo (grupos y directos)
- `tago_pedido_comentarios` / `tago_pedido_historial` — actividad por pedido
- `tago_notificaciones` — notificaciones por usuario
- `tago_tareas*` — módulo de tareas internas
- `tago_mail_alertas` — correos detectados como pedidos
- `tago_permitidos` — lista de emails autorizados a entrar (control de acceso)
- `tago_admins` — quiénes son admin (para el módulo de Tareas)
- `tago_espacios` / `tago_listas` / `tago_carpetas` / `tago_elementos` —
  espacios de trabajo de la barra lateral (rediseño de septiembre 2026): sus
  listas de tareas, carpetas, y los documentos / paneles / pizarras /
  formularios. Están en `database.rules.json` (lectura para todo el equipo
  autorizado; crear espacios, listas y carpetas solo admins; los elementos
  los edita cualquiera autorizado). Cualquier nodo nuevo que se agregue al
  JS hay que sumarlo ahí también, porque la regla `$other` bloquea todo
  nodo desconocido.
  Campos opcionales nuevos: en `tago_mensajes` `reacciones`, `audio`,
  `audioSeg`; en `tago_tareas` `lista`, `pedidoId`, `origenFormulario`; en
  `tago_listas` `carpeta`. Los audios e imágenes del chat van en base64
  dentro de la base — conviene pasarlos a Storage.

**Permisos:** el login es con Google, y solo entra alguien si su email (con
los puntos reemplazados por `_`) existe en `tago_permitidos`. Los roles de
admin financiero (`ADMINS_FINANCIEROS` en el JS: José, Andreina, Carol) y de
categorías (`esAdminPedidos`) están hardcodeados en el JS — son control
*visual*, no de seguridad real. Lo único con seguridad real a nivel de base
de datos (no se puede saltar desde la consola del navegador) es: eliminar una
categoría personalizada, restringido a `j.perozo@tago.cl` en
`database.rules.json`.

**Estados de un pedido:** Por revisar → Enviado a Producción → Enviado a
Impresión → Listo → Entregado (ver objeto `ST` en el JS). Cambiar de estado
guarda automáticamente fechas hito (`enviadoProdAt`, `impresionAt`,
`listaAt`) la primera vez que se alcanza cada una — esas fechas alimentan las
métricas de tiempo en Estadísticas.

**Categorías:** cada pedido tiene una categoría efectiva
(`categoriaDePedido(j)`) que es `j.categoria` si se asignó manualmente, o si
no, la categoría por defecto según el tipo de producto. Los admins pueden
crear categorías nuevas; **solo José puede eliminarlas** (reforzado en las
reglas de la base de datos, no solo en el JS).

**Alertas:** atrasado / vence hoy / sin boleta-factura / estancado (+2 días
en "Por revisar" sin moverse). Un pedido "Listo" con entrega "Retiro" nunca
cuenta como atrasado (se asume que la producción ya está lista y solo falta
que el cliente pase a buscarlo); si la entrega es despacho (OTS/Bluexpress/
Chilexpress) sí sigue contando como atrasado hasta que se marque Entregado.

**Vistas de Pedidos:** Lista (agrupada por categoría/estado, columnas
ordenables y ajustables, edición en la celda), Tablero (kanban con 5
columnas), Calendario (por fecha de entrega) y Carga (por persona). Cada
vista recuerda sus filtros en `localStorage` (`tago_vistas_config`). El
pedido se abre en una ficha lateral (`abrirFicha`) que reemplaza al modal
de edición; el estado solo avanza, nunca retrocede. El arrastrar-y-soltar del Tablero usa el API nativo
de HTML5 (`draggable`), que **no funciona con el dedo en celular** — en
móvil solo sirve para tocar y abrir el pedido; para cambiar de estado ahí
toca usar la Tabla.

**PWA (instalable en el celular):** `Pedidos/manifest.json`,
`Pedidos/sw.js` y los `icon-*.png` permiten "Agregar a inicio" en iOS/
Android. Limitación conocida de iOS: el login con Google **no funciona**
dentro de la app ya instalada en pantalla de inicio (Safari aísla el
almacenamiento del popup de login) — por eso el login screen detecta
`navigator.standalone` y le pide al usuario que inicie sesión primero en
Safari normal; una vez logueado ahí, la app instalada reconoce la sesión
sola.

**Móvil:** por debajo de 900px de ancho, la barra lateral deja de mostrarse
fija y se convierte en un panel deslizable (☰ arriba a la izquierda). Por
debajo de 700px cada pedido de la Lista se muestra como tarjeta
(`grid-template-areas` sobre las 10 celdas de `.table-row`).

## Convenciones al trabajar en este código

- No hay proceso de build. Se edita `index.html` directamente y se recarga.
- Nunca se elimina ni se migra data existente sin que lo pida explícitamente
  José — todo cambio de esquema de datos debe leer también el formato viejo
  (fallbacks), para no romper pedidos ya creados.
- Antes de cualquier `firebase deploy`, correr el chequeo de sintaxis de
  arriba.
- La sesión de `firebase login` expira cada cierto tiempo — si el deploy
  falla con un error de credenciales, correr `firebase login --reauth`.
- Probar lógica nueva desde la consola del navegador llamando directo a las
  funciones (ej. `window.alertaPred(...)`) es más seguro que probar contra
  pedidos reales.
