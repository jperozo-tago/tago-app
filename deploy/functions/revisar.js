// Revisión de un archivo para imprimir en DTF, para el bot de ventas de Vambe (29-10-2026).
//
// El bot no ve imágenes: Vambe le pasa una descripción genérica y el enlace del archivo
// ([url: https://vambe-bkt.s3…]). Con ese enlace el bot llama a esta revisión y recibe, en
// texto, lo que hace falta para decirle al cliente en el chat si su archivo sirve:
//   - formato y tamaño en píxeles;
//   - fondo: transparente, de un color (se imprimiría como un rectángulo) o sin transparencia;
//   - sombras o difuminados semitransparentes (salen con blanco y adhesivo detrás);
//   - calidad: el mínimo es 300 ppp (regla de Andreina, 29-10-2026). Con la medida que pide el
//     cliente dice si alcanza; sin medida, hasta cuántos centímetros queda bien.
// En pines, imanes, llaveros y parches no se usa: ahí basta un boceto y el taller arma la propuesta.
const sharp = require("sharp");

const PPP_MINIMO = 300;
const CM = 2.54;
const LADO_ANALISIS = 2000;          // se reduce a esto (vecino más cercano) solo para contar píxeles
const MAX_BYTES = 30 * 1024 * 1024;
const HOSTS = ["vambe-bkt.s3.us-east-1.amazonaws.com", "vambe-bkt.s3.amazonaws.com"];
const NO_MEDIBLES = { "%PDF": "PDF", "8BPS": "PSD", "%!PS": "EPS" };

const cm = (n) => (Math.floor(n * 10) / 10).toLocaleString("es-CL");

