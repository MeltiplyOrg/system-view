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
| Individual requests and service capacity          | `src/traffic.ts`, `src/design.ts`                          | `tests/traffic.test.ts`, Users/source and capacity inspectors                    |
| Ground-frame capacity meters                      | `src/node-status.ts`                                       | `src/scene.ts`, `src/style.css`                                                  |
| Traffic controls and visibility-aware clock       | `src/traffic-controls.ts`                                  | `src/main.ts` applied-document synchronization                                   |
| Wire context menus and inline insertion           | `src/world-builder.ts`, `src/construction.ts`              | applied document commits, shared component catalogue                             |

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
- `user`/`users` selects the Users crowd renderer. Users is an explicit source,
  wires only to frontend clients, accepts no incoming wire and has no replica
  stepper or capacity bar. Its static artwork uses the normal shared raster cache.
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

- `WorldBuilder` owns the component-only bottom drawer and side category list.
  **Components** opens only catalogue cards, never action tools or editors.
  The catalogue derives provider skins from the existing registry. Small
  catalogue glyphs are not copies of detailed models. Wiring, deletion, group
  management and New world are contextual world actions, not drawer controls.
- Drag a card to clear ground, or tap/click a card then tap/click the world.
  Keyboard activation seeds a preview; arrows move it and Enter places it.
  Escape, capture cancellation, blur, and backgrounding remove the preview.
  Dropping onto another UI surface adds nothing. Right-click empty ground →
  **New world…** confirms before clearing a populated document.
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
- Right-click a node to start directed source → destination wiring, by drag,
  two clicks, or the separate endpoint editor. Empty ground → **Connect nodes…**
  offers native source/target controls without a pointer-only node gesture.
  `component-rules.ts` owns compatible types and output ports;
  imports and construction use those same rules. Invalid destinations are
  disabled in the form and their world footprints are dimmed. Queue outputs
  deliver to workers; a browser cannot wire directly to a database.
- Load balancers accept browser, CDN or compute ingress and route to compute
  backends, not directly to databases, caches, queues or buckets. Workflow
  controls remain valid explicit routing points. Components → **Load balancer**
  adds a stepped crossbar appliance using the shared geometry and raster cache.
- Branches require an explicit `true`/`false` outlet. Other nodes use `out`
  (omitted by default). Construction rejects duplicate source/destination/port
  triples. Distinct ports may reach the same target; parallel imported links
  to the same target need explicit IDs. `relation` is annotation, not code.
  The rubber band is lightweight and orthogonal; committed wires use the
  existing obstacle-aware router and frame ports.
- Contextual deletion removes the clicked node or selected members and incident
  connections, updating affected organizational groups and replica pools.
  Unrelated nodes, groups and placements are unchanged.
- The scene owns one construction overlay. Its real-model ghost reuses the
  ordinary raster cache, removes decorative activity, and moves only a parent
  transform. Wire preview uses one path. Pointer updates coalesce into one
  animation frame; there is no idle loop, separate encoder or raised cache
  budget. Empty worlds start at a useful multi-machine construction scale.
- The contextual wire/group editor is a separate, non-modal side panel, never
  catalogue content. Entering an action collapses the component drawer; opening
  Components cancels the action and its preview. Close/Escape returns to the
  world. Native fields retain normal input behavior; hidden controls leave the
  tab order. Opening Design cancels both surfaces without moving the camera.

### Organizational node groups

- `groups?: [{id, label, instances}]` is independent of replica `clusters`.
  It organizes nodes without altering placement, ports, connections, provider
  choices or scaling semantics. Each node belongs to at most one organization
  group; replica pools stay wholly inside one group or remain ungrouped.
- Right-click empty ground → **Select nodes to group…** opens group management
  in the contextual editor. Click nodes, Shift-click, drag a marquee, or use the
  native member checkboxes. Ctrl/Cmd+G also opens grouping. Creation needs at
  least two selected nodes; existing groups may retain one member. Empty
  containers disappear after their last node is removed.
- The group picker manages names and membership. Saving transfers selected
  nodes out of previous groups, never nests containers. Ungroup removes only
  the container. Scaling a grouped pool updates organizational membership;
  deleting nodes prunes it. All mutations preserve unrelated nodes and wires.
- Group regions wrap member ground footprints, not projected artwork bounds.
  Both the boundary and compact drag plate use the shared `z=0` isometric
  plane. A near-edge apron keeps the plate clear of model raster hit boxes;
  camera fit includes the whole region. Regions are neither cable obstacles
  nor connection endpoints. The plate drags the whole group; a click opens
  management and focused arrow keys move it. Individual nodes and replica
  handles remain independently editable inside the region.
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

