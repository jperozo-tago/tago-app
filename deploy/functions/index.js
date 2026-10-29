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
  { region: "us-central1", secrets: [SECRETO_SHOPIFY, RELOJ_URL], timeoutSeconds: 10, memory: "128MiB", maxInstances: 3 },
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
const { revisar, descargar, vistaMarcada } = require("./revisar");
const numero = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return n > 0 ? n : 0; };
const VAMBE = "https://vambe-bkt.s3.us-east-1.amazonaws.com/";
const firmar = (ruta) => crypto.createHmac("sha256", REVISAR_CLAVE.value()).update(ruta).digest("hex").slice(0, 20);

exports.revisarArchivo = onRequest(
  { region: "us-central1", secrets: [REVISAR_CLAVE], timeoutSeconds: 60, memory: "1GiB", concurrency: 1, maxInstances: 3 },
  async (req, res) => {
    if (req.method === "GET" && req.path === "/vista") {
      const ruta = String(req.query.a || ""), f = String(req.query.f || "");
      const esperada = ruta ? firmar(ruta) : "";
      if (!ruta || f.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada))) {
        return res.status(403).send("enlace inválido");
      }
      try {
        const img = await vistaMarcada(await descargar(VAMBE + ruta));
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
    const c = req.body || {};
    // El asistente a veces copia el enlace con el «[url: …]» de Vambe alrededor: se toma solo el enlace.
    const url = (String(c.url || "").match(/https:\/\/[^\s\]\)"'<>]+/) || [""])[0];
    const ancho = numero(c.ancho_cm), alto = numero(c.alto_cm);
    try {
      const r = await revisar(url, ancho, alto);
      if (r.zonas_semitransparentes && url.startsWith(VAMBE)) {
        const ruta = url.slice(VAMBE.length);
        r.vista_marcada = `https://${req.get("host")}/vista?a=${ruta.split("/").map(encodeURIComponent).join("/")}&f=${firmar(ruta)}`;
      }
      console.log("revisado", { url: url.slice(-60), ancho, alto, sirve: r.sirve, problemas: (r.problemas || []).length });
      res.status(200).json(r);
    } catch (e) {
      console.warn("no se pudo revisar", e.message, url.slice(-60));
      res.status(200).json({ se_pudo_revisar: false, motivo: `No se pudo revisar el archivo: ${e.message}. Pide al cliente que lo vuelva a enviar como documento.` });
    }
  });
