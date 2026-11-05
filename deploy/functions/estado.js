// Estado de un pedido para el bot de ventas de Vambe (05-11-2026, lo pidió Andreina).
// El bot manda el número de pedido de tago.cl (#8584), el código del pedido en Pedidos (TG-0142) o, si el
// cliente compró por WhatsApp y no tiene número, el teléfono del contacto que Vambe pone solo (macro
// {{macro:contact.phone}}, nunca lo escribe el cliente). Recibe en qué etapa va, sin datos personales:
// nunca nombre, dirección, teléfono, correo ni montos. Lo llama revisarArchivo en POST /estado-pedido
// (misma X-Clave que la revisión de archivos), así no hay que abrir otro servicio al público en Cloud Run.
// Por teléfono se busca en `telefono` del pedido y en `envio.tel`; los pedidos con retiro solo se encuentran
// por teléfono si alguien anotó el teléfono del cliente en el pedido.

const ETAPAS = {
  pedidos_shopify:    { etapa: "recibido",      texto: "Recibimos el pedido y lo estamos revisando antes de enviarlo a producción." },
  recibido:           { etapa: "recibido",      texto: "Recibimos el pedido y lo estamos revisando antes de enviarlo a producción." },
  enviado_produccion: { etapa: "en_produccion", texto: "El pedido está en producción." },
  en_produccion:      { etapa: "en_produccion", texto: "El pedido está en producción." },
  maquilado:          { etapa: "en_produccion", texto: "El pedido está en la última etapa de producción." },
};
const DIA = 24 * 3600 * 1000;
const VENTANA_TELEFONO = 30 * DIA;   // por teléfono no se muestran pedidos entregados hace más de 30 días

// Igual que numeroShopify() de Pedidos: 4 a 6 dígitos sueltos, con o sin «#».
const numeroDe = (v) => {
  const m = String(v ?? "").match(/(?:^|[^\w-])#?(\d{4,6})(?![\w-])/);
  return m ? m[1] : null;
};
const codigoTG = (v) => {
  const m = String(v ?? "").match(/\bTG[-\s]?(\d{1,6})\b/i);
  return m ? m[1] : null;
};
// Últimos 8 dígitos: «+56 9 1234 5678», «56912345678» y «912345678» quedan iguales.
const telDe = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
};

const fechaChile = (v) => {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) { const [a, m, d] = v.slice(0, 10).split("-"); return `${d}-${m}-${a}`; }
  const n = typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(n)) return null;
  const p = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date(n));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("day")}-${g("month")}-${g("year")}`;
};

function unPedido(j, id) {
  const retiro = String(j.tipoEntrega || "Retiro") === "Retiro";
  const entrega = retiro ? "retiro en Providencia" : `despacho (${j.tipoEntrega})`;
  const r = { pedido: id || null, producto: String(j.tipoDtf || ""), entrega };
  if (j.shopifyAlerta) {
    return { ...r, etapa: "cancelado", texto: "El pedido figura cancelado o reembolsado. Pasa el caso a una ejecutiva para que lo revise." };
  }
  const listo = fechaChile(j.listaAt), entregado = fechaChile(j.entregadoAt);
  if (j.estado === "entregado") {
    return retiro
      ? { ...r, etapa: "entregado", texto: entregado ? `El pedido ya fue retirado (${entregado}).` : "El pedido ya fue retirado.", entregado }
      : { ...r, etapa: "despachado", texto: entregado ? `El pedido ya se entregó a la empresa de envíos (${entregado}). Desde ahí corre el plazo de entrega de ${j.tipoEntrega}.` : `El pedido ya se entregó a la empresa de envíos (${j.tipoEntrega}).`, entregado };
  }
  if (j.estado === "listo") {
    return retiro
      ? { ...r, etapa: "listo_para_retiro", texto: "El pedido está listo para retiro en Av. Francisco Bilbao 1940, Providencia, de lunes a viernes de 9:00 a 18:00. Lo puede retirar cualquier persona con el nombre del cliente o el número de pedido.", listo }
      : { ...r, etapa: "listo_para_despacho", texto: "El pedido está listo y sale con el despacho.", listo };
  }
  const e = ETAPAS[j.estado] || { etapa: "en_proceso", texto: "El pedido está en proceso." };
  return { ...r, ...e };
}

const responder = (lista, extra) => {
  const partes = lista.map(([id, j]) => unPedido(j, id));
  return {
    encontrado: true,
    ...extra,
    partes,
    mensaje: partes.length > 1
      ? "Hay varias partes o varios pedidos; cuéntale al cliente cómo va cada uno. No inventes fechas de llegada."
      : "Cuéntale al cliente cómo va su pedido con este texto, en palabras simples. No inventes fechas de llegada.",
  };
};

// pedidos: el objeto tago_pedidos completo ({TG-0142: {...}, ...}).
// consulta: {numero, telefono} (o solo el texto con el número, como antes).
function estadoDePedido(pedidos, consulta, ahora = Date.now()) {
  const c = consulta && typeof consulta === "object" ? consulta : { numero: consulta };
  const todos = Object.entries(pedidos || {}).filter(([, j]) => j && typeof j === "object");

  const tg = codigoTG(c.numero);
  if (tg) {
    const lista = todos.filter(([id]) => codigoTG(id) === tg || codigoTG(id) === tg.padStart(4, "0"));
    if (lista.length) return responder(lista, { numero: `TG-${tg.padStart(4, "0")}` });
  }
  const numero = numeroDe(c.numero);
  if (numero) {
    const lista = todos.filter(([, j]) => numeroDe(j.pedido) === numero || String(j.importado?.numero ?? "") === numero);
    if (lista.length) return responder(lista, { numero });
    return { encontrado: false, numero, motivo: "no_encontrado", mensaje: "No hay un pedido con ese número en el sistema de producción. Puede ser que la compra sea muy reciente (los pedidos de la web entran cada 30 minutos) o que el número esté mal: pídele que lo revise en el correo de confirmación. Si insiste o es un pedido antiguo, pasa el caso a una ejecutiva." };
  }
  const tel = telDe(c.telefono);
  if (tel) {
    const lista = todos.filter(([, j]) => (telDe(j.telefono) === tel || telDe(j.envio?.tel) === tel)
      && !(j.estado === "entregado" && j.entregadoAt && ahora - j.entregadoAt > VENTANA_TELEFONO));
    if (lista.length) return responder(lista, { buscado_por: "telefono" });
    return { encontrado: false, motivo: "sin_pedidos_por_telefono", mensaje: "No encontré pedidos recientes asociados a este WhatsApp. Si compró en tago.cl, pídele el número de pedido del correo de confirmación (por ejemplo #8584). Si compró por WhatsApp con una ejecutiva, pasa el caso a una ejecutiva para que lo revise." };
  }
  return { encontrado: false, motivo: "sin_numero", mensaje: "Falta el número de pedido. Pídele al cliente el número que aparece en el correo de confirmación de su compra en tago.cl (por ejemplo #8584). Si compró por WhatsApp y no tiene número, pasa el caso a una ejecutiva." };
}

module.exports = { estadoDePedido, numeroDe, codigoTG, telDe, fechaChile, unPedido };
