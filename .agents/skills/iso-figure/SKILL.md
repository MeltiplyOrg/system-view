---
name: iso-figure
description: 'Create or refine detailed isometric SVG models: hardware cabinets, system components, product illustrations, and interactive desk objects. Use for polished technical figures, matching an existing app’s model style, or layer-by-layer build animations.'
---

# Isometric models and figures

Build an engineered object, not a labelled box. Its silhouette, construction, materials, and functional details should explain what it is before the caption or accent does. Match the current project's rendering language when one exists.

**Detailed hardware, cabinet/provider variants, or assembly motion:** read [MODEL-CRAFT.md](MODEL-CRAFT.md) before designing the parts. It covers silhouette families, enclosed layered construction, detail placement, and bounded build animations.

## Delivery modes

- **Existing application:** extend its renderer, projection helpers, palette, model metadata, and static/live layer conventions. Read one representative model and its caller first. Keep camera fit, footprint, selection, and cached artwork consistent with the new geometry.
- **Standalone model:** produce self-contained HTML/SVG with embedded styles and script only when needed. A static illustration is a valid result; interaction is not a prerequisite.
- **Interactive figure:** choose a meaningful output before drawing controls: a powered display, typed text, arithmetic, sound, or a changed operating state. Give the user actual controls rather than making decorative surfaces clickable.

A standalone presentation may use a `Fig N` caption, object name, short instruction, and live readout. An application model belongs in the application's existing surface; it does not need another decorative card or frame.

## Procedure

1. **Read the reference.** Identify the object's defining proportions, two recognizable construction features, intended viewing size, and delivery mode. In a repository, locate the canonical projection, box/face helpers, and palette. **Done:** the geometry owner and reference features are named; the output mode matches the request.
2. **Block the silhouette.** Define the plinth, main volumes, modules, and cap in model-space dimensions. Use a small named parts table with `(x, y, z, width, depth, height)` and paint pass. Render those volumes before adding fine detail. **Done:** the object reads at overview size with labels and accents disabled; variants differ in form, not just color.
3. **Construct on planes.** Reuse the project's kernel, or the standalone kernel below. Place details in ordinary face-local coordinates. Model protruding handles, rails, fins, and chips as raised geometry when their depth matters. **Done:** every visible feature shares the same projection and attached parts meet their mounting surfaces.
4. **Give details a job.** Add primary panels and windows, secondary bays/vents/ports, then sparse screws, traces, and labels. Align repeated features to shared dimensions and leave quiet margins around them. **Done:** each detail has a plausible mechanical/electrical purpose, and small details do not overwhelm the silhouette.
5. **Resolve depth and materials.** Paint rear structure, internals, glazing/front frame, raised assemblies, roof/fascia, then live labels and indicators. Use opaque chassis faces and localized glazing; preserve the existing static/live separation. **Done:** nearer solids occlude correctly, interiors remain visible only through intended openings, and text stays on its face.
6. **Add the requested behavior.** For interactions, share state changes between pointer and keyboard. For assembly, follow the layered recipe in MODEL-CRAFT.md. Keep completed geometry fixed and the final artwork identical to the resting model. **Done:** behavior has observable output; reduced motion preserves that output without decorative movement.
7. **Frame and simplify.** Project all extreme corners, including roof hardware, feet, and cable extents. Fit the actual bounds with breathing room. Check the overview, then a close view; remove detail that becomes noise. **Done:** no clipping or accidental overlaps, readable structural hierarchy, and consistent scale with neighboring models.
8. **Verify the surface.** Open the real result in a browser. Inspect light/dark themes and narrow/wide layouts. Exercise every promised control and inspect an intermediate assembly frame when motion is present. **Done:** expected output is observed, depth and bounds are visually checked, no console errors, and repeated/cancelled motion leaves the final model intact.

## Standalone projection kernel

Reuse an existing kernel instead of introducing this alongside it. For a new file, keep projection linear; put camera translation in the parent group or `viewBox`.

