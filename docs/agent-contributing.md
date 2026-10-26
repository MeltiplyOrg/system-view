# App contribution guide

This guide maps the module that owns each value, the contracts a change must
keep, and the proof that closes the change. `AGENTS.md` owns universal policy;
this guide adds the app's mechanics.

## Fast path

1. **Find the owner.** Use the ownership map below. Done when you can name the
   one module that produces the value you are changing and the test or spec
   that observes it.
2. **Read the contract.** Read the owner's module comment and the contract
   section for that area. Done when you can state its input → output and the
   invariant your diff must keep.
3. **Pin the behavior.** Run the existing assertion first; add a focused test
   when the value has no direct proof. Done when a failing case names the
   behavior and its boundary.
4. **Change the owner.** Keep derived data out of the document. Done when the
   diff touches the smallest module set and the value has one source of truth.
5. **Prove it.** Run the narrowest suite, then observe the changed surface in
   the app. Done when the proof matrix row for that surface is green and a
   manual or scripted smoke matches the contract.
6. **Commit.** Follow `AGENTS.md` for the message and gate timing. Done when
   the staged diff matches the message and the milestone gates are green.

## Ownership map

| Surface                                           | Owner                                                      | Collaborators                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Document shape, validation, examples              | `src/design.ts`                                            | `src/main.ts` editor; `src/layout.ts` inputs                                     |
| Placement, color, cluster bounds                  | `src/layout.ts`                                            | `src/platform.ts`, `src/scene.ts`, `src/routing.ts`                              |
| Provider catalog, accent, footprint, mark         | `src/providers.ts`                                         | `src/components.ts`, `src/database.ts`, `src/style.css`, `src/main.ts`           |
| Renderer artwork, height, label placement, motion | `src/components.ts`                                        | `src/style.css`, `src/component-raster.ts`                                       |
| Database rack geometry and shared `<defs>`        | `src/database.ts`                                          | `src/components.ts` wrapper                                                      |
| Provider database cabinets                        | `src/database-skins.ts`                                    | `src/database.ts`, `src/providers.ts`, `src/style.css`                           |
| CDN provider appliances                           | `src/cdn-skins.ts`                                         | `src/component-geometry.ts`, `src/providers.ts`, `src/cdn-provider-marks.ts`     |
| Platform union and rendering                      | `src/platform.ts`                                          | `src/layout.ts` footprints                                                       |
| Canvas render pass, camera, selection             | `src/scene.ts`                                             | `src/components.ts`, `src/component-raster.ts`, `src/main.ts` overlays           |
| Raster cache and shared images                    | `src/component-raster.ts`                                  | `src/scene.ts`, `src/style.css` palettes                                         |
| Mechanical provider changes                       | `src/transformer-transitions.ts`                           | `src/transformer.ts` rig; renderer envelope metadata; raster leases              |
| Layer partition and assembly timing               | `src/assembly.ts`                                          | `src/transformer.ts`; pure ordering/travel regression tests                      |
| Shell, editor, callout, detail, theme             | `src/main.ts`                                              | `index.html`, `src/style.css`                                                    |
| Replica document mutation                         | `src/replicas.ts`                                          | `src/layout.ts`, `src/main.ts` stepper                                           |
| Construction catalogue and graph mutations        | `src/construction.ts`                                      | `src/design.ts`, `src/layout.ts`, `src/providers.ts`                             |
| Factory drawer and pointer/keyboard tool state    | `src/world-builder.ts`                                     | `src/main.ts` commits; `src/scene.ts` preview and ground projection              |
| Organizational grouping and multi-selection       | `src/node-groups.ts` mutations; `src/group-controls.ts` UI | `src/design.ts` validation; `src/scene.ts` backdrops and cached selection bounds |
| Typed connections and replication capabilities    | `src/component-rules.ts`                                   | `src/design.ts`, `src/construction.ts`, `src/replicas.ts`, builder/inspector     |
| Queue/storage/worker and workflow models          | `src/media-models.ts`                                      | `src/media-provider-marks.ts`, `src/components.ts`, `src/providers.ts`           |
| Junction conditions and merge mode                | `src/flow-node-editor.ts`                                  | parser-backed design annotations; `src/main.ts` inspector                        |
| Orthogonal cable routing                          | `src/routing.ts`                                           | `src/scene.ts` obstacles and ports                                               |

