import "./style.css";
import type { Design } from "./design";
import { example, parseDesign } from "./design";
import { instanceColor } from "./layout";
import { SystemScene } from "./scene";

/**
 * Resolve a required descendant or fail immediately.
 *
 * The HTML template below is the only source for these IDs. A missing element
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
      <desc id="scene-description">Isometric grid with three database instances in a cluster and animated connections. Pinch or scroll to zoom, drag to move, or open Design to edit the JSON and switch themes.</desc>
    </svg>
    <div id="callout" class="callout" aria-hidden="true">
      <div class="callout-card">
        <span class="callout-kind"></span>
        <span class="callout-name"></span>
        <span class="callout-meta"></span>
      </div>
    </div>
    <aside id="detail" class="detail" aria-labelledby="detail-title" aria-hidden="true">
      <header class="detail-header">
        <div>
          <span id="detail-kind" class="eyebrow"></span>
          <h2 id="detail-title" class="detail-title"></h2>
        </div>
        <button id="detail-close" class="icon-button" type="button" aria-label="Close details">×</button>
      </header>
      <div class="detail-body">
        <dl id="detail-spec" class="detail-spec"></dl>
        <section class="detail-section">
          <div class="detail-label"><span>Replicas</span><span id="detail-count"></span></div>
          <ul id="detail-replicas" class="detail-replicas"></ul>
        </section>
        <section class="detail-section">
          <div class="detail-label"><span>Links</span><span id="detail-link-count"></span></div>
          <ul id="detail-links" class="detail-links"></ul>
        </section>
      </div>
    </aside>
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
          <div class="section-label">Dynamic design</div>
          <code>instances: [{ id, label? }]<br>connections: [{ from, to, relation? }]<br>clusters: [{ label?, instances }]</code>
          <p>The ID prefix picks the type (db-…). Positions and distinct colors are generated; each cluster member keeps its own platform.</p>
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
const sceneSvg = mustQuery<SVGSVGElement>("#scene");
const scene = new SystemScene(sceneSvg);
const sceneTitle = mustQuery<HTMLElement>("#scene-title");
const sceneCount = mustQuery<HTMLElement>("#scene-count");
const applyButton = mustQuery<HTMLButtonElement>("#apply");

const stage = mustQuery<HTMLElement>(".stage");
const callout = mustQuery<HTMLElement>("#callout");
const calloutCard = mustQuery<HTMLElement>("#callout .callout-card");
const calloutKind = mustQuery<HTMLElement>("#callout .callout-kind");
const calloutName = mustQuery<HTMLElement>("#callout .callout-name");
const calloutMeta = mustQuery<HTMLElement>("#callout .callout-meta");

const detail = mustQuery<HTMLElement>("#detail");
const detailKind = mustQuery<HTMLElement>("#detail-kind");
const detailTitle = mustQuery<HTMLElement>("#detail-title");
const detailSpec = mustQuery<HTMLElement>("#detail-spec");
const detailCount = mustQuery<HTMLElement>("#detail-count");
const detailLinkCount = mustQuery<HTMLElement>("#detail-link-count");
const detailReplicas = mustQuery<HTMLUListElement>("#detail-replicas");
const detailLinks = mustQuery<HTMLUListElement>("#detail-links");
const detailClose = mustQuery<HTMLButtonElement>("#detail-close");

/**
 * Identity of the hover callout's target (`cluster:<id>` or `instance:<id>`).
 * Moving between replicas of one cluster keeps this key, so the readout does
 * not restart while the pointer crosses rack boundaries.
 */
let tipKey: string | null = null;

/** Target pinned by the last click, or null when nothing is selected. */
let selectedKey: string | null = null;

/** Element that owns the pinned callout. */
let selectedAnchor: Element | null = null;

/** Card size cached per content change, so pointer moves never read layout. */
let tipSize = { width: 0, height: 0 };

/** Preferred card offset from the anchor: above and slightly right. */
const CALLOUT_OFFSET_X = 41.6;
const CALLOUT_OFFSET_Y = -64;

/** Resolved hover or selection target. */
interface TargetIds {
  key: string;
  clusterId: string | null;
  instanceId: string | null;
}

