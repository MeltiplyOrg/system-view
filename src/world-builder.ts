import type { Design, GroundPoint, OutputPort } from "./design";
import type { SystemScene } from "./scene";
import {
  BUILD_ITEMS,
  BUILD_TYPES,
  BUILD_GRID,
  canPlace,
  connectComponents,
  pinWorld,
  placeComponent,
  removeComponent,
  snapPlacement,
  type BuildItem,
} from "./construction";
import { findProvider } from "./providers";
import { instanceColor } from "./layout";
import { connectionIssue, outputPorts } from "./component-rules";
import { GroupControls } from "./group-controls";
import { saveNodeGroup, ungroupNodes } from "./node-groups";

type Tool = "select" | "place" | "wire";

/** The shell remains the only owner of the applied/exported document. */
interface BuilderOptions {
  read(): Design;
  commit(design: Design): void;
  enter(): void;
  selection(): readonly string[];
  inspect(id: string): void;
}

/** Small catalogue glyphs, not clones of the world's detailed vector models. */
const GLYPHS: Readonly<Record<string, string>> = {
  "compute-server":
    "M12 12 40 2 68 12 40 23Z M12 12v12l28 12 28-12V12M12 29v12l28 12 28-12V29M20 23l10 4m-10 12 10 4M45 29l15-6m-15 22 15-6",
  webpage:
    "M14 5h52v38H14Z M14 14h52M20 10h1m5 0h1m5 0h1M20 22h18m-18 6h30m-30 6h24M9 49h62",
  "database-rack":
    "M18 10c0-9 44-9 44 0v34c0 10-44 10-44 0Z M18 10c0 10 44 10 44 0M18 26c0 10 44 10 44 0M24 40h6m23 0h3",
  cache:
    "m10 20 30-15 30 15-30 15Z M10 20v8l30 15 30-15v-8M10 34v8l30 15 30-15v-8M31 18h18m-15 6h12",
  cdn: "m30 4 12-4 12 4v15l-12 5-12-5Z M6 35l12-5 12 5v13l-12 5-12-5Z M54 35l12-5 12 5v13l-12 5-12-5Z M42 24v12M30 41l12-5 12 5",
  "message-queue":
    "M7 15h66v33H7Z M14 22h13v18H14ZM34 22h13v18H34ZM54 22h13v18H54ZM9 8h62M21 4v4m20-4v4m20-4v4",
  "object-storage":
    "M10 10h18v40H10ZM33 10h18v40H33ZM56 10h18v40H56ZM14 18h10m-10 9h10m-10 9h10m13-18h10m-10 9h10m-10 9h10m13-18h10m-10 9h10m-10 9h10",
  "media-worker":
    "M8 30h68v22H8ZM16 13h22v17H16ZM46 6h22v24H46ZM17 40h13m5 0h13M56 36l10 5-10 5Z",
  branch:
    "M6 28h20l16-19 16 19-16 19-16-19m32 0h18M42 47v10M39 22h6m-3 0v9m-3 5h6",
  merge: "M8 10h18l20 19h28M8 48h18l20-19M64 20l10 9-10 9",
};

/** Keyboard cursor directions are shared, not allocated on every key repeat. */
const KEY_STEPS: Readonly<Record<string, GroundPoint>> = {
  ArrowLeft: { x: -BUILD_GRID, y: 0 },
  ArrowRight: { x: BUILD_GRID, y: 0 },
  ArrowUp: { x: 0, y: -BUILD_GRID },
  ArrowDown: { x: 0, y: BUILD_GRID },
};

/** Page-lifetime construction controller: one pointer gesture, one preview, no idle clock. */
export class WorldBuilder {
  private readonly root = document.createElement("section");
  private readonly body: HTMLElement;
  private readonly editor = document.createElement("aside");
  private readonly toggle: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly counts: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly coordinates: HTMLElement;
  private readonly from: HTMLSelectElement;
  private readonly to: HTMLSelectElement;
  private readonly relation: HTMLInputElement;
  private readonly outlet: HTMLSelectElement;
  private tool: Tool = "select";
  private item: BuildItem | null = null;
  private wireFrom: string | null = null;
  private point: GroundPoint | null = null;
  private pointer: {
    id: number;
    x: number;
    y: number;
    card: HTMLButtonElement | null;
    dragged: boolean;
  } | null = null;
  private client = { x: 0, y: 0 };
  private frame: number | null = null;
  private previewShown = false;
  private category = "all";
  private readonly groups: GroupControls;
  private readonly menu = document.createElement("section");
  private menuReturn: Element | null = null;