- This is an educational system-design sandbox, not an integration platform.
  Provider skins never connect to external apps. No real uploads, transcoding,
  databases or cloud APIs run. `TrafficModel` models individual request journeys
  and service saturation. A rendered circle is one request branch with a stable
  request ID, not a rate sample, repeated dash or colored copy of a wire.
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
- Capacity-limited machines expose a requests/s budget in the inspector.
  `capacityRps` is optional, persisted through import/export and inherited by
  replicas. The parser accepts finite budgets from 1 to 1,000,000 and rejects
  budgets on Users, clients, If/Else and Merge. Omission uses illustrative type
  defaults, never a vendor performance claim. `latencyMs` now controls service
  processing time; typed connection and replica restrictions are unchanged.

### Traffic capacity and ground status

- The boot walkthrough is Users → Frontend → Backend → Database. Only Users
  emit requests; neither clients nor zero-indegree services implicitly generate
  traffic. Other structural examples remain idle until a Users source is wired.
- Select Users to edit persisted `trafficRps` in its detail HUD. Each source is
  independent: finite 0–20 requests/s, default 1; zero disables that source.
  The small cap makes every request visible without weighted/sampled markers.
- All engine timing is simulated seconds and runs at real time; there is no
  playback multiplier. Run advances the wall clock, Step advances exactly 10ms,
  and Reset clears requests/counters. Initial Run skips the empty interval before
  the first real source emission, not processing work. The sole RAF samples at
  most 30Hz, stops while paused/hidden/crashed, and never catches up a stalled
  page. Source/graph edits reset obsolete work.
- Each node-to-node hop takes a fixed 10 simulated milliseconds, not an
  animation-derived duration. Request arrivals wait FIFO for target capacity
  tokens, then process for `latencyMs` (default 100ms). Queue waiting adds to
  end-to-end latency; saturation alone never rejects a request. Only the queue
  head wakes for the next token, so arrivals cannot jump the line. Responses
  bypass capacity and do not trigger downstream calls again. Simulated one-second
  arrival/admission windows drive meters and directional wire counts.
- Interactive connections have two neutral lanes: solid request dots travel
  downstream, hollow response rings travel upstream with the same request ID.
  A node waits for every synchronous dependency response before replying on its
  incoming connection. TTL/admission-limit errors unwind as red response rings,
  never successful deliveries. Root success counts only upon response arrival.
- Queue-incident edges and database→database/cache→cache replication are one-way.
  These handoffs detach at dispatch, never hold their caller open and have no
  return lane. Their completed deliveries also count in the HUD; fan-out can
  therefore produce more deliveries than generated root requests.
- Users, balancers and If/Else choose one output round-robin; other dependencies
  fan out separate branches retaining the request ID. Caches first decide whether
  a request hits locally; misses alone fan out to downstream dependencies.
  Predicates, merge synchronization and durable broker/backlog storage are not executed.
- Cache nodes persist `cacheHitPercent` (finite 0–100, fractional allowed;
  omission defaults to 90). Only caches expose this field in the detail HUD,
  with the same parser-backed save/reset and replica inheritance as capacity.
  Each cache accumulates miss credit deterministically: 90% means the first nine
  requests hit and the tenth misses; 0% always misses, 100% always hits. This is
  coverage, not a cache-size/key/eviction model. Hits consume normal cache
  processing/capacity and return on the incoming response lane without contacting
  the origin. Misses await downstream responses; a miss without any downstream
  dependency returns an error, never fake success. Each root still has one SLO
  outcome. Counters reset with simulation.
- A 32-hop TTL rejects cycles and unwinds waiting callers. At most 512 travelling,
  queued, processing or waiting calls are retained; excess admissions increment
  the limit-drop counter and fail the parent. Rendering pools circles by call
  identity and interpolates precomputed lane arc lengths without geometry reads.
- Every eligible standalone frame gets one bar lying along its front
  (y=max) grid-border side. Both endpoints are projected on the ground plane, so the
  bar follows the border's isometric angle rather than screen-horizontal space.
  Replica frames show the worst member's admitted-rate/capacity ratio, never an
  average that could hide saturation. Load is clamped to 0–100%; pending FIFO
  work keeps it at 100%. Users, clients and routing fittings have no bars.
  Green means headroom; red means saturation. Accessible text includes admitted
  and incoming rates, capacity and queued count. The HUD also totals node queues.
- `NodeStatusLayer` stays outside the artwork raster cache. It uses expanded
  frame bounds from the scene margin helper; world moves rebuild positions,
  while request frames update circles and sample ground status every 20 simulated
  milliseconds, bounded by the 30Hz frame clock. A crash forces the final sample.
  Camera movement never restarts simulated time. Applied document edits reset
  requests while preserving Run/Pause; source rates live in the document.
