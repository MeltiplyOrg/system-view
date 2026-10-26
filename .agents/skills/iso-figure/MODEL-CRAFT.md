# Detailed isometric model craft

Use this reference for hardware/product models, distinctive variants, and assembly animation. The main skill owns projection, delivery, interaction, and browser verification.

## Silhouette before decoration

Choose a physical architecture, then detail it. A recognizable family can share projection and materials without sharing one generic chassis.

| Architecture | Primary form | Construction features that carry identity |
| --- | --- | --- |
| Storage/archive cabinet | Tall enclosure on a shallow plinth | Recessed or arched glazing, ordered drive bays, crown fascia, side service spine |
| Memory/cache appliance | Compact deep enclosure or exposed stack | Cartridge sleds or tiered banks, DIMM rails, a concentrated I/O strip, low cooling deck |
| Compute chassis | Wide low body with stepped rails | Pull-out trays, paired cooling units, port groups, latches and rack ears |
| File/shard appliance | Low tray or segmented enclosure | Offset cards, accessible slots, divided blades, a deliberately asymmetric service region |
| Desk instrument | Sloped or stepped body | Reachable controls, recessed display, connector side, distinct input/output areas |

For a requested product, inspect the supplied reference or existing artwork before choosing its architecture. Preserve defining features, not incidental ornament. A different badge or accent alone is not a new model.

## Construction grammar

**Primary volumes:** base, enclosure, major modules, roof. Let the plinth support the body, frame the windows, and give the cap a believable thickness. Use stepped offsets and small gaps to show how parts join. Favor a few well-proportioned assemblies over a stack of equally sized generic boxes.

**Secondary assemblies:** recesses, rails, glazing, sleds, cooling, service panels. Place them in functional zones with common edge margins. Keep one dominant front feature and let the narrow face carry quieter exhaust or service details. Use the roof as a designed third face, not an empty rectangle or an indiscriminate vent grid.

**Tertiary details:** fasteners, pins, separators, gauge bars, silk-screen labels. Derive repeated positions from a shared pitch and the dimensions of their owning panel. A repeated row should end at an intentional panel boundary. Reserve blank space around the primary feature so fine detail has a background to read against.

Keep dimensions relational:

- Named body dimensions own all face-local sizes and mounting offsets.
- A bay's top derives from the previous bay's height and a shared gap.
- A handle projects from its door; a fin rises from its roof; feet meet the plinth.
- A row of screws belongs to a removable panel, not every available corner.
- Record complete height/footprint in the renderer's existing metadata, including protrusions. Those values must agree with framing, neighboring models, and hit targets.

Group by **physical assembly**, not by arbitrary SVG nesting or path count. A body module includes its faces, top deck, fixed detail, and local label. This makes layer-by-layer construction possible without guessing what a generated `<g>` represents.

## Faces, internals, and occlusion

Use the main skill's face transforms for local rectangles, arcs, circles, labels, and vent patterns. Use projected model-space points for true box edges, cable routes, and irregular solids. Both techniques share the same kernel.

For a cutaway cabinet, plan paint passes explicitly:

1. Rear wall, deep recesses, and structural body.
2. Internal modules, boards, spindles, rails, and routed cables.
3. Local glass treatment and its surrounding front frame.
4. Raised handles, bezel edges, service hardware, and roof/fascia that occlude earlier work.
5. Live identity labels, state indicators, and any input hit targets.

Within each pass, paint distant parts before near ones. A global `x + y` sort alone does not handle a roof overlay or glass cutaway. Keep glazing local: it may tint the visible internals, while structural walls and frames stay opaque. Use clipping for a real window aperture; reducing the entire cabinet's opacity makes rear surfaces leak through.

At an exposed section boundary, draw the horizontal top face. A half-built model should read as a solid seated module, not two sliced vertical walls around an empty interior.

## Surface and detail hierarchy

Use **tonal volume**, **structural line**, **fine detail**, then **accent** in that order.

