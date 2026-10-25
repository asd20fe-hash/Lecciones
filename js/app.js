import * as db from "./db.js";
import { cleanText } from "./text.js";
import { generateQuiz, grade } from "./quiz.js";
import { ocrImages } from "./ocr.js";
import { SAMPLE_TEXT } from "./sample.js";

const app = document.getElementById("app");
const SUBJECTS = ["Naturales", "Sociales", "Lengua", "Matemática", "Inglés", "Otra"];
const LETTERS = "ABCDEFGH";

// El módulo de IA se carga solo si se usa (si no hay internet, el resto sigue andando)
let aiModule = null;
async function ai() {
  if (!aiModule) aiModule = await import("./ai.js");
  return aiModule;
}
function hasApiKey() {
  try {
    return !!localStorage.getItem("lecciones.apiKey");
  } catch {
    return false;
  }
}

// ---------- utilidades ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
const urls = new Map(); // blob -> object URL
function blobUrl(blob) {
  if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
  return urls.get(blob);
}
function pct(ok, total) {
  return total ? Math.round((ok / total) * 100) : 0;
}
function level(p) {
  return p >= 75 ? "ok" : p >= 50 ? "warn" : "bad";
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "proyecto";
}

// ---------- router ----------
window.addEventListener("hashchange", route);
route();

async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) return await viewHome();
    if (parts[0] === "nuevo") return viewNew();
    if (parts[0] === "ajustes") return viewSettings();
    if (parts[0] === "p" && parts[1]) {
      const p = await db.getProject(parts[1]);
      if (!p) {
        toast("No se encontró el proyecto");
        location.hash = "#/";
        return;
      }
      return viewProject(p, parts[2] || defaultStep(p));
    }
    location.hash = "#/";
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="wrap"><div class="card"><h2>Algo salió mal</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Volver al inicio</a></div></div>`;
  }
}

function defaultStep(p) {
  if (p.quiz) return "quiz";
  if (p.text) return "texto";
  return "fotos";
}

// ---------- inicio ----------
async function viewHome() {
  const projects = await db.listProjects();
  app.innerHTML = `
    <div class="wrap">
      <section class="hero">
        <h1>Estudiá con tus libros</h1>
        <p>Sacale fotos a las páginas de la lección, la app lee el texto y arma un quiz para ver qué se entendió y qué hay que reforzar.</p>
        <div class="row">
          <a class="btn primary" href="#/nuevo">+ Nuevo proyecto</a>
          <button class="btn" id="import">Importar proyecto</button>
          <input type="file" id="importFile" accept="application/json,.json" class="hidden">
        </div>
      </section>
      <h2 style="margin-top:24px">Mis proyectos</h2>
      ${
        projects.length
          ? `<div class="projects">${projects.map(projectCard).join("")}</div>`
          : `<div class="card empty">
               <p>Todavía no hay proyectos.</p>
               <p class="small">Creá uno nuevo con tus fotos, o probá la app con una lección de ejemplo de Naturales.</p>
               <button class="btn" id="sample">Probar con un ejemplo</button>
             </div>`
      }
    </div>`;

  app.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = projects.find((x) => x.id === b.dataset.del);
      if (!confirm(`¿Borrar el proyecto "${p.name}"? No se puede deshacer.`)) return;
      await db.deleteProject(p.id);
      toast("Proyecto borrado");
      viewHome();
    })
  );
  app.querySelectorAll("[data-export]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = projects.find((x) => x.id === b.dataset.export);
      download(`${slug(p.name)}.lecciones.json`, await db.exportProject(p));
    })
  );
  const fileIn = app.querySelector("#importFile");
  app.querySelector("#import").addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0];
    if (!f) return;
    try {
      const p = await db.importProject(await f.text());
      toast("Proyecto importado");
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      toast(e.message || "No se pudo importar");
    }
  });
  const sample = app.querySelector("#sample");
  if (sample) {
    sample.addEventListener("click", async () => {
      const p = db.newProject("Ejemplo: Los seres vivos", "Naturales");
      p.text = SAMPLE_TEXT;
      await db.saveProject(p);
      location.hash = `#/p/${p.id}/texto`;
    });
  }
}

