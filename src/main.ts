import "./style.css";
import type { Design } from "./design";
import {
  examples,
  parseDesign,
  webAppExample,
  MAX_INSTANCES,
  DEFAULT_CACHE_HIT_PERCENT,
} from "./design";
import { inferInstanceType, instanceColor } from "./layout";
import { resizeReplicas } from "./replicas";
import { findProvider, providersFor } from "./providers";
import { SystemScene } from "./scene";
import { WorldBuilder } from "./world-builder";
import { pinWorld, BUILD_TYPES } from "./construction";
import { replicaIssue } from "./component-rules";
import { FlowNodeEditor } from "./flow-node-editor";
import {
  placeCallout,
  placeOverviewLabels,
  type CalloutRect,
  type OverviewLabel,
} from "./callout-layout";
import { TrafficControls } from "./traffic-controls";
import { capacityRps } from "./traffic";

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
    <svg id="scene" xmlns="http://www.w3.org/2000/svg" role="group" aria-labelledby="scene-description" preserveAspectRatio="xMidYMid meet">
      <desc id="scene-description">Isometric system diagram with linked components and ground-border capacity meters. Pinch or scroll to zoom, drag to move, or open Design to edit JSON and load examples. Select a service to set its capacity. Run the simulation from Design.</desc>
    </svg>
    <a class="iso-credit" href="https://iso-glow.vercel.app" target="_blank" rel="noreferrer">Made with ISO-GLOW ↗</a>
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
        <section id="detail-capacity" class="detail-section" hidden>
          <form id="capacity-form">
            <label class="detail-label" for="capacity-rps">Per-node capacity · requests/s</label>
            <input id="capacity-rps" type="number" min="1" max="1000000" step="any" required>
            <button class="btn" type="submit">Set capacity</button>
            <p id="capacity-message" class="detail-empty" role="status">Illustrative throughput budget, not a provider benchmark.</p>
          </form>
        </section>
        <section id="detail-source" class="detail-section" hidden>
          <form id="source-traffic-form">
            <label class="detail-label" for="users-traffic-rps">Users · requests per second</label>
            <input id="users-traffic-rps" type="number" min="0" max="20" step="any" required>
            <button class="btn" type="submit">Set traffic</button>
            <p id="source-traffic-message" class="detail-empty" role="status">One dot is one request. Set 0 to stop this source; maximum 20 requests/s.</p>
          </form>
        </section>
        <section id="detail-cache" class="detail-section" hidden>
          <form id="cache-settings-form">
            <label class="detail-label" for="cache-hit-percent">Cache hit coverage · %</label>
            <input id="cache-hit-percent" type="number" min="0" max="100" step="any" required>
            <button class="btn" type="submit">Set cache coverage</button>
            <p id="cache-settings-message" class="detail-empty" role="status">Hits return from this cache; only misses continue downstream.</p>
          </form>
        </section>
        <section id="detail-scaling" class="detail-section">
          <div class="detail-label"><span id="detail-scaling-label">Scaling</span><span class="replica-stepper"><button id="replica-decrease" type="button" aria-label="Decrease replicas"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4"/></svg></button><span id="detail-count" aria-live="polite"></span><button id="replica-increase" type="button" aria-label="Increase replicas"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></button></span></div>
          <ul id="detail-replicas" class="detail-replicas"></ul>
          <p id="detail-scaling-reason" class="detail-empty" hidden></p>
        </section>
        <section class="detail-section">
          <div class="detail-label"><span>Links</span><span id="detail-link-count"></span></div>
          <ul id="detail-links" class="detail-links"></ul>
        </section>
      </div>
    </aside>
    <div class="top-actions">
      <button id="view-toggle" class="view-toggle" type="button" aria-pressed="false">View</button>
      <button id="panel-toggle" class="panel-toggle" type="button" aria-expanded="false" aria-controls="sidebar">
        <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 4h10M2 7h10M2 10h10"/></svg>
        <span>Design</span>
      </button>
    </div>
    <div id="architecture-labels" class="architecture-labels" role="list" aria-label="Architecture labels"></div>
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

        <section id="simulation-section" class="section">
          <div class="section-label">Simulation</div>
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
          <code>instances: [{ id, label?, provider?, placement?, trafficRps?, capacityRps?, cacheHitPercent?, condition?, mergeMode?, latencyMs? }]<br>connections: [{ id?, from, to, outlet?, relation? }]<br>clusters: [{ label?, instances }]<br>groups: [{ id, label, instances }]</code>
          <p>Open Components at the bottom to add to your system. The drawer contains only component categories and cards. Drag a component into the world, or select a card and click clear ground. Placements snap to the build grid and are saved in placement. Arrow keys move a keyboard-selected preview; Enter places it and Escape cancels. Right-click nodes to wire or delete them. Wiring opens a separate endpoint editor; choose a destination in the world or use its controls. A machine's anchor handle moves an existing node or replica group; completed moves are saved with the design. Right-click empty ground for New world.</p>
          <p>Groups organize any mix of nodes without changing their connections or replica pools. Right-click empty ground and choose Select nodes to group, then click nodes or drag a selection box, name the selection and create a group. Group management opens separately from the component drawer. Shift-click starts multi-selection; Ctrl/Cmd+G opens grouping. Click a group's title or use its right-click menu to rename it or change membership. Drag its ground-plane title plate to move every member together; focused titles also support arrow keys. Ungroup removes only the container, never its nodes or wires. Groups and their positions round-trip through JSON.</p>
          <p>Right-click a node, group title or empty ground for quick actions: inspect, start a wire, add/remove selection, group, ungroup or delete. Multi-node actions apply to the selection only when you right-click one of its members; right-clicking another node targets just that node. If/Else exposes separate TRUE/FALSE wiring actions. Shift+F10 or the Context Menu key opens quick actions from the world; arrows navigate, Enter activates, and Escape closes without losing selection.</p>
          <p>ID prefixes pick the visual: users- traffic sources, db- databases, compute-/server- APIs, web- frontend clients, cache- caches, cdn- delivery edges, queue- queues, storage- storage, worker- workers, branch- If/Else, and merge- convergence. Without placement, positions are automatic; manual sites remain fixed through export and import.</p>
          <p>An optional provider switches a component to a product skin. Redis applies only to cache nodes: it reworks the cache silhouette and platform, prints the official Redis mark on the cabinet, and replaces the accent with Redis red. Provider changes build the new cabinet layer by layer: base first, stacked body sections seating one at a time, then the top cap. Completed layers stay fixed; there are no swinging panels or wireframe chassis. The camera stays fixed. Up to three cabinets animate together; additional replicas queue. Reduced motion uses an immediate switch. Other renderers ignore providers they do not support, so documents stay portable.</p>
          <p>CDN nodes support ${providersFor("cdn")
            .map(({ id, label }) => `${label} (<code>${id}</code>)`)
            .join(
              ", ",
            )}. Select an independent edge and choose its provider in the inspector, or set provider in JSON. Repeated products share cached artwork, not replica controls.</p>
          <p>Only supported machines scale: API/compute and worker instances, database/cache replicas, never SQLite server replicas. Clients, CDNs, queues, buckets, If/Else and Merge nodes are logical components, not replicable machines. Replica groups require the same component type and provider. Scale from 1 to 10 within the world limit; new members inherit behavior, not an occupied placement.</p>
          <p>Wires stay neutral; individual requests go out and response rings return. Right-click a wire for Cut or Add node. Add inserts a compatible component between endpoints without moving existing nodes. Select a cache to set hit coverage: 90% serves nine requests locally and sends every tenth downstream. Hits return immediately after cache processing; misses wait for the origin. Focus a wire and press Enter for the same menu.</p>
          <p>This is a visual system-design sandbox: no external integrations, cloud calls, real uploads or transcoding. The editable media-app example is available in the Examples menu.</p>
          <p>Add Users and wire it to a frontend. Select Users to set traffic (0–20 requests/s), then Run. Each source has its own persisted rate. Every hop between nodes takes a fixed 300ms simulated; Run advances that clock in real time. Step advances 10ms. Load stops at 100% and excess requests wait FIFO. The Design sidebar tracks root-call p95, p99 and errors over 30 simulated seconds; crossing a crash limit freezes the system until Reset. This is an educational model, not a provider benchmark.</p>
          <p>If/Else and Merge are compact junctions directly on the wires, not machines. Choose TRUE/FALSE in Wire, and select a junction to edit its condition or merge mode. Invalid connection types are rejected in both the builder and JSON imports.</p>
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
let builder: WorldBuilder | undefined;
let nodeEditor: FlowNodeEditor | undefined;
let traffic: TrafficControls | undefined;
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
const viewToggle = mustQuery<HTMLButtonElement>("#view-toggle");
const architectureLabels = mustQuery<HTMLElement>("#architecture-labels");
let viewMode = false;

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

