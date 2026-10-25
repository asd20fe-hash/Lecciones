# Lecciones

Webapp para estudiar con los libros de la escuela: sacás fotos a las páginas de una lección, la app
extrae el texto y arma un **quiz interactivo** para comprobar si se entendió el tema y **qué hay que reforzar**.

Funciona en cualquier navegador (celular, tablet o compu), sin instalar nada.

## Cómo se usa

1. **Inicio**: entrar a un proyecto ya creado o tocar **+ Nuevo proyecto** (nombre de la lección y materia).
2. **Fotos**: subir las fotos de las páginas (o sacarlas con la cámara del celular), ordenarlas y tocar **Procesar**.
3. **Texto**: revisar el texto extraído y corregir lo que el OCR haya leído mal. Los títulos que quedan solos en
   una línea se usan como *temas* del quiz.
4. **Quiz**: elegir cantidad de preguntas y responder una por una; cada respuesta muestra si está bien y por qué.
5. **Resultados**: nota, resultado por tema, **qué reforzar** (conceptos y las frases del libro para releer),
   las preguntas falladas con la respuesta correcta, botón para repetir solo las incorrectas e historial de intentos.

Si no tenés fotos a mano, en el inicio (sin proyectos) está **Probar con un ejemplo** (lección de Naturales).

## Cómo funciona

| Parte | Sin clave (por defecto) | Modo IA (opcional) |
|---|---|---|
| Leer las fotos | OCR en el navegador con [Tesseract.js](https://tesseract.projectnaptha.com/) en español. Las fotos no salen del dispositivo. | Claude lee las fotos (mejor con fotos torcidas o con poca luz). |
| Armar el quiz | Generador automático: detecta títulos, definiciones ("X es…", "Se llama X a…") y conceptos clave; arma preguntas de definición, completar la frase y verdadero/falso. | Claude arma preguntas de comprensión y aplicación, con explicación, tema y cita del texto. |

El modo IA se activa cargando una clave de API de Anthropic en **Ajustes** (⚙). La clave queda guardada solo en
ese navegador y las llamadas van directo a la API de Anthropic (cada uso tiene costo en esa cuenta).

Los proyectos se guardan en el navegador (IndexedDB). Para pasar un proyecto a otro dispositivo: botón ⤓
(exportar) en la lista y **Importar proyecto** en el otro.

## Publicación

Es una página estática (HTML + JS, sin compilación). El workflow `.github/workflows/pages.yml` la publica en
GitHub Pages en cada push a `main` (o a la rama de desarrollo). Hay que tener Pages habilitado en
*Settings → Pages → Source: GitHub Actions* (en cuentas gratuitas el repositorio tiene que ser público).

Para probar en la compu: `python3 -m http.server` en esta carpeta y abrir http://localhost:8000.

## Estructura

- `index.html`, `css/styles.css` – interfaz.
- `js/app.js` – pantallas (inicio, nuevo proyecto, fotos, texto, quiz, resultados, ajustes).
- `js/db.js` – proyectos en IndexedDB, exportar/importar.
- `js/ocr.js` – OCR con Tesseract.js y preparación de las fotos.
- `js/text.js` – limpieza del texto del OCR (guiones de corte, párrafos, títulos).
- `js/quiz.js` – generador local de preguntas y corrección por tema.
- `js/ai.js` – modo IA (Claude) para leer fotos y armar el quiz.
- `tests/quiz_test.mjs` – prueba del generador (`node tests/quiz_test.mjs`).
