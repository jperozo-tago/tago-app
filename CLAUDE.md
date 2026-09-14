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
  tareas cuyo estado no es de su espacio caen en «Sin estado». Un estado con
  `lista` (y `espacio`) es propio de esa lista (`estadosPropiosLista`,
  `estadosDeLista`, `estadosParaTarea`): la lista lo usa en vez de los del
  espacio. Vistas de tareas: Lista (tabla), Tablero (columnas por estado,
  arrastrar cambia el estado) y Calendario (por fecha límite), recordadas en
  `tago_tareas_vista`; fila «Calcular» por columna al pie de cada grupo
  (`tago_listas/<id>/campos/calculos` si lo guarda un admin, si no local). La vista personal
  es «Mis tareas» (bajo Bandeja, `tareaFiltro.tipo==="mias"`: solo las
  asignadas a quien mira, con columna «Lista»); ya no existe el espacio fijo
  «Tareas» ni «Todas las tareas». En Mis tareas siempre están los grupos
  generales con «+ Agregar tarea» en línea (la tarea nace sin lista y asignada a
  uno mismo); una tarea necesita lista o alguien asignado, si no no tendría
  dónde verse. La columna «Estado» va por defecto en toda lista, después de
  Nombre, y se cambia desde la celda.
- `tago_mail_alertas` — correos detectados como pedidos
- `tago_permitidos` — lista de emails autorizados a entrar (control de acceso)
- `tago_admins` — quiénes son admin (para el módulo de Tareas)
- Privacidad por espacio (septiembre 2026): `tago_espacios/<id>/miembros =
  {<emailKey>: true}` hace privado el espacio (solo esas personas; los admins
  siempre). Sin `miembros`, lo ve todo el equipo. Las reglas de listas,
  carpetas, elementos y tareas exigen a los no-admins leer por consulta
  (`orderByChild('espacio')` / `orderByChild('lista')`) y comprueban la
  membresía del espacio; en la app, `espacioVisible`, `syncEspaciosDatos`
  (una consulta por espacio y colección) y el modal «Quién puede ver». Crear
  espacios: solo admins; dentro de un espacio, quien lo ve crea listas,
  carpetas y elementos; eliminar (listas, carpetas, elementos, tareas,
  páginas): solo admins (interfaz y reglas: los no-admins nunca escriben
  `null`). Al crear una tarea, `creadoPorEmail` debe ser el propio correo, y
  cambiarla de lista exige acceso a la lista destino. `deploy.sh` anota
  `tago_meta/versionPedidos` al publicar y la app muestra «Hay una versión
  nueva, recarga» en las pestañas abiertas.
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
- Subtareas, ficha de tarea y actividad (14-sep-2026, referencia ClickUp).
  Una subtarea es una tarea con `padre:<tareaId>` en `tago_tareas`: hereda
  la lista de la madre (así la ven los que ven la lista), nace en el primer
  estado y no copia `campos` (la Ruta y el Tablero identifican las tareas de
  clientes por `campos.rut`, una subtarea no debe parecer un cliente). En la
  tabla las hijas van anidadas bajo la madre, en el grupo de la madre aunque
  tengan otro estado (`ttArbolGrupo`/`ttAplanar`, caret en
  `localStorage` `tago_tareas_sub_plegadas`, contador hechas/total, «+» al
  pasar por la fila → `ttSubAgregar`/`ttCrear(estId,nombre,padreId)`); una
  hija cuya madre no se ve en la vista se pinta arriba con «↳ madre». Un
  solo nivel (las hijas no tienen «+»). Borrar una madre (admins) borra
  hijas, historial y comentarios en el mismo update. Las tareas existentes
  se abren en la ficha lateral `#ficha-tarea` (`abrirTarea`/`renderTarea`;
  `openTareaModal(id)` redirige ahí; el modal queda solo para crear, con
  `padreId` como cuarto parámetro cuando la lista exige campos): todo se
  guarda al cambiar cada campo (`tareaCampo` nombre/notas,
  `tareaGuardarCampo`, `tareaGuardarAsignados`, `cpGuardarValor`,
  `tareaCambiarLista` que mueve también a las hijas). La «Descripción» es la
  clave `notas` de siempre. Actividad: `tago_tareas_historial/<id>/<push>`
  ({autor, ts, campo, valorAnterior, valorNuevo} | {tipo:"creacion"} |
  {tipo:"texto", texto}) y `tago_tareas_comentarios/<id>/<push>` (igual que
  los de pedidos, con @menciones e imagen). Las funciones de actividad de
  pedidos son las mismas: `actNodo(id,tipo)` decide el nodo por el id
  (`esTareaId`), y `tareaLogDesdeUpdates(id, anterior, updates)` reconstruye
  la tarea tras cada `update()` y anota las diferencias (`TAREA_TRACK`,
  asignados y campos personalizados) — hay que llamarla en todo camino
  nuevo de escritura. Reglas: leer y crear entradas solo quien puede ver la
  tarea (admin, creador, asignado o miembro/espacio abierto de su lista);
  nadie edita ni borra entradas salvo admins. Las menciones y asignaciones
  de tareas llegan a `tago_notificaciones` con `tareaId` + `nombre` y la
  Bandeja abre la tarea (`irATarea`).
