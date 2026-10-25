import "./style.css";
import type { Design } from "./design";
import { examples, parseDesign, webAppExample } from "./design";
import { inferInstanceType, instanceColor } from "./layout";
import { resizeReplicas } from "./replicas";
import { findProvider, providersFor } from "./providers";
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
      <desc id="scene-description">Isometric system diagram with linked components. Pinch or scroll to zoom, drag to move, or open Design to edit JSON and load examples. Select a component to inspect its connections.</desc>
    </svg>
    <div id="callout" class="callout" aria-hidden="true">
      <div class="callout-card">
        <span class="callout-provider" hidden></span>
        <span class="callout-kind"></span>
        <span class="callout-name"></span>
        <span class="callout-meta"></span>
        <div class="callout-description" hidden></div>
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
        <section id="detail-provider-section" class="detail-section">
          <label class="detail-label" for="detail-provider"><span>Provider</span></label>
          <select id="detail-provider" class="detail-provider-select"></select>
        </section>
        <section class="detail-section">
          <div class="detail-label"><span>Replicas</span><span class="replica-stepper"><button id="replica-decrease" type="button" aria-label="Decrease replicas"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4"/></svg></button><span id="detail-count" aria-live="polite"></span><button id="replica-increase" type="button" aria-label="Increase replicas"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></button></span></div>
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
          <div class="section-label">Examples</div>
          <label class="field" for="example">
            <span>Reference design</span>
            <select id="example" aria-describedby="example-hint">
              <option value="" disabled>Choose an example…</option>
            </select>
          </label>
          <p id="example-hint" class="view-hint" aria-live="polite"></p>
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
          <code>instances: [{ id, label?, description?, provider? }]<br>connections: [{ from, to, relation? }]<br>clusters: [{ label?, description?, instances }]</code>
          <p>ID prefixes pick the visual: db- for databases, compute- or server- for backend servers, web- for frontend pages, cache- for in-memory caches. Connect IDs with from/to and describe traffic with relation. Positions and colors are generated; cluster members keep separate platforms.</p>
          <p>An optional provider switches a component to a product skin. Redis applies only to cache nodes: it reworks the cache silhouette and platform, prints the official Redis mark on the cabinet, and replaces the accent with Redis red. Provider changes build the new cabinet layer by layer: base first, stacked body sections seating one at a time, then the top cap. Completed layers stay fixed; there are no swinging panels or wireframe chassis. The camera stays fixed. Up to three cabinets animate together; additional replicas queue. Reduced motion uses an immediate switch. Other renderers ignore providers they do not support, so documents stay portable.</p>
          <p>Select a component and use the replica arrows to scale from 1 to 10. Each column holds at most five replicas; additional columns sit behind it, spaced by the actual platform footprint so compact provider cabinets stay compact instead of inheriting the wider rack pitch. New replicas drop onto their platforms (unless reduced motion is enabled), and rapid additions keep existing drops running. Multiple replicas become a cluster; returning to one restores an instance. Changes update the JSON. Links on removed replicas move to the surviving instance.</p>
          <p>Each renderer has a default palette: databases cyan, backend servers orange, frontend pages violet, caches green. A provider may supply its own accent, artwork, and live detail layer; only static artwork is cached, so activity LEDs and packets keep moving. Every node shares cached artwork by type and provider, so replicas and repeated designs reuse the same images. Visible nodes are prewarmed while idle, and removing a replica keeps shared images available for re-addition. Zoom reuses the previous image until a sharper tier is ready; labels remain live. Internal cable pulses pause during navigation and resume at rest. Offscreen nodes are culled and return when panned into view. Links between components remain visible.</p>
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
// Camera frames only need the fixed stage's cached rectangle. Reading layout
// after each viewBox write forces the detailed SVG to synchronously relayout.
let stageBounds = stage.getBoundingClientRect();
new ResizeObserver(() => {
  stageBounds = stage.getBoundingClientRect();
}).observe(stage);
const callout = mustQuery<HTMLElement>("#callout");
const calloutCard = mustQuery<HTMLElement>("#callout .callout-card");
const calloutKind = mustQuery<HTMLElement>("#callout .callout-kind");
const calloutName = mustQuery<HTMLElement>("#callout .callout-name");
const calloutMeta = mustQuery<HTMLElement>("#callout .callout-meta");
const calloutDescription = mustQuery<HTMLElement>(
  "#callout .callout-description",
);
const calloutProvider = mustQuery<HTMLElement>("#callout .callout-provider");

