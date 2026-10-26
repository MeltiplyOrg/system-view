import { parseDesign, type Design, type FlowCondition } from "./design";
import { inferInstanceType } from "./layout";

/** Author workflow behavior through the same validated document used by import/export and simulation. */
export class FlowNodeEditor {
  private readonly root = document.createElement("section");
  private members: readonly string[] = [];
  constructor(
    host: HTMLElement,
    private readonly read: () => Design,
    private readonly commit: (design: Design) => void,
  ) {
    this.root.className = "detail-section flow-node-editor";
    this.root.innerHTML = `<form id="flow-node-form"><h3 class="detail-label">Simulation behavior</h3>
      <div id="flow-condition-fields"><label>Request field<input id="node-condition-field" maxlength="100" placeholder="mediaType" required/></label><label>Operator<select id="node-condition-operator"><option value="equals">Equals</option><option value="not-equals">Does not equal</option><option value="greater-than">Greater than (number)</option><option value="contains">Contains (text)</option></select></label><label>Value type<select id="node-value-type"><option value="string">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="null">Null</option></select></label><label>Value<input id="node-condition-value" maxlength="100"/></label></div>
      <label id="flow-merge-field">Synchronization<select id="node-merge-mode"><option value="all">All inputs — wait for parallel branches</option><option value="any">Any input — converge conditional branches</option></select></label>
      <label>Simulated latency (ms)<input id="node-latency" type="number" min="100" max="30000" step="100" placeholder="Default model timing"/></label>
      <button id="flow-node-save" class="btn" type="submit">Apply behavior</button><p id="flow-node-message" role="status"></p></form>`;
    host.append(this.root);
    this.query<HTMLFormElement>("#flow-node-form").addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.save();
      },
    );
    this.query("#node-value-type").addEventListener("change", () => {
      this.query<HTMLInputElement>("#node-condition-value").disabled =
        this.query<HTMLSelectElement>("#node-value-type").value === "null";
    });
  }

  /** Required descendants are fixed module-owned markup. */
  private query<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing node behavior control: ${selector}`);
    return element;
  }

  /** Render behavior for one logical target; changing a replica group's latency updates its whole machine pool. */
  show(members: readonly string[]): void {
    this.members = members;
    const node = this.read().instances.find((item) => item.id === members[0]);
    this.root.hidden = !node;
    if (!node) return;
    const type = inferInstanceType(node.id),
      branch = type === "branch";
    this.query("#flow-condition-fields").hidden = !branch;
    this.query<HTMLInputElement>("#node-condition-field").disabled = !branch;
    this.query("#flow-merge-field").hidden = type !== "merge";
    const condition = node.condition ?? {
      field: "mediaType",
      operator: "equals",
      value: "video",
    };
    this.query<HTMLInputElement>("#node-condition-field").value =
      condition.field;
    this.query<HTMLSelectElement>("#node-condition-operator").value =
      condition.operator;
    this.query<HTMLSelectElement>("#node-value-type").value =
      condition.value === null ? "null" : typeof condition.value;
    this.query<HTMLInputElement>("#node-condition-value").value =
      condition.value === null ? "" : String(condition.value);
    this.query<HTMLInputElement>("#node-condition-value").disabled =
      condition.value === null;
    this.query<HTMLSelectElement>("#node-merge-mode").value =
      node.mergeMode ?? "all";
    this.query<HTMLInputElement>("#node-latency").value =
      node.latencyMs?.toString() ?? "";
    this.query("#flow-node-message").textContent =
      "Visual behavior only. No external integration.";
  }

  /** Parse scalars without evaluating expressions, then atomically validate before committing any world change. */
  private save(): void {
    try {
      const design = this.read(),
        type = inferInstanceType(this.members[0]);
      let condition: FlowCondition | undefined;
      if (type === "branch") {
        const valueType =
          this.query<HTMLSelectElement>("#node-value-type").value;
        const raw = this.query<HTMLInputElement>("#node-condition-value").value;
        if (valueType === "boolean" && raw !== "true" && raw !== "false")
          throw new Error("Boolean values must be true or false.");
        if (
          valueType === "number" &&
          (!raw.trim() || !Number.isFinite(Number(raw)))
        )
          throw new Error("Enter a finite numeric comparison value.");
        condition = {
          field: this.query<HTMLInputElement>(
            "#node-condition-field",
          ).value.trim(),
          operator: this.query<HTMLSelectElement>("#node-condition-operator")
            .value as FlowCondition["operator"],
          value:
            valueType === "null"
              ? null
              : valueType === "number"
                ? Number(raw)
                : valueType === "boolean"
                  ? raw === "true"
                  : raw,
        };
      }
      const latency = this.query<HTMLInputElement>("#node-latency").value;
      const mode = this.query<HTMLSelectElement>("#node-merge-mode").value as
        | "all"
        | "any";
      const instances = design.instances.map((node) => {
        if (!this.members.includes(node.id)) return node;
        const {
          condition: _condition,
          mergeMode: _mode,
          latencyMs: _latency,
          ...rest
        } = node;
        return {
          ...rest,
          ...(condition ? { condition } : {}),
          ...(type === "merge" ? { mergeMode: mode } : {}),
          ...(latency ? { latencyMs: Number(latency) } : {}),
        };
      });
      this.commit(parseDesign(JSON.stringify({ ...design, instances })));
      this.query("#flow-node-message").textContent =
        "Behavior saved to the design.";
    } catch (error) {
      this.query("#flow-node-message").textContent =
        error instanceof Error
          ? error.message
          : "Could not save node behavior.";
    }
  }
}
