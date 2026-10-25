// Prueba del generador local: node tests/quiz_test.mjs
import { cleanText } from "../js/text.js";
import { analyze, generateQuiz, grade } from "../js/quiz.js";
import { SAMPLE_TEXT } from "../js/sample.js";

let fail = 0;
const check = (cond, msg) => { if (!cond) { fail++; console.log("FALLA:", msg); } };

// limpieza OCR
const ocr = "La fotosín-\ntesis es un pro-\nceso de las\nplantas.\n\n12\n\nLas raíces absorben agua.";
const c = cleanText(ocr);
console.log("cleanText:", JSON.stringify(c));
check(c.includes("fotosíntesis es un proceso de las plantas."), "une guiones y líneas");
check(!/\n12\n/.test(c), "quita números de página");

const text = cleanText(SAMPLE_TEXT);
const a = analyze(text);
console.log("títulos:", a.headings);
console.log("definiciones:", a.definitions.map((d) => d.term + " => " + d.definition.slice(0, 50)));
console.log("términos:", a.terms.slice(0, 15).map((t) => t.label).join(", "));
check(a.headings.length === 3, "3 títulos");
check(a.definitions.some((d) => /fotos[ií]ntesis/i.test(d.term)), "definición de fotosíntesis");
check(a.definitions.some((d) => /aut[oó]trofos/i.test(d.term)), "definición de autótrofos");

for (const seed of [1, 2, 3, 42, 99]) {
  const q = generateQuiz(text, { seed });
  check(q.questions.length >= 8, `seed ${seed}: al menos 8 preguntas (${q.questions.length})`);
  for (const qq of q.questions) {
    check(qq.answer >= 0 && qq.answer < qq.options.length, `respuesta válida: ${qq.question}`);
    check(new Set(qq.options.map((o) => o.toLowerCase())).size === qq.options.length, `opciones únicas: ${qq.question}`);
    check(qq.topic && qq.quote, "tema y cita");
  }
  if (seed === 1) {
    for (const qq of q.questions) {
      console.log(`\n[${qq.topic}] ${qq.question}`);
      qq.options.forEach((o, i) => console.log(`  ${i === qq.answer ? "*" : " "} ${o}`));
    }
    const answers = {};
    q.questions.forEach((qq, i) => (answers[qq.id] = i % 3 === 0 ? (qq.answer + 1) % qq.options.length : qq.answer));
    const g = grade(q, answers);
    console.log("\nnota", g.score, "/", g.total, "reforzar:", g.reinforce.map((r) => `${r.name} (${r.ok}/${r.total})`));
    check(g.score === q.questions.length - Math.ceil(q.questions.length / 3), "corrección");
  }
}
console.log(fail ? `\n${fail} fallas` : "\nOK");
process.exit(fail ? 1 : 0);
