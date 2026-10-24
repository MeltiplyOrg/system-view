import "./style.css";
import type { Design } from "./design";
import { example, parseDesign } from "./design";
import { SystemScene } from "./scene";

/**
 * Resolve a required descendant or fail immediately.
 *
 * The HTML template below is the only source for these IDs. A missing node
 * means the template and controller drifted apart, which is a programming
 * error; throwing during boot is clearer than silently skipping wiring.
 * The generic parameter is the caller's expected element subtype.
 */
function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const app = mustQuery<HTMLDivElement>("#app");

/**
 * Static shell for the overlay UI.
 *
 * The Canvas owns the viewport; the sidebar is a fixed overlay with `inert`
 * and `aria-hidden` until expanded. All controls live inside it so the grid
 * remains unobstructed. IDs here are consumed by the wiring below.
 */
app.innerHTML = `
  <main class="stage">
    <svg id="scene" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="scene-description" preserveAspectRatio="xMidYMid meet">
      <desc id="scene-description">Isometric grid with three database racks and animated connections. Scroll to zoom, drag to move, or open Design to edit the JSON and switch themes.</desc>
    </svg>
    <button id="panel-toggle" class="panel-toggle" type="button" aria-expanded="false" aria-controls="sidebar">
      <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 4h10M2 7h10M2 10h10"/></svg>
      <span>Design</span>
    </button>
    <aside id="sidebar" class="sidebar" aria-labelledby="editor-title" aria-hidden="true" inert>
      <header class="sidebar-header">
        <div>
          <span class="eyebrow">System View</span>
          <h1 id="editor-title" class="panel-title">Design</h1>
        </div>
        <button id="panel-close" class="icon-button" type="button" aria-label="Close design sidebar">×</button>
      </header>
      <div class="sidebar-body">
        <p class="scene-meta"><span id="scene-title"></span><span id="scene-count"></span></p>

        <section class="section">
          <div class="section-label">Appearance</div>
          <label class="field" for="theme">
            <span>Theme</span>
            <select id="theme">
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </section>

        <section class="section">
          <div class="section-label">View</div>
          <div class="view-controls" aria-label="View controls">
            <button id="zoom-out" type="button" aria-label="Zoom out">−</button>
            <button id="fit" type="button">Fit</button>
            <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
          </div>
          <p class="view-hint">Pinch or scroll to zoom · drag to move</p>
        </section>

        <section class="section">
          <div class="section-label"><span>JSON design</span><span class="hint">⌘↵ apply</span></div>
          <label class="sr-only" for="source">System design JSON</label>
          <textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="message"></textarea>
          <div class="editor-actions">
            <button id="reset" class="btn" type="button">Reset</button>
            <button id="apply" class="btn btn-primary" type="button">Apply</button>
          </div>
          <p id="message" class="message" role="status" aria-live="polite"></p>
        </section>

        <section class="section schema-note">
          <div class="section-label">Database rack</div>
          <code>type: "database-rack"<br>position: { x, y, z }<br>color: "#ff9d52"</code>
          <p>Positions are world units. Links reference node IDs. The rack faces are decorative.</p>
        </section>
      </div>
      <footer class="sidebar-footer">
        <input id="file" type="file" accept=".json,application/json" hidden>
        <button id="import" class="btn" type="button">Import</button>
        <button id="export" class="btn" type="button">Export JSON</button>
      </footer>
    </aside>
  </main>`;

const source = mustQuery<HTMLTextAreaElement>("#source");
const message = mustQuery<HTMLParagraphElement>("#message");
const scene = new SystemScene(mustQuery<SVGSVGElement>("#scene"));
const sceneTitle = mustQuery<HTMLElement>("#scene-title");
const sceneCount = mustQuery<HTMLElement>("#scene-count");
const applyButton = mustQuery<HTMLButtonElement>("#apply");

/** Last successfully applied document; exports must never read the draft. */
let current: Design = example;

/**
 * Commit a validated design to the canvas and editor.
 *
 * The scene renders first; only then are the textarea and metadata replaced,
 * so a render failure cannot leave the UI claiming a design is applied. The
 * caller is responsible for validation. `current` is the export source.
 */
function apply(design: Design): void {
  scene.render(design);
  current = design;
  source.value = JSON.stringify(design, null, 2);
  sceneTitle.textContent = design.name;
  sceneCount.textContent = `${design.nodes.length} racks · ${design.connections.length} links`;
  source.removeAttribute("aria-invalid");
  message.classList.remove("error");
  message.textContent = "Canvas is up to date.";
}