function projectCard(p) {
  const last = p.attempts[p.attempts.length - 1];
  const thumb = p.images[0] ? `<img class="thumb" src="${blobUrl(p.images[0].blob)}" alt="">` : `<div class="thumb">📖</div>`;
  const status = last
    ? `<span class="badge ${level(pct(last.score, last.total))}">Último: ${last.score}/${last.total}</span>`
    : p.quiz
      ? `<span class="badge">Quiz listo</span>`
      : p.text
        ? `<span class="badge warn">Texto listo</span>`
        : `<span class="badge warn">${p.images.length} foto${p.images.length === 1 ? "" : "s"}</span>`;
  return `
    <div class="project">
      <a href="#/p/${p.id}">${thumb}</a>
      <div class="info">
        <a href="#/p/${p.id}">${esc(p.name)}</a>
        <div class="meta">${esc(p.subject)} · ${fmtDate(p.updatedAt)}</div>
        <div style="margin-top:4px">${status}</div>
      </div>
      <div class="row" style="gap:4px">
        <a class="btn small primary" href="#/p/${p.id}">Entrar</a>
        <button class="btn small ghost" data-export="${p.id}" title="Exportar para otro dispositivo">⤓</button>
        <button class="btn small ghost danger" data-del="${p.id}" title="Borrar">✕</button>
      </div>
    </div>`;
}

// ---------- nuevo proyecto ----------
function viewNew() {
  app.innerHTML = `
    <div class="wrap">
      <h1>Nuevo proyecto</h1>
      <form class="card" id="form">
        <div class="field">
          <label for="name">Nombre de la lección</label>
          <input type="text" id="name" required maxlength="80" placeholder="Ej.: Los seres vivos" autocomplete="off">
        </div>
        <div class="field">
          <label for="subject">Materia</label>
          <select id="subject">${SUBJECTS.map((s) => `<option>${s}</option>`).join("")}</select>
        </div>
        <div class="row end">
          <a class="btn ghost" href="#/">Cancelar</a>
          <button class="btn primary" type="submit">Crear y subir fotos</button>
        </div>
      </form>
    </div>`;
  const name = app.querySelector("#name");
  name.focus();
  app.querySelector("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = db.newProject(name.value.trim() || "Lección sin nombre", app.querySelector("#subject").value);
    await db.saveProject(p);
    location.hash = `#/p/${p.id}/fotos`;
  });
}

// ---------- ajustes ----------
function viewSettings() {
  let key = "";
  try {
    key = localStorage.getItem("lecciones.apiKey") || "";
  } catch {
    /* sin almacenamiento */
  }
  app.innerHTML = `
    <div class="wrap">
      <h1>Ajustes</h1>
      <div class="card">
        <h2>Modo IA (opcional)</h2>
        <p class="muted">Sin clave la app funciona igual: lee las fotos con OCR en el navegador y arma el quiz con reglas automáticas.
        Con una clave de API de Anthropic (Claude) la lectura de fotos difíciles y las preguntas de comprensión son de mejor calidad.
        La clave se guarda solo en este navegador y cada uso tiene un costo en tu cuenta de Anthropic.</p>
        <div class="field">
          <label for="key">Clave de API</label>
          <input type="password" id="key" placeholder="sk-ant-…" value="${esc(key)}" autocomplete="off">
        </div>
        <div class="row end">
          <button class="btn danger" id="clear">Borrar clave</button>
          <button class="btn primary" id="save">Guardar</button>
        </div>
      </div>
      <div class="card">
        <h2>Tus datos</h2>
        <p class="muted small">Los proyectos se guardan en este navegador. Para pasarlos a otro dispositivo usá el botón ⤓ (exportar) en la lista
        de proyectos y luego "Importar proyecto" en el otro dispositivo.</p>
      </div>
    </div>`;
  app.querySelector("#save").addEventListener("click", async () => {
    (await ai()).setApiKey(app.querySelector("#key").value);
    toast("Clave guardada");
  });
  app.querySelector("#clear").addEventListener("click", async () => {
    (await ai()).setApiKey("");
    app.querySelector("#key").value = "";
    toast("Clave borrada");
  });
}