const detail = mustQuery<HTMLElement>("#detail");
const detailProvider = mustQuery<HTMLSelectElement>("#detail-provider");
const detailProviderSection = mustQuery<HTMLElement>(
  "#detail-provider-section",
);
const detailKind = mustQuery<HTMLElement>("#detail-kind");
const detailTitle = mustQuery<HTMLElement>("#detail-title");
const detailSpec = mustQuery<HTMLElement>("#detail-spec");
const detailCount = mustQuery<HTMLElement>("#detail-count");
const replicaDecrease = mustQuery<HTMLButtonElement>("#replica-decrease");
const replicaIncrease = mustQuery<HTMLButtonElement>("#replica-increase");
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
/** Replica identity changes descriptions without restarting cluster animation. */
let tipInstanceId: string | null = null;

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
 * Standalone instances get a synthetic border frame keyed `instance:<id>`;
 * such a frame selects as the instance itself, never as a phantom cluster.
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
  if (clusterId?.startsWith("instance:"))
    return {
      key: clusterId,
      clusterId: null,
      instanceId: clusterId.slice(9) || instanceId,
    };
  if (clusterId) return { key: `cluster:${clusterId}`, clusterId, instanceId };
  if (instanceId)
    return { key: `instance:${instanceId}`, clusterId, instanceId };
  return null;
}

/** Member racks of a target; a standalone instance is its own member. */
function targetMembers(ids: TargetIds, anchor: Element): SVGGElement[] {
  if (!ids.clusterId) {
    if (anchor.classList.contains("scene-instance"))
      return [anchor as SVGGElement];
    // A synthetic border frame was the anchor: resolve the instance it wraps.
    const instance = ids.instanceId
      ? sceneSvg.querySelector<SVGGElement>(
          `[data-instance-id="${CSS.escape(ids.instanceId)}"]`,
        )
      : null;
    return instance ? [instance] : [];
  }
  return [...sceneSvg.querySelectorAll<SVGGElement>(".scene-instance")].filter(
    (rack) => rack.dataset.clusterId === ids.clusterId,
  );
}

/**
 * Provider declared on an instance in the applied design.
 *
 * A registered theme resolves to its canonical id only when the instance's
 * renderer supports it, and a provider on an unsupported renderer is treated
 * as absent. Unknown keys on a renderer that has provider support are returned
 * verbatim so the picker can preserve them.
 */
function instanceProvider(
  instanceId: string | null | undefined,
): string | undefined {
  if (!instanceId) return undefined;
  const instance = current.instances.find((item) => item.id === instanceId),
    type = inferInstanceType(instanceId),
    theme = findProvider(instance?.provider, type);
  if (theme) return theme.id;
  return providersFor(type).length > 0 ? instance?.provider : undefined;
}

/** Select value used when a cluster's members declare different providers. */
const MIXED_PROVIDER = "__mixed";

/**
 * Provider state for a set of instance ids.
 *
 * A cluster can mix providers, and claiming one product's mark for the whole
 * group would be misleading, so `mixed` reports the disagreement and
 * `provider` is set only when the declaration is unanimous. A single instance
 * trivially shares its own provider, including "none".
 */
function providerState(instanceIds: readonly (string | undefined)[]): {
  provider?: string;
  mixed: boolean;
} {
  const providers = new Set(instanceIds.map(instanceProvider));
  return providers.size === 1
    ? { provider: [...providers][0], mixed: false }
    : { provider: undefined, mixed: true };
}

/**
 * Providers every member of a target supports.
 *
 * A mixed-type cluster only offers a provider that can skin every one of its
 * members; a database target returns none, so the inspector hides the field.
 */
function providerOptions(instanceIds: readonly string[]) {
  if (instanceIds.length === 0) return [];
  return providersFor(inferInstanceType(instanceIds[0])).filter((theme) =>
    instanceIds.every((id) => theme.types.includes(inferInstanceType(id))),
  );
}

/**
 * Registered provider shared by every callout target member, if any.
 *
 * The tooltip only shows a logo that the target's renderer actually accepts;
 * an incompatible or unknown provider stays invisible.
 */
function calloutProviderName(
  members: readonly SVGGElement[],
): string | undefined {
  const providers = new Set(
    members.map((member) => {
      const id = member.dataset.instanceId;
      if (!id) return undefined;
      const instance = current.instances.find((item) => item.id === id);
      return findProvider(instance?.provider, inferInstanceType(id))?.id;
    }),
  );
  return providers.size === 1 ? [...providers][0] : undefined;
}

