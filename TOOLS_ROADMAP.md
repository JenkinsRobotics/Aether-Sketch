# Tool roadmap: Pixel and Vector workspaces

Decided by Jonathan on 2026-11-12: Aether Sketch is the suite's sketchbook, the
first step of the engineering design process before CAD. It is **one app with two
workspaces on one `.aethersketch` file**, the way Affinity Designer has a Designer
and a Pixel persona. Aether Vector merges into it and stops being a separate app.

Reference apps: **Autodesk SketchBook** and **Adobe Fresco** for the Pixel
workspace, **Affinity Designer** for the Vector workspace. We match their tools
and behaviour; we do not copy their artwork, names or file formats.

## Where it stands (alpha-0.1.29)

The workspace selector in the tool bar switches between Pixel and Vector.
`?workspace=vector` opens straight into Vector.

**The workspace decides what you make, whatever layer is current.** Drawing in the
Pixel workspace paints pixels; drawing in the Vector workspace makes paths. If the
current layer is the other kind, a layer of the right kind is added above it (an
empty layer just changes kind). Text is always a vector object. The eraser, fill
and eyedropper follow the current layer's kind.

| | Pixel | Vector |
|---|---|---|
| Works today | Pixel layers; stamped brushes painted live under the pen, with size, opacity, flow, spacing, softness and paper grain; 14 presets including pencils, inks, markers, charcoal, chalk, crayon and airbrushes; smudge; pencil, shapes and pen land as pixels; pixel eraser; flood fill with tolerance; eyedropper; pixel selections (rectangle, ellipse, freehand, polygon, magic wand; add, subtract, intersect, invert) that painting, erasing, filling and smudging stay inside; move, scale, rotate, skew, flip and copy the selected pixels; colour wheel and palette; layer opacity and blend modes; clipping layers, mask layers, a mask from the selection, layer blur, shadow and glow, adjustment layers, merge down; ruler, ellipse and French curve guides, symmetry (mirror, flip, quad, radial), 1-, 2- and 3-point and fisheye perspective, isometric grid, steady stroke, predictive stroke, canvas rotation | Pen (corners and curves, closes on its start), line, pencil, vector brush, rectangle, ellipse, polygon, star, a shape library (13 shapes, each with one option), text in a box and text on a path, select, node editing, corner tool (round or chamfer), lasso select, trim, knife, Booleans and Divide, gradients, stroke caps, joins, named and custom dashes, arrowheads, line width profiles, draw inside, align, distribute, order, flip, rotate, groups, snapping |
| Known gap | No pen tilt, no wet or mixing brushes (Fresco's live brushes), and the eraser is hard-edged. Selections have no feather, no cut, copy and paste between layers, and no four-corner (perspective) distort. | No drag-to-merge shape builder (Divide then Union does the same job in two steps) and no width profile drawn from pen pressure (four preset profiles, open paths only). Rounded corners and library shapes become plain nodes rather than staying live; the knife cuts straight lines only. |

Pixel layer limits in this release:

- One bitmap per layer, up to 4096 × 4096 px, one document pixel per bitmap pixel.
  Painting further away asks for another pixel layer.
- The bitmap is a PNG inside the `.aethersketch` file. The Studio server stores
  drawings up to 16 MB; the app warns from 12 MB.
- SVG, PNG, JPEG, WebP, OpenRaster, PSD and PDF exports include pixel layers.
- Gradient fills land on pixel layers as their first colour.
- Merge down keeps vectors only when both layers are plain vector layers. With a
  pixel layer, a blend mode, a clip, a mask, effects or an adjustment involved, the
  result is one pixel layer (up to 4096 px a side) with all of that applied.
- Clips, masks, effects and adjustments are in SVG, PNG, JPEG, WebP and OpenRaster
  exports (OpenRaster gets them applied to each layer's image; an adjustment layer
  shows only in its merged image; PSD the same). PDF applies clips and masks, and
  carries pixel layers with their effects; it leaves out adjustment layers and
  effects on vector layers, and says so.
- A stroke being painted on a clipped, masked or effect layer shows plain until the
  pen lifts. Shapes hidden by a mask can still be clicked.
- A stroke in progress, and the layer being smudged, show above every layer until
  the pen lifts; then they take their place in the layer order.
- A selection is a mask up to 4096 × 4096 px. It is not saved in the file; undo and
  redo bring back the selection that was active at each step.
- Each move, scale or rotation resamples the selected pixels once, so many small
  transforms in a row soften them. Whole-pixel moves and flips are exact.
- While a selection is dragged it shows above every layer, like a stroke in progress.
- Tested in Chrome with a mouse. Safari, iPad and pen pressure are not tested yet.

Lines and pen paths join at free ends and close on their own start (alpha-0.1.18).

## Build order

1. **Pixel layers.** Done in alpha-0.1.21: a layer is either vector or pixel, with
   paint, erase, flood fill and eyedropper on pixels.
2. **Pixel brush engine.** Done in alpha-0.1.22: stamped brushes with pressure,
   flow, spacing and paper grain, painted live under the pen, and smudge. Still to
   do here: pen tilt, a soft eraser, and moving the bitmap to tiles to lift the
   4096 px limit. (SketchBook brush library, Fresco pixel brushes.)
3. **Pixel selections.** Done in alpha-0.1.23: rectangle, ellipse, freehand,
   polygon and magic wand; add, subtract, intersect, invert; paint, erase, fill and
   smudge only inside; move, scale, rotate, skew, flip, nudge and Alt-drag copy.
   Still to do here: feather, cut, copy and paste, four-corner distort, and keeping
   the pixels floating across several transforms so they resample once.
4. **Vector stroke and shape depth.** Done in alpha-0.1.24 and alpha-0.1.25: custom
   dash and gap, arrowheads, four line width profiles, corner tool, a 13-shape
   library, a straight knife, Divide (every region of overlapping shapes becomes
   its own shape), and text on a path (the Text tool on a path's edge). Left for
   later, none of it blocking: a drag-to-merge shape builder, width from recorded
   pen pressure, live (re-editable) corners and shapes, a freehand knife, text on
   either side of its path. (Affinity Designer.)
5. **Layer depth.** Done in alpha-0.1.26, for pixel and vector layers alike:
   clipping layers (a layer shows only where the layer below is painted), mask
   layers (an ordinary layer that is not drawn and hides the layer below wherever
   it is painted; hide it to switch the mask off, blur it to feather the mask),
   a mask from the pixel selection, layer blur, drop shadow and glow, adjustment
   layers (brightness, contrast, saturation, hue, invert; for everything beneath,
   or for one layer when clipped), and Merge down for pixel layers. Left for
   later: curves and levels, more effects (stroke, inner shadow), an adjustment
   limited by its own mask, and clips, masks and effects on a stroke while it is
   still being painted. (Fresco and Affinity masks, Affinity adjustments.)
6. **Guides.** Done in alpha-0.1.27 and alpha-0.1.28: a French curve template
   (move, turn, resize, flip; strokes started on its edge follow it), 3-point and
   fisheye (5-point) perspective, an isometric grid whose three axes steer
   strokes, predictive stroke (a finished pencil or brush stroke that looks like
   a line, arc, circle, ellipse, triangle or box becomes that shape), and canvas
   rotation (Alt+scroll turns the view about the pointer; Environment → Rotate
   canvas turns it in 15° steps and resets it; the drawing is not changed). The
   rotation lives in the shared FreeformCanvas camera (@aether/ui alpha.295), so
   any app on that canvas can opt in. A stroke that starts beside the ruler,
   ellipse or French curve is on it from its first point. Left for later: a
   two-finger twist gesture, more French curve templates, tilted ellipses in
   predictive stroke. (SketchBook guides and Predictive Stroke.)
7. **Document.** Done in alpha-0.1.29:
   - **Artboards.** A drawing can have several named pages (Inspector →
     Artboards): add, name, place and size them by number. Image and SVG exports
     frame the current artboard, PDF has a page for each, and one command exports
     every artboard as PNG files in a ZIP. Every artboard shows the same layers;
     moving one moves the frame, not the drawing.
   - **Symbols.** A selection becomes a symbol with a copy in its place
     (Inspector → Symbols). Copies move, scale, rotate and flip like any object;
     redrawing the symbol from an edited copy updates every copy. Symbols do not
     nest and do not keep a "draw inside" clip.
   - **PSD.** Export writes layers as pixels with name, opacity, blend mode and
     visibility, masks and effects applied, plus the merged picture. Import reads
     8-bit RGB files (raw or RLE) as pixel layers; groups are flattened and layer
     masks, text and smart objects come in as the pixels the file stores.
   - **Pixel layers in PDF.** Each pixel layer is embedded as an image at one
     pixel per document pixel, with its masks, clip and effects applied.
   Left for later: dragging and resizing artboards on the canvas, artboard size
   presets, nested symbols, a symbol library shared between drawings, PSD layer
   masks and groups, 16-bit and CMYK PSD.
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