- Root-call p95/p99 use nearest-rank percentiles over outcomes completed in the
  last 30 simulated seconds, including wire travel, processing and FIFO waiting.
  Pending calls are excluded; no samples is unknown (`—`), not zero latency or
  zero errors. Metrics recompute only when an outcome arrives or expires.
- Error rate is failed root outcomes / all completed root outcomes, not failures
  per dependency branch or failures / generated traffic. Unwired sources,
  admission-limit drops and TTL failures are real simulated errors; no random
  errors or invented weighted samples are added. Detached async deliveries do
  not bias caller-response SLOs, although they still count as deliveries.
- Crash limits are editable session settings in simulated milliseconds: defaults
  p95 1000ms, p99 2000ms, errors 5%. The boot round trip is 360ms simulated
  (six 10ms hops plus three 100ms processing delays). A measured value strictly
  above any limit latches a crash with its causes and simulated time; Run and
  Step disable, the RAF stops, and queued/travelling calls freeze. There is no
  automatic recovery when old samples expire. Reset/graph edits start a fresh
  simulation; applying limits explicitly resets it. Limits survive these resets
  but are not exported as graph data. Reload restores the default limits.
- Each request is one circle at its actual simulated progress. During
  queued/processing phases it rests at the arrival socket; logical callers
  waiting on dependencies do not create duplicate dots. Dots paint above static
  cables and ground meters but below machine roots, so objects occlude them.
  Markers stay 10 CSS pixels across through overview zoom and resize, using the
  cached viewport scale rather than per-frame geometry reads. On mobile during
  placement, supplementary HUD rows collapse to keep build ground reachable.

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
- ISO-GLOW presentation in `style.css` keeps chassis, drawer handles, ports,
  cooling hardware and platforms neutral. World nodes, rack roots and links
  resolve `--cable-color` to the shared theme accent, overriding provider and
  document paint without changing exported colors or provider identities.
- LEDs, powered screen panels and travelling packet dashes carry the accent;
  neutral wires preserve routing legibility. Wide translucent cable strokes
  supply dark-theme signal glow without blur filters or additional renderers.
  Light theme sets `--glow-opacity` to zero while retaining flat lit accents.
- Static display and indicator paint goes through the existing raster cache;
  activity and labels remain live. Do not add per-node clocks, extra canvases,
  or glow filters. Fans are hardware, not light sources. Existing provider
  marks remain on neutral enamel plates; the world includes the ISO-GLOW link.

### Wires

- External links attach to a frame side chosen by the ray from the endpoint
  member to the far endpoint. One cable uses the side midpoint.
- Several cables on one side divide it into equal segments and attach at each
  segment's midpoint. Ordering by the far endpoint's coordinate along that side
  keeps the fan centered and reduces crossings.
- Ports leave and enter on a fixed outward stub. The router avoids frame
  rectangles, and the final leg meets the border perpendicular. Internal
  same-cluster links stay rack-to-rack and have no border port.
- External wires keep a neutral jacket/core and endpoint sockets. Only separate
  `.request-marker` circles carry the traffic accent; no animated wire paths,
  dash patterns, broad glow or active-wire recoloring remain. More emitted
  requests create more markers, not a denser repeating CSS texture. Pause holds
  their exact positions. Reduced-motion users can inspect manually with Step;
  explicit Run animates the functional simulation in either theme.
  Lane offsets taper into unchanged logical sockets with short perpendicular
  leads; shared hit targets and Cut still act on one logical connection.
- Right-click either cable lane for **Cut** or **Add node…** in the existing
  World quick-actions menu; hover no longer displays a detached Cut control.
  Focused wires support Enter/Space, Shift+F10 and ContextMenu. Existing arrows,
  Home/End, Escape, outside-click and camera dismissal rules apply. Add opens a
  catalogue submenu containing only products compatible with both endpoints.
- `disconnectComponents` removes only the exact document-indexed wire, preserving
  parallel links/outlets. WorldBuilder pins real sites before committing;
  cutting never repacks nodes or refits the camera. Export and traffic use the
  resulting graph. The shared HTML menu stays outside SVG pointer capture.
- `insertComponent` atomically rewires A→B to A→new→B. The first edge keeps the
  original ID, source outlet and relation; the second gets a unique ID. If/Else
  inserted inline uses its TRUE outlet. Both edges use canonical compatibility
  rules and respect node/wire limits. A bounded search chooses the nearest free
  snapped site to the endpoint midpoint (within 64 build cells). Occupied ground
  never moves an existing node; failure leaves the document unchanged. Existing
  sites, group/replica membership and camera remain unchanged by insertion.

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