/**
 * Show or hide the provider mark in the callout.
 *
 * The mark is trusted registry markup, so assigning it as HTML is safe. It is
 * absolutely positioned inside the card's header block and reserves no width,
 * so showing a logo never resizes the tooltip.
 */
function setCalloutProvider(provider: string | undefined): void {
  const theme = findProvider(provider);
  calloutProvider.hidden = !theme;
  if (theme) {
    calloutProvider.innerHTML = theme.logo;
    calloutProvider.title = theme.label;
    calloutProvider.style.setProperty("--provider-color", theme.color);
    if (theme.plate)
      calloutProvider.style.setProperty("--provider-plate", theme.plate);
    else calloutProvider.style.removeProperty("--provider-plate");
  } else {
    calloutProvider.replaceChildren();
    calloutProvider.removeAttribute("title");
    calloutProvider.style.removeProperty("--provider-color");
    calloutProvider.style.removeProperty("--provider-plate");
  }
}

/**
 * Synchronize the inspector's provider picker with a target's members.
 *
 * The picker lives in the right-hand detail HUD. Its options are rebuilt for
 * the target so only providers that support the member renderer types appear;
 * databases, servers, and pages have no provider field at all. An unknown
 * stored key gets a transient option so the control never misreports the
 * document, and a mixed cluster shows a disabled placeholder until one value
 * is chosen for every member.
 */
function syncDetailProvider(instanceIds: readonly string[]): void {
  const allowed = providerOptions(instanceIds);
  detailProviderSection.hidden = allowed.length === 0;
  if (allowed.length === 0) return;

  const { provider, mixed } = providerState(instanceIds),
    options = [new Option("Default", "")];
  for (const theme of allowed) options.push(new Option(theme.label, theme.id));
  if (mixed) {
    const option = new Option("Mixed", MIXED_PROVIDER);
    option.disabled = true;
    options.push(option);
  } else if (provider !== undefined && !allowed.some((t) => t.id === provider))
    options.push(new Option(provider, provider));
  detailProvider.replaceChildren(...options);
  detailProvider.value = mixed
    ? MIXED_PROVIDER
    : (allowed.find((theme) => theme.id === provider)?.id ?? provider ?? "");
}

