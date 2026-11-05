// Receptor de webhooks de Shopify para TAGO (19-10-2026).
//
// Shopify exige un «200» en menos de 5 s. El reloj de Apps Script («Reloj del tablero TAGO»)
// responde con una redirección (302) y Shopify la toma por fallo: reintenta hasta 19 veces en
// 48 h (el pedido #8843 llegó cuatro veces en tres minutos) y al final borra el webhook.
// Esta función verifica la firma HMAC de Shopify, reenvía el aviso al reloj —que es quien lanza
// la corrida liviana shopify.yml en GitHub— y contesta 200 al momento.
//
// Secretos (firebase functions:secrets:set):
//   SHOPIFY_WEBHOOK_SECRET  «Tus webhooks se firmarán con …» (Shopify → Configuración →
//                           Notificaciones → Webhooks)
//   RELOJ_URL               URL /exec del Apps Script con ?clave=<CLAVE_WEBHOOK>
// URL de la función (va en los tres webhooks de Shopify: orders/paid, orders/cancelled,
// refunds/create): https://shopifywebhook-prukg2gqfq-uc.a.run.app (Cloud Run, 2.ª generación).
// Primer despliegue (19-10-2026): hubo que dar a 919374961221-compute@developer.gserviceaccount.com
// el rol «Cuenta de servicio de Cloud Build» y, en Cloud Run → Seguridad, «Permitir el acceso
// público»; ninguna de las dos cosas la hace el CLI en este proyecto (política de la organización).
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("node:crypto");

const SECRETO_SHOPIFY = defineSecret("SHOPIFY_WEBHOOK_SECRET");
const RELOJ_URL = defineSecret("RELOJ_URL");
const TEMAS = { "orders/paid": "pedido", "orders/cancelled": "cancelado", "refunds/create": "reembolso" };

exports.shopifyWebhook = onRequest(
  { region: "us-central1", secrets: [SECRETO_SHOPIFY, RELOJ_URL], timeoutSeconds: 10, memory: "256MiB", maxInstances: 3 },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("solo POST");
    const cuerpo = req.rawBody || Buffer.alloc(0);
    const firma = String(req.get("X-Shopify-Hmac-Sha256") || "");
    const esperada = crypto.createHmac("sha256", SECRETO_SHOPIFY.value()).update(cuerpo).digest("base64");
    const ok = firma.length === esperada.length && crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
    if (!ok) { console.warn("firma inválida", { tema: req.get("X-Shopify-Topic") }); return res.status(401).send("firma inválida"); }

    const tema = TEMAS[String(req.get("X-Shopify-Topic") || "")] || "pedido";
    let nombre = "";
    try {
      const c = JSON.parse(cuerpo.toString("utf8"));
      nombre = String(c.name || c.order_id || "");
      if (c.source_name && c.source_name !== "web") {           // caja (POS): no va a Pedidos
        console.log("ignorado, no es de la tienda web", c.source_name, nombre);
        return res.status(200).send("ok, no es de la tienda web");
      }
    } catch (e) { /* sin cuerpo JSON: igual se avisa */ }

    // Reenvío al reloj siguiendo su redirección. Si no contesta en 4 s se responde 200 de todas
    // formas: el reloj de cada 30 min cubre lo que se pierda.
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(RELOJ_URL.value() + "&tema=" + tema,
        { method: "POST", headers: { "Content-Type": "text/plain" }, body: cuerpo, redirect: "follow", signal: ctrl.signal });
      console.log("reloj respondió", r.status, tema, nombre);
    } catch (e) {
      console.error("no se pudo avisar al reloj", e.message, tema, nombre);
    } finally { clearTimeout(t); }
    res.status(200).send("ok");
  });