/**
 * Resolve the instance or cluster element under a pointer event.
 *
 * A rack carries both its instance ID and its cluster ID, so the callout can
 * report the cluster that owns it. Frames and captions resolve the same way.
 */
function hoveredTarget(target: EventTarget | null): Element | null {
  return (
    (target as Element | null)?.closest?.(
      "[data-instance-id], [data-cluster-id]",
    ) ?? null
  );
}

/** Read an element's target identity, preferring its cluster. */
function targetIds(anchor: Element | null): TargetIds | null {
  const clusterId = anchor?.getAttribute("data-cluster-id") ?? null,
    instanceId = anchor?.getAttribute("data-instance-id") ?? null;
  if (clusterId) return { key: `cluster:${clusterId}`, clusterId, instanceId };
  if (instanceId)
    return { key: `instance:${instanceId}`, clusterId, instanceId };
  return null;
}

/** Member racks of a target; a standalone instance is its own member. */
function targetMembers(ids: TargetIds, anchor: Element): SVGGElement[] {
  if (!ids.clusterId) return [anchor as SVGGElement];
  return [...sceneSvg.querySelectorAll<SVGGElement>(".database-rack")].filter(
    (rack) => rack.dataset.clusterId === ids.clusterId,
  );
}

/** Fill the callout with the target summary and cache the card size. */
function fillCallout(ids: TargetIds, members: SVGGElement[]): void {
  calloutKind.textContent = ids.clusterId ? "Cluster" : "Instance";
  calloutName.textContent = ids.clusterId
    ? (clusterLabel(ids.clusterId) ?? ids.clusterId)
    : (members[0].querySelector(".instance-label")?.textContent ??
      ids.instanceId);
  calloutMeta.textContent = ids.clusterId
    ? `${members.length} replica${members.length === 1 ? "" : "s"}`
    : ids.instanceId;
  tipSize = {
    width: calloutCard.offsetWidth,
    height: calloutCard.offsetHeight,
  };
  callout.classList.remove("visible");
}

/** Reveal the callout, replaying the entry animation only when hidden. */
function revealCallout(): void {
  if (callout.classList.contains("visible")) return;
  // Flush the class removal so the entry animation replays for a new target
  // instead of being coalesced into the existing state.
  void callout.offsetWidth;
  callout.classList.add("visible");
}

/** Hide the callout and forget its target. */
function hideCallout(): void {
  tipKey = null;
  callout.classList.remove("visible");
}

/** Read a cluster's caption text; IDs are compared in JS to avoid escaping. */
function clusterLabel(clusterId: string | null): string | null {
  if (!clusterId) return null;
  for (const label of sceneSvg.querySelectorAll<SVGTextElement>(
    ".cluster-label",
  )) {
    if (label.dataset.clusterId === clusterId) return label.textContent;
  }
  return null;
}

/**
 * Position the card and leader relative to a client-space point.
 *
 * The wrapper sits exactly on the point, the card hangs up and to the right of
 * it, and both move together. The card is clamped to the stage so a target
 * near an edge still shows the readout; the leader always ends on the card
 * corner nearest the anchor.
 */
function positionCallout(point: { clientX: number; clientY: number }): void {
  const stageBox = stage.getBoundingClientRect(),
    anchorX = point.clientX - stageBox.left,
    anchorY = point.clientY - stageBox.top,
    margin = 12,
    cardX = Math.min(
      Math.max(CALLOUT_OFFSET_X, margin - anchorX),
      stageBox.width - margin - tipSize.width - anchorX,
    ),
    cardY = Math.min(
      Math.max(CALLOUT_OFFSET_Y - tipSize.height, margin - anchorY),
      stageBox.height - margin - tipSize.height - anchorY,
    ),
    corners = [
      [cardX, cardY],
      [cardX + tipSize.width, cardY],
      [cardX, cardY + tipSize.height],
      [cardX + tipSize.width, cardY + tipSize.height],
    ],
    [cornerX, cornerY] = corners.reduce((best, corner) =>
      Math.hypot(corner[0], corner[1]) < Math.hypot(best[0], best[1])
        ? corner
        : best,
    ),
    length = Math.hypot(cornerX, cornerY),
    angle = (Math.atan2(cornerY, cornerX) * 180) / Math.PI;

  callout.style.transform = `translate3d(${anchorX.toFixed(1)}px, ${anchorY.toFixed(1)}px, 0)`;
  callout.style.setProperty("--tip-x", `${cardX.toFixed(1)}px`);
  callout.style.setProperty("--tip-y", `${cardY.toFixed(1)}px`);
  callout.style.setProperty("--tip-line-length", `${length.toFixed(1)}px`);
  callout.style.setProperty("--tip-line-angle", `${angle.toFixed(2)}deg`);
}