// ---------- proyecto ----------
function stepsNav(p, step) {
  const steps = [
    ["fotos", "Fotos", p.images.length > 0 || !!p.text],
    ["texto", "Texto", !!p.text],
    ["quiz", "Quiz", !!p.quiz],
    ["resultados", "Resultados", p.attempts.length > 0],
  ];
  const enabled = { fotos: true, texto: p.images.length > 0 || !!p.text, quiz: !!p.quiz, resultados: p.attempts.length > 0 };
  return `<nav class="steps">${steps
    .map(
      ([id, label, done], i) =>
        `<a href="#/p/${p.id}/${id}" class="${id === step ? "active" : ""} ${done ? "done" : ""} ${enabled[id] ? "" : "disabled"}"><span class="n">${done && id !== step ? "✓" : i + 1}</span>${label}</a>`
    )
    .join("")}</nav>`;
}

function viewProject(p, step) {
  const head = `
    <div class="row" style="margin-bottom:6px">
      <div class="grow">
        <a href="#/" class="small">← Proyectos</a>
        <h1 style="margin-top:4px">${esc(p.name)}</h1>
        <div class="muted small">${esc(p.subject)} · creado el ${fmtDate(p.createdAt)}</div>
      </div>
    </div>
    ${stepsNav(p, step)}`;
  app.innerHTML = `<div class="wrap">${head}<div id="step"></div></div>`;
  const el = app.querySelector("#step");
  if (step === "fotos") return stepPhotos(p, el);
  if (step === "texto") return stepText(p, el);
  if (step === "quiz") return stepQuiz(p, el);
  if (step === "resultados") return stepResults(p, el);
  location.hash = `#/p/${p.id}`;
}

