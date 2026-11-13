# Tool roadmap: Pixel and Vector workspaces

Decided by Jonathan on 2026-11-12: Aether Sketch is the suite's sketchbook, the
first step of the engineering design process before CAD. It is **one app with two
workspaces on one `.aethersketch` file**, the way Affinity Designer has a Designer
and a Pixel persona. Aether Vector merges into it and stops being a separate app.

Reference apps: **Autodesk SketchBook** and **Adobe Fresco** for the Pixel
workspace, **Affinity Designer** for the Vector workspace. We match their tools
and behaviour; we do not copy their artwork, names or file formats.

## Where it stands (alpha-0.1.22)

The workspace selector in the tool bar switches between Pixel and Vector.
`?workspace=vector` opens straight into Vector.

**The workspace decides what you make, whatever layer is current.** Drawing in the
Pixel workspace paints pixels; drawing in the Vector workspace makes paths. If the
current layer is the other kind, a layer of the right kind is added above it (an
empty layer just changes kind). Text is always a vector object. The eraser, fill
and eyedropper follow the current layer's kind.

| | Pixel | Vector |
|---|---|---|
| Works today | Pixel layers; stamped brushes painted live under the pen, with size, opacity, flow, spacing, softness and paper grain; 14 presets including pencils, inks, markers, charcoal, chalk, crayon and airbrushes; smudge; pencil, shapes and pen land as pixels; pixel eraser; flood fill with tolerance; eyedropper; colour wheel and palette; layer opacity and blend modes; ruler, ellipse, symmetry (mirror, flip, quad, radial), 1- and 2-point perspective, steady stroke | Pen (corners and curves, closes on its start), line, pencil, vector brush, rectangle, ellipse, polygon, star, text, select, node editing, lasso select, trim, Booleans, gradients, draw inside, align, distribute, order, flip, rotate, groups, snapping |
| Known gap | No pen tilt, no wet or mixing brushes (Fresco's live brushes), and the eraser is hard-edged. Pixels cannot be selected, moved or transformed. | No corner tool, shape library, stroke options (dashes, caps, width profile), text on a path, layer effects, symbols or multiple artboards. |

Pixel layer limits in this release:

- One bitmap per layer, up to 4096 × 4096 px, one document pixel per bitmap pixel.
  Painting further away asks for another pixel layer.
- The bitmap is a PNG inside the `.aethersketch` file. The Studio server stores
  drawings up to 16 MB; the app warns from 12 MB.
- SVG, PNG, JPEG, WebP and OpenRaster exports include pixel layers. PDF export is
  still vector only and says so.
- Pixel layers do not merge down yet. Gradient fills land as their first colour.
- A stroke in progress, and the layer being smudged, show above every layer until
  the pen lifts; then they take their place in the layer order.
- Tested in Chrome with a mouse. Safari, iPad and pen pressure are not tested yet.

Lines and pen paths join at free ends and close on their own start (alpha-0.1.18).

## Build order

1. **Pixel layers.** Done in alpha-0.1.21: a layer is either vector or pixel, with
   paint, erase, flood fill and eyedropper on pixels.
2. **Pixel brush engine.** Done in alpha-0.1.22: stamped brushes with pressure,
   flow, spacing and paper grain, painted live under the pen, and smudge. Still to
   do here: pen tilt, a soft eraser, and moving the bitmap to tiles to lift the
   4096 px limit. (SketchBook brush library, Fresco pixel brushes.)
3. **Pixel selections.** Rectangle, ellipse, lasso, polyline and magic wand;
   move, transform and distort the selection; paint only inside it.
4. **Vector stroke and shape depth.** Stroke options (dashes, caps, joins,
   pressure width profile), corner tool, a parametric shape library, knife and
   shape builder, text on a path. (Affinity Designer.)
5. **Layer depth.** Masks, clipping layers, layer effects (shadow, glow, blur),
   adjustment layers.
6. **Guides.** French curve, 3-point and fisheye perspective, predictive stroke,
   canvas rotation, isometric grids.
7. **Document.** Multiple artboards, symbols, PSD import and export.
8. **Motion.** Flipbook frames and time-lapse recording. Last, because nothing
   else depends on it.

Each step ships as its own alpha release, live on the Studio host, with a test
and a walk of the changed flow.

## Open decisions

- **App name: decided.** The app stays "Aether Sketch" (Jonathan, 2026-11-13). "Sketchbook"
  is the name of the drawing app formerly published by Autodesk, so we describe Aether
  Sketch as the suite's sketchbook without taking the name.
- **Retiring the Aether Vector tile.** The launcher still lists Aether Vector as
  "Coming soon". Removing it is a Studio host change.