## Render pass

One pass explains where most edits belong:

1. `parseDesign` validates JSON into a `Design`. The renderer trusts validated
   data.
2. `main.ts` applies it with `scene.render(design)`. In-place edits such as a
   provider or replica change use `scene.render(design, true)` so the camera
   and live roots survive.
3. `SystemScene.render` derives `layoutDesign`, builds the static layer
   (border frames, platforms, cluster labels, links), and reconciles keyed
   `.scene-instance` roots. The static layer paints in that order; instance
   roots paint back-to-front by `x + y`.
4. `createComponent` builds `.scene-instance` → `.component-static-base` +
   optional `.component-motion` + `.component-label`. A registered provider
   variant selects artwork, height, and label placement.
5. `ComponentRasterCache.sync` snapshots the static base into shared images.
   The motion layer and label stay live. `setScale` and culling keep the cache
   aligned with the camera.
6. `main.ts` keeps callout and inspector geometry in screen space, following
   `onViewChange` and `onLayoutChange`.

## Contracts

### Document and layout

- `Design` is the portable source of truth: `version: 1`, instances, links,
  clusters. Explicit `placement: {x, y}` is user-authored build intent.
  Omitted positions, colors, footprints, and measured pixels are derived.
- IDs select the renderer by leading word: `db`/`database`/`rack` → database,
  `compute`/`server`/`api` → compute, `web`/`webpage`/`frontend` → webpage,
  `cache` → cache, `cdn` → delivery edge, `queue`/`broker` → message queue,
  `storage`/`bucket` → object storage, `worker`/`encoder` → media worker,
  `lb`/`balancer`/`loadbalancer` → load balancer,
  `branch`/`condition` → If/Else, `merge`/`join` → Merge; unknown → database.
- `layoutDesign` is deterministic from the document alone. Explicit sites
  override automatic slots; a pinned first replica anchors the default slots
  of newly added members. Existing explicit sites never silently repack.
  Automatic replica pitch follows the largest footprint plus a fixed air gap.
- `resizeReplicas` owns replica membership: 1–10 members within the shared
  64-component limit. New replicas inherit presentation, not the primary's
  exact site. Removed members' external links move to the first member.
  Only API/compute and worker machines scale as instances; databases and caches
  support replicas, except SQLite. Clients, CDNs, load balancers, logical queues/buckets,
  and workflow controls are not machine replicas. Replica pools require the same
  type and provider; organizational `groups` may contain any mix of types.
- `parseDesign` owns limits and reference checks. Add a field there before
  teaching the renderer or editor about it.

### Factory construction

- `WorldBuilder` owns the collapsible bottom drawer, side category list and
  Select/Place/Wire/Remove tools. Its catalogue derives provider skins from the
  existing registry. Small catalogue glyphs are not copies of detailed models.
- Drag a card to clear ground, or tap/click a card then tap/click the world.
  Keyboard activation seeds a preview; arrows move it and Enter places it.
  Escape, capture cancellation, blur, and backgrounding remove the preview.
  Dropping onto another UI surface adds nothing. New world confirms before
  clearing a populated document.
- Placement snaps to a 40-unit grid, using actual provider footprints with
  clearance. `placeComponent` rejects occupied sites, not just its UI caller.
  `parseDesign` validates finite ground coordinates within ±100,000 world
  units. The existing 64-component and 256-wire limits also apply to building.
- Before graph edits, `pinWorld` captures actual sites, including pending
  legacy anchor offsets. `main.ts` commits the immutable document, clears
  transient offsets, and renders in place. Adding, wiring, and removing never
  refit the camera or repack neighbours. JSON import/export retain placements.