// Revisión de archivos para el bot de ventas de Vambe (29-10-2026): el bot manda el enlace del
// archivo que recibió y la medida que pide el cliente, y recibe si sirve para imprimir en DTF.
// Detalle de qué se mide en revisar.js. Vambe la llama como función «Webhook» del asistente TAGO
// con la cabecera X-Clave fija.
// Secreto: REVISAR_CLAVE (copia en Data TAGO/informe/.revisar_archivo_clave).
// Si el archivo tiene sombras o difuminados, la respuesta trae además vista_marcada: un enlace a
// GET /vista que devuelve el diseño con esas zonas en magenta, para mandárselo al cliente. El enlace
// va firmado con la misma clave, así que solo abre archivos que pasaron por esta revisión.
const REVISAR_CLAVE = defineSecret("REVISAR_CLAVE");
// ./revisar carga sharp (libvips, decenas de MB). Se carga solo cuando revisarArchivo lo usa: todas las funciones
// comparten este archivo, y cargarlo arriba hacía que chatPublicar y shopifyWebhook pasaran los 128 MiB al
// arrancar y Cloud Run las matara (04-11-2026: el chat del robot y los webhooks de Shopify respondían 500/503).
let modRevisar = null;
const rev = () => (modRevisar ??= require("./revisar"));
// Estado de un pedido para el mismo bot (05-11-2026): POST /estado-pedido con {"numero": "#8584" o "TG-0142", "telefono": <macro de Vambe>} y la misma
// X-Clave. Detalle en estado.js; no devuelve datos personales. tago_pedidos se lee entero (no tiene índice) y se
// guarda un minuto en memoria para no bajarlo en cada pregunta.
let modEstado = null;
const est = () => (modEstado ??= require("./estado"));
let cachePedidos = { ts: 0, val: null };
const pedidosEnCache = async (db) => {
  if (cachePedidos.val && Date.now() - cachePedidos.ts < 60 * 1000) return cachePedidos.val;
  const val = (await leerConPlazo(db.ref("tago_pedidos"), 15000)).val() || {};
  cachePedidos = { ts: Date.now(), val };
  return val;
};
const numero = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return n > 0 ? n : 0; };
const VAMBE = "https://vambe-bkt.s3.us-east-1.amazonaws.com/";
const firmar = (ruta) => crypto.createHmac("sha256", REVISAR_CLAVE.value()).update(ruta).digest("hex").slice(0, 20);

exports.revisarArchivo = onRequest(
  { region: "us-central1", secrets: [REVISAR_CLAVE], timeoutSeconds: 120, memory: "1GiB", concurrency: 1, maxInstances: 3 },
  async (req, res) => {
    if (req.method === "GET" && req.path === "/vista") {
      const ruta = String(req.query.a || ""), f = String(req.query.f || "");
      const esperada = ruta ? firmar(ruta) : "";
      if (!ruta || f.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada))) {
        return res.status(403).send("enlace inválido");
      }
      try {
        const img = await rev().vistaMarcada(await rev().descargar(VAMBE + ruta));
        return res.set("Content-Type", "image/jpeg").set("Cache-Control", "private, max-age=86400").send(img);
      } catch (e) {
        console.warn("no se pudo generar la vista", e.message, ruta.slice(-60));
        return res.status(404).send("no se pudo generar la vista del archivo");
      }
    }
    if (req.method !== "POST") return res.status(405).send("solo POST");
    const clave = String(req.get("X-Clave") || "");
    const esperada = REVISAR_CLAVE.value();
    if (clave.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(clave), Buffer.from(esperada))) {
      return res.status(401).json({ error: "clave inválida" });
    }
    if (req.path === "/estado-pedido") {
      try {
        const r = est().estadoDePedido(await pedidosEnCache(admin.database()), req.body || {});
        console.log("estado de pedido", { numero: r.numero || null, por: r.buscado_por || "numero", encontrado: r.encontrado, partes: (r.partes || []).length });
        return res.status(200).json(r);
      } catch (e) {
        console.error("no se pudo consultar el estado del pedido", e.message);
        return res.status(503).json({ encontrado: false, motivo: "error", mensaje: "No se pudo consultar el estado en este momento. Pasa el caso a una ejecutiva." });
      }
    }
    const c = req.body || {};
    // El asistente a veces copia el enlace con el «[url: …]» de Vambe alrededor: se toma solo el enlace.
    // Si el cliente mandó varios archivos, url trae todos los enlaces en el orden en que llegaron y
    // se revisan en una sola llamada: con una llamada por archivo el bot cruzaba los resultados
    // (pruebas del 29-10-2026), aun con archivo_revisado en cada respuesta.
    const urls = [...new Set(String(c.url || "").match(/https:\/\/[^\s\]\)"'<>,]+/g) || [""])].slice(0, 5);
    const ancho = numero(c.ancho_cm), alto = numero(c.alto_cm);
    const uno = async (url) => {
      try {
        const r = { archivo_revisado: url, ...(await rev().revisar(url, ancho, alto)) };
        if (r.zonas_semitransparentes && url.startsWith(VAMBE)) {
          const ruta = url.slice(VAMBE.length);
          r.vista_marcada = `https://${req.get("host")}/vista?a=${ruta.split("/").map(encodeURIComponent).join("/")}&f=${firmar(ruta)}`;
        }
        console.log("revisado", { url: url.slice(-60), ancho, alto, sirve: r.sirve, problemas: (r.problemas || []).length });
        return r;
      } catch (e) {
        console.warn("no se pudo revisar", e.message, url.slice(-60));
        return { archivo_revisado: url, se_pudo_revisar: false, motivo: `No se pudo revisar el archivo: ${e.message}. Pide al cliente que lo vuelva a enviar como documento.` };
      }
    };
    if (urls.length === 1) return res.status(200).json(await uno(urls[0]));
    const resultados = [];
    for (const [i, url] of urls.entries()) resultados.push({ archivo_numero: i + 1, ...(await uno(url)) });
    res.status(200).json({ cantidad_de_archivos: urls.length, resultados });
  });