```js
const C = Math.cos(Math.PI / 6), S = Math.sin(Math.PI / 6);
const P = (x, y, z) => [(x - y) * C, (x + y) * S - z];
// A local 2D face uses model-space origin O and unit axes U, V.
const plane = (O, U, V) => {
  const o = P(...O), u = P(...U), v = P(...V);
  return `matrix(${u[0]} ${u[1]} ${v[0]} ${v[1]} ${o[0]} ${o[1]})`;
};
const TOP = (x, y, z) => plane([x, y, z], [1, 0, 0], [0, 1, 0]);
const FRONT = (x, y, z) => plane([x, y, z], [1, 0, 0], [0, 0, -1]);
const SIDE = (x, y, z) => plane([x, y, z], [0, -1, 0], [0, 0, -1]);
const rect = (t, w, h, r = 0, cls = 'face') =>
  `<g transform="${t}"><rect class="${cls}" width="${w}" height="${h}" rx="${r}"/></g>`;
const box = (x, y, z, w, d, h, r = 0) =>
  rect(SIDE(x + w, y + d, z + h), d, h, Math.min(r, h / 4), 'face side') +
  rect(FRONT(x, y + d, z + h), w, h, Math.min(r, h / 4)) +
  rect(TOP(x, y, z + h), w, d, r, 'face top');
```

Axes: `+x` runs down-right, `+y` down-left, `+z` up. The visible front is `y = max`; the visible narrow side is `x = max`. FRONT and SIDE origins are their top corners. Draw text, slits, ports, and curves inside transformed groups; derive polygon vertices from model-space points rather than hand-skewing them.

```js
svg += `<g transform="${FRONT(0, 96, 180)}">
  <rect class="face recess" x="8" y="12" width="144" height="124" rx="3"/>
  <path class="detail" d="M16 146H136"/>
  <text class="label" x="16" y="155">SERVICE / SYNC</text>
</g>`;
```

## Visual language

Use the project's palette when integrating. Otherwise define light and dark CSS tokens for body, narrow side, top deck, recess, glazing, structural line, detail line, text, and one restrained accent. Tonal separation supplies volume; the accent identifies state or a product's signature feature. Keep broad surfaces quiet and detail concentrated in functional zones.

```css
.face { fill: var(--body); stroke: var(--line); stroke-width: .85; }
.face.top { fill: var(--deck); }
.face.side { fill: var(--side); }
.face.recess { fill: var(--recess); }
.detail { fill: none; stroke: var(--detail); stroke-width: .55; }
.face, .detail { vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.label { fill: var(--muted); font-family: ui-monospace, monospace; }
.led { fill: var(--accent); }
.press { cursor: pointer; transition: transform 60ms ease-out; }
.press.down { transform: translateY(3px); }
@media (prefers-reduced-motion: reduce) {
  .press { transition: none; }
  .press.down { transform: none; }
}
```

Keep stroke widths stable under face transforms. Use an outer structural outline, lighter internal detail, small consistent corner radii, recessed panels, and stepped seams. Render glazing locally over internals, rather than lowering opacity on the whole model. Avoid blur/filter stacks or shadows as a substitute for geometry.

When a real product is requested, reuse its exact trusted mark from the project or an authoritative self-contained asset. Its physical design still carries the identity; the badge confirms it. Use an invented mark for an unbranded object. User-supplied names go through `textContent`, not SVG markup interpolation.

## Interaction and runtime

- Use native HTML buttons where appropriate. For SVG controls, give each operable part a named, focusable button/toggle and support Enter/Space. Pointer and keyboard call the same state function. Expose state through a display/readout and applicable ARIA state.
- Keep a moving control and its label inside one semantic part group. Animate a local wrapper, preserving the face and world-placement transforms beneath it.
- For held controls, use pointer capture, release on `pointerup`, `pointercancel`, and window blur, and ignore repeated keydown. Only suppress browser gestures over the interactive area.
- Create audio after a user gesture; share one audio graph and suspend its drawing loop when inactive. Clip display content to its screen face.
- A static SVG uses `role="img"` and a useful accessible name. An interactive SVG uses group semantics with exposed controls; do not hide interactive descendants behind an image role.
- Idle models do not need a frame loop. Keep animated actors bounded; pause offscreen/background activity, honor reduced motion, and clean up interrupted work. Reuse an application's existing cache for complex replicated artwork instead of expanding detailed vector trees during transitions.
