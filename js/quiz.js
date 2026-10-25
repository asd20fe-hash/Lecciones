// Generador de quiz local (sin internet ni IA). Analiza el texto en español:
// detecta títulos (temas), conceptos clave y definiciones, y arma preguntas de
// opción múltiple, completar la frase y verdadero/falso. Cada pregunta guarda
// el tema y la frase del texto de donde sale, para indicar qué reforzar.

import { splitSentences, isHeading, STOPWORDS, normalize, words, capitalize } from "./text.js";

// ---------- azar con semilla (para poder repetir / regenerar) ----------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- análisis del texto ----------
export function analyze(text) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const sentences = []; // {text, topic, index}
  const headings = [];
  let topic = null;
  for (const b of blocks) {
    const oneLine = !b.includes("\n");
    if (oneLine && isHeading(b)) {
      topic = b.replace(/[:]$/, "").trim();
      headings.push(topic);
      continue;
    }
    for (const s of splitSentences(b.replace(/\n/g, " "))) {
      if (words(s).length >= 4) sentences.push({ text: s, topic, index: sentences.length });
    }
  }
  const terms = keyTerms(sentences, headings);
  const definitions = findDefinitions(sentences);
  // Las definiciones también son conceptos clave
  for (const d of definitions) {
    const k = normalize(d.term);
    const known = terms.find((t) => t.key === k);
    if (known) known.cls = known.cls || d.cls;
    else terms.unshift({ key: k, label: d.term, count: 1, score: 99, cls: d.cls });
  }
  return { sentences, headings, terms, definitions };
}

const DET_CLASS = {
  el: "ms", un: "ms", del: "ms", al: "ms", este: "ms", ese: "ms",
  la: "fs", una: "fs", esta: "fs", esa: "fs",
  los: "mp", unos: "mp", estos: "mp", esos: "mp",
  las: "fp", unas: "fp", estas: "fp", esas: "fp",
  su: "s", sus: "p",
};
// Terminaciones típicas de verbos / participios / adverbios: no son buenos conceptos
const VERBISH = /(an|en|ar|er|ir|ado|ados|ada|adas|ido|idos|ida|idas|ando|iendo|mente|aron|ieron|aba|aban|ía|ían)$/;

function numberOf(cls, label) {
  if (cls) return cls.slice(-1);
  return /s$/i.test(label) ? "p" : "s";
}

function articleFor(cls, label) {
  const c = cls && cls.length === 2 ? cls : (numberOf(cls, label) === "p" ? "mp" : "ms");
  return { ms: "el", fs: "la", mp: "los", fp: "las" }[c];
}

function cleanTerm(t) {
  return t
    .replace(/^[\s"«“(]+|[\s"»”),.;:]+$/g, "")
    .replace(/^(el|la|los|las|un|una|unos|unas|al|del|lo)\s+/i, "")
    .trim();
}

// Conceptos clave: palabras y frases de 2-3 palabras repetidas, sin palabras vacías
// en los extremos. Puntúa por frecuencia, largo y aparición en títulos.
function keyTerms(sentences, headings) {
  const counts = new Map(); // key -> {label, count, n}
  const headingText = normalize(headings.join(" "));
  for (const { text } of sentences) {
    const ws = words(text);
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= ws.length; i++) {
        const gram = ws.slice(i, i + n);
        const first = normalize(gram[0]);
        const last = normalize(gram[n - 1]);
        if (STOPWORDS.has(first) || STOPWORDS.has(last)) continue;
        if (n === 1 && first.length < 5) continue;
        if (gram.some((w) => w.length < 2)) continue;
        // Dentro de la frase solo se permiten "de", "del", "y"
        if (n === 3 && !["de", "del", "y"].includes(normalize(gram[1])) && STOPWORDS.has(normalize(gram[1]))) continue;
        const label = gram.join(" ");
        const key = normalize(label);
        const e = counts.get(key) || { label, count: 0, n, det: 0, cls: {} };
        e.count++;
        const prev = i > 0 ? normalize(ws[i - 1]) : "";
        if (DET_CLASS[prev]) {
          e.det++;
          e.cls[DET_CLASS[prev]] = (e.cls[DET_CLASS[prev]] || 0) + 1;
        }
        // Preferimos la forma en minúscula si aparece así alguna vez
        if (label !== label.toLowerCase() && e.label !== e.label.toLowerCase()) e.label = label;
        else if (label === label.toLowerCase()) e.label = label;
        counts.set(key, e);
      }
    }
  }
  const out = [];
  for (const [key, e] of counts) {
    if (e.n > 1 && e.count < 2) continue;
    const inHeading = headingText.includes(key);
    // Un concepto suele ir precedido de un artículo ("la célula", "los herbívoros")
    if (!e.det && !inHeading) continue;
    if (e.n === 1 && VERBISH.test(key) && e.det < 2) continue;
    let score = e.count * (1 + 0.6 * (e.n - 1)) + Math.min(key.length, 12) / 12 + e.det * 0.5;
    if (inHeading) score += 3;
    const cls = Object.entries(e.cls).sort((x, y) => y[1] - x[1])[0];
    out.push({ key, label: e.label, count: e.count, score, cls: cls ? cls[0] : null });
  }
  out.sort((a, b) => b.score - a.score);
  // Quita términos sueltos contenidos en una frase clave que casi siempre los incluye
  const res = [];
  for (const t of out) {
    const covered = res.find(
      (r) => (r.key.includes(t.key) || t.key.includes(r.key)) && Math.abs(r.count - t.count) <= 1
    );
    if (!covered) res.push(t);
    if (res.length >= 40) break;
  }
  return res;
}