// Entrada para robots al chat de Pedidos (03-11-2026). Un robot de afuera (el de prioridades que
// Andreina arma en Grok: cada 2 h lee Vambe y ventas@tago.cl y escribe a quién responder primero)
// deja su informe como un mensaje más en UN grupo del chat de Pedidos; la app lo muestra con avatar
// de robot y avisa a los integrantes como con cualquier mensaje. Solo agrega mensajes: no lee, no
// borra, no edita.
//   POST https://chatpublicar-prukg2gqfq-uc.a.run.app   cabecera X-Clave: <clave>   cuerpo {"texto": "…"}
//   GET  https://chatpublicar-prukg2gqfq-uc.a.run.app/leer?desde=2026-11-03   misma cabecera   (lee el grupo)
//   (la clave también se acepta como «Authorization: Bearer <clave>» o dentro del JSON, en "clave")
// La configuración vive en la base, en tago_meta/robotChat (no hace falta redesplegar para cambiarla):
//   clave   la que manda el robot (copia en Data TAGO/informe/.chat_robot_clave)
//   chat    id del grupo de tago_chats donde escribe (lo crea Andreina en la app)
//   nombre  cómo se firma (por defecto «Robot de prioridades»)
//   ultimo  lo anota la función: dos mensajes con menos de un minuto entre sí se rechazan (frena bucles)
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const ROBOT_TOPE = 6000;         // caracteres por mensaje; lo que sobra se corta con «…»
const ROBOT_PAUSA = 60 * 1000;   // mínimo entre mensajes del robot
const ROBOT_ID = "ROBOT";        // Pedidos pinta este autor con el avatar 🤖

const claveOk = (dada, esperada) => {
  dada = String(dada || ""); esperada = String(esperada || "");
  return esperada.length > 0 && dada.length === esperada.length && crypto.timingSafeEqual(Buffer.from(dada), Buffer.from(esperada));
};
const claveDe = (req) => {
  const cab = String(req.get("X-Clave") || "");
  if (cab) return cab;
  const aut = String(req.get("Authorization") || "");
  if (/^Bearer\s+/i.test(aut)) return aut.replace(/^Bearer\s+/i, "").trim();
  return typeof req.body === "object" && req.body ? String(req.body.clave || "") : "";
};
// El cuerpo puede venir como JSON ({texto}, o mensaje/text/message si el robot se equivoca de
// nombre), como texto plano, o como texto plano que en realidad es un JSON.
const textoDe = (cuerpo) => {
  if (typeof cuerpo === "string") {
    const s = cuerpo.trim();
    if (s.startsWith("{")) { try { return textoDe(JSON.parse(s)); } catch (e) { /* era texto con llaves */ } }
    return s;
  }
  if (cuerpo && typeof cuerpo === "object") return String(cuerpo.texto ?? cuerpo.mensaje ?? cuerpo.text ?? cuerpo.message ?? "");
  return "";
};

