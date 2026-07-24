# Changelog

## 0.13.0 — 2026-07-24

- Adds Auto, 1, 2, and 4-image parallel-processing choices under Advanced
  settings.
- Gives every parallel detector its own local Grounding DINO and CLIP model
  session so simultaneous inference does not share mutable session state.
- Uses a conservative local CPU/memory policy plus a short compute benchmark
  for Auto; the current 18-logical-processor system selects two workers.
- Overlaps detection with the previous image's sequential redaction/export so
  the pipeline gains throughput even when multiple detector sessions contend
  for the same CPU cores.
- Keeps output files, metadata sidecars, and manifest writes serialized.
- Makes preview decoding, carousel rendering, and preview cleanup safe when
  multiple images are active.
- Records the requested/resolved worker count, capability signals, per-image
  worker assignment, and batch duration in the schema-version-8 manifest.
- Adds deterministic worker-policy and worker-pool tests plus a reproducible
  local model-worker benchmark.

## 0.12.0 — 2026-07-24

- Uses a smooth, mask-size-aware Gaussian blur as the default redaction style.
- Reduces the default strength to 3% of the badge's shorter edge while keeping
  detected badge text unreadable in the supplied full-resolution regression
  photograph.
- Keeps the pixelated mosaic as an optional redaction style.
- Adds redaction style and strength controls to the UI and records the chosen
  style in the schema-version-7 run manifest.
- Moves detection phrases, threshold, torso rescue, redaction style, strength,
  mask expansion, and edge feather into a collapsed Advanced settings panel.
- Bumps the local image API handshake so an older running server cannot process
  the new redaction settings incorrectly.

## 0.11.0 — 2026-07-23

- Automatically loads the bundled Grounding DINO and CLIP models after the
  local server version check succeeds.
- Uses a writable source-folder handle in Chrome/Edge and auto-saves each
  processed image into `source/exports/a-unique-run-folder`.
- Adds a user-selectable alternate export destination without changing the
  source-folder default.
- Replaces four-image pages with a left-to-right three-slot carousel that keeps
  the actively processed or reviewed image centered.
- Adds Before/edit and After/exported toggles with progressive redacted
  previews and automatic re-export after manual mask changes.
- Records per-image detection/export time, live batch elapsed time, and final
  batch duration in both the interface and schema-version-6 manifest.
- Fixes the full-resolution redaction pipeline so its downscale/upscale mosaic
  is applied as two distinct image operations instead of being optimized away
  into an almost invisible blur.
- Adds a redaction-strength regression test that verifies detail loss inside
  the mask and unchanged pixels well outside it.

## 0.10.4 — 2026-07-23

- Prevents a false “could not start” dialog when the bundled server is running
  but the app wrapper's local `curl` health check is inconclusive.
- Opens the browser whenever the server process remains alive; the error dialog
  is now reserved for an actual server-process exit.

## 0.10.3 — 2026-07-23

- Moves the complete Mac runtime, server, dependencies, and models inside
  `Badge Remover.app/Contents/Resources`.
- Prevents macOS Desktop/Documents privacy controls from denying the launcher
  access to a sibling `scripts/serve.mjs` file.
- Keeps photo-folder access in the browser file picker while the launcher reads
  only its own signed application bundle.

## 0.10.2 — 2026-07-23

- Replaces the Mac tester-facing Terminal `.command` launcher with a normal
  double-clickable `Badge Remover.app` bundle that runs without a Terminal
  window and opens Chrome or Edge automatically.
- Avoids a false compatibility failure when Launch Services starts the wrapper
  in a translated process context; the bundled ARM runtime now determines
  whether the Mac is compatible.
- Ad-hoc signs and verifies the Mac app bundle during packaging; warning-free
  public distribution still requires Developer ID signing and notarization.

## 0.10.1 — 2026-07-23

- Adds a red × control at the lower-right edge of every badge mask so false
  detections can be removed immediately without covering the detection label.
- Uses a larger invisible hit target and pointer cursor for reliable clicking
  when large photos are scaled down in the review grid.
- Keeps the existing selected-mask button and Delete/Backspace keyboard
  shortcuts as accessible alternatives.
## 0.10.0 — 2026-07-23

- Adds an enhanced local detection mode that detects people, searches enlarged
  upper-torso crops, and preserves full-image detections as the primary pass.
- Adds a bundled quantized CLIP classifier that rejects likely shirt logos,
  pockets, clothing details, paper, and signs from the torso rescue pass.
- Improves the reviewed 45-badge set from 62.2% to 75.6% recall while retaining
  72.3% precision.
- Adds an optional faster mode by turning off **Enhanced torso rescue**.
- Adds a versioned local crop endpoint used only for on-device model input.

## 0.9.1 — 2026-07-23

- Prevents a newly unpacked Mac app from reusing an older Badge Remover server
  merely because it has the same page title.
- Adds an explicit app/API version handshake before image processing is
  enabled.
- Returns JSON for unknown local API routes and replaces raw JSON parse errors
  with a clear restart instruction.

## 0.9.0 — 2026-07-23

- Replaces OWLv2 and the color heuristic with a bundled quantized Grounding
  DINO Tiny ONNX detector on both Mac and Windows.
- Uses one Grounding DINO-compatible, period-delimited badge prompt and a
  balanced default threshold of `0.20`.
- Improves the reviewed 18-image local set from 44.4% to 62.2% automatic
  recall and from 71.4% to 73.7% mask precision.
