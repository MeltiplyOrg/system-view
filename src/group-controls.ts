import type { Design, GroundPoint } from "./design";
import { pinWorld, BUILD_GRID } from "./construction";
import {
  moveNodeGroup,
  nodeGroupMembers,
  saveNodeGroup,
  ungroupNodes,
} from "./node-groups";
import type { SystemScene } from "./scene";

/** The builder owns tool arbitration; the shell remains the sole applied-document owner. */
interface GroupOptions {
  read(): Design;
  commit(design: Design): void;
  selection(): readonly string[];
  prepare(): void;
  reveal(): void;
}

type Gesture =
  | {
      kind: "box";
      pointerId: number;
      start: GroundPoint;
      node: string | null;
      original: string[];
      additive: boolean;
    }
  | {
      kind: "move";
      pointerId: number;
      start: GroundPoint;
      id: string;
      source: Design;
      preview: Design;
      moved: boolean;
    };

/** Shared immutable keyboard steps avoid allocating a direction table on every keypress. */
const GROUP_STEPS: Readonly<Record<string, GroundPoint>> = {
  ArrowLeft: { x: -BUILD_GRID, y: 0 },
  ArrowRight: { x: BUILD_GRID, y: 0 },
  ArrowUp: { x: 0, y: -BUILD_GRID },
  ArrowDown: { x: 0, y: BUILD_GRID },
};

/** Organizational editing and one bounded gesture; no execution, idle loop, copied artwork or replica routing changes. */
export class GroupControls {
  private readonly panel = document.createElement("section");
  private readonly marquee = document.createElement("div");
  private readonly button: HTMLButtonElement;
  private readonly picker: HTMLSelectElement;
  private readonly name: HTMLInputElement;
  private readonly members: HTMLElement;
  private readonly selected = new Set<string>();
  private active = false;
  private groupId: string | undefined;
  private gesture: Gesture | null = null;
  private frame: number | null = null;
  private client: GroundPoint = { x: 0, y: 0 };

  /** The builder uses this to cancel grouping when its drawer collapses. */
  get isOpen(): boolean {
    return this.active;
  }