/** Cached HTML overlay geometry; pointer movement never forces panel layout. */
let calloutObstacles: CalloutRect[] = [];
const calloutPoint = { clientX: 0, clientY: 0 };
let hasCalloutPoint = false;

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
 * members; incompatible mixed-type targets hide the field.
 */
function providerOptions(instanceIds: readonly string[]) {
  if (instanceIds.length === 0) return [];
  return providersFor(inferInstanceType(instanceIds[0])).filter(
    (theme) =>
      instanceIds.every((id) => theme.types.includes(inferInstanceType(id))) &&
      (instanceIds.length < 2 ||
        !replicaIssue({ id: instanceIds[0], provider: theme.id })),
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
  const componentType = inferInstanceType(
    ids.instanceId ?? members[0]?.dataset.instanceId ?? "",
  );
  calloutKind.textContent = ids.clusterId
    ? "Cluster"
    : BUILD_TYPES.find((item) => item.type === componentType)!.label;
  calloutName.textContent = ids.clusterId
    ? (clusterLabel(ids.clusterId) ?? ids.clusterId)
    : (members[0].querySelector(".instance-label")?.textContent ??
      ids.instanceId);
  calloutMeta.textContent = ids.clusterId
    ? `${members.length} ${componentType === "compute-server" || componentType === "media-worker" ? "instance" : "replica"}${members.length === 1 ? "" : "s"}`
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
  hasCalloutPoint = false;
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
  calloutPoint.clientX = point.clientX;
  calloutPoint.clientY = point.clientY;
  hasCalloutPoint = true;
  const stageBox = stageBounds,
    anchorX = point.clientX - stageBox.left,
    anchorY = point.clientY - stageBox.top,
    placement = placeCallout(
      { x: anchorX, y: anchorY },
      tipSize,
      stageBox,
      calloutObstacles,
    ),
    cardX = placement.x - anchorX,
    cardY = placement.y - anchorY,
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
  const capacities = current.instances
    .filter((node) => memberSet.has(node.id))
    .map(capacityRps);
  const capacitySection = mustQuery<HTMLElement>("#detail-capacity");
  capacitySection.hidden =
    capacities.length === 0 || capacities.some((value) => value === null);
  const capacityInput = mustQuery<HTMLInputElement>("#capacity-rps");
  const commonCapacity = capacities.every((value) => value === capacities[0]);
  capacityInput.value =
    commonCapacity && capacities[0] !== null ? String(capacities[0]) : "";
  capacityInput.placeholder = commonCapacity ? "" : "Mixed budgets";
  mustQuery<HTMLElement>("#capacity-message").textContent =
    memberIds.length > 1
      ? "Applies this requests/s budget to each member, not the whole pool."
      : "Illustrative throughput budget, not a provider benchmark.";
  const selectedSource = current.instances.find(
    (node) => memberSet.has(node.id) && inferInstanceType(node.id) === "users",
  );
  mustQuery<HTMLElement>("#detail-source").hidden = !selectedSource;
  if (selectedSource)
    mustQuery<HTMLInputElement>("#users-traffic-rps").value = String(
      selectedSource.trafficRps ?? 1,
    );
  const cacheMembers = current.instances.filter(
    (node) => memberSet.has(node.id) && inferInstanceType(node.id) === "cache",
  );
  const cacheSection = mustQuery<HTMLElement>("#detail-cache");
  cacheSection.hidden =
    !cacheMembers.length || cacheMembers.length !== memberIds.length;
  if (!cacheSection.hidden) {
    const percentages = cacheMembers.map(
      (node) => node.cacheHitPercent ?? DEFAULT_CACHE_HIT_PERCENT,
    );
    const common = percentages.every((percent) => percent === percentages[0]);
    const input = mustQuery<HTMLInputElement>("#cache-hit-percent");
    input.value = common ? String(percentages[0]) : "";
    input.placeholder = common ? "" : "Mixed coverage";
    mustQuery<HTMLElement>("#cache-settings-message").textContent =
      memberIds.length > 1
        ? "Applies this hit percentage to each cache in the pool. Only misses reach downstream nodes."
        : "Hits return from this cache; only misses continue downstream.";
  }
  detailTitle.textContent = ids.clusterId
    ? (cluster?.label ?? ids.clusterId)
    : ((ids.instanceId &&
        current.instances.find((item) => item.id === ids.instanceId)?.label) ??
      ids.instanceId ??
      "");
  detailCount.textContent = String(memberIds.length);
  const scalingIssue = replicaIssue(
    current.instances.find((item) => item.id === memberIds[0])!,
  );
  const scalingReason = mustQuery<HTMLElement>("#detail-scaling-reason");
  mustQuery<HTMLElement>(".replica-stepper").hidden = !!scalingIssue;
  detailReplicas.hidden = !!scalingIssue;
  scalingReason.hidden = !scalingIssue;
  scalingReason.textContent = scalingIssue ?? "";
  const scalingType = inferInstanceType(memberIds[0]);
  const scalingName =
    scalingType === "database-rack" || scalingType === "cache"
      ? "replicas"
      : "instances";
  mustQuery<HTMLElement>("#detail-scaling-label").textContent = scalingIssue
    ? "Scaling"
    : scalingName === "replicas"
      ? "Replicas"
      : "Instances";
  replicaDecrease.setAttribute("aria-label", `Decrease ${scalingName}`);
  replicaIncrease.setAttribute("aria-label", `Increase ${scalingName}`);
  replicaDecrease.disabled = !!scalingIssue || memberIds.length <= 1;
  replicaIncrease.disabled =
    !!scalingIssue ||
    memberIds.length >= 10 ||
    current.instances.length >= MAX_INSTANCES;
  detailLinkCount.textContent = String(links.length);
  nodeEditor?.show(memberIds);

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
    specRow(
      scalingName === "replicas" ? "Replicas" : "Instances",
      String(memberIds.length),
    ),
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
  if (replicaIssue(current.instances.find((item) => item.id === memberId)!))
    return;
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

  let design: Design;
  try {
    design = parseDesign(JSON.stringify({ ...current, instances }));
  } catch (error) {
    showError(error);
    openDetail(ids);
    return;
  }
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

sceneSvg.addEventListener("pointerover", (event) => {
  if (viewMode) return;
  showCallout(event.target, event);
});
sceneSvg.addEventListener("pointermove", (event) => {
  if (viewMode) return;
  showCallout(event.target, event);
});
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
  if (viewMode) return;
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
  builder?.reset();
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
  builder?.sync(design);
  traffic?.sync(design);
  if (viewMode) rebuildArchitectureLabels();
}

/** One measured label in the architecture overview, keyed to a scene target. */
interface ArchitectureEntry {
  key: string;
  element: HTMLDivElement;
  card: HTMLDivElement;
  width: number;
  height: number;
}

let architectureEntries: ArchitectureEntry[] = [];
let architectureFrame: number | null = null;

/** Label every logical target once: clusters as pools, everything else individually. */
function architectureTargets(): {
  key: string;
  kind: string;
  name: string;
  meta: string;
}[] {
  const groupOf = new Map<string, string>();
  for (const group of current.groups ?? [])
    for (const id of group.instances) groupOf.set(id, group.label);
  const clustered = new Set(
    current.clusters.flatMap((cluster) => cluster.instances),
  );
  const targets: { key: string; kind: string; name: string; meta: string }[] =
    [];
  for (const [index, cluster] of current.clusters.entries()) {
    const id = cluster.id ?? `cluster-${index + 1}`,
      first = current.instances.find(
        (instance) => instance.id === cluster.instances[0],
      ),
      kind =
        BUILD_TYPES.find(
          (item) => item.type === inferInstanceType(first?.id ?? ""),
        )?.label ?? "Cluster";
    targets.push({
      key: `cluster:${id}`,
      kind: groupOf.get(cluster.instances[0])
        ? `${groupOf.get(cluster.instances[0])} · Cluster`
        : "Cluster",
      name: cluster.label ?? id,
      meta: `${cluster.instances.length} × ${kind}`,
    });
  }
  for (const instance of current.instances) {
    if (clustered.has(instance.id)) continue;
    const type = inferInstanceType(instance.id),
      kind =
        BUILD_TYPES.find((item) => item.type === type)?.label ??
        type.replaceAll("-", " "),
      provider = findProvider(instance.provider, type),
      group = groupOf.get(instance.id);
    targets.push({
      key: `instance:${instance.id}`,
      kind: group ? `${group} · ${kind}` : kind,
      name: instance.label ?? instance.id,
      meta: provider?.label ?? instance.id,
    });
  }
  return targets;
}

/** Recreate overview labels after design/layout changes and measure them once. */
function rebuildArchitectureLabels(): void {
  if (!viewMode) return;
  architectureEntries = [];
  architectureLabels.replaceChildren();
  for (const target of architectureTargets()) {
    const element = document.createElement("div");
    element.className = "architecture-label";
    element.dataset.target = target.key;
    element.setAttribute("role", "listitem");
    const card = document.createElement("div");
    card.className = "architecture-label-card";
    const kind = document.createElement("span");
    kind.className = "architecture-kind";
    kind.textContent = target.kind;
    const name = document.createElement("strong");
    name.className = "architecture-name";
    name.textContent = target.name;
    const meta = document.createElement("span");
    meta.className = "architecture-meta";
    meta.textContent = target.meta;
    card.append(kind, name, meta);
    element.append(card);
    architectureLabels.append(element);
    architectureEntries.push({
      key: target.key,
      element,
      card,
      width: card.offsetWidth,
      height: card.offsetHeight,
    });
  }
  positionArchitectureLabels();
}

/** Place labels around their node edges, avoiding artwork and each other. */
function positionArchitectureLabels(): void {
  if (!viewMode) return;
  const stage = stageBounds,
    toStage = (rect: CalloutRect): CalloutRect => ({
      x: rect.x - stage.left,
      y: rect.y - stage.top,
      width: rect.width,
      height: rect.height,
    }),
    obstacles = current.instances.flatMap((instance) => {
      const rect = scene.targetScreenRect(`instance:${instance.id}`);
      return rect
        ? [
            {
              x: rect.x - stage.left - 2,
              y: rect.y - stage.top - 2,
              width: rect.width + 4,
              height: rect.height + 4,
            },
          ]
        : [];
    }),
    actions = document.querySelector(".top-actions")?.getBoundingClientRect(),
    reserved = actions
      ? [
          {
            x: actions.left - stage.left,
            y: actions.top - stage.top,
            width: actions.width,
            height: actions.height,
          },
        ]
      : [],
    labels: OverviewLabel[] = [],
    byKey = new Map(architectureEntries.map((entry) => [entry.key, entry]));
  for (const entry of architectureEntries) {
    const rect = scene.targetScreenRect(entry.key);
    if (!rect) {
      entry.element.hidden = true;
      continue;
    }
    entry.element.hidden = false;
    labels.push({
      key: entry.key,
      rect: toStage(rect),
      size: { width: entry.width, height: entry.height },
    });
  }
  const placements = placeOverviewLabels(
    labels,
    { width: stage.width, height: stage.height },
    obstacles,
    reserved,
  );
  for (const placement of placements) {
    const entry = byKey.get(placement.key);
    if (!entry) continue;
    const anchor = {
        x: placement.anchor.x,
        y: placement.anchor.y,
      },
      cardX = placement.x - anchor.x,
      cardY = placement.y - anchor.y,
      corners = [
        [cardX, cardY],
        [cardX + entry.width, cardY],
        [cardX, cardY + entry.height],
        [cardX + entry.width, cardY + entry.height],
      ],
      [cornerX, cornerY] = corners.reduce((best, corner) =>
        Math.hypot(corner[0], corner[1]) < Math.hypot(best[0], best[1])
          ? corner
          : best,
      ),
      length = Math.hypot(cornerX, cornerY),
      angle = (Math.atan2(cornerY, cornerX) * 180) / Math.PI;
    entry.element.style.transform = `translate3d(${anchor.x.toFixed(1)}px, ${anchor.y.toFixed(1)}px, 0)`;
    entry.element.style.setProperty("--label-x", `${cardX.toFixed(1)}px`);
    entry.element.style.setProperty("--label-y", `${cardY.toFixed(1)}px`);
    entry.element.style.setProperty(
      "--label-line-length",
      `${length.toFixed(1)}px`,
    );
    entry.element.style.setProperty(
      "--label-line-angle",
      `${angle.toFixed(2)}deg`,
    );
  }
}

/** Coalesce label repositioning to one frame while the camera settles. */
function scheduleArchitectureLabels(): void {
  if (!viewMode || architectureFrame !== null) return;
  architectureFrame = requestAnimationFrame(() => {
    architectureFrame = null;
    positionArchitectureLabels();
  });
}

/** Toggle the read-only architecture overview; editing chrome is hidden there. */
function setViewMode(open: boolean): void {
  if (viewMode === open) return;
  viewMode = open;
  document.body.classList.toggle("view-mode", open);
  viewToggle.setAttribute("aria-pressed", String(open));
  viewToggle.textContent = open ? "Exit view" : "View";
  if (open) {
    builder?.reset();
    setPanelOpen(false);
    clearSelection();
    hideCallout();
    scene.fit();
    rebuildArchitectureLabels();
  } else {
    architectureEntries = [];
    architectureLabels.replaceChildren();
  }
  viewToggle.focus({ preventScroll: true });
}

viewToggle.addEventListener("click", () => setViewMode(!viewMode));
scene.onViewChange(scheduleArchitectureLabels);
scene.onLayoutChange(() => {
  if (viewMode) rebuildArchitectureLabels();
});
document.addEventListener(
  "contextmenu",
  (event) => {
    if (!viewMode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

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
  const example = examples.find((item) => item.id === exampleId);
  exampleHint.textContent = example
    ? `${example.group} · ${example.summary}`
    : "Choose a reference design to load it on the canvas.";
}

for (const item of examples) {
  let group = exampleSelect.querySelector<HTMLOptGroupElement>(
    `optgroup[data-group="${CSS.escape(item.group)}"]`,
  );
  if (!group) {
    group = document.createElement("optgroup");
    group.label = item.group;
    group.dataset.group = item.group;
    exampleSelect.append(group);
  }
  const option = document.createElement("option");
  option.value = item.id;
  option.textContent = item.design.name;
  group.append(option);
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
    builder?.close();
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
  if (viewMode) {
    event.preventDefault();
    setViewMode(false);
    return;
  }
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

traffic = new TrafficControls(
  mustQuery<HTMLElement>("#simulation-section"),
  () => current,
  (state) => scene.setTraffic(state),
);
apply(webAppExample);

/**
 * Construction commits pin real sites and preserve the camera. Transient anchor
 * offsets are cleared only after they have been folded into explicit placements.
 */
function commitWorld(design: Design): void {
  scene.clearOffsets();
  scene.render(design, true);
  current = design;
  syncDesign();
  exampleSelect.value = "";
  showExampleSummary(null);
}

builder = new WorldBuilder(stage, sceneSvg, scene, {
  read: () => current,
  commit: commitWorld,
  selection: () => {
    const ids = targetIds(selectedAnchor);
    return ids && selectedAnchor
      ? targetMembers(ids, selectedAnchor).map(
          (node) => node.dataset.instanceId!,
        )
      : [];
  },
  inspect: (id) => {
    const anchor = [
      ...sceneSvg.querySelectorAll<SVGGElement>(".scene-instance"),
    ].find((node) => node.dataset.instanceId === id);
    selectTarget(anchor ?? null);
  },
  enter: () => {
    scene.freezeView();
    clearSelection();
    hideCallout();
    if (sidebar.classList.contains("open")) setPanelOpen(false);
  },
});
scene.onPlacementChange(() =>
  commitWorld(pinWorld(current, scene.getWorldInstances())),
);

nodeEditor = new FlowNodeEditor(
  mustQuery<HTMLElement>(".detail-body"),
  () => current,
  commitWorld,
);

/** Capacity edits share parser validation, document persistence and keyed-world rendering. */
mustQuery<HTMLFormElement>("#capacity-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    const ids = targetIds(selectedAnchor);
    if (!ids || !selectedAnchor) return;
    const members = new Set(
      targetMembers(ids, selectedAnchor).map(
        (node) => node.dataset.instanceId!,
      ),
    );
    const capacity = mustQuery<HTMLInputElement>("#capacity-rps").valueAsNumber;
    try {
      const design = parseDesign(
        JSON.stringify({
          ...current,
          instances: current.instances.map((node) =>
            members.has(node.id) ? { ...node, capacityRps: capacity } : node,
          ),
        }),
      );
      commitWorld(design);
      openDetail(ids);
      mustQuery<HTMLElement>("#capacity-message").textContent =
        "Capacity saved · traffic restarted on the updated graph.";
    } catch (error) {
      mustQuery<HTMLElement>("#capacity-message").textContent =
        error instanceof Error ? error.message : "Could not save capacity.";
    }
  },
);

/** Source traffic is authored on Users, not a global synthetic client rate. */
mustQuery<HTMLFormElement>("#source-traffic-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    const ids = targetIds(selectedAnchor);
    if (!ids?.instanceId) return;
    try {
      const rate =
        mustQuery<HTMLInputElement>("#users-traffic-rps").valueAsNumber;
      const design = parseDesign(
        JSON.stringify({
          ...current,
          instances: current.instances.map((node) =>
            node.id === ids.instanceId ? { ...node, trafficRps: rate } : node,
          ),
        }),
      );
      commitWorld(design);
      openDetail(ids);
      mustQuery<HTMLElement>("#source-traffic-message").textContent =
        "Users traffic saved. Run the simulation to follow each request.";
    } catch (error) {
      mustQuery<HTMLElement>("#source-traffic-message").textContent =
        error instanceof Error ? error.message : "Could not set Users traffic.";
    }
  },
);

/** Cache coverage is persisted on cache nodes; save through the same parser and world commit as capacity. */
mustQuery<HTMLFormElement>("#cache-settings-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    const ids = targetIds(selectedAnchor);
    if (!ids || !selectedAnchor) return;
    const members = new Set(
      targetMembers(ids, selectedAnchor).map(
        (node) => node.dataset.instanceId!,
      ),
    );
    try {
      const percent =
        mustQuery<HTMLInputElement>("#cache-hit-percent").valueAsNumber;
      const design = parseDesign(
        JSON.stringify({
          ...current,
          instances: current.instances.map((node) =>
            members.has(node.id) ? { ...node, cacheHitPercent: percent } : node,
          ),
        }),
      );
      commitWorld(design);
      openDetail(ids);
      mustQuery<HTMLElement>("#cache-settings-message").textContent =
        `Cache coverage saved · ${percent}% hits, ${100 - percent}% misses. Simulation restarted.`;
    } catch (error) {
      mustQuery<HTMLElement>("#cache-settings-message").textContent =
        error instanceof Error
          ? error.message
          : "Could not save cache coverage.";
    }
  },
);

/**
 * HTML overlays, not SVG animation, invalidate the cached exclusion rectangles.
 * Measure only on overlay resize/state changes. Aside offsets represent their
 * final open position rather than a sliding animation's intermediate position.
 */
const calloutOverlays = [
  mustQuery<HTMLElement>(".build-dock"),
  mustQuery<HTMLElement>("#build-status"),
  mustQuery<HTMLElement>(".world-edit-panel"),
  toggle,
  sidebar,
  detail,
];
let calloutMeasureFrame: number | null = null;
/** Coalesce overlay mutations without doing DOM measurements on pointer frames. */
function scheduleCalloutMeasure(): void {
  if (calloutMeasureFrame !== null) return;
  calloutMeasureFrame = requestAnimationFrame(() => {
    calloutMeasureFrame = null;
    const rectangles: CalloutRect[] = [];
    for (const element of calloutOverlays) {
      const aside = element === sidebar || element === detail;
      if (aside && !element.classList.contains("open")) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      rectangles.push({
        x: aside ? element.offsetLeft : rect.left - stageBounds.left,
        y: aside ? element.offsetTop : rect.top - stageBounds.top,
        width: rect.width,
        height: rect.height,
      });
    }
    calloutObstacles = rectangles;
    if (hasCalloutPoint && callout.classList.contains("visible"))
      positionCallout(calloutPoint);
  });
}
const calloutOverlayResize = new ResizeObserver(scheduleCalloutMeasure);
const calloutOverlayState = new MutationObserver(scheduleCalloutMeasure);
for (const element of calloutOverlays) {
  calloutOverlayResize.observe(element);
  calloutOverlayState.observe(element, {
    attributes: true,
    subtree: element !== sidebar && element !== detail,
    attributeFilter: ["class", "hidden", "aria-expanded", "aria-hidden"],
  });
}
calloutOverlayResize.observe(stage);
new ResizeObserver(([entry]) => {
  const box = entry.borderBoxSize[0];
  const width = box?.inlineSize ?? calloutCard.offsetWidth;
  const height = box?.blockSize ?? calloutCard.offsetHeight;
  if (width === tipSize.width && height === tipSize.height) return;
  tipSize = { width, height };
  if (hasCalloutPoint && callout.classList.contains("visible"))
    positionCallout(calloutPoint);
}).observe(calloutCard);
scheduleCalloutMeasure();