/**
 * Surface an import/apply failure without mutating the scene.
 *
 * The live region announces the message, and `aria-invalid` ties the textarea
 * to its error. The previously applied scene and `current` stay intact.
 */
function showError(error: unknown): void {
  message.textContent =
    error instanceof Error ? error.message : "Could not load the design.";
  message.classList.add("error");
  source.setAttribute("aria-invalid", "true");
}

applyButton.addEventListener("click", () => {
  // Parse/validate before rendering so a bad document cannot partially apply.
  try {
    apply(parseDesign(source.value));
  } catch (error) {
    showError(error);
  }
});

source.addEventListener("input", () => {
  message.classList.remove("error");
  source.removeAttribute("aria-invalid");
  message.textContent = "Unapplied changes.";
});

source.addEventListener("keydown", (event) => {
  // Cmd/Ctrl+Enter mirrors the visible Apply button for keyboard users.
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    applyButton.click();
  }
});

mustQuery<HTMLButtonElement>("#reset").addEventListener("click", () =>
  apply(example),
);

const file = mustQuery<HTMLInputElement>("#file");
mustQuery<HTMLButtonElement>("#import").addEventListener("click", () =>
  file.click(),
);

file.addEventListener("change", async () => {
  const selected = file.files?.[0];
  if (!selected) return;
  try {
    apply(parseDesign(await selected.text()));
  } catch (error) {
    showError(error);
  } finally {
    // Clear the input so selecting the same file again still fires `change`.
    file.value = "";
  }
});

mustQuery<HTMLButtonElement>("#export").addEventListener("click", () => {
  // Export exactly what is visible, never a potentially invalid editor draft.
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(current, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "system-design.json";
  link.click();
  // Browsers keep the Blob URL alive until revoked; one second is enough for
  // the click to start and avoids leaking URLs over repeated exports.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message.textContent = "Exported system-design.json.";
});

const theme = mustQuery<HTMLSelectElement>("#theme");
theme.addEventListener("change", () => {
  // Absence of data-theme delegates to the OS preference in CSS; explicit
  // values override it for this document only.
  if (theme.value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme.value;
});

mustQuery<HTMLButtonElement>("#zoom-in").addEventListener("click", () =>
  scene.zoomBy(1.25),
);
mustQuery<HTMLButtonElement>("#zoom-out").addEventListener("click", () =>
  scene.zoomBy(0.8),
);
mustQuery<HTMLButtonElement>("#fit").addEventListener("click", () =>
  scene.fit(),
);

/* The sidebar is an overlay: closed by default, never reserved layout space. */
const toggle = mustQuery<HTMLButtonElement>("#panel-toggle");
const sidebar = mustQuery<HTMLElement>("#sidebar");
const closeButton = mustQuery<HTMLButtonElement>("#panel-close");

/** Element to focus when the overlay closes, captured at open time. */
let returnFocus: HTMLElement | null = null;

/**
 * Expand or collapse the overlay and keep ARIA/focus in sync.
 *
 * Opening removes `inert`, exposes the sidebar to assistive technology, and
 * focuses the close button. Closing reverses that and restores the previous
 * focus, falling back to the toggle. `preventScroll` is essential: the
 * off-screen fixed panel would otherwise scroll the stage and shift the grid.
 */
function setPanelOpen(open: boolean): void {
  sidebar.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  if (open) {
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : toggle;
    sidebar.inert = false;
    sidebar.removeAttribute("aria-hidden");
    closeButton.focus({ preventScroll: true });
  } else {
    sidebar.inert = true;
    sidebar.setAttribute("aria-hidden", "true");
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
}

toggle.addEventListener("click", () => setPanelOpen(true));
closeButton.addEventListener("click", () => setPanelOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebar.classList.contains("open"))
    setPanelOpen(false);
});

document.addEventListener("pointerdown", (event) => {
  // A click anywhere outside the panel (and its trigger) dismisses it. The
  // canvas has no controls of its own, so this does not steal interactions.
  const target = event.target as Node;
  if (
    sidebar.classList.contains("open") &&
    !sidebar.contains(target) &&
    !toggle.contains(target)
  )
    setPanelOpen(false);
});

// Hidden tabs need no decorative animation work. Reduced motion is handled in CSS.
document.addEventListener("visibilitychange", () =>
  document.documentElement.classList.toggle("paused", document.hidden),
);

apply(example);