// Si el service account de la función no tiene permiso sobre la base, el SDK se queda reintentando en
// silencio y la llamada muere por tiempo (pasó el 03-11-2026: faltaba el rol «Firebase Realtime Database
// Admin» a 919374961221-compute@developer.gserviceaccount.com). Mejor un error claro a los 8 s.
const leerConPlazo = (ref, ms = 8000) => Promise.race([
  ref.once("value"),
  new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("la base no respondió en " + ms / 1000 + " s: revisar que el service account de la función tenga el rol Firebase Realtime Database Admin")), ms).unref?.()),
]);
async function publicarComoRobot(db, cuerpo, clave, ahora = Date.now()) {
  const cfg = (await leerConPlazo(db.ref("tago_meta/robotChat"))).val() || {};
  if (!cfg.clave || !cfg.chat) return { status: 503, body: { error: "falta configurar tago_meta/robotChat (clave y chat)" } };
  if (!claveOk(clave, cfg.clave)) return { status: 401, body: { error: "clave inválida" } };
  let texto = textoDe(cuerpo).replace(/\r\n/g, "\n").trim();
  if (!texto) return { status: 400, body: { error: "falta el texto: manda un JSON {\"texto\": \"…\"}" } };
  if (texto.length > ROBOT_TOPE) texto = texto.slice(0, ROBOT_TOPE - 1) + "…";
  const chat = (await leerConPlazo(db.ref("tago_chats/" + cfg.chat))).val();
  if (!chat || chat.tipo !== "grupal") return { status: 404, body: { error: "el grupo configurado en tago_meta/robotChat/chat no existe" } };
  if (cfg.ultimo && ahora - cfg.ultimo < ROBOT_PAUSA) return { status: 429, body: { error: "espera un minuto entre mensajes" } };
  const nombre = String(cfg.nombre || "Robot de prioridades");
  const ref = db.ref("tago_mensajes/" + cfg.chat).push();
  await ref.set({ autor: { id: ROBOT_ID, nombre }, texto, ts: ahora });
  await db.ref().update({
    ["tago_chats/" + cfg.chat + "/ultimoMensaje"]: { texto: texto.slice(0, 200), autorNombre: nombre, autorId: ROBOT_ID, ts: ahora },
    "tago_meta/robotChat/ultimo": ahora,
  });
  return { status: 200, body: { ok: true, id: ref.key, grupo: chat.nombre || cfg.chat, caracteres: texto.length } };
}