// ----- Paso 1: fotos -----
function stepPhotos(p, el) {
  const render = () => {
    el.innerHTML = `
      <div class="card">
        <h2>Fotos de la lección</h2>
        <p class="muted small">Subí las fotos en el orden de las páginas. Mejor con buena luz, la página derecha y sin sombras.</p>
        <div class="drop" id="drop" tabindex="0" role="button">
          <strong>Tocá para elegir fotos</strong> o arrastralas acá<br>
          <span class="small">JPG, PNG, HEIC (según el navegador)</span>
        </div>
        <input type="file" id="files" accept="image/*" multiple class="hidden">
        <input type="file" id="camera" accept="image/*" capture="environment" class="hidden">
        <div class="row" style="margin-top:10px">
          <button class="btn small" id="cam">📷 Sacar foto</button>
        </div>
        <div class="images">${p.images
          .map(
            (img, i) => `
          <div class="img-card">
            <img src="${blobUrl(img.blob)}" alt="Foto ${i + 1}" data-zoom="${i}">
            <div class="bar">
              <span>Foto ${i + 1} ${img.text ? '<span class="badge ok">leída</span>' : ""}</span>
              <span>
                <button data-left="${i}" title="Mover antes" ${i === 0 ? "disabled" : ""}>◀</button>
                <button data-right="${i}" title="Mover después" ${i === p.images.length - 1 ? "disabled" : ""}>▶</button>
                <button data-rm="${i}" title="Quitar">✕</button>
              </span>
            </div>
          </div>`
          )
          .join("")}</div>
      </div>
      <div class="card ${p.images.length ? "" : "hidden"}" id="processCard">
        <h2>Extraer el texto</h2>
        <div class="choice">
          <label><input type="radio" name="engine" value="ocr" checked>
            <span><b>OCR en el navegador</b><span class="small muted">Gratis, las fotos no salen de tu dispositivo. La primera vez descarga el idioma (~15 MB).</span></span></label>
          <label><input type="radio" name="engine" value="ia" ${hasApiKey() ? "" : "disabled"}>
            <span><b>Con IA (Claude)</b><span class="small muted">${hasApiKey() ? "Mejor con fotos torcidas o con poca luz." : 'Necesita una clave en <a href="#/ajustes">Ajustes</a>.'}</span></span></label>
        </div>
        <div id="progress" class="hidden">
          <div class="progress"><div id="bar"></div></div>
          <div class="status-line"><span id="msg">Procesando…</span><span id="pct">0%</span></div>
        </div>
        <div class="row end"><button class="btn primary" id="process">Procesar ${p.images.length} foto${p.images.length === 1 ? "" : "s"}</button></div>
      </div>`;
    bind();
  };

  const addFiles = async (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!imgs.length) return toast("Elegí archivos de imagen");
    for (const f of imgs) p.images.push({ id: db.newId(), name: f.name, blob: f, text: "" });
    await db.saveProject(p);
    toast(`${imgs.length} foto${imgs.length === 1 ? "" : "s"} agregada${imgs.length === 1 ? "" : "s"}`);
    viewProject(p, "fotos");
  };

  const bind = () => {
    const files = el.querySelector("#files");
    const camera = el.querySelector("#camera");
    const drop = el.querySelector("#drop");
    drop.addEventListener("click", () => files.click());
    drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && files.click());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      addFiles(e.dataTransfer.files);
    });
    files.addEventListener("change", () => addFiles(files.files));
    el.querySelector("#cam").addEventListener("click", () => camera.click());
    camera.addEventListener("change", () => addFiles(camera.files));

    const move = async (i, d) => {
      const [img] = p.images.splice(i, 1);
      p.images.splice(i + d, 0, img);
      await db.saveProject(p);
      render();
    };
    el.querySelectorAll("[data-left]").forEach((b) => b.addEventListener("click", () => move(+b.dataset.left, -1)));
    el.querySelectorAll("[data-right]").forEach((b) => b.addEventListener("click", () => move(+b.dataset.right, 1)));
    el.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", async () => {
        p.images.splice(+b.dataset.rm, 1);
        await db.saveProject(p);
        viewProject(p, "fotos");
      })
    );
    el.querySelectorAll("[data-zoom]").forEach((im) =>
      im.addEventListener("click", () => {
        const d = document.createElement("dialog");
        d.innerHTML = `<img src="${im.src}" alt="">`;
        d.addEventListener("click", () => d.close());
        d.addEventListener("close", () => d.remove());
        document.body.appendChild(d);
        d.showModal();
      })
    );

    const btn = el.querySelector("#process");
    if (btn) btn.addEventListener("click", () => processImages(p, el, btn));
  };
  render();
}

async function processImages(p, el, btn) {
  const engine = el.querySelector("input[name=engine]:checked").value;
  if (p.text && !confirm("Esto reemplaza el texto que ya está guardado. ¿Seguir?")) return;
  const box = el.querySelector("#progress");
  const bar = el.querySelector("#bar");
  const msg = el.querySelector("#msg");
  const pctEl = el.querySelector("#pct");
  box.classList.remove("hidden");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Procesando…`;
  const n = p.images.length;
  const setProgress = (i, f, m) => {
    const total = Math.round(((i + f) / n) * 100);
    bar.style.width = total + "%";
    pctEl.textContent = total + "%";
    msg.textContent = n > 1 ? `Foto ${Math.min(i + 1, n)} de ${n}: ${m}` : m;
  };
  try {
    let text;
    if (engine === "ia") {
      setProgress(0, 0.2, "La IA está leyendo las fotos…");
      text = cleanText(await (await ai()).aiExtractText(p.images));
      p.images.forEach((img) => (img.text = "ia"));
    } else {
      const texts = await ocrImages(p.images, setProgress);
      texts.forEach((t, i) => (p.images[i].text = cleanText(t)));
      text = p.images.map((img) => img.text).join("\n\n");
    }
    setProgress(n - 1, 1, "Listo");
    if (!text.trim()) throw new Error("No se encontró texto en las fotos. Probá con fotos más nítidas.");
    p.text = text;
    p.quiz = null;
    await db.saveProject(p);
    toast("Texto extraído. Revisalo y corregí lo que haga falta.");
    location.hash = `#/p/${p.id}/texto`;
  } catch (e) {
    console.error(e);
    toast(e.message || "No se pudo procesar");
    btn.disabled = false;
    btn.textContent = "Reintentar";
    msg.textContent = e.message || "Error";
  }
}