- Completed anchor moves persist the whole group's sites. A cancelled anchor
  gesture restores its prior offset; applying another document cancels capture.
  A no-movement handle click does not rewrite the document.
- Wiring is directed source → destination, by drag, two clicks, or the native
  endpoint form. `component-rules.ts` owns compatible types and output ports;
  imports and construction use those same rules. Invalid destinations are
  disabled in the form and their world footprints are dimmed. Queue outputs
  deliver to workers; a browser cannot wire directly to a database.
- Load balancers accept browser, CDN or compute ingress and route to compute
  backends, not directly to databases, caches, queues or buckets. Workflow
  controls remain valid explicit routing points. Build → **Load balancer**
  adds a stepped crossbar appliance using the shared geometry and raster cache.
- Branches require an explicit `true`/`false` outlet. Other nodes use `out`
  (omitted by default). Construction rejects duplicate source/destination/port
  triples. Distinct ports may reach the same target; parallel imported links
  to the same target need explicit IDs. `relation` is annotation, not code.
  The rubber band is lightweight and orthogonal; committed wires use the
  existing obstacle-aware router and frame ports.
- Remove deletes only the selected component and incident connections, updates
  its affected group, and dissolves that group if fewer than two members
  remain. Unrelated groups, including valid singleton groups, are unchanged.
- The scene owns one construction overlay. Its real-model ghost reuses the
  ordinary raster cache, removes decorative activity, and moves only a parent
  transform. Wire preview uses one path. Pointer updates coalesce into one
  animation frame; there is no idle loop, separate encoder or raised cache
  budget. Empty worlds start at a useful multi-machine construction scale.
- Opening construction freezes any inspector camera spring. Opening Design
  cancels construction and collapses its drawer; controls remain keyboard
  reachable, and collapsed content leaves the tab order.

### Organizational node groups

- `groups?: [{id, label, instances}]` is independent of replica `clusters`.
  It organizes nodes without altering placement, ports, connections, provider
  choices or scaling semantics. Each node belongs to at most one organization
  group; replica pools stay wholly inside one group or remain ungrouped.
- **Groups** shares the existing Build drawer. Click nodes, Shift-click from
  Select, drag a marquee, or use the native member checkboxes. Ctrl/Cmd+G opens
  grouping. Creation needs at least two selected nodes; existing groups may
  retain one member. Empty containers disappear after their last node is removed.
- The group picker manages names and membership. Saving transfers selected
  nodes out of previous groups, never nests containers. Ungroup removes only
  the container. Scaling a grouped pool updates organizational membership;
  deleting nodes prunes it. All mutations preserve unrelated nodes and wires.
- Backdrops wrap projected member artwork and do not become cable obstacles
  or connection endpoints. The title bar drags the whole group; a click opens
  management. A focused title supports arrow-key movement. Individual nodes
  and replica handles remain independently editable inside the container.
- Group drags pin the actual world once, preview one shared bounded delta
  through the normal keyed scene/raster cache, and commit on release. Escape,
  capture cancellation, blur, or applying another design restores the starting
  geometry. No idle clock, model clones, new cache budget or packet actors.
- Marquee and selection outlines use cached projected bounds, never model DOM
  measurement on pointer frames. Native checkboxes support keyboard and touch;
  labels are plain text. Group names, membership and positions survive export
  and import; transient selection does not.

### Contextual quick actions

- `WorldBuilder` owns one screen-space right-click menu. Node artwork and its
  standalone/replica frame resolve to actual document identities; group titles
  resolve to organizational containers. Empty ground opens world actions.
- Node actions inspect, prime typed outgoing wiring, add/remove multi-selection,
  group the selection, or delete nodes and incident wires. If/Else has distinct
  TRUE/FALSE actions. The clicked node is the source even when another node was
  inspected earlier. Existing `connectionIssue` validation remains authoritative.
- Right-clicking a selected node acts on that selection; an unselected node
  targets only itself. Opening/dismissing the menu never changes topology or
  selection. Group title actions edit, select members, ungroup without deletion,
  or explicitly delete the group's nodes. Creation opens the name field for
  immediate renaming. All mutations use the existing pin/commit path.
