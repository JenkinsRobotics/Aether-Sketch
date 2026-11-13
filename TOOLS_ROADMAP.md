# Tool roadmap: Pixel and Vector workspaces

Decided by Jonathan on 2026-11-12: Aether Sketch is the suite's sketchbook, the
first step of the engineering design process before CAD. It is **one app with two
workspaces on one `.aethersketch` file**, the way Affinity Designer has a Designer
and a Pixel persona. Aether Vector merges into it and stops being a separate app.

Reference apps: **Autodesk SketchBook** and **Adobe Fresco** for the Pixel
workspace, **Affinity Designer** for the Vector workspace. We match their tools
and behaviour; we do not copy their artwork, names or file formats.

## Where it stands (alpha-0.1.20)

The workspace selector in the tool bar switches between Pixel and Vector.
`?workspace=vector` opens straight into Vector.

| | Pixel | Vector |
|---|---|---|
| Works today | Brush library and properties, pencil, eraser, fill a shape, lasso fill, eyedropper, colour wheel and palette, layers with opacity and blend modes, ruler, ellipse, symmetry (mirror, flip, quad, radial), 1- and 2-point perspective, steady stroke | Pen (corners and curves, closes on its start), line, pencil, rectangle, ellipse, polygon, star, text, select, node editing, lasso select, trim, Booleans, gradients, draw inside, align, distribute, order, flip, rotate, groups, snapping |
| Known gap | **Strokes are still vector shapes, not pixels.** There are no raster layers yet, so no smudge, no flood fill of a painted region, no pixel eraser. | No corner tool, shape library, stroke options (dashes, caps, width profile), text on a path, layer effects, symbols or multiple artboards. |

Lines and pen paths join at free ends and close on their own start (alpha-0.1.18).

## Build order

1. **Pixel layers.** A layer is either vector or pixel. Pixel layers are tiled
   bitmaps so the canvas stays unbounded; they save as PNG tiles inside the
   document and export to OpenRaster and PNG. This is the piece that makes the
   Pixel workspace real, so it comes first.
2. **Pixel brush engine.** Stamped brushes with pressure, tilt, flow, spacing,
   texture and blend; pixel eraser; smudge; flood fill with tolerance; eyedropper
   that samples pixels. (SketchBook brush library, Fresco pixel brushes.)
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

- **App name.** Jonathan proposed renaming the app "Sketchbook". "Sketchbook" is
  the name of the drawing app formerly published by Autodesk, so the public name
  needs his decision before branding, the launcher and the site change.
- **Retiring the Aether Vector tile.** The launcher still lists Aether Vector as
  "Coming soon". Removing it is a Studio host change, best made in the same
  release as the name change.