// ----- Paso 2: texto -----
function stepText(p, el) {
  const words = (p.text.match(/\S+/g) || []).length;
  el.innerHTML = `
    <div class="card">
      <div class="row"><h2 class="grow" style="margin:0">Texto de la lección</h2><span class="muted small" id="count">${words} palabras</span></div>
      <p class="muted small" style="margin-top:6px">Revisá que el texto se haya leído bien y corregí errores. Los títulos en una línea sola se usan como temas del quiz.</p>
      <textarea id="text" spellcheck="true" placeholder="Acá aparece el texto extraído. También podés pegarlo o escribirlo.">${esc(p.text)}</textarea>
      <div class="row end" style="margin-top:10px"><button class="btn" id="save">Guardar cambios</button></div>
    </div>
    <div class="card">
      <h2>Armar el quiz</h2>
      <div class="choice">
        <label><input type="radio" name="gen" value="local" checked>
          <span><b>Automático</b><span class="small muted">Preguntas de definiciones, completar y verdadero/falso a partir del texto. Sin internet.</span></span></label>
        <label><input type="radio" name="gen" value="ia" ${hasApiKey() ? "" : "disabled"}>
          <span><b>Con IA (Claude)</b><span class="small muted">${hasApiKey() ? "Preguntas de comprensión y aplicación, con explicaciones." : 'Necesita una clave en <a href="#/ajustes">Ajustes</a>.'}</span></span></label>
      </div>
      <div class="row">
        <label for="count-q" style="margin:0">Cantidad de preguntas</label>
        <select id="count-q" style="width:auto">${[5, 8, 10, 12, 15, 20].map((n) => `<option ${n === 10 ? "selected" : ""}>${n}</option>`).join("")}</select>
        <span class="grow"></span>
        <button class="btn primary" id="gen">${p.quiz ? "Armar un quiz nuevo" : "Armar el quiz"}</button>
      </div>
    </div>`;
  const ta = el.querySelector("#text");
  ta.addEventListener("input", () => {
    el.querySelector("#count").textContent = `${(ta.value.match(/\S+/g) || []).length} palabras`;
  });
  const save = async () => {
    if (ta.value !== p.text) {
      p.text = ta.value;
      await db.saveProject(p);
    }
  };
  el.querySelector("#save").addEventListener("click", async () => {
    await save();
    toast("Texto guardado");
  });
  el.querySelector("#gen").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    await save();
    if ((p.text.match(/\S+/g) || []).length < 30) return toast("El texto es muy corto para armar un quiz.");
    const mode = el.querySelector("input[name=gen]:checked").value;
    const count = +el.querySelector("#count-q").value;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Armando…`;
    try {
      const quiz =
        mode === "ia"
          ? await (await ai()).aiGenerateQuiz(p.text, { count, subject: p.subject })
          : generateQuiz(p.text, { max: count, title: p.name });
      if (quiz.questions.length < 3) throw new Error("No se pudieron armar suficientes preguntas con este texto. Revisá que tenga oraciones completas.");
      p.quiz = quiz;
      await db.saveProject(p);
      session = null;
      location.hash = `#/p/${p.id}/quiz`;
    } catch (err) {
      console.error(err);
      toast(err.message || "No se pudo armar el quiz");
      btn.disabled = false;
      btn.textContent = "Armar el quiz";
    }
  });
}

// ----- Paso 3: quiz interactivo -----
let session = null; // {projectId, questions, i, answers, checked}

function startSession(p, questions) {
  session = { projectId: p.id, questions, i: 0, answers: {}, checked: false, partial: questions.length !== p.quiz.questions.length };
}