- The menu clamps to the viewport, scrolls internally on narrow screens, and
  hides competing hover chrome. Shift+F10/ContextMenu opens it from the world;
  Up/Down/Home/End navigate enabled items. Enter/Space activate native buttons.
  Escape restores world/title focus without clearing selection; Tab, outside
  presses, camera changes, Apply, tool changes and blur dismiss the menu.
  Editable text/select fields retain their native context menu behavior.
- `e2e/context-menu.spec.ts` exercises actual secondary clicks, source/port
  precedence, selected-vs-unselected deletion, grouping, safe ungrouping,
  viewport clamping and keyboard dismissal.

### Visual routing workflows

- This is a visual system-design sandbox, not an integration platform. Provider
  skins never connect to external apps. No real uploads, transcoding, queues,
  databases or cloud APIs run. The request simulator, its clock, JSON injection,
  trace viewer and input/output panel have been removed; cable pulses are
  decorative traffic, not execution results.
- The editable media-app reference remains in Design → Reference design. It
  illustrates video/image routing, parallel original/processing paths, a
  queue/worker topology, publication and CDN playback.
- If/Else and Merge render as cable-sized fittings, not machine appliances.
  `isWireJunction` in `layout.ts` owns this classification. Their 48 × 48 ground
  footprint drives placement, hit bounds and routing clearance; they contribute
  no platform and have no standalone dashed frame. Cables terminate at the
  fitting center, never at an invisible machine-sized frame port.
- Static fitting artwork uses the normal shared raster cache. A live transparent
  hit/selection ring remains outside cached pixels; full names stay accessible
  through the root label, tooltip and inspector rather than a large nameplate.
  The move handle sits beside a fitting so it cannot cover its entire hit target.
- Select a junction to edit its routing annotation. If/Else persists
  `condition: {field, operator, value}` with scalar comparisons and explicit
  TRUE/FALSE wire outlets. Merge persists `mergeMode: \"all\" | \"any\"` to express
  synchronization or independent convergence. These describe design intent;
  no request data or expressions are executed.
- Ordinary machines do not show a simulation-behavior form. Existing imported
  `latencyMs` annotations still validate and round-trip without being executed
  or changed by routing-rule edits. Typed connection and replica restrictions
  remain enforced by the shared parser and builder.

### Geometry and artwork

- Isometric projection is `project` in `src/database.ts`. Generic component
  face planes, boxes, fans, and detail paths live in `src/component-geometry.ts`
  and serve both `src/components.ts` and `src/cdn-skins.ts`; world units are
  the drawing unit.
- Faces are opaque and painter order is the only depth sort. A new part must
  paint back-to-front around the existing box and detail groups.
- Object storage's controller spine sits on the near (+x) side of every drive
  blade. Paint its body and face details after the blades; a late brand badge
  cannot repair early body occlusion. `e2e/storage-models.spec.ts` checks the
  controller's actual cached pixels in both light and dark themes.
- `componentHeight` feeds camera fit and callout anchors. Height and footprint
  are provider-aware through the variant and theme. Unsupported providers must
  not change fitting height or assembly bounds for another renderer type.
- Provider artwork has three layers: static `.component-static-base`, live
  `.component-motion`, then `.component-label`. Labels use `textContent` so
  imported strings cannot inject markup; only trusted constants use
  `innerHTML`.
- Use the exact upstream brand mark from the provider theme, and place one mark
  on the object. The Redis cache reuses `REDIS_LOGO_ART`; database skins print
  the theme mark on an enamel plate.
- Database provider skins are dedicated cabinets in `src/database-skins.ts`:
  PostgreSQL's arched archive tower, MySQL's wave cabinet with a dorsal fin,
  SQLite's low file tray, and MongoDB's shard enclosure. Each owns its height
  and `db-<id>-rear/front` definitions; the neutral rack remains provider-free.
