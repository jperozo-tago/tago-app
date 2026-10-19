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