// Lectura (03-11-2026, lo pidió el robot de Grok): GET /leer?desde=<fecha>&limite=<n>, misma X-Clave, en la
// misma función (así no hay que abrir otro servicio al público a mano en Cloud Run). Devuelve los mensajes
// del mismo grupo desde esa fecha, en orden, solo texto y quién lo dijo (sin imágenes ni audios: se marca
// «adjunto»), y en cada mensaje de una persona el id de la última publicación del robot anterior
// («publicacion»), para que el robot sepa a qué informe contesta. El cliente al que se refiere va en el
// texto: las vendedoras contestan con el número del punto y el nombre del cliente.
//   desde   «2026-11-03» (desde las 00:00 de Chile), «2026-11-03T09:00:00-03:00» o milisegundos; por
//           defecto, las últimas 24 h.   limite  cuántos como máximo (200 por defecto, tope 500).
const LEER_TOPE = 500, LEER_POR_DEFECTO = 200;
const ZONA = "America/Santiago";
const partesChile = (ms) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset" });
  const o = {}; for (const x of f.formatToParts(new Date(ms))) o[x.type] = x.value;
  if (o.hour === "24") o.hour = "00";
  return o;   // year, month, day, hour, minute, second, timeZoneName («GMT-03:00»)
};
const isoChile = (ms) => { const o = partesChile(ms); return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}${o.timeZoneName.replace("GMT", "") || "-03:00"}`; };
const fechaDesde = (v, ahora) => {
  if (v === undefined || v === null || String(v).trim() === "") return ahora - 24 * 3600 * 1000;
  v = String(v).trim();
  if (/^\d{11,}$/.test(v)) return Number(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {                       // fecha sola: las 00:00 de ese día en Chile
    const mediodiaUtc = Date.parse(v + "T12:00:00Z"); if (isNaN(mediodiaUtc)) return null;
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(partesChile(mediodiaUtc).timeZoneName) || ["", "-", "03", "00"];
    const desfase = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
    return Date.parse(v + "T00:00:00Z") - desfase;
  }
  const t = Date.parse(v); return isNaN(t) ? null : t;
};
const enOrden = (snap) => { const l = []; snap.forEach((h) => { l.push([h.key, h.val() || {}]); }); return l.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0)); };

async function leerComoRobot(db, params, clave, ahora = Date.now()) {
  const cfg = (await leerConPlazo(db.ref("tago_meta/robotChat"))).val() || {};
  if (!cfg.clave || !cfg.chat) return { status: 503, body: { error: "falta configurar tago_meta/robotChat (clave y chat)" } };
  if (!claveOk(clave, cfg.clave)) return { status: 401, body: { error: "clave inválida" } };
  const desde = fechaDesde(params.desde, ahora);
  if (desde === null) return { status: 400, body: { error: "desde no es una fecha válida: usa 2026-11-03, 2026-11-03T09:00:00-03:00 o milisegundos" } };
  const limite = Math.min(LEER_TOPE, Math.max(1, parseInt(params.limite, 10) || LEER_POR_DEFECTO));
  const chat = (await leerConPlazo(db.ref("tago_chats/" + cfg.chat))).val();
  if (!chat || chat.tipo !== "grupal") return { status: 404, body: { error: "el grupo configurado en tago_meta/robotChat/chat no existe" } };
  const ref = db.ref("tago_mensajes/" + cfg.chat);
  const crudos = enOrden(await leerConPlazo(ref.orderByChild("ts").startAt(desde).limitToLast(limite)));
  // La publicación anterior al rango, por si la primera respuesta de una persona contesta a un informe de antes.
  let publicacion = null;
  if (crudos.length && crudos[0][1].autor?.id !== ROBOT_ID) {
    const previos = enOrden(await leerConPlazo(ref.orderByChild("ts").endAt(desde - 1).limitToLast(30)));
    for (const [id, m] of previos) if (m.autor?.id === ROBOT_ID) publicacion = id;
  }
  const mensajes = [];
  for (const [id, m] of crudos) {
    if (m.sistema) continue;
    const robot = m.autor?.id === ROBOT_ID;
    if (robot) publicacion = id;
    const o = partesChile(m.ts || 0);
    const item = { id, robot, autor: m.autor?.nombre || "?", autorId: m.autor?.id || null, texto: String(m.texto || ""), fecha: `${o.year}-${o.month}-${o.day}`, hora: `${o.hour}:${o.minute}`, ts: m.ts || 0 };
    if (!robot) item.publicacion = publicacion;
    const adjunto = m.imagen ? "imagen" : m.audio ? "audio" : m.archivo ? "archivo" : null;
    if (adjunto) { item.adjunto = adjunto; if (m.archivo?.nombre) item.archivo = String(m.archivo.nombre); }
    mensajes.push(item);
  }
  return { status: 200, body: { ok: true, grupo: chat.nombre || cfg.chat, desde: isoChile(desde), hasta: isoChile(ahora), cantidad: mensajes.length, mensajes } };
}

exports.chatPublicar = onRequest(
  { region: "us-central1", timeoutSeconds: 15, memory: "256MiB", maxInstances: 2 },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    const ruta = String(req.path || "/").replace(/\/+$/, "") || "/";
    try {
      if (ruta === "/leer") {
        if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET /leer?desde=… (o POST con JSON {desde}), con cabecera X-Clave" });
        const params = { ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) };
        const r = await leerComoRobot(admin.database(), params, claveDe(req));
        console.log(r.status === 200 ? "leído" : "rechazado", r.status, r.status === 200 ? r.body.cantidad + " mensajes desde " + r.body.desde : r.body.error);
        return res.status(r.status).json(r.body);
      }
      if (req.method !== "POST") return res.status(405).json({ error: "solo POST, con cabecera X-Clave y cuerpo JSON {\"texto\": \"…\"}; para leer, GET /leer?desde=…" });
      const r = await publicarComoRobot(admin.database(), req.body, claveDe(req));
      console.log(r.status === 200 ? "publicado" : "rechazado", r.status, r.body.id || r.body.error);
      res.status(r.status).json(r.body);
    } catch (e) {
      console.error("chatPublicar", ruta, e);
      res.status(500).json({ error: "no se pudo " + (ruta === "/leer" ? "leer" : "publicar") + ": " + e.message });
    }
  });
// Para la prueba local (prueba-chat-robot.js en Data TAGO/.claude/sandbox): sin Firebase de verdad.
exports._robot = { publicarComoRobot, leerComoRobot, fechaDesde, isoChile, claveDe, textoDe, ROBOT_TOPE, ROBOT_PAUSA };