/**
 * Show or move the hover callout.
 *
 * An instance inside a cluster reports the cluster, because the replicas form
 * one logical unit; a standalone instance reports itself. While a target is
 * pinned the hover readout stands down, so the pinned callout stays put.
 */
function showCallout(
  target: EventTarget | null,
  point: { clientX: number; clientY: number },
): void {
  if (selectedKey) return;
  const anchor = hoveredTarget(target),
    ids = targetIds(anchor);
  if (!anchor || !ids) {
    hideCallout();
    return;
  }
  if (ids.key !== tipKey) {
    const members = targetMembers(ids, anchor);
    if (members.length === 0) {
      hideCallout();
      return;
    }
    tipKey = ids.key;
    fillCallout(ids, members);
  }
  positionCallout(point);
  revealCallout();
}

/** Pin the callout to the selected target's top center. */
function lockCallout(): void {
  if (!selectedKey || !selectedAnchor) return;
  const ids = targetIds(selectedAnchor);
  if (!ids) return;
  if (ids.key !== tipKey) {
    const members = targetMembers(ids, selectedAnchor);
    if (members.length === 0) return;
    tipKey = ids.key;
    fillCallout(ids, members);
  }
  const point = scene.targetTopPoint(ids.key);
  if (!point) return;
  positionCallout({ clientX: point.x, clientY: point.y });
  revealCallout();
}

/**
 * Select a target: pin its callout, open details, and reframe the camera.
 *
 * The camera moves the target into the free area left of the detail panel with
 * a smooth pan; the scene owns the interpolation, so the shell only supplies
 * the desired client point.
 */
function selectTarget(anchor: Element | null): void {
  const ids = targetIds(anchor);
  if (!anchor || !ids) {
    clearSelection();
    return;
  }
  selectedKey = ids.key;
  selectedAnchor = anchor;
  tipKey = null;
  lockCallout();
  openDetail(ids);

  const stageBox = stage.getBoundingClientRect(),
    free = Math.max(220, stageBox.width - detail.offsetWidth - 28),
    margin = 16;
  scene.focus(ids.key, {
    x: stageBox.left + margin,
    y: stageBox.top + margin,
    width: free - margin * 2,
    height: stageBox.height - margin * 2,
  });
}

/** Drop the selection, hide the callout, and close the detail panel. */
function clearSelection(): void {
  if (!selectedKey) return;
  selectedKey = null;
  selectedAnchor = null;
  hideCallout();
  detail.classList.remove("open");
  detail.setAttribute("aria-hidden", "true");
}

