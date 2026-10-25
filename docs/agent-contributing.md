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

| Surface                                           | Owner                     | Collaborators                                                          |
| ------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| Document shape, validation, examples              | `src/design.ts`           | `src/main.ts` editor; `src/layout.ts` inputs                           |
| Placement, color, cluster bounds                  | `src/layout.ts`           | `src/platform.ts`, `src/scene.ts`, `src/routing.ts`                    |
| Provider catalog, accent, footprint, mark         | `src/providers.ts`        | `src/components.ts`, `src/database.ts`, `src/style.css`, `src/main.ts` |
| Renderer artwork, height, label placement, motion | `src/components.ts`       | `src/style.css`, `src/component-raster.ts`                             |
| Database rack geometry and shared `<defs>`        | `src/database.ts`         | `src/components.ts` wrapper                                            |
| Platform union and rendering                      | `src/platform.ts`         | `src/layout.ts` footprints                                             |
| Canvas render pass, camera, selection, morph      | `src/scene.ts`            | `src/components.ts`, `src/component-raster.ts`, `src/main.ts` overlays |
| Raster cache and shared images                    | `src/component-raster.ts` | `src/scene.ts`, `src/style.css` palettes                               |
| Shell, editor, callout, detail, theme             | `src/main.ts`             | `index.html`, `src/style.css`                                          |
| Replica document mutation                         | `src/replicas.ts`         | `src/layout.ts`, `src/main.ts` stepper                                 |
| Orthogonal cable routing                          | `src/routing.ts`          | `src/scene.ts` obstacles and ports                                     |

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
  are provider-aware through the variant and theme.
- Provider artwork has three layers: static `.component-static-base`, live
  `.component-motion`, then `.component-label`. Labels use `textContent` so
  imported strings cannot inject markup; only trusted constants use
  `innerHTML`.
- Use the exact upstream brand mark from the provider theme, and place one mark
  on the object. The Redis cache reuses `REDIS_LOGO_ART`; database racks print
  the theme mark on the roof plate.
- Database provider skins share the rack chassis: the accent tints faces,
  drawers, glass, LEDs, and cables. `ProviderTheme.plate` chooses a light or
  dark badge background so the mark stays legible.

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
- A skin mid-morph carries `data-skin-morph` and is skipped until the scene
  calls `sync` again. Keep that marker on the geometry root and let the scene
  own its lifetime.
- `data-raster-ready` marks a component with images installed. Existing roots
  survive replica edits; removing and re-adding a replica reuses shared pixels.

### Provider transitions

- Transitions are derived from the rendered DOM: top-level paint groups are
  wrapped and moved. The generic morph is the only transition path, so a new
  skin participates as soon as it renders through `createComponent`.
- Animation uses `transform` and `opacity` only. Detailed part motion is for
  small swaps; above three simultaneous skins the scene cross-fades whole
  objects and mounts live detail after the rebuild.
- Borders animate through the affine matrix of their old and new projected
  rectangles. The path is the hit target, so pointer geometry follows the
  drawn line.
- The merged platform cross-fades as a reused underlay plus the incoming
  group. It stays non-interactive.
- `prefers-reduced-motion` swaps the DOM without animation and stops provider
  detail layers.

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
2. Add artwork: a `PROVIDER_VARIANTS` entry for generic renderers, or the
   renderer's own skin. Database racks print `logo` on the roof plate; set
   `plate` when the mark is white or bright.
3. Add skin classes to `style.css`. Put animated fills and strokes outside the
   static base. Add the reduced-motion rule.
4. The generic morph handles transitions; a new skin participates
   automatically.
5. Prove color and footprint through `layoutDesign` and supported-type gating
   through `providersFor`; add that focused provider test. Then switch provider
   on a cache or database node in the browser: exactly one artwork mark
   (inspect before the raster cache replaces vectors), the build, border,
   platform, and cleanup.
6. Check `bun run size`; provider art ships in the JS bundle.

## Proof matrix

| Surface                                  | Fast proof                                                | Browser proof                                                 |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Validation, limits, references           | `tests/design.test.ts`                                    | apply/import/export in `e2e/app.spec.ts`                      |
| Placement, pitch, cluster bounds, colors | `tests/layout.test.ts`                                    | replica and provider paths in `e2e/app.spec.ts`               |
| Provider catalogue, gates, object marks  | `tests/providers.test.ts`, `tests/database.test.ts`       | `e2e/database-providers.spec.ts`                              |
| Platform topology and markup             | `tests/platform.test.ts`, `tests/platform-render.test.ts` | boot scene render in `e2e/app.spec.ts`                        |
| Cable routing and cluster ports          | `tests/routing.test.ts`, `tests/scene-port.test.ts`       | `e2e/wires.spec.ts`; link and zoom tests in `e2e/app.spec.ts` |
| Rack geometry and projection             | `tests/database.test.ts`                                  | boot scene and theme switch in `e2e/app.spec.ts`              |
| Replica mutation                         | `tests/replicas.test.ts`                                  | replica stepper and ten-replica layout                        |
| Shell, editor, theme, a11y               | —                                                         | `e2e/app.spec.ts`                                             |
| Canvas, raster, selection, morph         | pure helpers only                                         | `e2e/app.spec.ts`, `e2e/component-cache.spec.ts`              |

Gates: `bun run check` (format, lint, types), `bun run build`, `bun run size`.

Notes:

- Browser tests run against `dist`. Build before a targeted Playwright run;
  otherwise the browser proves the previous bundle.
- E2E defaults to reduced motion. A transition test opts out with
  `test.use({ reducedMotion: "no-preference" })`.
- Unit coverage includes every `src` module except `main.ts` and `scene.ts`.
  Check `vite.config.ts` before assuming a module is exempt.
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
