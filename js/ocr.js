// Extracción de texto de las fotos. Por defecto usa Tesseract.js (OCR en el propio
// navegador, idioma español, gratis y sin enviar las fotos a ningún servidor).

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TESSERACT_URL;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => {
        loading = null;
        reject(new Error("No se pudo cargar el motor de OCR. Revisá la conexión a internet."));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// Dibuja la imagen en un canvas con el lado mayor en [minSide, maxSide] px.
// gray = escala de grises con un poco más de contraste (ayuda al OCR con fotos).
export async function prepareImage(blob, { maxSide = 2400, minSide = 1400, gray = false, type = "image/png", quality = 0.9 } = {}) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const long = Math.max(bmp.width, bmp.height);
  let scale = 1;
  if (long > maxSide) scale = maxSide / long;
  else if (long < minSide) scale = Math.min(2, minSide / long);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (gray) ctx.filter = "grayscale(1) contrast(1.35)";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// images: [{blob}] ; onProgress(indexImagen, fraccion 0..1, mensaje)
export async function ocrImages(images, onProgress = () => {}) {
  const Tesseract = await loadTesseract();
  let current = 0;
  onProgress(0, 0, "Cargando el idioma español…");
  const worker = await Tesseract.createWorker("spa", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") onProgress(current, m.progress, "Leyendo texto…");
      else onProgress(current, 0, traducir(m.status));
    },
  });
  const texts = [];
  try {
    for (current = 0; current < images.length; current++) {
      onProgress(current, 0, "Preparando la foto…");
      const prepared = await prepareImage(images[current].blob, { gray: true });
      const { data } = await worker.recognize(prepared);
      texts.push(data.text || "");
      onProgress(current, 1, "Listo");
    }
  } finally {
    await worker.terminate();
  }
  return texts;
}

function traducir(status) {
  const map = {
    "loading tesseract core": "Cargando el motor de OCR…",
    "initializing tesseract": "Iniciando el OCR…",
    "loading language traineddata": "Cargando el idioma español…",
    "initializing api": "Iniciando…",
  };
  return map[status] || "Procesando…";
}