/** Populate and open the read-only detail panel. */
function openDetail(ids: TargetIds): void {
  const clusterIndex = ids.clusterId
      ? current.clusters.findIndex(
          (cluster, index) =>
            (cluster.id ?? `cluster-${index + 1}`) === ids.clusterId,
        )
      : -1,
    cluster = clusterIndex >= 0 ? current.clusters[clusterIndex] : undefined,
    memberIds = cluster?.instances ?? (ids.instanceId ? [ids.instanceId] : []),
    members = memberIds.map((id) => {
      const index = current.instances.findIndex((item) => item.id === id);
      return {
        id,
        label: (index >= 0 && current.instances[index].label) || id,
        color: index >= 0 ? instanceColor(index) : "var(--line)",
      };
    }),
    memberSet = new Set(memberIds),
    links = current.connections.filter(
      (link) => memberSet.has(link.from) || memberSet.has(link.to),
    );

  detailKind.textContent = ids.clusterId ? "Cluster" : "Instance";
  detailTitle.textContent = ids.clusterId
    ? (cluster?.label ?? ids.clusterId)
    : ((ids.instanceId &&
        current.instances.find((item) => item.id === ids.instanceId)?.label) ??
      ids.instanceId ??
      "");
  detailCount.textContent = String(memberIds.length);
  detailLinkCount.textContent = String(links.length);

  const specRow = (term: string, value: string) => {
    const row = document.createElement("div"),
      dt = document.createElement("dt"),
      dd = document.createElement("dd");
    row.className = "detail-spec-row";
    dt.textContent = term;
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  };
  detailSpec.replaceChildren(
    specRow("ID", ids.clusterId ?? ids.instanceId ?? ""),
    specRow("Kind", ids.clusterId ? "Cluster" : "Instance"),
    specRow("Replicas", String(memberIds.length)),
    specRow("Links", String(links.length)),
  );

  detailReplicas.replaceChildren(
    ...members.map((member, index) => {
      const item = document.createElement("li"),
        number = document.createElement("span"),
        dot = document.createElement("span"),
        label = document.createElement("span"),
        id = document.createElement("span");
      item.className = "detail-replica";
      number.className = "detail-index";
      number.textContent = String(index + 1).padStart(2, "0");
      dot.className = "detail-dot";
      dot.style.setProperty("--dot", member.color);
      label.className = "detail-replica-label";
      label.textContent = member.label;
      id.className = "detail-replica-id";
      id.textContent = member.id;
      item.append(number, dot, label, id);
      return item;
    }),
  );

  const empty = document.createElement("li");
  empty.className = "detail-empty";
  empty.textContent = "No links";
  detailLinks.replaceChildren(
    ...(links.length === 0
      ? [empty]
      : links.map((link) => {
          const item = document.createElement("li"),
            route = document.createElement("span"),
            relation = document.createElement("span");
          item.className = "detail-link";
          route.className = "detail-route";
          route.textContent = `${link.from} → ${link.to}`;
          relation.className = "detail-relation";
          relation.textContent =
            link.relation ??
            (memberSet.has(link.from) && memberSet.has(link.to)
              ? "internal"
              : "external");
          item.append(route, relation);
          return item;
        })),
  );

  detail.classList.add("open");
  detail.removeAttribute("aria-hidden");
}

sceneSvg.addEventListener("pointerover", (event) =>
  showCallout(event.target, event),
);
sceneSvg.addEventListener("pointermove", (event) =>
  showCallout(event.target, event),
);
sceneSvg.addEventListener("pointerleave", () => {
  if (!selectedKey) hideCallout();
});
// Panning and zooming move every anchor; drop an unpinned callout rather than
// leave it pointing at pixels the object has left. A pinned callout follows
// the target through the scene's view-change callback instead.
for (const type of ["pointerdown", "wheel"] as const) {
  sceneSvg.addEventListener(
    type,
    () => {
      if (!selectedKey) hideCallout();
    },
    { passive: true },
  );
}

// Click selects the instance or cluster under the pointer. The target is
// captured on pointerdown because the scene grabs pointer capture for panning,
// which retargets the later pointerup to the SVG. Distance guards reject the
// click that ends a pan, which would otherwise select by accident.
let press: { x: number; y: number; target: Element | null } | null = null;
sceneSvg.addEventListener("pointerdown", (event) => {
  press =
    event.button === 0
      ? {
          x: event.clientX,
          y: event.clientY,
          target: hoveredTarget(event.target),
        }
      : null;
});
sceneSvg.addEventListener("pointerup", (event) => {
  if (event.button !== 0 || !press) return;
  const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y),
    target = press.target;
  press = null;
  if (moved > 5) return;
  if (sidebar.classList.contains("open")) setPanelOpen(false);
  selectTarget(target);
});

scene.onViewChange(() => {
  if (selectedKey) lockCallout();
});

detailClose.addEventListener("click", clearSelection);

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
  clearSelection();
  hideCallout();
  scene.render(design);
  current = design;
  source.value = JSON.stringify(design, null, 2);
  sceneTitle.textContent = design.name;
  const clusters = design.clusters.length;
  sceneCount.textContent = `${design.instances.length} instances · ${
    design.connections.length
  } links${
    clusters === 0 ? "" : ` · ${clusters} cluster${clusters === 1 ? "" : "s"}`
  }`;
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

toggle.addEventListener("click", () => {
  clearSelection();
  setPanelOpen(true);
});
closeButton.addEventListener("click", () => setPanelOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (sidebar.classList.contains("open")) setPanelOpen(false);
  else clearSelection();
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
