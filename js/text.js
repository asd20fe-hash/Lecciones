// Limpieza del texto que devuelve el OCR y utilidades de texto en español.

// Une palabras cortadas con guion al final de línea, junta las líneas de un mismo
// párrafo y quita ruido típico del OCR (símbolos sueltos, espacios repetidos).
export function cleanText(raw) {
  let t = (raw || "").normalize("NFC").replace(/\r/g, "");
  t = t.replace(/[­]/g, ""); // guion blando
  t = t.replace(/(\p{L})[-‐‑]\n\s*(\p{Ll})/gu, "$1$2"); // fotosín-\ntesis -> fotosíntesis
  t = t.replace(/[|_~^`¨]+/g, " ");
  t = t.replace(/[ \t]+/g, " ");

  const lines = t.split("\n").map((l) => l.trim());
  const out = [];
  let para = "";
  const flush = () => {
    if (para) out.push(para.trim());
    para = "";
  };
  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    // Basura: líneas muy cortas sin letras (números de página, manchas)
    if (!/\p{L}{2,}/u.test(line)) continue;
    const continues = para && !/[.!?:;]$/.test(para);
    if (!continues && isHeading(line)) {
      flush();
      out.push(line);
      continue;
    }
    // Viñetas: cada una es su propio párrafo
    if (/^[•●▪\-–—*]\s+/.test(line)) {
      flush();
      para = line.replace(/^[•●▪\-–—*]\s+/, "");
      continue;
    }
    para += (para ? " " : "") + line;
  }
  flush();
  return out.join("\n\n").replace(/ +([.,;:!?)])/g, "$1").trim();
}

// Un título: línea corta, sin punto final y que empieza con mayúscula
// (o está toda en mayúsculas).
export function isHeading(line) {
  const l = line.trim();
  if (l.length < 3 || l.length > 70) return false;
  if (/[.,;]$/.test(l)) return false;
  const words = l.split(/\s+/);
  if (words.length > 9) return false;
  const letters = l.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  if (upper / letters.length > 0.7) return true;
  return /^[\p{Lu}¿¡\d]/u.test(l) && words.length <= 6 && !/(?<!\p{L})(es|son|está|están|tiene|tienen)(?!\p{L})/iu.test(l);
}

export function splitSentences(paragraph) {
  // Evita cortar en abreviaturas comunes
  const protectedText = paragraph.replace(/\b(ej|etc|aprox|pág|fig|Sr|Sra|Dr)\./gi, "$1§");
  return protectedText
    .split(/(?<=[.!?])\s+(?=[\p{Lu}¿¡\d"«])/u)
    .map((s) => s.replace(/§/g, ".").trim())
    .filter((s) => s.length > 0);
}

export const STOPWORDS = new Set(
  (
    "a al algo algunas algunos ante antes aquel aquella aquellas aquellos aqui aquí así asi aun aún " +
    "bien cada casi como cómo con contra cual cuál cuales cuáles cuando cuándo cuanto cuánto de del desde donde dónde dos " +
    "el él ella ellas ello ellos en entre era eran es esa esas ese eso esos esta está estaba estaban estado estamos " +
    "están estar estas éstas este éste esto estos éstos fue fueron gran grandes ha haber había habían han hasta hay " +
    "la las le les lo los mas más me mediante mi mientras mis mismo misma mismos mismas mucho muchos muchas muy " +
    "nada ni no nos nosotros nuestra nuestro nuestras nuestros o otra otras otro otros para pero poco pocos por porque " +
    "puede pueden puedo que qué quien quién quienes se sea sean según ser si sí siempre sin sino sobre solo sólo son su " +
    "sus también tambien tan tanto te tiene tienen todo todos toda todas tras tu tus un una unas uno unos usted ustedes " +
    "y ya yo cual cuya cuyo cuyas cuyos dentro fuera luego menos parte partes forma formas tipo tipos vez veces " +
    "además ademas hacer hace hacen tener cosa cosas otra través traves llamado llamada llaman llama denomina " +
    "denominan conoce conocen conocido conocida ejemplo ejemplos decir mayor mayoría menor algunas cierto ciertos " +
    "primero primera segundo segunda tres cuatro cinco general manera durante cuales uno"
  ).split(/\s+/)
);

export function normalize(w) {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function words(s) {
  return s.match(/\p{L}[\p{L}\-]*/gu) || [];
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