function stepQuiz(p, el) {
  if (!p.quiz) {
    location.hash = `#/p/${p.id}/texto`;
    return;
  }
  if (!session || session.projectId !== p.id) startSession(p, p.quiz.questions);
  const s = session;
  if (s.i >= s.questions.length) return finishQuiz(p);
  const q = s.questions[s.i];
  const chosen = s.answers[q.id];
  const answered = chosen !== undefined;
  const okCount = s.questions.slice(0, s.i).filter((x) => s.answers[x.id] === x.answer).length;

  el.innerHTML = `
    <div class="card">
      <div class="quiz-head">
        <span class="badge">${esc(q.topic)}</span>
        <span class="muted small">Pregunta ${s.i + 1} de ${s.questions.length} · ${okCount} bien</span>
      </div>
      <div class="progress"><div style="width:${(s.i / s.questions.length) * 100}%"></div></div>
      <div class="question">${esc(q.question)}</div>
      <div class="options">${q.options
        .map((o, i) => {
          let cls = "";
          if (answered && i === q.answer) cls = "correct";
          else if (answered && i === chosen) cls = "wrong";
          return `<button class="option ${cls}" data-opt="${i}" ${answered ? "disabled" : ""}><span class="letter">${q.type === "tf" ? (i === 0 ? "V" : "F") : LETTERS[i]}</span><span>${esc(o)}</span></button>`;
        })
        .join("")}</div>
      ${
        answered
          ? `<div class="feedback ${chosen === q.answer ? "ok" : "bad"}">
               <strong>${chosen === q.answer ? "¡Bien!" : "No es correcto."}</strong>
               ${esc(q.explanation)}
             </div>
             <div class="row end" style="margin-top:14px"><button class="btn primary" id="next">${s.i + 1 < s.questions.length ? "Siguiente →" : "Ver resultados"}</button></div>`
          : `<p class="muted small" style="margin-top:14px">Elegí una opción.</p>`
      }
    </div>
    <div class="row">
      <a class="btn small ghost" href="#/p/${p.id}/texto">Ver el texto</a>
      <span class="grow"></span>
      <button class="btn small ghost" id="restart">Empezar de nuevo</button>
    </div>`;

  el.querySelectorAll("[data-opt]").forEach((b) =>
    b.addEventListener("click", () => {
      s.answers[q.id] = +b.dataset.opt;
      stepQuiz(p, el);
      el.querySelector("#next")?.focus();
    })
  );
  el.querySelector("#next")?.addEventListener("click", () => {
    s.i++;
    stepQuiz(p, el);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  el.querySelector("#restart").addEventListener("click", () => {
    startSession(p, p.quiz.questions);
    stepQuiz(p, el);
  });
}

async function finishQuiz(p) {
  const s = session;
  const quiz = { ...p.quiz, questions: s.questions };
  const g = grade(quiz, s.answers);
  const byTopic = {};
  for (const [name, t] of Object.entries(g.byTopic)) byTopic[name] = { ok: t.ok, total: t.total };
  p.attempts.push({
    date: new Date().toISOString(),
    score: g.score,
    total: g.total,
    partial: s.partial,
    byTopic,
    wrong: g.wrong, // copia de las preguntas falladas (sirve aunque después se arme otro quiz)
  });
  await db.saveProject(p);
  session = null;
  location.hash = `#/p/${p.id}/resultados`;
}

// ----- Paso 4: resultados -----
function stepResults(p, el) {
  const last = p.attempts[p.attempts.length - 1];
  if (!last) {
    location.hash = `#/p/${p.id}/quiz`;
    return;
  }
  const wrongQs = last.wrong || [];
  const score = pct(last.score, last.total);
  const topicInfo = Object.fromEntries((p.quiz?.topics || []).map((t) => [t.name, t.summary]));
  const topics = Object.entries(last.byTopic).sort((a, b) => a[1].ok / a[1].total - b[1].ok / b[1].total);
  const weak = topics.filter(([, t]) => t.ok / t.total < 0.75);
  const msg =
    score >= 90 ? "¡Excelente! El tema está muy bien entendido." :
    score >= 75 ? "¡Muy bien! Quedan pocos detalles para repasar." :
    score >= 50 ? "Bien encaminado, pero hay temas para reforzar." :
    "Conviene volver a leer la lección y repasar los temas de abajo.";

  el.innerHTML = `
    <div class="card">
      <div class="score">
        <div class="big" style="color:var(--${level(score)})">${last.score}/${last.total}</div>
        <div class="muted">${score}% correcto${last.partial ? " · repaso de las incorrectas" : ""} · ${fmtDateTime(last.date)}</div>
        <p style="margin-top:10px;font-weight:600">${msg}</p>
      </div>
      <div class="row" style="justify-content:center">
        ${wrongQs.length ? `<button class="btn primary" id="retryWrong">Repetir las ${wrongQs.length} incorrectas</button>` : ""}
        <button class="btn" id="retryAll">Hacer el quiz de nuevo</button>
        <a class="btn" href="#/p/${p.id}/texto">Armar otro quiz</a>
      </div>
    </div>

    <div class="card">
      <h2>Resultado por tema</h2>
      ${topics
        .map(([name, t]) => {
          const tp = pct(t.ok, t.total);
          return `<div class="topic-row">
            <div class="top"><span>${esc(name)}</span><span class="badge ${level(tp)}">${t.ok}/${t.total}</span></div>
            <div class="progress"><div class="${level(tp)}" style="width:${Math.max(tp, 3)}%"></div></div>
          </div>`;
        })
        .join("")}
    </div>

    <div class="card">
      <h2>Qué reforzar</h2>
      ${
        weak.length
          ? weak
              .map(([name]) => {
                const qs = wrongQs.filter((q) => q.topic === name);
                const concepts = [...new Set(qs.map((q) => q.concept).filter(Boolean))];
                const quotes = [...new Set(qs.map((q) => q.quote).filter(Boolean))].slice(0, 3);
                return `<div class="reinforce">
                  <strong>${esc(name)}</strong>
                  ${topicInfo[name] ? `<div class="small">${esc(topicInfo[name])}</div>` : ""}
                  ${concepts.length ? `<div class="small" style="margin-top:6px">Conceptos: <b>${concepts.map(esc).join(", ")}</b></div>` : ""}
                  ${quotes.map((qt) => `<blockquote>📖 «${esc(qt)}»</blockquote>`).join("")}
                </div>`;
              })
              .join("")
          : `<p>¡No hay temas flojos! Todos los temas tienen 75% o más de respuestas correctas.</p>`
      }
    </div>

    ${
      wrongQs.length
        ? `<div class="card"><h2>Preguntas incorrectas</h2>${wrongQs
            .map(
              (q) => `<div style="margin:12px 0;padding-bottom:12px;border-bottom:1px solid var(--border)">
                <div style="font-weight:600">${esc(q.question)}</div>
                <div class="small" style="color:var(--ok);margin-top:4px">Respuesta correcta: ${esc(q.options[q.answer])}</div>
                <div class="small muted">${esc(q.explanation)}</div>
              </div>`
            )
            .join("")}</div>`
        : ""
    }

    ${
      p.attempts.length > 1
        ? `<div class="card"><h2>Historial</h2><table class="history"><tr><th>Fecha</th><th>Resultado</th><th></th></tr>${p.attempts
            .slice()
            .reverse()
            .map(
              (a) => `<tr><td>${fmtDateTime(a.date)}</td><td><span class="badge ${level(pct(a.score, a.total))}">${a.score}/${a.total}</span></td><td class="muted small">${a.partial ? "Repaso" : "Completo"}</td></tr>`
            )
            .join("")}</table></div>`
        : ""
    }`;

  el.querySelector("#retryWrong")?.addEventListener("click", () => {
    startSession(p, wrongQs);
    location.hash = `#/p/${p.id}/quiz`;
  });
  el.querySelector("#retryAll").addEventListener("click", () => {
    if (!p.quiz) return (location.hash = `#/p/${p.id}/texto`);
    startSession(p, p.quiz.questions);
    location.hash = `#/p/${p.id}/quiz`;
  });
}