  constructor(
    private readonly dock: HTMLElement,
    private readonly svg: SVGSVGElement,
    private readonly scene: SystemScene,
    private readonly options: GroupOptions,
  ) {
    this.button = dock.querySelector<HTMLButtonElement>("#build-groups")!;
    this.panel.className = "group-controls";
    this.panel.id = "build-grouping";
    this.panel.hidden = true;
    this.panel.innerHTML = `<div class="group-intro"><span class="eyebrow">Organize your system</span><h2>Node groups</h2><p>Click nodes or drag a selection box. Shift-click also starts a selection. Replica pools stay together; different component types can share a group.</p><label>Manage group<select id="group-picker"><option value="">New group…</option></select></label></div><form id="group-form"><label>Group name<input id="group-name" maxlength="100" required placeholder="Media processing"/></label><div class="group-actions"><button id="group-save" class="btn btn-primary" type="submit" disabled>Create group</button><button id="group-ungroup" class="btn" type="button" disabled>Ungroup</button><button id="group-clear" class="btn" type="button">Clear selection</button></div><p id="group-message" role="status">Select at least two nodes. Drag a group’s title bar to move it.</p></form><fieldset class="group-member-field"><legend id="group-count">Selected nodes · 0</legend><div id="group-members" class="group-members"></div></fieldset>`;
    dock.querySelector(".build-footer")!.before(this.panel);
    this.marquee.className = "group-marquee";
    this.marquee.hidden = true;
    dock.parentElement!.append(this.marquee);
    this.picker = this.query("#group-picker");
    this.name = this.query("#group-name");
    this.members = this.query("#group-members");
    this.button.addEventListener("click", () =>
      this.active ? this.options.prepare() : this.open(),
    );
    this.picker.addEventListener("change", () =>
      this.choose(this.picker.value || undefined),
    );
    this.query("#group-clear").addEventListener("click", () => this.select([]));
    this.query<HTMLFormElement>("#group-form").addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        try {
          const design = saveNodeGroup(
            this.pinned(),
            this.selected,
            this.name.value,
            this.groupId,
          );
          this.groupId = design.groups!.find((group) =>
            group.instances.includes(this.selected.values().next().value!),
          )!.id;
          this.options.commit(design);
          this.message(
            "Group saved. Drag its title bar to move every member together.",
          );
        } catch (error) {
          this.error(error);
        }
      },
    );
    this.query("#group-ungroup").addEventListener("click", () => {
      if (!this.groupId) return;
      const design = ungroupNodes(this.pinned(), this.groupId);
      this.groupId = undefined;
      this.select([]);
      this.options.commit(design);
      this.message("Ungrouped. All nodes, wires and replica pools were kept.");
    });
    document.addEventListener("pointermove", (event) => this.move(event), true);
    document.addEventListener("pointerup", (event) => this.end(event), true);
    for (const type of ["pointercancel", "lostpointercapture"] as const)
      document.addEventListener(
        type,
        (event) => {
          if (this.gesture?.pointerId === event.pointerId) this.cancelGesture();
        },
        true,
      );
    this.scene.onLayoutChange(() => {
      if (this.active) this.scene.previewNodeSelection(this.selected);
    });
  }

  /** Fixed markup is module-owned; user labels are added only with textContent. */
  private query<T extends HTMLElement>(selector: string): T {
    const node = this.panel.querySelector<T>(selector);
    if (!node) throw new Error(`Missing grouping control: ${selector}`);
    return node;
  }

  /** Claim the existing builder drawer, keeping the camera fixed and ordinary inspectors closed. */
  private open(initial = this.options.selection()): void {
    this.options.prepare();
    this.active = true;
    this.panel.hidden = false;
    this.name.value = "";
    this.button.setAttribute("aria-pressed", "true");
    this.dock
      .querySelector("#build-select")!
      .setAttribute("aria-pressed", "false");
    this.svg.classList.add("tool-group");
    this.options.reveal();
    this.sync(this.options.read());
    this.select(nodeGroupMembers(this.options.read(), initial));
  }

  /** Context actions borrow the current multi-selection without mutating it. */
  get selectedNodes(): readonly string[] {
    return [...this.selected];
  }

  /** Open a named group or explicit selection through the ordinary grouping controls. */
  manage(ids: readonly string[], groupId?: string): void {
    this.open(ids);
    if (groupId) {
      this.choose(groupId);
      this.picker.value = groupId;
    }
    this.name.focus({ preventScroll: true });
    this.name.select();
  }

  /** Context selection toggles retain an existing marquee selection and expand whole pools. */
  toggleNode(id: string): void {
    if (!this.active) this.open();
    this.toggle(id);
  }

  /** Closing or switching tools cancels previews without committing their transient positions. */
  close(): void {
    this.cancelGesture();
    if (this.active) this.scene.previewNodeSelection([]);
    this.active = false;
    this.groupId = undefined;
    this.selected.clear();
    this.panel.hidden = true;
    this.button.setAttribute("aria-pressed", "false");
    this.svg.classList.remove("tool-group");
  }

  /** Reconcile authored containers and member checkboxes after every applied graph edit. */
  sync(design: Design): void {
    if (!this.active) return;
    const group = design.groups?.find((item) => item.id === this.groupId);
    this.groupId = group?.id;
    this.picker.replaceChildren(
      new Option("New group…", ""),
      ...(design.groups ?? []).map(
        (item) =>
          new Option(`${item.label} · ${item.instances.length} nodes`, item.id),
      ),
    );
    this.picker.value = this.groupId ?? "";
    if (group) {
      this.name.value = group.label;
      this.selected.clear();
      for (const id of group.instances) this.selected.add(id);
    }
    const live = new Set(design.instances.map((node) => node.id));
    for (const id of this.selected) if (!live.has(id)) this.selected.delete(id);
    this.members.replaceChildren(
      ...design.instances.map((node) => {
        const label = document.createElement("label"),
          input = document.createElement("input"),
          text = document.createElement("span");
        input.type = "checkbox";
        input.value = node.id;
        input.checked = this.selected.has(node.id);
        input.addEventListener("change", () => this.toggle(node.id));
        text.textContent = node.label ? `${node.label} · ${node.id}` : node.id;
        label.append(input, text);
        return label;
      }),
    );
    this.paintSelection();
  }

  /** Choosing a saved group edits its membership; selecting New starts a fresh container. */
  private choose(id?: string): void {
    this.groupId = id;
    const group = this.options.read().groups?.find((item) => item.id === id);
    this.name.value = group?.label ?? "";
    this.select(group?.instances ?? []);
    this.message(
      "Edit the name or selection, then save. Ungroup keeps the nodes.",
    );
  }

  /** Pool expansion keeps selection and later group drags consistent with replica handles. */
  private toggle(id: string): void {
    const members = nodeGroupMembers(this.options.read(), [id]);
    const remove = this.selected.has(id);
    for (const member of members) {
      if (remove) this.selected.delete(member);
      else this.selected.add(member);
    }
    this.paintSelection();
  }

  /** Selection is UI state only, not a document mutation or a camera focus operation. */
  private select(ids: Iterable<string>): void {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.paintSelection();
  }

  /** Update cheap live outlines and native checkbox state without touching cached artwork. */
  private paintSelection(): void {
    for (const input of this.members.querySelectorAll<HTMLInputElement>(
      "input",
    ))
      input.checked = this.selected.has(input.value);
    this.query("#group-count").textContent =
      `Selected nodes · ${this.selected.size}`;
    this.query<HTMLButtonElement>("#group-save").disabled =
      this.selected.size < (this.groupId ? 1 : 2);
    this.query("#group-save").textContent = this.groupId
      ? "Save group"
      : "Create group";
    this.query<HTMLButtonElement>("#group-ungroup").disabled = !this.groupId;
    this.scene.previewNodeSelection(this.selected);
  }

  /** Intercept only grouping, Shift-selection, and a group's explicit title-bar drag. */
  claimsPointer(event: PointerEvent): boolean {
    // A second contact cancels the one-pointer edit before normal navigation
    // can claim it; never leave a half-moved group behind a pinch gesture.
    if (this.gesture && this.gesture.pointerId !== event.pointerId) {
      this.cancelGesture();
      return false;
    }
    if (event.button !== 0 || !event.isPrimary) return false;
    const target = event.target as Element;
    const group = target.closest<SVGGElement>(".node-group");
    if (group) {
      const start = this.scene.screenToWorld(event.clientX, event.clientY);
      if (!start) return false;
      this.options.prepare();
      const source = this.pinned();
      this.scene.clearOffsets();
      this.gesture = {
        kind: "move",
        pointerId: event.pointerId,
        start,
        id: group.dataset.nodeGroupId!,
        source,
        preview: source,
        moved: false,
      };
    } else {
      if (!this.active && !event.shiftKey) return false;
      if (!this.active) this.open();
      this.gesture = {
        kind: "box",
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        node:
          target.closest<SVGGElement>(".scene-instance")?.dataset.instanceId ??
          null,
        original: [...this.selected],
        additive: event.shiftKey,
      };
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.client = { x: event.clientX, y: event.clientY };
    this.svg.setPointerCapture(event.pointerId);
    return true;
  }

  /** Pointer work is coalesced; there is no scheduling while idle. */
  private move(event: PointerEvent): void {
    if (this.gesture?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.client = { x: event.clientX, y: event.clientY };
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paintGesture();
    });
  }

  /** Projected selection uses cached scene bounds; group moves reuse keyed artwork and the normal wire router. */
  private paintGesture(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.kind === "move") {
      const point = this.scene.screenToWorld(this.client.x, this.client.y);
      if (!point) return;
      const delta = {
        x: point.x - gesture.start.x,
        y: point.y - gesture.start.y,
      };
      if (Math.hypot(delta.x, delta.y) < 2 && !gesture.moved) return;
      gesture.moved = true;
      gesture.preview = moveNodeGroup(gesture.source, gesture.id, delta);
      this.scene.render(gesture.preview, true);
      return;
    }
    if (
      Math.hypot(
        this.client.x - gesture.start.x,
        this.client.y - gesture.start.y,
      ) <= 6
    )
      return;
    const x = Math.min(gesture.start.x, this.client.x),
      y = Math.min(gesture.start.y, this.client.y);
    this.marquee.hidden = false;
    Object.assign(this.marquee.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${Math.abs(this.client.x - gesture.start.x)}px`,
      height: `${Math.abs(this.client.y - gesture.start.y)}px`,
    });
    const ids = this.scene.nodesInSelection(gesture.start, this.client);
    this.select(
      nodeGroupMembers(this.options.read(), [
        ...(gesture.additive ? gesture.original : []),
        ...ids,
      ]),
    );
  }

  /** Release commits exactly once; a title click opens management rather than moving nodes. */
  private end(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.client = { x: event.clientX, y: event.clientY };
    this.paintGesture();
    this.gesture = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.svg.hasPointerCapture(event.pointerId))
      this.svg.releasePointerCapture(event.pointerId);
    this.marquee.hidden = true;
    if (gesture.kind === "move") {
      if (gesture.moved) this.options.commit(gesture.preview);
      else {
        this.open();
        this.choose(gesture.id);
        this.picker.value = gesture.id;
      }
    } else if (
      Math.hypot(
        this.client.x - gesture.start.x,
        this.client.y - gesture.start.y,
      ) <= 6
    ) {
      if (gesture.node) this.toggle(gesture.node);
      else if (!gesture.additive) this.select([]);
    }
  }

  /** Revoke capture after clearing state so lostpointercapture cannot recursively cancel. */
  private cancelGesture(): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.marquee.hidden = true;
    if (!gesture) return;
    if (this.svg.hasPointerCapture(gesture.pointerId))
      this.svg.releasePointerCapture(gesture.pointerId);
    if (gesture.kind === "move") this.scene.render(gesture.source, true);
    else this.select(gesture.original);
  }

  /** Keyboard parity: open/select through native controls; move focused group titles with arrows. */
  handleKey(event: KeyboardEvent): boolean {
    const target = event.target as Element;
    if (
      target.matches("input,textarea,select") ||
      (target as HTMLElement).isContentEditable
    )
      return false;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.open();
      this.name.focus();
      return true;
    }
    if (event.key === "Escape" && (this.active || this.gesture)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.options.prepare();
      return true;
    }
    const header = target.closest<SVGGElement>(".node-group-header");
    const id = header?.closest<SVGGElement>(".node-group")?.dataset.nodeGroupId;
    if (!id) return false;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.open();
      this.choose(id);
      this.picker.value = id;
      return true;
    }
    const delta = GROUP_STEPS[event.key];
    if (!delta) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.options.prepare();
    this.options.commit(moveNodeGroup(this.pinned(), id, delta));
    this.svg
      .querySelector<SVGGElement>(
        `.node-group[data-node-group-id="${CSS.escape(id)}"] .node-group-header`,
      )
      ?.focus();
    return true;
  }

  /** Capture actual sites before changing grouping or previewing a shared move. */
  private pinned(): Design {
    return pinWorld(this.options.read(), this.scene.getWorldInstances());
  }
  /** Status text is plain user-visible output; errors never suppress an invalid mutation. */
  private message(text: string): void {
    this.query("#group-message").textContent = text;
  }
  /** Parser/mutation errors leave the applied world unchanged. */
  private error(error: unknown): void {
    this.message(
      error instanceof Error ? error.message : "Could not save the group.",
    );
  }
}
