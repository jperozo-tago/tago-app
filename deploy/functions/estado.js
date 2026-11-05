// Estado de un pedido para el bot de ventas de Vambe (05-11-2026, lo pidió Andreina).
// El bot manda el número de pedido de tago.cl (#8584) o, si el cliente compró por WhatsApp y no tiene número,
// el correo que dio al hacer el pedido y el teléfono del contacto que Vambe pone solo (macro
// {{macro:contact.phone}}, nunca lo escribe el cliente). Recibe en qué etapa va, sin datos personales: nunca
// nombre, dirección, teléfono, correo ni montos. Lo llama revisarArchivo en POST /estado-pedido (misma X-Clave
// que la revisión de archivos), así no hay que abrir otro servicio al público en Cloud Run.
// Por correo se busca en `correo` (lo escribe quien crea el pedido) y en `envio.correo`; por teléfono en
// `telefono` y en `envio.tel`. Al 05-11-2026, de 66 pedidos de WhatsApp en curso, 48 tenían correo y 9 teléfono:
// por eso, si el teléfono no encuentra nada, el bot pide el correo; si el correo tampoco, pasa a una vendedora.
// El código TG-xxxx es interno: no se le manda al cliente, así que ni se busca ni se devuelve (Andreina, 05-11-2026).
// Los `texto` van escritos para el cliente: el bot los usa casi tal cual.

const DIA = 24 * 3600 * 1000;
const VENTANA = 30 * DIA;   // por correo o teléfono no se muestran pedidos entregados hace más de 30 días
const DERIVAR = "Pasa el caso a una vendedora con «Mover a Asistencia Humana» y deja escrito lo que dio el cliente (número de pedido o correo).";

const ETAPAS = {
  pedidos_shopify:    { etapa: "recibido",      texto: "Recibimos tu pedido y lo estamos revisando para enviarlo a producción." },
  recibido:           { etapa: "recibido",      texto: "Recibimos tu pedido y lo estamos revisando para enviarlo a producción." },
  enviado_produccion: { etapa: "en_produccion", texto: "Tu pedido está en producción." },
  en_produccion:      { etapa: "en_produccion", texto: "Tu pedido está en producción." },
  maquilado:          { etapa: "en_produccion", texto: "Tu pedido está en la última etapa de producción." },
};