- Cierre en Shopify (14-sep-2026): al pasar un pedido a **Entregado**, si
  «# Pedido» trae un número de Shopify (`numeroShopify`: 4 a 6 dígitos sueltos,
  «#8584»), `moverEstado`/`crearDesdeFicha` escriben
  `tago_pedidos/<id>/shopify = {pendiente:true, numero, solicitadoAt/By}`.
  Quien cierra es el robot del tablero (`tago-tablero/pipeline/shopify_cerrar.py`,
  al final de cada corrida): marca enviado (fulfillment sin avisar al cliente) y
  archiva (orderClose), y deja `shopify = {cerradoAt, orderId, name, …}` o
  `{error, intentadoAt}` (sin permisos: el error y `pendiente` sigue en true).
  La ficha muestra la fila «Shopify» (`fichaShopifyHtml`) con «Reintentar» /
  «Cerrar en Shopify» (`pedirCierreShopify`); la tabla, un ícono junto al
  estado. La app nunca habla con Shopify: no hay clave en el navegador.
- `tago_packs` — packs DTF: metros comprados por adelantado (septiembre
  2026, reemplaza la planilla «Control packs»). Cada pack es
  `{cliente, tipo:"textil"|"uv"|"fluor", metros, codigo, documento (n° boleta o
  factura), fechaCompra, vence, precio, notas, cerrado?, alias{<nombre
  normalizado>:true}, consumos{<cid>:{fecha, metros, nota, quien, ts}},
  createdAt/By, updatedAt/By}`; los 45 de la planilla llevan
  `origen:"planilla"`. La vigencia se calcula sola al crear o al cambiar
  fecha/metros: 3 meses, 4 si el pack es de 100 m o más (`packVence`), y se
  puede corregir a mano. **El saldo no se guarda**: se calcula al vuelo
  (`packResumen`) como metros − consumos a mano − cantidad de los pedidos
  con `packId` (solo si su unidad es metros), así nunca se desfasa aunque el
  pedido se edite o se borre. Un pedido guarda `packId`; en su ficha, si el
  producto va en metros (cada DTF con su propio pack: Textil → textil, UV →
  uv, Flúor → fluor), la fila «Pack DTF» es una casilla «¿Tiene pack?»
  (Andreina no quiso desplegable ni preselección automática): al marcarla,
  la app busca el nombre del cliente entre los packs vigentes del tipo
  (`packSimilitud`: sin tildes ni puntuación, sin SpA/Ltda…, palabras y
  pares de letras; parecido ≥ 0,5) y pregunta uno por uno «¿Es este?» con
  Sí / No; si no hay parecidos o dicen que no a todos, ofrece elegirlo de la
  lista de vigentes (`fichaPackHtml`, `fichaPackToggle`,
  `fichaPackResponder`; estado en `fichaPackBuscando` /
  `fichaPackRechazados`). Al enlazar con un nombre distinto el pack aprende
  el `alias`. Cambiar el producto a uno en unidades o a otro tipo de DTF
  desenlaza el pack (`packAjustarEnlace`). Estados derivados: activo, por vencer (≤ 15 días),
  agotado (saldo ≤ 0, con sobregiro en rojo), vencido, cerrado (a mano).
  Vista «Packs DTF» bajo Pedidos en la barra (`renderPacks`) y ficha propia
  `#ficha-pack` (`abrirPack`/`renderPack`, movimientos y «Registrar
  consumo»). Reglas: leen y escriben todos los permitidos; borrar un pack
  (`newData` nulo) solo admins; borrar consumos se limita en el JS a admins.

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
de edición. El estado se cambia desde el desplegable de la ficha, la pastilla
de la tabla (menú) o el botón «→ siguiente», y **también puede retroceder**
(desde el 14-sep-2026): al volver atrás, `moverEstado` borra los hitos de las
etapas que se dejan (`enviadoProdAt`, `impresionAt`, `listaAt`) para que las
estadísticas no las cuenten, y si se sale de Entregado con el cierre en
Shopify aún pendiente quita esa marca. El arrastrar-y-soltar del Tablero usa el API nativo
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