const DEF_VERBS =
  "se llaman|se llama|se denominan|se denomina|se conocen como|se conoce como|reciben el nombre de|recibe el nombre de";

// Definiciones del tipo "X es/son ...", "Se llama X a ...", "... se llaman X", "X: ...".
function findDefinitions(sentences) {
  const defs = [];
  const seen = new Set();
  const add = (rawTerm, definition, s) => {
    const art = normalize((rawTerm.trim().match(/^\p{L}+/u) || [""])[0]);
    const term = cleanTerm(rawTerm);
    definition = definition.replace(/[.;:\s]+$/, "").trim();
    const k = normalize(term);
    if (!term || term.length < 3 || words(term).length > 5 || definition.length < 12) return;
    if (STOPWORDS.has(k) || seen.has(k)) return;
    seen.add(k);
    definition = definition.replace(/^(es|son)\s+/i, "");
    defs.push({ term, definition: capitalize(definition), sentence: s, cls: DET_CLASS[art] || null });
  };
  for (const s of sentences) {
    const t = s.text;
    let m;
    // "Se llama fotosíntesis al proceso ..."
    if ((m = t.match(new RegExp(`^(?:${DEF_VERBS})\\s+([^,.;]{3,40}?)\\s+(?:a|al|a la|a los|a las)\\s+(.{12,})$`, "i")))) {
      add(m[1], m[2], s);
      continue;
    }
    // "Los animales que comen plantas se llaman herbívoros."
    if ((m = t.match(new RegExp(`^(.{12,}?)\\s+(?:${DEF_VERBS})\\s+([^,.;]{3,40})[.]?$`, "i")))) {
      add(m[2], m[1], s);
      continue;
    }
    // "Fotosíntesis: proceso por el cual ..."
    if ((m = t.match(/^([^:]{3,40}):\s+(.{12,})$/))) {
      add(m[1], m[2], s);
      continue;
    }
    // "La célula es la unidad ..." / "Los herbívoros son animales que ..."
    if ((m = t.match(/^((?:el|la|los|las|un|una)?\s*[^,;:]{3,45}?)\s+(es|son)\s+(.{12,})$/i))) {
      const rest = m[3];
      const looksLikeDef =
        /^(el|la|los|las|un|una|aquel|aquella|aquellos|aquellas|todo|todos|cada)\s/i.test(rest) ||
        /\s(que|cuyo|cuya|donde|en el que|en la que|por el cual|por la cual|formad[oa]s? por)\s/i.test(" " + rest);
      const subjWords = words(m[1]).filter((w) => !STOPWORDS.has(normalize(w)));
      if (looksLikeDef && subjWords.length >= 1 && subjWords.length <= 4) add(m[1], `${m[2]} ${rest}`, s);
    }
  }
  return defs;
}

// ---------- preguntas ----------
function trimDef(d, max = 160) {
  return d.length > max ? d.slice(0, max).replace(/\s+\S*$/, "") + "…" : d;
}

