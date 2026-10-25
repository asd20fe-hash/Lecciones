// Almacenamiento local de proyectos (IndexedDB). Cada proyecto guarda sus imágenes
// como Blob, el texto extraído, el quiz generado y el historial de intentos.

const DB_NAME = "lecciones";
const DB_VERSION = 1;
const STORE = "projects";

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function newProject(name, subject) {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name,
    subject,
    createdAt: now,
    updatedAt: now,
    images: [], // {id, name, blob, text, status}
    text: "",
    quiz: null,
    attempts: [], // {date, score, total, byTopic: {topic: {ok, total}}}
  };
}

export function listProjects() {
  return tx("readonly", (s) => s.getAll()).then((all) =>
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  );
}

export function getProject(id) {
  return tx("readonly", (s) => s.get(id));
}

export function saveProject(p) {
  p.updatedAt = new Date().toISOString();
  return tx("readwrite", (s) => s.put(p));
}

export function deleteProject(id) {
  return tx("readwrite", (s) => s.delete(id));
}

// --- Exportar / importar (para pasar un proyecto a otro dispositivo) ---

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}

export async function exportProject(p) {
  const images = [];
  for (const img of p.images) {
    images.push({ ...img, blob: undefined, dataUrl: await blobToDataUrl(img.blob) });
  }
  return JSON.stringify({ format: "lecciones-v1", project: { ...p, images } });
}

export async function importProject(json) {
  const data = JSON.parse(json);
  if (data.format !== "lecciones-v1" || !data.project) {
    throw new Error("El archivo no es un proyecto de Lecciones.");
  }
  const p = data.project;
  p.id = newId();
  const images = [];
  for (const img of p.images || []) {
    const { dataUrl, ...rest } = img;
    images.push({ ...rest, blob: await dataUrlToBlob(dataUrl) });
  }
  p.images = images;
  p.attempts = p.attempts || [];
  await saveProject(p);
  return p;
}
