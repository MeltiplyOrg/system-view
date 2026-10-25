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

| Surface                                           | Owner                            | Collaborators                                                          |
| ------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| Document shape, validation, examples              | `src/design.ts`                  | `src/main.ts` editor; `src/layout.ts` inputs                           |
| Placement, color, cluster bounds                  | `src/layout.ts`                  | `src/platform.ts`, `src/scene.ts`, `src/routing.ts`                    |
| Provider catalog, accent, footprint, mark         | `src/providers.ts`               | `src/components.ts`, `src/database.ts`, `src/style.css`, `src/main.ts` |
| Renderer artwork, height, label placement, motion | `src/components.ts`              | `src/style.css`, `src/component-raster.ts`                             |
| Database rack geometry and shared `<defs>`        | `src/database.ts`                | `src/components.ts` wrapper                                            |
| Provider database cabinets                        | `src/database-skins.ts`          | `src/database.ts`, `src/providers.ts`, `src/style.css`                 |
| Platform union and rendering                      | `src/platform.ts`                | `src/layout.ts` footprints                                             |
| Canvas render pass, camera, selection             | `src/scene.ts`                   | `src/components.ts`, `src/component-raster.ts`, `src/main.ts` overlays |
| Raster cache and shared images                    | `src/component-raster.ts`        | `src/scene.ts`, `src/style.css` palettes                               |
| Mechanical provider changes                       | `src/transformer-transitions.ts` | `src/transformer.ts` rig; renderer envelope metadata; raster leases    |
| Layer partition and assembly timing               | `src/assembly.ts`                | `src/transformer.ts`; pure ordering/travel regression tests            |
| Shell, editor, callout, detail, theme             | `src/main.ts`                    | `index.html`, `src/style.css`                                          |
| Replica document mutation                         | `src/replicas.ts`                | `src/layout.ts`, `src/main.ts` stepper                                 |
| Orthogonal cable routing                          | `src/routing.ts`                 | `src/scene.ts` obstacles and ports                                     |

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
  clusters. Presentation intent lives here; positions, colors, footprints, and
  measured pixels are derived at render time.
- IDs select the renderer by leading word: `db`/`database`/`rack` → database,
  `compute`/`server`/`api` → compute, `web`/`webpage`/`frontend` → webpage,
  `cache` → cache, unknown → database fallback.
- `layoutDesign` is deterministic from the document alone. Replica pitch is
  the cluster's largest footprint plus a fixed air gap; group packing uses real
  content edges. A provider footprint change moves platforms, borders, ports,
  and camera fit together.
- `resizeReplicas` is the mutation boundary for replica membership: 1–10
  members, the first member stays the stable endpoint, and links on removed
  replicas move to it. Layout reads the document and returns placed instances.
- `parseDesign` owns limits and reference checks. Add a field there before
  teaching the renderer or editor about it.

### Geometry and artwork

- Isometric projection is `project` in `src/database.ts`. Face-local planes,
  boxes, and fans are shared helpers in `src/components.ts`; world units are
  the drawing unit.
- Faces are opaque and painter order is the only depth sort. A new part must
  paint back-to-front around the existing box and detail groups.
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
- The provider accent tints faces, glass, LEDs, and cables.
  `ProviderTheme.plate` chooses a dark enamel tone for the single mark; the
  badge never uses a white backing.

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
- Theme is `data-theme` on `<html>`; absence follows the OS. Keep accessible
  names, focus movement, `inert`, and the `aria-live` message intact.

## Change paths

| Goal                             | Edit in this order                                                                                                                                         | Close with                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Add a provider skin              | `providers.ts` theme → `components.ts` variant (generic) or `database.ts` badge (racks) → `style.css` skin → provider gating test                          | provider catalogue and footprint proof; provider e2e |
| Add a renderer type              | `design.ts` type → `layout.ts` prefix/color/footprint → `components.ts` geometry/height/label → `component-raster.ts` renderer list → scene/callout labels | unit tests per pure owner; boot scene e2e            |
| Tune replica spacing or groups   | `layout.ts` constants and packing → `tests/layout.test.ts` → verify border ports, platform union, routing                                                  | layout, platform, routing, replica e2e               |
| Reshape artwork                  | `components.ts` variant → `style.css` palette/animation → reduced-motion block                                                                             | app/cache e2e; visual smoke at overview and close-up |
| Change shell, editor, inspector  | `main.ts` → `index.html` → `style.css`                                                                                                                     | `e2e/app.spec.ts`, including a11y                    |
| Change camera, selection, cables | `scene.ts`; extract pure math for unit proof where possible                                                                                                | `tests/scene-*.test.ts`, `e2e/app.spec.ts`           |

### Provider skin checklist

1. Register the theme in `PROVIDERS`: canonical id, label, accent, supported
   types, optional footprints, exact self-contained logo.
2. Add artwork: a `PROVIDER_VARIANTS` entry for generic renderers, or a
   dedicated cabinet builder plus `db-<id>-rear/front` definitions in
   `src/database-skins.ts`. Each database skin owns its height and one `logo`
   badge; set a dark `plate` tone so the mark stays legible.
3. Add skin classes to `style.css`. Put animated fills and strokes outside the
   static base. Add the reduced-motion rule.
4. Supply the physical cabinet envelope alongside its artwork. The shared
   mechanism consumes these dimensions; never add provider-pair choreography.
5. Prove color and footprint through `layoutDesign` and supported-type gating
   through `providersFor`; add that focused provider test. Then switch provider
   on a cache or database node in the browser: exactly one artwork mark
   (inspect before the raster cache replaces vectors), final border/platform,
   live selection, bounded connected motion, and no leftover rig after settling.
6. Check `bun run size`; provider art ships in the JS bundle.

## Proof matrix

| Surface                                  | Fast proof                                                | Browser proof                                                 |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Validation, limits, references           | `tests/design.test.ts`                                    | apply/import/export in `e2e/app.spec.ts`                      |
| Placement, pitch, cluster bounds, colors | `tests/layout.test.ts`                                    | replica and provider paths in `e2e/app.spec.ts`               |
| Provider catalogue, gates, object marks  | `tests/providers.test.ts`, `tests/database-skins.test.ts` | `e2e/database-providers.spec.ts`                              |
| Platform topology and markup             | `tests/platform.test.ts`, `tests/platform-render.test.ts` | boot scene render in `e2e/app.spec.ts`                        |
| Cable routing and cluster ports          | `tests/routing.test.ts`, `tests/scene-port.test.ts`       | `e2e/wires.spec.ts`; link and zoom tests in `e2e/app.spec.ts` |
| Rack geometry and projection             | `tests/database.test.ts`                                  | boot scene and theme switch in `e2e/app.spec.ts`              |
| Replica mutation                         | `tests/replicas.test.ts`                                  | replica stepper and ten-replica layout                        |
| Shell, editor, theme, a11y               | —                                                         | `e2e/app.spec.ts`                                             |
| Canvas, raster, selection, assembly      | `tests/transformer.test.ts` ordering and travel bounds    | `e2e/app.spec.ts`, `e2e/component-cache.spec.ts`              |

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
- Unit coverage gates deterministic geometry, validation, replica edits and
  `assembly.ts` timing. Browser-only scene, cache, assembly rendering and
  scheduling modules run in Playwright rather than mocked DOM lifecycle tests;
  `transformer-model.ts` contains only types. `vite.config.ts` lists those
  exclusions explicitly. Per-file coverage thresholds remain unchanged.
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