  /** Mount the drawer and arbitrate construction before the scene's ordinary pan/select handlers. */
  constructor(
    stage: HTMLElement,
    private readonly svg: SVGSVGElement,
    private readonly scene: SystemScene,
    private readonly options: BuilderOptions,
  ) {
    this.root.className = "build-dock";
    this.root.setAttribute("aria-label", "World builder");
    this.root.innerHTML = `<header class="build-toolbar">
      <button id="build-toggle" class="build-toggle" type="button" aria-expanded="false" aria-controls="build-body"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 7 7-4 7 4-7 4ZM3 7v7l7 4 7-4V7M10 11v7"/></svg><span>Components</span><span class="build-chevron" aria-hidden="true">⌃</span></button>
      <span id="build-status" class="build-status" role="status" aria-live="polite">Build your system, one component at a time.</span>
      <span id="build-counts" class="build-counts"></span>
    </header>
    <div id="build-body" class="build-body" hidden>
      <div id="build-catalogue" class="build-catalogue">
        <nav class="build-categories" aria-label="Component categories"><button type="button" data-category="all" aria-pressed="true">All components <span>${BUILD_ITEMS.length}</span></button>${BUILD_TYPES.map((item) => `<button type="button" data-category="${item.type}" aria-pressed="false">${item.label}<span>${BUILD_ITEMS.filter((entry) => entry.type === item.type).length}</span></button>`).join("")}</nav>
        <div id="build-cards" class="build-cards" aria-label="Component catalogue"></div>
      </div>
      <footer class="build-footer"><span>Drag a card into the world · or select, then click to place · Esc cancels</span><span id="build-coordinates" aria-hidden="true"></span></footer>
    </div>`;
    this.editor.className = "world-edit-panel";
    this.editor.setAttribute("aria-labelledby", "world-edit-title");
    this.editor.hidden = true;
    this.editor.innerHTML = `<header class="world-edit-header"><h2 id="world-edit-title"></h2><button id="world-edit-close" class="btn" type="button" aria-label="Close action editor">✕</button></header>
      <form id="build-wiring" class="build-wiring" hidden>
        <div class="build-wire-intro"><p>Choose a destination in the world, or use the endpoints below. Esc cancels.</p></div>
        <label>From<select id="build-from"><option value="">Choose a source…</option></select></label>
        <label>Output<select id="build-outlet"><option value="out">OUT</option></select></label>
        <label>To<select id="build-to"><option value="">Choose a destination…</option></select></label>
        <label>Traffic label<input id="build-relation" maxlength="100" placeholder="HTTPS, SQL, events…"/></label>
        <button id="build-connect" class="btn btn-primary" type="submit" disabled>Connect</button>
      </form>
      <p id="world-edit-status" class="world-edit-status" role="status" aria-live="polite"></p>`;
    stage.append(this.root, this.editor);
    svg.setAttribute("tabindex", "0");
    this.menu.className = "world-context-menu";
    this.menu.setAttribute("role", "menu");
    this.menu.setAttribute("aria-label", "World quick actions");
    this.menu.hidden = true;
    stage.append(this.menu);
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.menu.hidden && !this.menu.contains(event.target as Node))
          this.hideContext(false);
      },
      true,
    );
    this.menu.addEventListener("pointerdown", (event) =>
      event.stopPropagation(),
    );
    this.body = this.query("#build-body");
    this.toggle = this.query("#build-toggle");
    this.status = this.query("#build-status");
    this.counts = this.query("#build-counts");
    this.cards = this.query("#build-cards");
    this.coordinates = this.query("#build-coordinates");
    this.from = this.query("#build-from");
    this.to = this.query("#build-to");
    this.relation = this.query("#build-relation");
    this.outlet = this.query("#build-outlet");
    this.groups = new GroupControls(this.editor, svg, scene, {
      read: () => options.read(),
      commit: (design) => options.commit(design),
      selection: () => options.selection(),
      prepare: () => {
        this.reset();
        this.options.enter();
      },
      reveal: () => {
        this.setOpen(false);
        this.editor.hidden = false;
        this.query("#world-edit-title").textContent = "Node groups";
        this.query("#world-edit-status").hidden = true;
        this.say(
          "Groups: click nodes or drag a selection box · drag group titles to move together.",
        );
      },
    });
    this.toggle.addEventListener("click", () =>
      this.setOpen(!!this.body.hidden),
    );
    this.query("#world-edit-close").addEventListener("click", () =>
      this.dismissEditor(),
    );
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-category]",
    ))
      button.addEventListener("click", () => {
        this.setTool("select");
        this.category = button.dataset.category!;
        this.renderCatalogue();
      });
    this.query<HTMLFormElement>("#build-wiring").addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.connect(this.from.value, this.to.value);
      },
    );
    this.from.addEventListener("change", () => {
      this.wireFrom = this.from.value || null;
      this.updateConnect();
    });
    this.to.addEventListener("change", () => this.updateConnect());
    this.outlet.addEventListener("change", () => this.updateConnect());
    svg.addEventListener("pointerdown", (event) => this.worldDown(event), true);
    document.addEventListener("pointermove", (event) => this.move(event), true);
    document.addEventListener("pointerup", (event) => this.up(event), true);
    document.addEventListener(
      "pointercancel",
      (event) => {
        if (this.pointer?.id === event.pointerId) this.reset();
      },
      true,
    );
    document.addEventListener(
      "lostpointercapture",
      (event) => {
        if (this.pointer?.id === event.pointerId) this.reset();
      },
      true,
    );
    document.addEventListener("keydown", (event) => this.key(event), true);
    svg.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showContext(event.target as Element, event.clientX, event.clientY);
    });
    window.addEventListener("blur", () => this.reset());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.reset();
    });
    scene.onViewChange(() => {
      this.hideContext(false);
      this.schedule();
    });
    scene.onLayoutChange(() => this.schedule());
    this.renderCatalogue();
    this.sync(options.read());
  }

  /** Required elements belong to this module's fixed template. */
  private query<T extends HTMLElement>(selector: string): T {
    const element =
      this.root.querySelector<T>(selector) ??
      this.editor.querySelector<T>(selector);
    if (!element) throw new Error(`Missing builder control: ${selector}`);
    return element;
  }

  /** Collapse without resizing or refitting the world; hidden controls leave the tab order. */
  private setOpen(open: boolean): void {
    if (open) {
      this.reset();
      this.options.enter();
    }
    this.body.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.root.classList.toggle("expanded", open);
    if (!open) {
      if (this.tool === "place") this.reset();
      this.toggle.focus({ preventScroll: true });
    }
  }

  /** Rebuild only the small catalogue when the category changes, never detailed world models. */
  private renderCatalogue(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-category]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.category === this.category),
      );
    this.cards.replaceChildren(
      ...BUILD_ITEMS.filter(
        (item) => this.category === "all" || item.type === this.category,
      ).map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "build-card";
        button.dataset.buildItem = item.id;
        button.setAttribute("aria-label", `Build ${item.label}`);
        button.style.setProperty(
          "--item-color",
          instanceColor(item.type, item.provider),
        );
        const provider = findProvider(item.provider, item.type);
        button.style.setProperty(
          "--card-plate",
          provider?.plate ?? "var(--brand-plate)",
        );
        button.innerHTML = `<span class="build-card-art" aria-hidden="true"><svg viewBox="0 0 84 60"><path d="${GLYPHS[item.type]}"/></svg>${provider ? `<span class="build-card-brand">${provider.logo}</span>` : ""}</span><span class="build-card-label">${item.label}</span><span class="build-card-kind">${BUILD_TYPES.find((entry) => entry.type === item.type)!.label}</span>`;
        button.title = `${item.description} Drag into the world or click to select.`;
        button.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          if (event.pointerType !== "touch") event.preventDefault();
          button.focus({ preventScroll: true });
          this.begin(item);
          this.pointer = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            card: button,
            dragged: false,
          };
          this.client.x = event.clientX;
          this.client.y = event.clientY;
          button.setPointerCapture(event.pointerId);
        });
        button.addEventListener("click", (event) => {
          if (event.detail === 0) this.begin(item, true);
        });
        return button;
      }),
    );
  }

  /** Select a reusable template; keyboard users get a ground cursor moved with arrow keys. */
  private begin(item: BuildItem, keyboard = false): void {
    this.setTool("place");
    this.item = item;
    this.svg.classList.add("tool-place");
    this.say(
      `${item.label} selected. Place on clear ground. Arrow keys move; Enter builds; Esc cancels.`,
    );
    if (keyboard) {
      const box = this.svg.getBoundingClientRect();
      const point = this.scene.screenToWorld(
        box.left + box.width / 2,
        box.top + box.height * 0.3,
      );
      if (point) {
        this.point = snapPlacement(point);
        this.paintPlacement();
      }
    }
    for (const card of this.cards.querySelectorAll<HTMLElement>(
      "[data-build-item]",
    ))
      card.classList.toggle("selected", card.dataset.buildItem === item.id);
  }

  /** A tool change releases capture before touching controls and removes any transient actor. */
  private setTool(tool: Tool): void {
    this.reset();
    this.tool = tool;
    if (tool !== "select") this.options.enter();
    this.svg.classList.toggle("tool-wire", tool === "wire");
    if (tool === "wire") {
      this.setOpen(false);
      this.editor.hidden = false;
      this.query("#world-edit-title").textContent = "Connect nodes";
      this.query("#world-edit-status").hidden = false;
      this.query("#build-wiring").hidden = false;
      this.say(
        "Choose a destination in the world or use the endpoint controls.",
      );
    }
  }

  /** Opening the JSON editor closes construction without stealing either tool's state. */
  close(): void {
    this.reset();
    this.setOpen(false);
  }

  /** Explicit dismissal returns keyboard focus to the world, never a now-hidden field. */
  private dismissEditor(): void {
    this.reset();
    this.svg.focus({ preventScroll: true });
  }

  /** Destructive world reset is a contextual action, not part of the component shelf. */
  private newWorld(): void {
    if (
      this.options.read().instances.length &&
      !window.confirm(
        "Start an empty world? Export your current design first if you want to keep it.",
      )
    )
      return;
    this.reset();
    this.options.enter();
    this.options.commit({
      version: 1,
      name: "Untitled system",
      instances: [],
      connections: [],
      clusters: [],
    });
    this.scene.fit();
    this.say("Empty world ready. Drag in your first component.");
  }

  /** Restore ordinary scene controls; safe during pointer cancellation, Apply, blur and removal. */
  reset(): void {
    this.hideContext(false);
    this.groups?.close();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    const pointer = this.pointer;
    this.pointer = null;
    const capture = pointer?.card ?? this.svg;
    if (pointer && capture.hasPointerCapture(pointer.id))
      capture.releasePointerCapture(pointer.id);
    this.tool = "select";
    this.item = null;
    this.point = null;
    this.wireFrom = null;
    this.scene.clearBuildPreview();
    this.previewShown = false;
    this.svg.classList.remove("tool-place", "tool-wire");
    this.svg.classList.remove("wire-invalid");
    for (const card of this.cards.querySelectorAll(".selected"))
      card.classList.remove("selected");
    this.editor.hidden = true;
    this.query("#build-wiring").hidden = true;
    this.from.value = "";
    this.to.value = "";
    this.updateConnect();
    this.coordinates.textContent = "";
    this.say("Drag in components · right-click the world for other actions");
  }

  /** Keep counts and keyboard-accessible wire endpoints synchronized with the same document. */
  sync(design: Design): void {
    this.hideContext(false);
    this.groups.sync(design);
    this.counts.textContent = `${design.instances.length} component${design.instances.length === 1 ? "" : "s"} · ${design.connections.length} wire${design.connections.length === 1 ? "" : "s"}`;
    for (const select of [this.from, this.to]) {
      const value = select.value;
      select.replaceChildren(
        new Option(
          select === this.from ? "Choose a source…" : "Choose a destination…",
          "",
        ),
        ...design.instances.map(
          (instance) =>
            new Option(
              `${instance.label ?? instance.id} · ${instance.id}`,
              instance.id,
            ),
        ),
      );
      select.value = design.instances.some((instance) => instance.id === value)
        ? value
        : "";
    }
    if (
      this.wireFrom &&
      !design.instances.some((instance) => instance.id === this.wireFrom)
    )
      this.reset();
    this.updateConnect();
  }

  /** Filter native targets and highlight compatible world endpoints from the same authoritative rules. */
  private updateConnect(): void {
    const design = this.options.read();
    const source = design.instances.find((item) => item.id === this.from.value);
    const ports = source ? outputPorts(source) : ["out"];
    const previous = this.outlet.value;
    this.outlet.replaceChildren(
      ...ports.map((port) => new Option(port.toUpperCase(), port)),
    );
    this.outlet.value = ports.includes(previous as OutputPort)
      ? previous
      : ports[0];
    const outlet = this.outlet.value as OutputPort;
    const reason = (id: string): string | null => {
      const target = design.instances.find((item) => item.id === id);
      if (!source || !target) return null;
      if (id === source.id) return "Choose a different component.";
      if (
        design.connections.some(
          (link) =>
            link.from === source.id &&
            link.to === id &&
            (link.outlet ?? "out") === outlet,
        )
      )
        return "Already connected in that direction.";
      return connectionIssue(source, target, outlet);
    };
    for (const option of this.to.options) {
      const issue = reason(option.value);
      option.disabled = !!issue;
      option.title = issue ?? "";
    }
    const frames = new Map<string, boolean>();
    for (const node of this.svg.querySelectorAll<SVGGElement>(
      ".scene-instance",
    )) {
      const issue = reason(node.dataset.instanceId!);
      node.classList.toggle(
        "wire-target-valid",
        this.tool === "wire" && !!source && !issue,
      );
      node.classList.toggle(
        "wire-target-invalid",
        this.tool === "wire" && !!source && !!issue,
      );
      const key =
        node.dataset.clusterId ?? `instance:${node.dataset.instanceId!}`;
      frames.set(key, (frames.get(key) ?? false) || !issue);
    }
    for (const frame of this.svg.querySelectorAll<SVGPathElement>(
      ".scene-frame",
    )) {
      const valid = frames.get(frame.dataset.clusterId!) ?? false;
      frame.classList.toggle(
        "wire-target-valid",
        this.tool === "wire" && !!source && valid,
      );
      frame.classList.toggle(
        "wire-target-invalid",
        this.tool === "wire" && !!source && !valid,
      );
    }
    const issue = reason(this.to.value);
    this.query<HTMLButtonElement>("#build-connect").disabled =
      !source || !this.to.value || !!issue;
    if (source)
      this.say(
        issue ??
          "Source selected. Highlighted components accept this connection.",
        !!issue,
      );
  }

  /** Identify a painted component, even while pointer capture retargets the event itself. */
  private hit(x: number, y: number): string | null {
    return (
      document.elementFromPoint(x, y)?.closest<SVGGElement>(".scene-instance")
        ?.dataset.instanceId ?? null
    );
  }

  /** Palette overlays and inspectors are not world ground. */
  private overWorld(x: number, y: number): boolean {
    return document.elementFromPoint(x, y)?.closest("#scene") === this.svg;
  }

  /** Construction owns only its gestures; Select leaves all pan/pinch/anchor behavior intact. */
  private worldDown(event: PointerEvent): void {
    if (this.groups.claimsPointer(event)) return;
    if (this.tool === "select" || event.button !== 0 || !event.isPrimary)
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      card: null,
      dragged: false,
    };
    this.client.x = event.clientX;
    this.client.y = event.clientY;
    if (this.tool === "wire" && !this.wireFrom) {
      this.wireFrom = this.hit(event.clientX, event.clientY);
      this.from.value = this.wireFrom ?? "";
      this.updateConnect();
    }
    this.svg.setPointerCapture(event.pointerId);
    this.schedule();
  }

  /** Coalesce raw pointer events; touch scrolling in the catalogue may cancel a card drag. */
  private move(event: PointerEvent): void {
    if (this.tool === "select") return;
    if (this.pointer && this.pointer.id !== event.pointerId) return;
    this.client.x = event.clientX;
    this.client.y = event.clientY;
    if (this.pointer)
      this.pointer.dragged ||=
        Math.hypot(
          event.clientX - this.pointer.x,
          event.clientY - this.pointer.y,
        ) > 6;
    this.schedule();
    if (this.overWorld(event.clientX, event.clientY))
      event.stopImmediatePropagation();
  }

  /** One scheduled frame, never an idle animation loop or a re-render on pointer movement. */
  private schedule(): void {
    if (
      this.tool === "select" ||
      (this.tool === "wire" && !this.wireFrom) ||
      this.frame !== null
    )
      return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  /** Move the bounded ghost or rubber band using the current pan/zoom projection. */
  private paint(): void {
    if (!this.overWorld(this.client.x, this.client.y)) {
      if (this.previewShown) this.scene.clearBuildPreview();
      this.previewShown = false;
      this.point = null;
      return;
    }
    const point = this.scene.screenToWorld(this.client.x, this.client.y);
    if (!point) return;
    if (this.tool === "place") {
      try {
        this.point = snapPlacement(point);
        this.paintPlacement();
      } catch {
        this.point = null;
        this.scene.clearBuildPreview();
        this.say("Move back inside the buildable world.");
      }
    } else if (this.tool === "wire" && this.wireFrom) {
      const targetId = this.hit(this.client.x, this.client.y);
      const design = this.options.read();
      const source = design.instances.find((item) => item.id === this.wireFrom);
      const target = design.instances.find((item) => item.id === targetId);
      this.svg.classList.toggle(
        "wire-invalid",
        !!(
          source &&
          target &&
          connectionIssue(source, target, this.outlet.value as OutputPort)
        ),
      );
      this.scene.previewWire(
        this.wireFrom,
        point,
        this.hit(this.client.x, this.client.y) ?? undefined,
      );
      this.previewShown = true;
    }
  }

  /** Preview the exact product and its real provider footprint, not a generic bounding box. */
  private paintPlacement(): void {
    if (!this.item || !this.point) return;
    const valid = canPlace(
      this.item,
      this.point,
      this.scene.getWorldInstances(),
    );
    this.scene.previewPlacement(this.item, this.point, valid);
    this.previewShown = true;
    this.coordinates.textContent = `X ${this.point.x} / Y ${this.point.y}`;
    this.status.classList.toggle("build-error", !valid);
  }

  /** Commit only a real release in the world; outside drops and cancelled captures add nothing. */
  private up(event: PointerEvent): void {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    this.pointer = null;
    if ((pointer.card ?? this.svg).hasPointerCapture(pointer.id))
      (pointer.card ?? this.svg).releasePointerCapture(pointer.id);
    const inside = this.overWorld(event.clientX, event.clientY);
    if (inside) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    this.client.x = event.clientX;
    this.client.y = event.clientY;
    if (this.tool === "place") {
      if (inside) {
        this.paint();
        this.place();
      } else if (pointer.dragged) this.reset();
    } else if (this.tool === "wire" && inside) {
      const target = this.hit(event.clientX, event.clientY);
      if (this.wireFrom && target && target !== this.wireFrom)
        this.connect(this.wireFrom, target);
      else
        this.say(
          this.wireFrom
            ? "Source selected. Click or drag to a different component."
            : "Choose a component to start the wire.",
        );
    } else this.reset();
  }

  /** Capture actual world sites, including earlier anchor gestures, before changing the graph. */
  private pinned(): Design {
    return pinWorld(this.options.read(), this.scene.getWorldInstances());
  }

  /** Place once; invalid sites stay armed so the player can choose another location. */
  private place(): void {
    if (!this.item || !this.point) return;
    try {
      const label = this.item.label;
      this.options.commit(placeComponent(this.pinned(), this.item, this.point));
      this.reset();
      this.say(`Placed ${label}. Choose another component to keep building.`);
    } catch (error) {
      this.say(
        error instanceof Error
          ? error.message
          : "Could not place the component.",
        true,
      );
    }
  }

  /** Pointer and native form wiring use the same mutation and validation path. */
  private connect(from: string, to: string): void {
    try {
      this.options.commit(
        connectComponents(
          this.pinned(),
          from,
          to,
          this.relation.value,
          this.outlet.value as OutputPort,
        ),
      );
      this.wireFrom = null;
      this.from.value = "";
      this.to.value = "";
      this.scene.clearBuildPreview();
      this.previewShown = false;
      this.updateConnect();
      this.say(`Connected ${from} → ${to}. Choose the next source.`);
    } catch (error) {
      this.say(
        error instanceof Error
          ? error.message
          : "Could not connect components.",
        true,
      );
    }
  }

  /** Escape cancels first; keyboard placement needs no pointer or drag-and-drop API. */
  private key(event: KeyboardEvent): void {
    if (this.contextKey(event)) return;
    if (this.groups.handleKey(event)) return;
    if (
      event.key === "Escape" &&
      !(event.target instanceof HTMLSelectElement)
    ) {
      if (this.tool !== "select" || this.groups.isOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.dismissEditor();
      } else if (!this.body.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.setOpen(false);
      }
      return;
    }
    if (
      this.tool !== "place" ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.place();
      return;
    }
    const direction = KEY_STEPS[event.key];
    if (!direction || !this.point) return;
    event.preventDefault();
    try {
      this.point = snapPlacement({
        x: this.point.x + direction.x,
        y: this.point.y + direction.y,
      });
      this.paintPlacement();
    } catch {
      this.say("World boundary reached.", true);
    }
  }

  /** State changes announce once; raw pointer coordinates never spam the live region. */
  private say(text: string, error = false): void {
    const status = this.editor.hidden
      ? this.status
      : this.query("#world-edit-status");
    if (status.textContent !== text) status.textContent = text;
    status.classList.toggle("build-error", error);
  }

  /** Dismiss without losing a multi-selection; focus returns only on keyboard dismissal. */
  private hideContext(restore: boolean): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    if (restore && this.menuReturn?.isConnected) {
      (this.menuReturn as HTMLElement | SVGElement).focus({
        preventScroll: true,
      });
    }
    this.menuReturn = null;
  }

  /** Build context-specific actions from the actual clicked node or group, never hover/inspector leftovers. */
  private showContext(target: Element, x: number, y: number): void {
    if (this.pointer || this.tool !== "select") this.reset();
    this.scene.freezeView();
    const design = this.options.read();
    const frameId =
      target.closest<SVGGElement>(".scene-frame")?.dataset.clusterId;
    const pool = design.clusters.find(
      (item, index) => (item.id ?? `cluster-${index + 1}`) === frameId,
    );
    const nodeId =
      target.closest<SVGGElement>(".scene-instance")?.dataset.instanceId ??
      (frameId?.startsWith("instance:")
        ? frameId.slice(9)
        : pool?.instances[0]);
    const node = design.instances.find((item) => item.id === nodeId);
    const groupId =
      target.closest<SVGGElement>(".node-group")?.dataset.nodeGroupId;
    const group = design.groups?.find((item) => item.id === groupId);
    const selection = this.groups.isOpen
      ? this.groups.selectedNodes
      : this.options.selection();
    const ids = group
      ? group.instances
      : pool
        ? pool.instances
        : node
          ? selection.includes(node.id)
            ? [...selection]
            : [node.id]
          : [...selection];
    this.menuReturn = target.closest(".node-group-header") ?? this.svg;
    this.menu.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "context-heading";
    heading.setAttribute("role", "presentation");
    heading.textContent =
      group?.label ??
      (ids.length > 1
        ? `${ids.length} selected nodes`
        : (node?.label ?? node?.id ?? "World"));
    this.menu.append(heading);
    const action = (
      label: string,
      run: () => void,
      options: { disabled?: boolean; danger?: boolean } = {},
    ): void => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.tabIndex = -1;
      button.textContent = label;
      button.disabled = !!options.disabled;
      button.classList.toggle("context-danger", !!options.danger);
      button.addEventListener("click", () => {
        this.hideContext(false);
        try {
          run();
        } catch (error) {
          this.say(
            error instanceof Error
              ? error.message
              : "Could not complete this action.",
            true,
          );
        }
      });
      this.menu.append(button);
    };
    if (node) {
      action("Inspect node", () => {
        this.reset();
        this.options.enter();
        this.options.inspect(node.id);
      });
      for (const port of outputPorts(node))
        action(
          port === "out"
            ? "Wire from this node…"
            : `Wire ${port.toUpperCase()} output…`,
          () => this.startContextWire(node.id, port),
        );
      action(
        selection.includes(node.id)
          ? "Remove from selection"
          : "Add to selection",
        () => this.groups.toggleNode(node.id),
      );
    }
    if (group) {
      action("Rename / edit group…", () =>
        this.groups.manage(group.instances, group.id),
      );
      action("Select group nodes", () => this.groups.manage(group.instances));
      action("Ungroup · keep nodes", () => {
        const next = ungroupNodes(this.pinned(), group.id);
        this.reset();
        this.options.enter();
        this.options.commit(next);
        this.say("Ungrouped. Nodes and wires were kept.");
      });
    } else {
      action(
        `Group selected nodes${ids.length ? ` (${ids.length})` : ""}`,
        () => {
          const next = saveNodeGroup(this.pinned(), ids, "New group");
          const created = next.groups!.find((item) =>
            item.instances.includes(ids[0]),
          )!;
          this.options.commit(next);
          this.groups.manage(created.instances, created.id);
        },
        { disabled: ids.length < 2 },
      );
      const owner =
        node && design.groups?.find((item) => item.instances.includes(node.id));
      if (owner)
        action("Edit containing group…", () =>
          this.groups.manage(owner.instances, owner.id),
        );
    }
    if (ids.length)
      action(
        group
          ? `Delete group nodes (${ids.length})`
          : ids.length > 1
            ? `Delete selected nodes (${ids.length})`
            : "Delete node",
        () => {
          let next = this.pinned();
          for (const id of ids) next = removeComponent(next, id);
          this.reset();
          this.options.enter();
          this.options.commit(next);
          this.say(
            `Deleted ${ids.length} node${ids.length === 1 ? "" : "s"} and incident wires.`,
          );
        },
        { danger: true },
      );
    if (!node && !group) {
      action("Select nodes to group…", () => this.groups.manage([]));
      action(
        "Select all nodes",
        () => this.groups.manage(design.instances.map((item) => item.id)),
        { disabled: !design.instances.length },
      );
      action(
        "Connect nodes…",
        () => {
          this.setTool("wire");
          this.from.focus({ preventScroll: true });
        },
        { disabled: design.instances.length < 2 },
      );
      action("Add components…", () => {
        this.setTool("select");
        this.setOpen(true);
      });
      action("Fit world", () => this.scene.fit());
      action("New world…", () => this.newWorld(), { danger: true });
    }
    this.menu.hidden = false;
    // One opening-time measurement; clamp both axes and allow internal scrolling
    // on narrow screens instead of placing commands outside the viewport.
    this.menu.style.left = "0px";
    this.menu.style.top = "0px";
    const box = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
    this.menu
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }

  /** Quick wiring primes the normal directed Wire tool and retains all shared relationship checks. */
  private startContextWire(id: string, port: OutputPort): void {
    this.setTool("wire");
    this.wireFrom = id;
    this.from.value = id;
    this.updateConnect();
    this.outlet.value = port;
    this.relation.value = port === "out" ? "" : port.toUpperCase();
    this.updateConnect();
    this.say("Choose a destination in the world or use the endpoint controls.");
    this.to.focus({ preventScroll: true });
  }

  /** Standard menu keyboard navigation and native Shift+F10/ContextMenu entry. */
  private contextKey(event: KeyboardEvent): boolean {
    const target = event.target as Element;
    if (!this.menu.hidden) {
      const buttons = [
        ...this.menu.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ),
      ];
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        this.hideContext(true);
        return event.key === "Escape";
      }
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : event.key === "ArrowDown"
              ? (index + 1) % buttons.length
              : event.key === "ArrowUp"
                ? (index - 1 + buttons.length) % buttons.length
                : -1;
      if (next >= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        buttons[next]?.focus();
        return true;
      }
      return false;
    }
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return false;
    if (
      target.matches("input,textarea,select") ||
      (target as HTMLElement).isContentEditable
    )
      return false;
    if (!target.closest("#scene") && target !== document.body) return false;
    const selected = this.options.selection()[0];
    const anchor =
      target.closest(".node-group-header,.scene-instance") ??
      (selected
        ? [...this.svg.querySelectorAll<SVGGElement>(".scene-instance")].find(
            (node) => node.dataset.instanceId === selected,
          )
        : null) ??
      this.svg;
    const box = anchor.getBoundingClientRect();
    event.preventDefault();
    event.stopImmediatePropagation();
    this.showContext(
      anchor,
      box.x + box.width / 2,
      box.y + Math.min(box.height / 2, 120),
    );
    return true;
  }
}
