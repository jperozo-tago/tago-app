# TAGO — Contexto del proyecto

Este repo contiene el ecosistema de apps internas de TAGO. Está pensado para que
cualquiera (persona o un asistente como Claude Code) pueda seguir trabajando en
el código sin tener que redescubrir cómo está armado todo.

## Qué es esto

TAGO usa 5 apps internas, todas de una sola página HTML (sin build, sin
`npm install`, sin framework) que se editan directamente y se despliegan tal
cual a Firebase Hosting:

| App | Carpeta | URL | Notas |
|---|---|---|---|
| Home (portada del ecosistema) | `Home/` | `/` | enlaza a las demás |
| Cotizador 3D | `Cotizador 3D/` | `/calculadora` | |
| Control de inventario | `Control de inventario/` | — | **proyecto Firebase aparte** (`tago-inventario`), tiene su propio `deploy.sh` dentro de esa carpeta. No se publica junto con las demás. |
| Pedidos (seguimiento de producción) | `Pedidos/` | `/pedidos` | la más activa, ver detalle abajo |
| Tablero (ventas y marketing) | `Tablero/` | `/tablero` | vive en la rama `tablero`; sin datos incrustados, lee todo de Realtime Database, ver detalle abajo |

Home, Cotizador 3D, Pedidos y Tablero viven en el **mismo** proyecto de
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
Esto copia `Home/`, `Cotizador 3D/`, `Pedidos/` y, si está en el checkout, el
`index.html` de `Tablero/` dentro de `deploy/public/` (carpeta generada, no se
sube a git) y corre `firebase deploy --only hosting`. `./deploy.sh --preview`
sube lo mismo a un canal de vista previa y `./deploy.sh --solo-reglas` publica
solo `database.rules.json`.

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
- `tago_tareas*` — módulo de tareas internas. `tago_tareas_estados/<id>` puede
  llevar `espacio`: es un estado propio de ese espacio (como en ClickUp); los
  estados sin `espacio` son los generales y NO deben tocarse (la app Ruta los
  usa: menor `orden` = por hacer, mayor = listo). Cada vista agrupa por los
  estados del espacio que se mira (`estadosDe`, `estadosDelContexto`); las
  tareas cuyo estado no es de su espacio caen en «Sin estado». La vista personal
  es «Mis tareas» (bajo Bandeja, `tareaFiltro.tipo==="mias"`: solo las
  asignadas a quien mira, con columna «Lista»); ya no existe el espacio fijo
  «Tareas» ni «Todas las tareas».
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
  `tago_listas` `carpeta`; en `tago_elementos` tipo documento, `paginas/<pid>
  = {titulo, contenido, orden, createdAt, createdBy, updatedAt, updatedBy}`
  (documentos con varias páginas, como los Docs de ClickUp; un documento sin
  `paginas` sigue leyendo y escribiendo `contenido`, y al agregarle una página
  ese contenido pasa a ser la primera sin borrar `contenido`). Los audios e
  imágenes del chat van en base64 dentro de la base — conviene pasarlos a
  Storage.
- `tago_campos` — campos personalizados de las listas de tareas (septiembre
  2026, referencia: panel «Campos» de ClickUp). Cada campo es
  `{espacio, etiqueta, tipo, opciones, archivado, creadoPor, createdAt}` y
  vale para todas las listas de su espacio; nunca se borra, se marca
  `archivado`. Cada lista dice qué muestra en `tago_listas/<id>/campos =
  {integrados:{prioridad,fechaLimite,fechaInicio,asignados,pedido,notas,
  creado,creador,actualizado,id}, personalizados:{<cid>:{orden,requerido}}}`
  (sin ese nodo la lista se ve como siempre) y cada tarea guarda sus valores
  en `tago_tareas/<id>/campos/<cid>` (más `fechaInicio` opcional); los
  valores se escriben clave por clave, nunca se reemplaza el objeto entero.
  Solo admins configuran (regla de `tago_campos` y de `tago_listas`); el
  equipo rellena los valores de sus tareas. En el JS: `CP_TIPOS`,
  `CP_PROPIEDADES`, `cpConfig(listaId)`, panel `abrirCampos`. La vista de
  Tareas es una tabla por estado (`renderTareas`/`renderTareaRow`, funciones
  `tt*`): una columna por propiedad y por campo, celdas editables con el
  popover `celdaPop`, «+ Agregar tarea» al pie crea con solo el nombre (si la
  lista tiene campos obligatorios, abre el modal), los grupos se pliegan
  (`localStorage` `tago_tareas_plegados`), las columnas se ensanchan
  arrastrando el borde del encabezado (`tago_tareas_anchos`, por lista) y se
  reordenan arrastrando el título: un admin dentro de una lista lo guarda en
  `tago_listas/<id>/campos/columnas` (para todos); si no, en `localStorage`
  `tago_tareas_orden`.

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

## Tablero — el tablero de negocio

`Tablero/index.html` es el tablero de ventas y marketing de TAGO (facturación
de relBase, publicidad de Meta, tienda web Shopify, chats de WhatsApp). Se
publica en `/tablero` con el mismo login de Google del ecosistema y **no lleva
ningún dato incrustado**: todo lo lee de Realtime Database, del nodo
`tago_tablero` — `paquete` (el JSON comprimido con toda la historia), `hoy` (la
venta del día), `estado` (cómo va la última actualización), `metas` / `fijos`
(lo único que escribe la página) y `config/github` (solo admins; sirve para
lanzar la actualización).

Quien escribe esos nodos **no es este repo**: es un pipeline en Python que vive
en `aalizo14/tago-tablero` y corre en GitHub Actions (a demanda desde el botón
"Actualizar" del tablero), entrando a la base con una cuenta de servicio. Aquí
solo están la página y las reglas: los nodos de `tago_tablero` y quién puede
leer o escribir cada uno están en `deploy/database.rules.json`
(`tago_tablero/permitidos` y `tago_tablero/admins` son las listas de acceso y
se editan únicamente desde la consola de Firebase). `./deploy.sh --preview`
sube el sitio a un canal de vista previa y `./deploy.sh --solo-reglas` publica
solo las reglas.

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