// Igual que numeroShopify() de Pedidos: 4 a 6 dígitos sueltos, con o sin «#».
const numeroDe = (v) => {
  const m = String(v ?? "").match(/(?:^|[^\w-])#?(\d{4,6})(?![\w-])/);
  return m ? m[1] : null;
};
// Últimos 8 dígitos: «+56 9 1234 5678», «56912345678» y «912345678» quedan iguales.
const telDe = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
};
// Primer correo que aparezca en el texto, en minúsculas.
const correoDe = (v) => {
  const m = String(v ?? "").match(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
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

// Cómo se le nombra al cliente cada tipo de entrega de Pedidos (OTS es el courier de Santiago: el cliente no lo conoce).
function entregaDe(tipo) {
  const t = String(tipo || "Retiro");
  if (t === "Retiro") return { retiro: true, entrega: "retiro en Providencia" };
  if (t === "OTS") return { retiro: false, santiago: true, entrega: "despacho en Santiago" };
  return { retiro: false, entrega: `despacho por ${t}`, courier: t };
}

function unPedido(j) {
  const e = entregaDe(j.tipoEntrega);
  const r = { producto: String(j.tipoDtf || ""), entrega: e.entrega };
  if (j.shopifyAlerta) {
    // Cancelado o reembolsado en Shopify: puede ser parcial, así que no se le afirma nada al cliente.
    return { ...r, etapa: "revisar_con_vendedora", texto: "Para confirmarte el estado de este pedido lo tiene que revisar una vendedora. Ya le pasé tu caso y te escribe por aquí.", accion: DERIVAR };
  }
  const listo = fechaChile(j.listaAt), entregado = fechaChile(j.entregadoAt);
  if (j.estado === "entregado") {
    if (e.retiro) return { ...r, etapa: "entregado", texto: entregado ? `Tu pedido ya fue retirado el ${entregado}.` : "Tu pedido ya fue retirado.", entregado };
    const cuando = entregado ? ` el ${entregado}` : "";
    return e.santiago
      ? { ...r, etapa: "despachado", texto: `Tu pedido salió${cuando} con la empresa de envíos de Santiago, que generalmente lo entrega el mismo día en que se lo pasamos.`, entregado }
      : { ...r, etapa: "despachado", texto: `Tu pedido se entregó a ${e.courier}${cuando}. Desde ahí corre el plazo de entrega de ${e.courier}.`, entregado };
  }
  if (j.estado === "listo") {
    return e.retiro
      ? { ...r, etapa: "listo_para_retiro", texto: "Tu pedido está listo para retiro en Av. Francisco Bilbao 1940, Providencia, de lunes a viernes de 9:00 a 18:00. Puede retirarlo cualquier persona: solo tiene que decir tu nombre o el número de pedido.", listo }
      : { ...r, etapa: "listo_para_despacho", texto: e.santiago ? "Tu pedido está listo y ahora se lo pasamos a la empresa de envíos de Santiago." : `Tu pedido está listo y ahora se lo entregamos a ${e.courier}.`, listo };
  }
  const et = ETAPAS[j.estado] || { etapa: "en_proceso", texto: "Tu pedido está en proceso." };
  return { ...r, ...et };
}

const responder = (lista, extra) => {
  const partes = lista.map(([, j]) => unPedido(j));
  const derivar = partes.some((p) => p.accion);
  return {
    encontrado: true,
    ...extra,
    partes,
    mensaje: (partes.length > 1
      ? "Hay varias partes o varios pedidos: cuéntale al cliente cómo va cada uno, nombrándolos por el producto, con el texto de cada parte casi tal cual."
      : "Cuéntale al cliente cómo va su pedido con este texto, casi tal cual.")
      + " No inventes fechas de llegada ni menciones códigos internos." + (derivar ? " " + DERIVAR : ""),
  };
};

// pedidos: el objeto tago_pedidos completo ({TG-0142: {...}, ...}).
// consulta: {numero, correo, telefono} (o solo el texto con el número, como antes).
function estadoDePedido(pedidos, consulta, ahora = Date.now()) {
  const c = consulta && typeof consulta === "object" ? consulta : { numero: consulta };
  const todos = Object.entries(pedidos || {}).filter(([, j]) => j && typeof j === "object");
  const recientes = todos.filter(([, j]) => !(j.estado === "entregado" && j.entregadoAt && ahora - j.entregadoAt > VENTANA));
  // Si el bot puso el correo en «numero», se usa como correo (y no se lee un número dentro de él).
  const correo = correoDe(c.correo) || correoDe(c.numero);
  const numero = correoDe(c.numero) ? null : numeroDe(c.numero);

  if (numero) {
    const lista = todos.filter(([, j]) => numeroDe(j.pedido) === numero || String(j.importado?.numero ?? "") === numero);
    if (lista.length) return responder(lista, { numero });
    return { encontrado: false, numero, motivo: "no_encontrado", mensaje: "No hay un pedido con ese número. Pídele que lo revise en el correo de confirmación de su compra en tago.cl. Si te confirma que el número está bien, dile que le pasas el caso a una vendedora y " + DERIVAR.charAt(0).toLowerCase() + DERIVAR.slice(1) };
  }
  if (correo) {
    const lista = recientes.filter(([, j]) => correoDe(j.correo) === correo || correoDe(j.envio?.correo) === correo);
    if (lista.length) return responder(lista, { buscado_por: "correo" });
  }
  const tel = telDe(c.telefono);
  if (tel) {
    const lista = recientes.filter(([, j]) => telDe(j.telefono) === tel || telDe(j.envio?.tel) === tel);
    if (lista.length) return responder(lista, { buscado_por: "telefono" });
  }
  if (correo) {
    return { encontrado: false, motivo: "sin_pedidos_por_correo", mensaje: "No aparece ningún pedido reciente con ese correo ni con este WhatsApp. No le pidas otro correo ni otro dato: dile que le pasas el caso a una vendedora para que lo revise y te escribe por aquí. " + DERIVAR };
  }
  if (tel) {
    return { encontrado: false, motivo: "sin_pedidos_por_telefono", mensaje: "No aparece ningún pedido reciente con este WhatsApp. Pídele el correo que dio al hacer el pedido (o, si compró en tago.cl, el número de pedido del correo de confirmación, por ejemplo #8584) y vuelve a consultar." };
  }
  return { encontrado: false, motivo: "sin_numero", mensaje: "Falta el número de pedido o el correo. Pídele el número de su compra en tago.cl (está en el correo de confirmación, por ejemplo #8584) o, si compró por WhatsApp, el correo que dio al hacer el pedido." };
}

module.exports = { estadoDePedido, numeroDe, telDe, correoDe, fechaChile, unPedido, entregaDe };