- Give top, front, narrow side, and recesses related but distinguishable values. Keep that hierarchy legible in both themes.
- Outer edges explain the silhouette; lighter internal lines explain construction. Avoid equally strong strokes on every screw and vent.
- Use inset surrounds, a thin lip, or paired seam edges for a bevel. Keep the lip attached to its panel and consistent around adjacent faces.
- Make cooling plausible: concentric fan rings with sparse radial spokes, or a grille with a consistent pitch. Model raised fan housings when they alter the outline.
- Make service regions plausible: grouped port cutouts, smaller connector pins, a latch or reset opening, and short labels tied to the actual ports.
- Keep most indicators subdued. Reserve the accent for a meaningful rail, selected bay, active port, or small status cluster; it should not flood every face.
- Put the main name on a dedicated rail or plate. Keep identity readable at its intended viewing size; microtype is optional close-view detail, not the only clue to what the object is.

When producing a family, compare silhouettes side by side with the accent and logo hidden. Adjust width/depth/height, window shape, roof profile, module rhythm, and service-region placement until the models are distinguishable. Reuse primitives and spacing rules, not one unchanged body.

## Layer-by-layer assembly

Use when the user requests a build, assembly, or provider/model transition. Static models remain static unless motion is requested.

**Sequence:** plinth → lower module → successive body sections → controller/fascia → cap. For a replacement, the source may disassemble top-down first. Start the new base promptly; keep the camera and platform reference stable so the construction is readable.

Each arriving section is a rigid, fully opaque piece. Seat it from a short distance immediately above the completed stack, ease into contact, then start the next. Completed sections keep their exact final transform. Overlap preparation, not a swarm of moving pieces. Close exposed tops, and let the authored roof replace the temporary deck at the end. The final assembled pixels and labels must match the ordinary resting renderer.

Choose compact timing appropriate to the number of sections; avoid dead holds between teardown and construction. A cached model change should respond promptly rather than waiting behind camera refits or background sharpening. Respect reduced motion with an immediate final-state render.

For a standalone model, animate a small number of named assembly wrappers. Keep face-plane transforms below those wrappers, and stop the clock at rest. Do not flatten an entire cabinet into a flipping plane or stretch its picture to simulate construction.

For a detailed replicated application model:

- Reuse the existing static-art cache. Borrow already-decoded surfaces; keep labels and activity outside cached pixels.
- If using artwork slices, follow the model's isometric front/side height contour rather than horizontal screen-space bands. Consolidate completed sections into one surface, plus the next seating section.
- Precompute section geometry and clip paths once. Advance only the bounded actors; avoid per-frame DOM discovery or repeated style/layout measurements.
- Limit concurrent assemblies and queue the remainder with a stationary source preview. Use the application's existing pixel and queue budgets; creating one canvas, bitmap, or full vector clone per part defeats the bound.
- Namespace clips/definitions per model. Cancellation, replacement, removal, palette changes, reduced-motion changes, and backgrounding must restore the final state, stop scheduled work, and release borrowed resources.

Verify the build at its base-only, middle, and capped stages. The base should stay registered, one incoming section should be identifiable, completed sections should stay fixed, and the cap should be the last visible construction step. Then interrupt and repeat it; the final model must remain complete without accumulated actors.

## Visual correction cues

| Observation | Correction |
| --- | --- |
| Identity disappears with the badge hidden | Rework proportions and defining construction features before adding more detail |
| Hardware looks pasted onto a face | Move it into the owning face plane or give its protrusion real depth |
| Glazing hides everything or leaks rear walls | Fix the aperture and paint passes; keep structural faces opaque |
| A partial build looks like an open U-shaped cutout | Close the section with its top deck before seating the next section |
| Overview turns into grey noise | Restore quiet panels and reduce tertiary contrast or repetition |
| Replicas stutter or accumulate parts | Reduce animated actors, reuse shared painted surfaces, and verify disposal |
