// Estado de un pedido para el bot de ventas de Vambe (05-11-2026, lo pidió Andreina).
// El bot manda el número de pedido de tago.cl (#8584) y recibe en qué etapa va, sin datos personales:
// nunca nombre, dirección, teléfono, correo ni montos. Lo llama revisarArchivo en POST /estado-pedido
// (misma X-Clave que la revisión de archivos), así no hay que abrir otro servicio al público en Cloud Run.

const ETAPAS = {
  pedidos_shopify:    { etapa: "recibido",      texto: "Recibimos el pedido y lo estamos revisando antes de enviarlo a producción." },
  recibido:           { etapa: "recibido",      texto: "Recibimos el pedido y lo estamos revisando antes de enviarlo a producción." },
  enviado_produccion: { etapa: "en_produccion", texto: "El pedido está en producción." },
  en_produccion:      { etapa: "en_produccion", texto: "El pedido está en producción." },
  maquilado:          { etapa: "en_produccion", texto: "El pedido está en la última etapa de producción." },
};

// Igual que numeroShopify() de Pedidos: 4 a 6 dígitos sueltos, con o sin «#».
const numeroDe = (v) => {
  const m = String(v ?? "").match(/(?:^|[^\w-])#?(\d{4,6})(?![\w-])/);
  return m ? m[1] : null;
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

function unPedido(j) {
  const retiro = String(j.tipoEntrega || "Retiro") === "Retiro";
  const entrega = retiro ? "retiro en Providencia" : `despacho (${j.tipoEntrega})`;
  const r = { producto: String(j.tipoDtf || ""), entrega };
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

// pedidos: el objeto tago_pedidos completo ({TG-0142: {...}, ...}).
function estadoDePedido(pedidos, consulta) {
  const numero = numeroDe(consulta);
  if (!numero) {
    return { encontrado: false, motivo: "sin_numero", mensaje: "Falta el número de pedido. Pídele al cliente el número que aparece en el correo de confirmación de su compra en tago.cl (por ejemplo #8584)." };
  }
  const lista = Object.values(pedidos || {}).filter((j) => j && (numeroDe(j.pedido) === numero || String(j.importado?.numero ?? "") === numero));
  if (!lista.length) {
    return { encontrado: false, numero, motivo: "no_encontrado", mensaje: "No hay un pedido con ese número en el sistema de producción. Puede ser que la compra sea muy reciente (los pedidos de la web entran cada 30 minutos) o que el número esté mal: pídele que lo revise en el correo de confirmación. Si insiste o es un pedido antiguo, pasa el caso a una ejecutiva." };
  }
  const partes = lista.map(unPedido);
  return {
    encontrado: true,
    numero,
    partes,
    mensaje: partes.length > 1
      ? "El pedido tiene varias partes (una por producto); cuéntale al cliente cómo va cada una. No inventes fechas de llegada."
      : "Cuéntale al cliente cómo va su pedido con este texto, en palabras simples. No inventes fechas de llegada.",
  };
}

module.exports = { estadoDePedido, numeroDe, fechaChile, unPedido };