- The default CDN is a raised routing core between two cache pods. Provider
  appliances in `src/cdn-skins.ts` reuse the same footprint and live name rail,
  but own their seated-module layouts, roof hardware, physical height, and
  assembly envelope. The CDN delivery example shows client → edge → origin.
  One shared static bitmap per skin holds the chassis and exact upstream mark;
  at most three packet paths and one status cluster stay live, pause with
  navigation, and stop for reduced motion. Default ↔ provider and provider ↔
  provider changes reuse the bounded layered assembly.
- CDN provider keys are:

  | Key                 | Product           | Physical architecture                                 |
  | ------------------- | ----------------- | ----------------------------------------------------- |
  | `cloudflare`        | Cloudflare CDN    | Wide shielded gateway and paired cache shelves        |
  | `cloudfront`        | Amazon CloudFront | Stepped distribution hub and low delivery decks       |
  | `google-cloud-cdn`  | Google Cloud CDN  | Three modular relay towers and front controller       |
  | `azure-front-door`  | Azure Front Door  | Twin gateway pylons joined by a raised lintel         |
  | `fastly`            | Fastly            | Low streaming blades and side cooling manifold        |
  | `akamai`            | Akamai            | Terraced route-exchange banks and service spine       |
  | `bunny`             | bunny.net         | Paired upright cartridge banks and compact controller |
  | `cdn77`             | CDN77             | Two tall cache stacks and low cross-controller        |
  | `keycdn`            | KeyCDN            | Asymmetric shelves beside a tall routing spine        |
  | `alibaba-cloud-cdn` | Alibaba Cloud CDN | Wide portal gateway and three content modules         |

- CDN themes are rejected on every non-CDN renderer, just as Redis only applies
  to cache nodes and database products only apply to database racks.
- The provider accent tints faces, glass, LEDs, and cables. `ProviderTheme.plate`
  chooses a contrasting enamel tone for the one exact mark, never a white
  backing. CDN77 uses yellow enamel so its official dark wordmark stays legible;
  other products use dark enamel. SVG source URLs live in the mark module.

### Wires

- External links attach to a frame side chosen by the ray from the endpoint
  member to the far endpoint. One cable uses the side midpoint.
- Several cables on one side divide it into equal segments and attach at each
  segment's midpoint. Ordering by the far endpoint's coordinate along that side
  keeps the fan centered and reduces crossings.
- Ports leave and enter on a fixed outward stub. The router avoids frame
  rectangles, and the final leg meets the border perpendicular. Internal
  same-cluster links stay rack-to-rack and have no border port.

### Raster cache

- The raster cache discovers a geometry root by `data-renderer-type` and a
  provider by `data-renderer-provider`. New renderer types must join
  `RENDERER_TYPES` in `src/component-raster.ts`.
- Static artwork is snapshotted; motion stays live by design. CSS animations
  inside `.component-static-base` are frozen in the image.
- Static fills that resolve from CSS variables must stay in
  `PALETTE_PROPERTIES`, or a theme change will serve a stale image.
- `data-raster-ready` marks a component with images installed. Existing roots
  survive replica edits; removing and re-adding a replica reuses shared pixels.
- `capture` borrows decoded image references; release every lease when a rig
  completes or is cancelled. Theme invalidation retires leased URLs until their
  last borrower releases them. `requestSnapshot` prioritizes the normal target
  job, retaining the existing pixel budget and single-encode queue.

### Provider transitions

- Provider changes synchronously mount final artwork, border, and platform.
  Selection is rebound without refocusing the camera: another camera glide
  would delay target rasterization and obscure the mechanical movement.
- `transformer.ts` assembles the target bottom-to-top: base, stacked body
  sections, then cap. The source un-stacks top-down first. The full cycle takes
  800 ms; only the next section moves, seating from nine model units above.
  Completed sections remain fixed. No hinged doors, wireframe chassis, fading,
  whole-cabinet scaling, or large part travel.