- Keeps tiled inference and the earlier color assist disabled because controlled
  tests increased false masks.
- Pins the local model revision and verifies its SHA-256 checksum before builds.

## 0.8.0 — 2026-07-23

- Adds a fully local color-assisted detection pass for strong green and orange
  badge evidence, supplementing the bundled OWLv2 model without any network
  request.
- Adds an ignored local real-photo evaluation corpus, reviewed badge-center
  annotations, scored recall/precision reports, per-image review overlays, and
  contact sheets.
- Adds `npm run test:badge-production` for a reproducible production-path
  regression and keeps higher-recall person-guided experiments opt-in.
- Improves the reviewed 18-image set from 31.1% to 44.4% automatic recall and
  from 60.9% to 71.4% mask precision. Human review remains mandatory because
  the current detector still misses white/translucent and distant badges.

## 0.7.0 — 2026-07-23

- Creates a new timestamped, random-ID run folder for every bulk export so a
  later batch cannot overwrite an earlier run.
- Adds previous-run import: select an earlier
  `badge-removal-manifest.json`, reselect the original source folder, and
  continue adjusting the restored masks and settings locally.
- Matches restored files by relative path and byte size, with a safe unique
  rootless-path fallback when the source folder has moved.
- Does not copy unredacted originals into the output folder; the manifest
  records that policy and links a resumed export to its source run ID.
- Improves automatic angle matching with perpendicular image-gradient
  sampling, bilinear interpolation, a wider tilt search, and a larger fitting
  preview while retaining the existing safety fallback.
- Updates the audit manifest to schema version 5.

## 0.6.0 — 2026-07-23

- Adds a local edge-based quadrilateral refinement pass after OWLv2 detection.
- Automatically initializes four corners when long badge edges and the fitted
  geometry pass confidence, convexity, size, and image-boundary checks.
- Blends fitted corners back toward the original detection when necessary so
  the expanded polygon continues to cover the original detected region.
- Keeps the original rectangle when the fit is weak or unsafe.
- Records automatic-fit confidence, fallback reason, original detection
  bounds, and later user adjustments in the version 4 audit manifest.

## 0.5.0 — 2026-07-23

- Converts every detected or manually drawn mask into an editable four-corner
  quadrilateral.
- Adds visible corner handles and prevents self-intersecting corner edits.
- Adds an Edge feather control from 0–30 percent.
- Applies pixelation through a feathered polygon alpha mask so redaction can
  follow tilted or perspective-distorted badges.
- Adds polygon points and COCO segmentation data to the local manifest and
  training annotations while retaining bounding-box compatibility.

## 0.4.3 — 2026-07-23

- Reports intentionally rejected files as concise local warnings instead of
  printing alarming stack traces in the launcher window.

## 0.4.2 — 2026-07-23

- Broadens the embedded-preview exclusion to the complete ExifTool Preview
  metadata group.
- Generates image and metadata outputs before writing either file during bulk
  export, reducing the chance of a partial per-image result.

## 0.4.1 — 2026-07-23

- Ensures a metadata archive is created even when a source contains no
  transferable descriptive metadata.

## 0.4.0 — 2026-07-23

- Adds local JPEG, PNG, 8-bit single-page TIFF, WebP, AVIF, and HEIC/HEIF
  decoding on macOS and Windows.
- Keeps JPEG, PNG, TIFF, WebP, and AVIF output formats; safely converts
  HEIC/HEIF input to TIFF.
- Transfers writable EXIF, IPTC, XMP, camera, copyright, and ICC metadata.
- Saves a non-preview MIE metadata archive beside every redacted image.
- Excludes embedded thumbnails/previews that could reveal the original badge.
- Rejects RAW, multi-page, and greater-than-8-bit files instead of silently
  reducing or flattening them.
- Continues a bulk export after an individual file failure and records skipped
  files in the manifest.

## 0.3.1 — 2026-07-23

- Adds the supplied ORNL leaf artwork to the left of the “Badge Remover”
  masthead title.
- Preserves the SVG artwork without changing its paths, proportions, or color.
- Keeps the title lockup aligned and legible at desktop and narrow widths.

## 0.3.0 — 2026-07-23

- Upgrades the local detector from OWL-ViT patch32 to the quantized OWLv2
  patch16 ensemble.
- Tunes detection phrases, confidence, geometry filtering, overlap handling,
  and lanyard-extension suppression against the frozen five-image demo set.
- Processes detection and export sequentially instead of retaining every
  full-resolution source in memory.
- Adds four-image review pages with Previous/Next navigation.
- Retains only bounded 1200-pixel previews for the current page; full-resolution
  files are reopened one at a time for redaction.
- Keeps the macOS and Windows packages synchronized at version 0.3.0.

## 0.2.0 — 2026-07-23

- Replaced the unsupported-browser multi-download fallback with a clear
  Microsoft Edge or Google Chrome requirement for bulk folder export.
- Writes all redacted files sequentially after one destination-folder choice.
- Preserves source subfolders to prevent duplicate filename collisions.
- Adds initial model detections and final reviewed masks to the audit manifest.
- Adds `badge-training-annotations.coco.json` for future local detector
  training; the bundled model remains fixed during inference.
- Prefers Google Chrome or Microsoft Edge on macOS and Microsoft Edge on
  Windows.
- Keeps macOS and Windows packaging synchronized through `npm run package:all`.
