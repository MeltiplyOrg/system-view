import "./style.css";
import { example, parseDesign } from "./design";
import type { Design } from "./design";
import { SystemScene } from "./scene";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="./"><span class="brand-mark" aria-hidden="true">◇</span> SYSTEM VIEW <span class="tag">/ spatial designer</span></a>
    <div class="actions">
      <label class="theme-label">Theme <select id="theme" aria-label="Color theme"><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <button id="import">Import JSON</button><button id="export">Export JSON ↗</button>
      <input id="file" type="file" accept=".json,application/json" hidden>
    </div>
  </header>
  <main class="workspace">
    <section class="canvas-panel" aria-labelledby="scene-title">
      <header class="scene-header"><div><span class="eyebrow">WORKSPACE 01 / ISOMETRIC</span><h1 id="scene-title"></h1><p>A system defined by data. Connected in space.</p></div><span class="badge">DATABASE RACKS</span></header>
      <div class="viewport">
        <svg id="scene" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="scene-title scene-description"><desc id="scene-description">Isometric grid with database racks and animated connections. Decorative cable motion, not live telemetry.</desc></svg>
        <div class="viewport-caption">X / Y / Z <span>30° ISOMETRIC PROJECTION</span></div>
        <div class="zoom" aria-label="View controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="fit">Fit</button><button id="zoom-in" aria-label="Zoom in">+</button></div>
      </div>
      <footer class="scene-footer"><span id="scene-count"></span><span class="motion-state">COLORED SIGNAL FLOW</span></footer>
    </section>
    <aside class="editor-panel" aria-labelledby="editor-title">
      <header class="editor-header"><div><span class="eyebrow">SOURCE OF TRUTH</span><h2 id="editor-title">Design document</h2></div><span class="file-type">JSON</span></header>
      <p class="editor-hint">Set object positions, cable colors, and connections. Apply to update the canvas.</p>
      <label class="sr-only" for="source">System design JSON</label><textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="message"></textarea>
      <div class="editor-actions"><button id="reset">Load example</button><button id="apply" class="primary">Apply design <span aria-hidden="true">↗</span></button></div>
      <p id="message" role="status" aria-live="polite"></p>
      <div class="schema-note"><span>DATABASE RACK CONTRACT</span><code>type: "database-rack"<br>position: { x, y, z }<br>color: "#ff9d52"</code><p>Coordinates are world units. Links reference node IDs. Glass sides, storage caddies, and compute drawers are decorative.</p></div>
    </aside>
  </main>
  <footer class="page-footer"><span>BUILT IN SPACE. STORED AS JSON.</span><span>Rack adapted from <a href="https://isoglow.dev/demo/objects#rack" target="_blank" rel="noopener noreferrer">iso-glow · April Zhu ↗</a></span></footer>`;

const source = document.querySelector<HTMLTextAreaElement>("#source")!;
const message = document.querySelector<HTMLParagraphElement>("#message")!;
const scene = new SystemScene(document.querySelector<SVGSVGElement>("#scene")!);
let current: Design = example;

function apply(design: Design): void {
  scene.render(design);
  current = design;
  source.value = JSON.stringify(design, null, 2);
  document.querySelector("#scene-title")!.textContent = design.name;
  document.querySelector("#scene-count")!.textContent =
    `${design.nodes.length.toString().padStart(2, "0")} OBJECTS / ${design.connections.length.toString().padStart(2, "0")} CONNECTIONS`;
  source.removeAttribute("aria-invalid");
  message.classList.remove("error");
  message.textContent = "Design applied. Canvas is up to date.";
}
function showError(error: unknown): void {
  message.textContent =
    error instanceof Error ? error.message : "Could not load the design.";
  message.classList.add("error");
  source.setAttribute("aria-invalid", "true");
}
document.querySelector("#apply")!.addEventListener("click", () => {
  try {
    apply(parseDesign(source.value));
  } catch (error) {
    showError(error);
  }
});
source.addEventListener("input", () => {
  message.classList.remove("error");
  source.removeAttribute("aria-invalid");
  message.textContent =
    "Unapplied changes. Apply to render or export the new design.";
});
source.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    document.querySelector<HTMLButtonElement>("#apply")!.click();
  }
});
document
  .querySelector("#reset")!
  .addEventListener("click", () => apply(example));
const file = document.querySelector<HTMLInputElement>("#file")!;
document
  .querySelector("#import")!
  .addEventListener("click", () => file.click());
file.addEventListener("change", async () => {
  const selected = file.files?.[0];
  if (!selected) return;
  try {
    apply(parseDesign(await selected.text()));
  } catch (error) {
    showError(error);
  } finally {
    file.value = "";
  }
});
document.querySelector("#export")!.addEventListener("click", () => {
  // Export exactly what is visible, never a potentially invalid editor draft.
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(current, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "system-design.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message.textContent = "Exported the applied design as system-design.json.";
});
const theme = document.querySelector<HTMLSelectElement>("#theme")!;
theme.addEventListener("change", () => {
  if (theme.value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme.value;
});
document
  .querySelector("#zoom-in")!
  .addEventListener("click", () => scene.zoomBy(1.25));
document
  .querySelector("#zoom-out")!
  .addEventListener("click", () => scene.zoomBy(0.8));
document.querySelector("#fit")!.addEventListener("click", () => scene.fit());
// Hidden tabs need no decorative animation work. Reduced motion is handled in CSS.
document.addEventListener("visibilitychange", () =>
  document.documentElement.classList.toggle("paused", document.hidden),
);
apply(example);