- Sections follow the cabinet's isometric front/side contour, not horizontal
  screen-space strips. Temporary horizontal decks close exposed sections;
  the final cap restores the exact original artwork. Seated sections share
  one clipped image to avoid seams, plus one image for the seating section.
- Envelope metadata belongs to each renderer, not a provider pair. Surface
  textures reference the existing shared bitmaps. Never expand or clone the
  detailed stationary vector trees, allocate transition-only canvases, or add
  filters/compositing layers. The previous live-vector experiments caused a
  reported system crash; those resource-heavy paths must stay removed.
- `TransformerTransitions` owns one 30 Hz clock, at most three active rigs,
  and at most twelve total jobs. Queued changes retain stationary source
  pixels. Reduced motion, an unavailable source snapshot, offscreen artwork,
  or an exhausted queue uses immediate static replacement instead.
- Completion, interruption, removal, Apply/Reset, theme changes, reduced-motion
  changes, and backgrounding settle to final artwork and release both leases.
  A cold target uses the normal prioritized raster job, never a second encoder.
- Renderer activity and new-replica entry remain separate. Reduced motion
  disables decorative movement and bypasses the mechanical rig.

### Shell and state

- `current` in `src/main.ts` is the applied and exported document. The editor
  textarea is a draft; only `parseDesign` + `apply` change `current`.
- A failed apply leaves the previous scene and `current` intact. Render first,
  then sync the editor and metadata.
- Provider and replica edits re-render in place, sync the document, and rebind
  the pinned selection. Apply and Reset use a non-animated render and refit.
- Callout and inspector are screen-space overlays. Use the scene's view and
  layout listeners instead of measuring projected SVG geometry.
  Tooltip marks occupy a real grid column, never cover the summary. Card size
  follows resize/font changes. `src/callout-layout.ts` places cards around cached
  HTML overlay rectangles; pointer movement never measures panel DOM. Summary
  labels identify the actual component type, and worker pools count instances.
- Theme is `data-theme` on `<html>`; absence follows the OS. Keep accessible
  names, focus movement, `inert`, and the `aria-live` message intact.

## Change paths

| Goal                             | Edit in this order                                                                                                                                         | Close with                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Add a provider skin              | `providers.ts` theme → `components.ts`, `cdn-skins.ts`, or `database-skins.ts` artwork → palette/motion → provider gating proof                            | provider catalogue and footprint proof; provider e2e |
| Add a renderer type              | `design.ts` type → `layout.ts` prefix/color/footprint → `components.ts` geometry/height/label → `component-raster.ts` renderer list → scene/callout labels | unit tests per pure owner; boot scene e2e            |
| Tune replica spacing or groups   | `layout.ts` constants and packing → `tests/layout.test.ts` → verify border ports, platform union, routing                                                  | layout, platform, routing, replica e2e               |
| Reshape artwork                  | `components.ts` variant → `style.css` palette/animation → reduced-motion block                                                                             | app/cache e2e; visual smoke at overview and close-up |
| Change shell, editor, inspector  | `main.ts` → `index.html` → `style.css`                                                                                                                     | `e2e/app.spec.ts`, including a11y                    |
| Change camera, selection, cables | `scene.ts`; extract pure math for unit proof where possible                                                                                                | `tests/scene-*.test.ts`, `e2e/app.spec.ts`           |

### Provider skin checklist

1. Register the theme in `PROVIDERS`: canonical id, label, accent, supported
   types, optional footprints, exact self-contained logo.
2. Add artwork in its owner: `PROVIDER_VARIANTS` for generic renderers,
   `ARCHITECTURES` in `src/cdn-skins.ts` for CDN appliances, or dedicated
   `db-<id>-rear/front` builders in `src/database-skins.ts` for database cabinets.
   Keep the model height, one exact badge, and contrasting enamel with the skin.
3. Add skin classes to `style.css`. Put animated fills and strokes outside the
   static base. Add the reduced-motion rule.
4. Supply the physical cabinet envelope alongside its artwork. The shared
   mechanism consumes these dimensions; never add provider-pair choreography.
