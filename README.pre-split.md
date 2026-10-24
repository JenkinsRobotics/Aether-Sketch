# Aether Sketch

A launchable vector workspace and integration host for `@aether/sketch`.
Aether Studio serves its build at `/sketch/`; isolated development uses port 5182.

## Vector editing

- Bézier pen: click corners, drag tangents, Enter finishes an open path;
  click the first anchor or Shift+Enter closes it. Escape cancels a gesture.
- Line, rectangle, editable four-cubic ellipse, polygon, open pencil and closed
  freehand tools. Shift constrains shapes, tangent angles and transforms.
- Node tool: select/move/nudge anchors or handles; double-click an edge to insert
  a point without changing its cubic shape. Delete removes the selected anchor.
- Corner, smooth and symmetric node modes; Alt-drag decouples handles. Convert
  an outgoing edge between line/curve. Open, close, reverse, break and join paths.
- Trim the clicked interval between crossings; without crossings remove the edge.
- Offset contour with signed distance. Closed paths have independent fill/stroke.
- Shift-select or marquee paths; eight common resize handles and a rotation
  handle; numeric bounds, proportional sizing, rotation, reflection, duplication.
- Snapping to anchors, midpoints, centers, axes and optional grid with a
  screen-scaled threshold. Alt bypasses snapping. Space-drag pans; zoom persists
  across tool changes and undo.

Shared Aether UI provides the full-width ribbon, panels, tree, fields and themes.
Docked/Floating/Canvas layouts are available. The hierarchical tree supports
layers, nested groups, rename, visibility, locks, deletion and drag reordering or
moves between layers. Select moves a whole group; Alt-click or Node edits a path.
The active layer owns canvas picking. Group visibility/locks apply to descendants.
Grouping makes the selected paths a contiguous paint block at the topmost selected
position; the tree displays that paint order. Document edits support 100-step
undo/redo, including atomic multi-path transforms, break, trim and join.

Save downloads validated `.aethersketch` v2 JSON. Open upgrades v1 drawings and
validates geometry, identities, hierarchy and appearance before replacing the
current drawing. SVG export writes the visible retained vectors. Units are pixels.

## Essential vector workflows

- Make/release compound paths with editable contours, holes, even-odd/nonzero
  fill rules, and whole-object transforms. Choose Edit contour for node editing.
- Union, Subtract front, Intersect and Exclude overlap operate on closed shapes.
  Subtract cuts front shapes from the backmost selection. Curved input becomes
  editable polygon edges at the chosen tolerance (default 0.25 px). Worker execution
  has complexity limits and a timeout; failures keep the source drawing.
- Editable multiline text: content, installed font family, size, weight, italic,
  alignment, line spacing, paint and affine transforms; retained in save and SVG.
- Import SVG converts paths, basic shapes, groups/transforms, ordinary text,
  supported gradients and user-space clips into editable document data. Imported
  scripts and foreign content never mount. Unsupported features report warnings.
- Autosave keeps account/project-scoped browser drafts, with separate records for
  working tabs. Refresh recovers the tab; Recover drafts restores or deletes durable
  IndexedDB copies. Storage errors are visible. Signed-out/unverified sessions use
  manual Save. This is local recovery, not server storage or collaborative editing.

## Vector painting

Solid, linear and radial fills use the shared paint definition. Edit gradient
colors, positions, stop transparency, angle and overall fill opacity. Stroke
color, width, opacity, caps, joins and dash style are independent of object opacity.
Fill shape paints a closed path; Pick appearance samples vector styles.

Draw inside selected shape creates a live clipping group: the original closed
path remains the editable boundary. Contents and boundary move/resize/duplicate
as a group. Release clipping removes the clipping relationship. Save/Open and
SVG export preserve gradient stops, stroke styles and clipping references.
The same Aether UI GradientControls edit Map's colour sources.

## Verification and limits

Run `npm ci`, then `npm test && npm run build`. Browser checks: `npm run e2e`
(install Playwright Chromium, or set `AETHER_TEST_CHROMIUM` to its executable).
They start a separate local server on 5183 and use disposable downloads.

Ellipses are cubic approximations, not analytic CAD conics. Cubic trim crossings
use sampled intersection parameters; output pieces retain the original cubic
shape. Offsets flatten curved input to editable polygon contours and reject
collapsed/self-crossing results. Boolean winding normalization is intended for
ordinary closed contours, not exact CAD profiles or every pathological self-crossing
fill. SVG import is a supported subset: CSS stylesheets, filters, external resources,
images/use, arbitrary gradient coordinates, and per-span text layout are not fully
preserved. Fonts are not embedded; text outlining/path text remain future work.
Full Adobe/Affinity parity and physical stylus/Safari validation are not claimed.

Raster painting is deferred: GPU brushes, pressure/tilt, texture layers/blend modes,
image import, PSD/PNG export, touch gestures and server persistence remain planned.
See `dev/docs/roadmap/Aether_Sketch_Standard.md`.