/** Fill the callout with the target summary and cache the card size. */
function fillCallout(
  ids: TargetIds,
  members: SVGGElement[],
  restart = true,
): void {
  tipInstanceId = ids.instanceId;
  calloutKind.textContent = ids.clusterId ? "Cluster" : "Instance";
  calloutName.textContent = ids.clusterId
    ? (clusterLabel(ids.clusterId) ?? ids.clusterId)
    : (members[0].querySelector(".instance-label")?.textContent ??
      ids.instanceId);
  calloutMeta.textContent = ids.clusterId
    ? `${members.length} replica${members.length === 1 ? "" : "s"}`
    : ids.instanceId;
  // Group descriptions take precedence; a replica can supply its own when the
  // group has none. Frame/caption hovers only have the group's description.
  const groupDescription = ids.clusterId
    ? current.clusters.find(
        (cluster, index) =>
          (cluster.id ?? `cluster-${index + 1}`) === ids.clusterId,
      )?.description
    : undefined;
  const description =
    groupDescription ??
    current.instances.find((instance) => instance.id === ids.instanceId)
      ?.description;
  calloutDescription.textContent = description ?? "";
  calloutDescription.hidden = description === undefined;
  setCalloutProvider(calloutProviderName(members));
  tipSize = {
    width: calloutCard.offsetWidth,
    height: calloutCard.offsetHeight,
  };
  if (restart) callout.classList.remove("visible");
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
  const stageBox = stageBounds,
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
  if (ids.key !== tipKey || ids.instanceId !== tipInstanceId) {
    const restart = ids.key !== tipKey;
    const members = targetMembers(ids, anchor);
    if (members.length === 0) {
      hideCallout();
      return;
    }
    tipKey = ids.key;
    fillCallout(ids, members, restart);
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
 * Select a target: pin its callout, open details, optionally reframe the camera.
 *
 * The camera moves the target into the free area left of the detail panel with
 * a smooth pan; the scene owns the interpolation, so the shell only supplies
 * the desired client point. Provider edits preserve the current view so the
 * mechanical change starts in place, without waiting for another camera glide.
 */
function selectTarget(
  anchor: Element | null,
  options: { preserveCallout?: boolean; camera?: "focus" | "preserve" } = {},
): void {
  const ids = targetIds(anchor);
  if (!anchor || !ids) {
    clearSelection();
    return;
  }
  selectedKey = ids.key;
  selectedAnchor = anchor;
  scene.setFocus(ids.key);
  if (options.preserveCallout) {
    tipKey = ids.key;
    fillCallout(ids, targetMembers(ids, anchor), false);
  } else tipKey = null;
  lockCallout();
  openDetail(ids);
  if (options.camera === "preserve") return;

  const stageBox = stageBounds,
    free = Math.max(220, stageBox.width - detail.offsetWidth - 28),
    margin = 16;
  scene.focus(ids.key, {
    x: stageBox.left + margin,
    y: stageBox.top + margin,
    width: free - margin * 2,
    height: stageBox.height - margin * 2,
  });
}

/** Drop the selection, hide the callout, close the detail panel, and undim. */
function clearSelection(): void {
  if (!selectedKey) return;
  selectedKey = null;
  selectedAnchor = null;
  scene.setFocus(null);
  hideCallout();
  detail.classList.remove("open");
  detail.setAttribute("aria-hidden", "true");
}

/** Populate the inspector and synchronize its bounded replica controls. */
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
        color:
          index >= 0
            ? instanceColor(
                inferInstanceType(id),
                current.instances[index].provider,
              )
            : "var(--line)",
      };
    }),
    memberSet = new Set(memberIds),
    links = current.connections.filter(
      (link) => memberSet.has(link.from) || memberSet.has(link.to),
    );

  detailKind.textContent = ids.clusterId ? "Cluster" : "Instance";
  syncDetailProvider(memberIds);
  detailTitle.textContent = ids.clusterId
    ? (cluster?.label ?? ids.clusterId)
    : ((ids.instanceId &&
        current.instances.find((item) => item.id === ids.instanceId)?.label) ??
      ids.instanceId ??
      "");
  detailCount.textContent = String(memberIds.length);
  replicaDecrease.disabled = memberIds.length <= 1;
  replicaIncrease.disabled = memberIds.length >= 10;
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

/**
 * Apply a replica edit without closing the inspector or resetting the camera.
 * Rebind the pinned anchor after reconciling cluster membership and layout.
 */
function changeReplicas(delta: number): void {
  const ids = targetIds(selectedAnchor);
  if (!ids) return;
  const cluster = ids.clusterId
    ? current.clusters.find(
        (item, index) => (item.id ?? `cluster-${index + 1}`) === ids.clusterId,
      )
    : undefined;
  const memberId = cluster?.instances[0] ?? ids.instanceId;
  if (!memberId) return;
  const count = (cluster?.instances.length ?? 1) + delta;
  if (count < 1 || count > 10) return;
  const design = resizeReplicas(current, memberId, count);
  scene.render(design, true);
  current = design;
  syncDesign();
  const anchor = [...sceneSvg.querySelectorAll(".scene-instance")].find(
    (element) => element.getAttribute("data-instance-id") === memberId,
  );
  selectTarget(anchor ?? null, { preserveCallout: true });
}

replicaDecrease.addEventListener("click", () => changeReplicas(-1));
replicaIncrease.addEventListener("click", () => changeReplicas(1));

/**
 * Set or clear the provider for every instance of the focused target.
 *
 * The document stays the source of truth: choosing Default removes the field
 * instead of storing a "none" sentinel, which keeps old designs and unknown
 * providers portable. The scene re-renders in place so the node keeps its
 * position and camera; selection is rebound because provider skins rebuild
 * geometry and may change labels and height.
 */