5. Prove color and footprint through `layoutDesign` and supported-type gating
   through `providersFor`; add that focused provider test. Then switch provider
   on a cache, CDN, or database node in the browser: exactly one artwork mark
   (inspect before the raster cache replaces vectors), final border/platform,
   live selection, bounded connected motion, and no leftover rig after settling.
6. Check `bun run size`; provider art ships in the JS bundle.

## Proof matrix

| Surface                                         | Fast proof                                                                            | Browser proof                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Validation, limits, references                  | `tests/design.test.ts`                                                                | apply/import/export in `e2e/app.spec.ts`                                      |
| Placement, pitch, cluster bounds, colors        | `tests/layout.test.ts`                                                                | replica and provider paths in `e2e/app.spec.ts`                               |
| Provider catalogue, gates, object marks         | `tests/providers.test.ts`, `tests/components.test.ts`, `tests/database-skins.test.ts` | `e2e/database-providers.spec.ts`, `e2e/cdn-providers.spec.ts`                 |
| Platform topology and markup                    | `tests/platform.test.ts`, `tests/platform-render.test.ts`                             | boot scene render in `e2e/app.spec.ts`                                        |
| Cable routing and cluster ports                 | `tests/routing.test.ts`, `tests/scene-port.test.ts`                                   | `e2e/wires.spec.ts`; link and zoom tests in `e2e/app.spec.ts`                 |
| Rack geometry and projection                    | `tests/database.test.ts`                                                              | boot scene and theme switch in `e2e/app.spec.ts`                              |
| Replica mutation                                | `tests/replicas.test.ts`                                                              | replica stepper and ten-replica layout                                        |
| Factory placement, wiring, removal, persistence | `tests/construction.test.ts`, `tests/design.test.ts`, `tests/replicas.test.ts`        | `e2e/world-builder.spec.ts`                                                   |
| Organizational groups and shared movement       | `tests/node-groups.test.ts` validation, transfer, scaling and clamping                | actual Groups drawer, title dragging, marquee, import/export and mobile smoke |
| Shell, editor, theme, a11y                      | —                                                                                     | `e2e/app.spec.ts`                                                             |
| Canvas, raster, selection, assembly             | `tests/transformer.test.ts` ordering and travel bounds                                | `e2e/app.spec.ts`, `e2e/component-cache.spec.ts`                              |

Gates: `bun run check` (format, lint, types), `bun run build`, `bun run size`.

Notes:

- Browser tests run against `dist`. Build before a targeted Playwright run;
  otherwise the browser proves the previous bundle.
- E2E defaults to reduced motion. A transition test opts out with
  `test.use({ reducedMotion: "no-preference" })`.
- Callout geometry checks wait for `document.fonts.ready` and assert placement,
  pointer tracking, viewport bounds, and leader endpoints. A clamped card need
  not travel by the pointer's exact delta. Do not pin cosmetic offsets, stroke
  widths, or bracket-border pixel defaults in interaction tests.
- Unit coverage gates deterministic geometry, validation, construction edits,
  replica edits and `assembly.ts` timing. Browser-only scene, factory drawer,
  cache, assembly rendering and scheduling run in Playwright rather than
  mocked DOM lifecycle tests; `transformer-model.ts` contains only types.
  `vite.config.ts` lists exclusions; coverage thresholds remain unchanged.
- Gate timing is owned by `AGENTS.md`: targeted unit tests in the inner loop,
  fast unit gate before scope expands, browser and `verify` at milestones.

## Done checklist

- [ ] The changed value has one owner and one source of truth.
- [ ] The contract is stated where the next editor reads it, and a test or
      browser assertion pins the changed boundary.
- [ ] The narrowest proof row is green and the changed surface was observed.
- [ ] Reduced motion, light/dark, and the replica boundaries were checked when
      the change touches them.
- [ ] Accessibility names/focus and the bundle budget were checked for UI or
      artwork changes.
- [ ] The staged diff matches a Conventional Commit message per `AGENTS.md`.