// clsOf(label) -> "ms" | "fs" | "mp" | "fp" | "s" | "p" | null. Prefiere distractores
// del mismo género y número para que la respuesta no se adivine por la gramática.
function pickDistractors(correct, pool, n, rand, clsOf = null) {
  const ck = normalize(correct);
  const cand = pool.filter((p) => {
    const k = normalize(p);
    return k !== ck && !k.includes(ck) && !ck.includes(k);
  });
  const uniq = shuffle([...new Map(cand.map((c) => [normalize(c), c])).values()], rand);
  let ranked = uniq;
  if (clsOf) {
    const cc = clsOf(correct);
    const rank = (c) => {
      const k = clsOf(c);
      if (cc && k && cc.length === 2 && k === cc) return 0;
      return numberOf(k, c) === numberOf(cc, correct) ? 1 : 2;
    };
    ranked = uniq.sort((x, y) => rank(x) - rank(y));
  }
  // Sin opciones que se contengan entre sí ("cadena" / "cadena alimentaria")
  const out = [];
  for (const c of ranked) {
    const k = normalize(c);
    if (out.some((o) => normalize(o).includes(k) || k.includes(normalize(o)))) continue;
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

function findTermIn(sentence, terms) {
  const ns = normalize(sentence);
  // el término más importante que aparece como palabra completa
  return terms.find((t) => new RegExp(`(^|[^a-z])${escapeRe(t.key)}([^a-z]|$)`).test(ns));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reemplaza la aparición de un término (ignorando tildes/mayúsculas) en el texto original
function replaceTerm(sentence, termKey, replacement) {
  const ns = normalize(sentence);
  const re = new RegExp(`(^|[^a-z])(${escapeRe(termKey)})(?=[^a-z]|$)`);
  const m = ns.match(re);
  if (!m) return null;
  const start = m.index + m[1].length;
  const end = start + m[2].length;
  // normalize() conserva el largo para texto en NFC con tildes simples
  const orig = sentence.slice(start, end);
  let rep = replacement;
  if (/^\p{Lu}/u.test(orig)) rep = capitalize(rep);
  return sentence.slice(0, start) + rep + sentence.slice(end);
}

function topicFor(sentence, term) {
  return sentence.topic || (term ? capitalize(term.label) : "General");
}

export function generateQuiz(text, { seed = Date.now(), max = 12, title = "" } = {}) {
  const rand = rng(seed);
  const a = analyze(text);
  const termLabels = a.terms.map((t) => t.label);
  const clsMap = new Map(a.terms.map((t) => [normalize(t.label), t.cls]));
  const clsOf = (label) => clsMap.get(normalize(label)) || null;
  const questions = [];
  const usedSentences = new Set();
  const usedTerms = new Map(); // key -> veces preguntado

  const push = (q, sentence, termKey) => {
    q.id = "q" + questions.length;
    questions.push(q);
    usedSentences.add(sentence.index);
    if (termKey) usedTerms.set(termKey, (usedTerms.get(termKey) || 0) + 1);
  };

  // 1) Definiciones
  const defs = shuffle(a.definitions, rand);
  const defTexts = a.definitions.map((d) => trimDef(d.definition));
  for (const d of defs) {
    const key = normalize(d.term);
    const term = { label: d.term };
    const useForward = defTexts.length >= 4 && rand() < 0.5;
    if (useForward) {
      const distract = pickDistractors(trimDef(d.definition), defTexts, 3, rand);
      const options = shuffle([trimDef(d.definition), ...distract], rand);
      push(
        {
          type: "mc",
          question: `¿Qué ${numberOf(d.cls, d.term) === "p" ? "son" : "es"} ${articleFor(d.cls, d.term)} ${/^\p{Lu}{2,}/u.test(d.term) ? d.term : d.term.toLowerCase()}?`,
          options,
          answer: options.indexOf(trimDef(d.definition)),
          explanation: d.sentence.text,
          topic: topicFor(d.sentence, term),
          concept: d.term,
          quote: d.sentence.text,
        },
        d.sentence,
        key
      );
    } else {
      const clue = normalize(d.definition);
      const distract = pickDistractors(d.term, termLabels, 8, rand, clsOf)
        .filter((t) => !clue.includes(normalize(t)))
        .slice(0, 3);
      if (distract.length < 2) continue;
      const options = shuffle([d.term, ...distract], rand).map((o) => capitalize(o));
      push(
        {
          type: "mc",
          question: `¿Cómo se llama${numberOf(d.cls, d.term) === "p" ? "n" : ""}…? «${trimDef(d.definition, 200)}»`,
          options,
          answer: options.indexOf(capitalize(d.term)),
          explanation: d.sentence.text,
          topic: topicFor(d.sentence, term),
          concept: d.term,
          quote: d.sentence.text,
        },
        d.sentence,
        key
      );
    }
    if (questions.length >= Math.ceil(max * 0.4)) break;
  }

  // Oraciones informativas candidatas, priorizando las que tienen conceptos clave
  const candidates = shuffle(
    a.sentences.filter((s) => s.text.length >= 35 && s.text.length <= 260 && !s.text.endsWith("?")),
    rand
  )
    .map((s) => ({ s, term: findTermIn(s.text, a.terms) }))
    .filter((c) => c.term);
  // más importantes primero, sin repetir demasiado el mismo concepto
  candidates.sort((x, y) => y.term.score - x.term.score + (rand() - 0.5) * 4);

  // 2) Completar la frase y 3) Verdadero / falso, alternando
  let turn = 0;
  for (const { s, term } of candidates) {
    if (questions.length >= max) break;
    if (usedSentences.has(s.index)) continue;
    if ((usedTerms.get(term.key) || 0) >= 2) continue;
    const kind = turn++ % 3 === 2 ? "tf" : "cloze";
    if (kind === "cloze") {
      const blanked = replaceTerm(s.text, term.key, "_____");
      if (!blanked) continue;
      const distract = pickDistractors(term.label, termLabels, 6, rand, clsOf).filter(
        (d) => !normalize(s.text).includes(normalize(d))
      );
      if (distract.length < 2) continue;
      const options = shuffle([term.label, ...distract.slice(0, 3)], rand);
      push(
        {
          type: "mc",
          question: `Completá la frase: ${blanked}`,
          options,
          answer: options.indexOf(term.label),
          explanation: s.text,
          topic: topicFor(s, term),
          concept: term.label,
          quote: s.text,
        },
        s,
        term.key
      );
    } else {
      const makeFalse = rand() < 0.5;
      let statement = s.text;
      if (makeFalse) {
        // Para "falso" solo sirve un reemplazo del mismo género y número
        const other = pickDistractors(term.label, termLabels, 6, rand, clsOf).find(
          (d) => (clsOf(d) || "") === (term.cls || "-") && !normalize(s.text).includes(normalize(d))
        );
        const swapped = other && replaceTerm(s.text, term.key, other);
        if (!swapped) continue;
        statement = swapped;
      }
      push(
        {
          type: "tf",
          question: `¿Verdadero o falso? ${statement}`,
          options: ["Verdadero", "Falso"],
          answer: makeFalse ? 1 : 0,
          explanation: makeFalse ? `Es falso. El texto dice: «${s.text}»` : `Es verdadero: «${s.text}»`,
          topic: topicFor(s, term),
          concept: term.label,
          quote: s.text,
        },
        s,
        term.key
      );
    }
  }

  // Temas con un resumen corto (primera oración del tema)
  const topicNames = [...new Set(questions.map((q) => q.topic))];
  const topics = topicNames.map((name) => {
    const first = a.sentences.find((s) => s.topic === name) || questions.find((q) => q.topic === name);
    return { name, summary: first ? first.text || first.quote : "" };
  });

  return {
    title: title || a.headings[0] || "Quiz",
    source: "local",
    createdAt: new Date().toISOString(),
    topics,
    questions: shuffle(questions, rand).map((q, i) => ({ ...q, id: "q" + i })),
  };
}

// ---------- resultados ----------
// answers: {questionId: optionIndex}
export function grade(quiz, answers) {
  const byTopic = {};
  let score = 0;
  const wrong = [];
  for (const q of quiz.questions) {
    const t = (byTopic[q.topic] = byTopic[q.topic] || { ok: 0, total: 0, wrong: [] });
    t.total++;
    if (answers[q.id] === q.answer) {
      t.ok++;
      score++;
    } else {
      t.wrong.push(q);
      wrong.push(q);
    }
  }
  const reinforce = Object.entries(byTopic)
    .filter(([, t]) => t.ok / t.total < 0.75)
    .sort((x, y) => x[1].ok / x[1].total - y[1].ok / y[1].total)
    .map(([name, t]) => ({
      name,
      ok: t.ok,
      total: t.total,
      concepts: [...new Set(t.wrong.map((q) => q.concept).filter(Boolean))],
      quotes: [...new Set(t.wrong.map((q) => q.quote).filter(Boolean))],
    }));
  return { score, total: quiz.questions.length, byTopic, reinforce, wrong };
}