function changeProvider(provider: string | undefined): void {
  const ids = targetIds(selectedAnchor);
  if (!selectedAnchor || !ids) return;
  const memberIds = new Set(
    targetMembers(ids, selectedAnchor)
      .map((member) => member.dataset.instanceId)
      .filter((id): id is string => id !== undefined),
  );
  if (memberIds.size === 0 && ids.instanceId) memberIds.add(ids.instanceId);
  if (memberIds.size === 0) return;
  if (
    provider !== undefined &&
    !providerOptions([...memberIds]).some((theme) => theme.id === provider)
  )
    return;

  let changed = false;
  const instances = current.instances.map((instance) => {
    if (!memberIds.has(instance.id)) return instance;
    if ((instance.provider ?? "") === (provider ?? "")) return instance;
    changed = true;
    const { provider: _previous, ...rest } = instance;
    return provider === undefined ? rest : { ...rest, provider };
  });
  if (!changed) return;

  const design: Design = { ...current, instances };
  scene.render(design, true);
  current = design;
  syncDesign();
  // Provider skins rebuild the component root, so rebind the pinned target to
  // the live node before refreshing the inspector and callout.
  const anchor = [
    ...sceneSvg.querySelectorAll<SVGGElement>(".scene-instance"),
  ].find((element) => {
    const id = element.dataset.instanceId;
    return id !== undefined && memberIds.has(id);
  });
  selectTarget(anchor ?? null, { preserveCallout: true, camera: "preserve" });
}

detailProvider.addEventListener("change", () => {
  const value = detailProvider.value;
  if (!selectedKey || value === MIXED_PROVIDER) return;
  changeProvider(value === "" ? undefined : value);
});

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

// A camera move and a fixed-camera re-render (node drag, replica edit) both
// move the target on screen; keep the whole pinned callout on its top center.
const followPinnedCallout = (): void => {
  if (selectedKey) lockCallout();
};
scene.onViewChange(followPinnedCallout);
scene.onLayoutChange(followPinnedCallout);

detailClose.addEventListener("click", clearSelection);

/** Last successfully applied document; exports must never read the draft. */
let current: Design = webAppExample;

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
  // Manual placement offsets belong to the outgoing scene's instance ids and
  // must not leak into a document whose ids may repeat with new meaning.
  scene.clearOffsets();
  scene.render(design);
  current = design;
  syncDesign();
}

/** Keep the JSON editor and scene metadata in sync with every applied edit. */
function syncDesign(): void {
  const design = current;
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

const exampleSelect = mustQuery<HTMLSelectElement>("#example");
const exampleHint = mustQuery<HTMLElement>("#example-hint");

/**
 * Explain the selected reference design in the picker's teaching note.
 *
 * A null id means the canvas holds a custom or imported document, so the note
 * falls back to the picker's prompt rather than describing a design that is
 * no longer loaded.
 */
function showExampleSummary(exampleId: string | null): void {
  exampleHint.textContent =
    examples.find((item) => item.id === exampleId)?.summary ??
    "Choose a reference design to load it on the canvas.";
}

for (const item of examples) {
  const option = document.createElement("option");
  option.value = item.id;
  option.textContent = item.design.name;
  exampleSelect.append(option);
}

// The default scene is one of the catalogue entries; selecting it on boot and
// after Reset keeps the control and the canvas telling the same story.
const defaultExample = examples.find(({ design }) => design === webAppExample);
if (!defaultExample) throw new Error("Missing default design example.");
const defaultExampleId = defaultExample.id;
exampleSelect.value = defaultExampleId;
showExampleSummary(defaultExampleId);

/**
 * Apply a document that did not come from the picker.
 *
 * Clearing the selection keeps the control from claiming a custom or imported
 * design is still one of the reference examples.
 */
function applyCustom(design: Design): void {
  apply(design);
  exampleSelect.value = "";
  showExampleSummary(null);
}

applyButton.addEventListener("click", () => {
  // Parse/validate before rendering so a bad document cannot partially apply.
  try {
    applyCustom(parseDesign(source.value));
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

mustQuery<HTMLButtonElement>("#reset").addEventListener("click", () => {
  apply(webAppExample);
  exampleSelect.value = defaultExampleId;
  showExampleSummary(defaultExampleId);
});
exampleSelect.addEventListener("change", () => {
  const selected = examples.find((item) => item.id === exampleSelect.value);
  if (!selected) return;
  apply(selected.design);
  showExampleSummary(selected.id);
});

const file = mustQuery<HTMLInputElement>("#file");
mustQuery<HTMLButtonElement>("#import").addEventListener("click", () =>
  file.click(),
);

file.addEventListener("change", async () => {
  const selected = file.files?.[0];
  if (!selected) return;
  try {
    applyCustom(parseDesign(await selected.text()));
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
  // Escape belongs to an open select (closing its popup), not to the canvas
  // selection; clearing both at once would fight the native control.
  if (event.key !== "Escape" || event.target instanceof HTMLSelectElement)
    return;
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

apply(webAppExample);