async function descargar(url) {
  let u;
  try { u = new URL(url); } catch (e) { throw new Error("el enlace no es válido"); }
  if (u.protocol !== "https:" || !HOSTS.includes(u.hostname)) throw new Error("solo se revisan archivos recibidos en Vambe");
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`no se pudo descargar el archivo (${r.status})`);
  if (Number(r.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("el archivo pesa más de 30 MB");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("el archivo pesa más de 30 MB");
  return buf;
}

function nombreColor([r, g, b]) {
  if (r > 235 && g > 235 && b > 235) return "blanco";
  if (r < 30 && g < 30 && b < 30) return "negro";
  return "de color #" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

// Color dominante del borde (si más del 80 % del borde es de un mismo color, eso es un fondo).
function fondoDelBorde(px, w, h) {
  const borde = [];
  const paso = Math.max(1, Math.floor(Math.min(w, h) / 400));
  const toma = (x, y) => { const i = (y * w + x) * 4; borde.push([px[i], px[i + 1], px[i + 2]]); };
  for (let x = 0; x < w; x += paso) { toma(x, 0); toma(x, h - 1); }
  for (let y = 0; y < h; y += paso) { toma(0, y); toma(w - 1, y); }
  const cubos = new Map();
  for (const [r, g, b] of borde) { const k = (r >> 3) + "," + (g >> 3) + "," + (b >> 3); cubos.set(k, (cubos.get(k) || 0) + 1); }
  const base = [...cubos.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map((c) => c * 8 + 4);
  const cerca = borde.filter((p) => Math.abs(p[0] - base[0]) + Math.abs(p[1] - base[1]) + Math.abs(p[2] - base[2]) < 40).length;
  return cerca / borde.length > 0.8 ? base : null;
}

async function revisar(url, anchoCm, altoCm) {
  return analizar(await descargar(url), anchoCm, altoCm);
}

async function analizar(buf, anchoCm, altoCm) {
  const firma = buf.subarray(0, 4).toString("latin1");
  if (NO_MEDIBLES[firma]) {
    return { se_pudo_revisar: false, formato: NO_MEDIBLES[firma],
      motivo: `Los ${NO_MEDIBLES[firma]} no se pueden medir automáticamente. Pide el mismo diseño en PNG sin fondo o pasa el caso a una ejecutiva para que lo revise.` };
  }

  let meta;
  try { meta = await sharp(buf, { failOn: "none", limitInputPixels: 2e8 }).metadata(); }
  catch (e) { return { se_pudo_revisar: false, motivo: "El archivo no es una imagen que se pueda abrir. Pide el diseño en PNG sin fondo." }; }
  const formato = String(meta.format || "").toUpperCase().replace("JPEG", "JPG");
  const vectorial = formato === "SVG";
  const W = meta.width, H = meta.height;

  // Píxeles para contar: imagen reducida con vecino más cercano (no inventa transparencias nuevas).
  const escala = Math.min(1, LADO_ANALISIS / Math.max(W, H));
  const { data: px, info } = await sharp(buf, { failOn: "none", limitInputPixels: 2e8, density: vectorial ? 150 : undefined })
    .resize(Math.max(1, Math.round(W * escala)), Math.max(1, Math.round(H * escala)), { kernel: "nearest", fit: "fill" })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, total = w * h;

  let transp = 0, semi = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  const a = (x, y) => px[(y * w + x) * 4 + 3];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const al = a(x, y);
    if (al <= 10) { transp++; continue; }
    if (al < 245) semi++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return { se_pudo_revisar: true, sirve: false, formato, problemas: ["El archivo está vacío: es completamente transparente."] };
  const visibles = total - transp;
  const conTransparencia = transp / total > 0.01;

  // Semitransparencia «profunda»: píxeles semitransparentes rodeados solo de semitransparentes.
  // El suavizado de los bordes es una franja de 1 o 2 píxeles; una sombra o un difuminado es ancho.
  let profundos = 0;
  if (semi) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const al = a(x, y);
    if (al <= 10 || al >= 245) continue;
    const v = [a(x - 1, y), a(x + 1, y), a(x, y - 1), a(x, y + 1)];
    if (v.every((n) => n > 10 && n < 245)) profundos++;
  }
  const difuminados = profundos / visibles > 0.01;

  const fondo = conTransparencia ? null : fondoDelBorde(px, w, h);
  // Tamaño del diseño en píxeles reales: sin lo transparente que lo rodea.
  const dw = conTransparencia ? Math.round((x1 - x0 + 1) / escala) : W;
  const dh = conTransparencia ? Math.round((y1 - y0 + 1) / escala) : H;
  const maxAncho = dw / PPP_MINIMO * CM, maxAlto = dh / PPP_MINIMO * CM;

  // Medida del archivo completo según la resolución que declara (solo si es de impresión, ≥150).
  // Si coincide con la que pide el cliente, habla de la lámina entera y no solo del diseño:
  // «lamina_58x100cm_300dpi.png» pedida a 58 cm se compara con sus 6.850 px, no con el dibujo.
  const dens = meta.density >= 150 ? meta.density : null;
  const archAncho = dens ? W / dens * CM : 0, archAlto = dens ? H / dens * CM : 0;
  const cerca = (a, b) => a > 0 && b > 0 && Math.abs(a - b) / b < 0.03;
  const esLamina = cerca(archAncho, anchoCm) || cerca(archAlto, altoCm);
  const [rw, rh] = esLamina ? [W, H] : [dw, dh];

  const problemas = [], avisos = [];
  if (!conTransparencia) {
    problemas.push(fondo
      ? `Tiene fondo ${nombreColor(fondo)}: se imprimiría ese rectángulo de color alrededor del diseño. No quitamos fondos: se necesita el mismo diseño en PNG sin fondo (salvo que el cliente quiera el rectángulo).`
      : "No tiene fondo transparente: se imprimiría el rectángulo completo de la imagen. Se necesita el diseño en PNG sin fondo.");
  }
  if (difuminados) avisos.push("Tiene sombras, difuminados o partes semitransparentes: esas zonas se imprimen con blanco detrás y no se ven como en pantalla (en DTF UV, además, con adhesivo).");

  let ppp = null;
  if (!vectorial && (anchoCm > 0 || altoCm > 0)) {
    const pW = anchoCm > 0 ? rw / (anchoCm / CM) : Infinity;
    const pH = altoCm > 0 ? rh / (altoCm / CM) : Infinity;
    ppp = Math.round(Math.min(pW, pH));
    if (ppp < PPP_MINIMO * 0.98) {                    // 2 % de holgura: las medidas del cliente son aproximadas
      const hasta = esLamina ? `${cm(W / PPP_MINIMO * CM)} × ${cm(H / PPP_MINIMO * CM)}` : `${cm(maxAncho)} × ${cm(maxAlto)}`;
      problemas.push(`La calidad no alcanza para ${anchoCm > 0 ? cm(anchoCm) + " cm de ancho" : cm(altoCm) + " cm de alto"}: quedaría a ${ppp} ppp y el mínimo es ${PPP_MINIMO}. Con este archivo queda bien hasta ${hasta} cm; para más grande se necesita un archivo de mayor resolución.`);
    }
  }

  return {
    se_pudo_revisar: true,
    sirve: problemas.length === 0,
    formato,
    pixeles: `${W} × ${H}`,
    medida_del_archivo: dens ? `${cm(archAncho)} × ${cm(archAlto)} cm a ${dens} ppp` : "no declara una resolución de impresión",
    fondo: conTransparencia ? "transparente" : fondo ? nombreColor(fondo) : "sin transparencia",
    calidad: vectorial
      ? "vectorial: sirve a cualquier tamaño"
      : `el diseño queda bien hasta ${cm(maxAncho)} × ${cm(maxAlto)} cm (mínimo ${PPP_MINIMO} ppp)` + (ppp ? `; a la medida pedida queda a ${ppp} ppp` : ""),
    problemas,
    avisos,
  };
}

module.exports = { revisar, analizar, PPP_MINIMO };
