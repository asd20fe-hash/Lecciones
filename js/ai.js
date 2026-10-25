// Modo IA (opcional): usa Claude con la clave de API que el usuario carga en Ajustes.
// La clave queda solo en este navegador (localStorage) y las llamadas van directo
// del navegador a la API de Anthropic.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.132.1";
import { prepareImage } from "./ocr.js";

const MODEL = "claude-opus-5-5";
const KEY_STORAGE = "lecciones.apiKey";

export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* almacenamiento bloqueado: la clave no se recuerda */
  }
}

function client() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Cargá tu clave de API de Anthropic en Ajustes para usar el modo IA.");
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

async function call(params) {
  try {
    const res = await client().beta.messages.create({
      model: MODEL,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...params,
    });
    if (res.stop_reason === "refusal") throw new Error("La IA no pudo procesar este contenido.");
    if (res.stop_reason === "max_tokens") throw new Error("La respuesta de la IA quedó cortada. Probá con menos texto.");
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("La clave de API no es válida.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error("La clave de API no tiene permiso para usar este modelo.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Demasiados pedidos seguidos. Esperá un minuto y probá de nuevo.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("No se pudo conectar con la IA. Revisá la conexión.");
    if (e instanceof Anthropic.APIError) throw new Error("Error de la IA: " + (e.message || e.status));
    throw e;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Transcribe el texto de las fotos de un libro.
export async function aiExtractText(images) {
  const content = [];
  for (let i = 0; i < images.length; i++) {
    const jpg = await prepareImage(images[i].blob, { maxSide: 1800, minSide: 0, type: "image/jpeg", quality: 0.85 });
    content.push({ type: "text", text: `Foto ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(jpg) } });
  }
  content.push({
    type: "text",
    text:
      "Son fotos de páginas de un libro escolar, en orden. Transcribí todo el texto de la lección tal como está " +
      "escrito, en el idioma original. Cada título va en su propia línea y los párrafos se separan con una línea en blanco. " +
      "Incluí epígrafes de imágenes y recuadros solo si aportan contenido. No incluyas números de página, encabezados " +
      "repetidos ni comentarios tuyos. Respondé solo con el texto.",
  });
  return call({
    max_tokens: 16000,
    output_config: { effort: "low" },
    messages: [{ role: "user", content }],
  });
}

const QUIZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "topics", "questions"],
  properties: {
    title: { type: "string" },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "summary"],
        properties: { name: { type: "string" }, summary: { type: "string" } },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "question", "options", "answer", "explanation", "topic", "concept", "quote"],
        properties: {
          type: { type: "string", enum: ["mc", "tf"] },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "integer" },
          explanation: { type: "string" },
          topic: { type: "string" },
          concept: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
  },
};

// Arma el quiz a partir del texto de la lección.
export async function aiGenerateQuiz(text, { count = 12, subject = "" } = {}) {
  const prompt =
    `Este es el texto de una lección escolar${subject ? ` de ${subject}` : ""}:\n\n<leccion>\n${text}\n</leccion>\n\n` +
    `Armá un quiz de ${count} preguntas para comprobar si el alumno entendió el tema (no solo si memorizó frases). ` +
    "Mezclá preguntas de comprensión, de relacionar conceptos y de aplicar a ejemplos de la vida diaria; todas tienen " +
    "que poder responderse con lo que dice el texto. Usá español rioplatense sencillo, para chicos de primaria.\n" +
    "- type \"mc\": 4 opciones, una sola correcta, distractores creíbles del mismo tipo que la respuesta.\n" +
    "- type \"tf\": options exactamente [\"Verdadero\", \"Falso\"].\n" +
    "- answer: índice (desde 0) de la opción correcta. Variá la posición de la respuesta correcta.\n" +
    "- explanation: por qué es la respuesta correcta, en 1-2 oraciones.\n" +
    "- topic: uno de los temas de la lista topics (3 a 6 temas, con un resumen de 1-2 oraciones cada uno para repasar).\n" +
    "- concept: el concepto puntual que evalúa la pregunta.\n" +
    "- quote: la frase del texto donde está la respuesta, copiada tal cual.";
  const out = await call({
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: QUIZ_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });
  const data = JSON.parse(out);
  const questions = data.questions
    .filter((q) => Array.isArray(q.options) && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length)
    .map((q, i) => ({ ...q, id: "q" + i }));
  if (!questions.length) throw new Error("La IA no devolvió preguntas válidas.");
  return { title: data.title, source: "ia", createdAt: new Date().toISOString(), topics: data.topics, questions };
}
