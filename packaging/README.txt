LOCAL BADGE REMOVER — OFFLINE MVP
=================================

Compatibility
-------------
This package is for Apple-silicon Macs (M1, M2, M3, M4, M5, and later).
It does not require Ollama, Python, Node.js, an account, or an internet
connection after the ZIP has been downloaded and unpacked.

Start
-----
1. Unzip the package. Badge Remover.app contains its complete private runtime;
   the adjacent demo folder and README can remain where they are.
2. Double-click "Badge Remover.app".
3. The app opens in Google Chrome or Microsoft Edge when installed. No
   Terminal window is required.

This test build is not Developer ID signed or Apple notarized. If macOS blocks
the first launch, right-click "Badge Remover.app", choose Open, then choose
Open once more. On a managed Mac, follow organizational policy or contact
support instead of bypassing a block. A fully warning-free tester build must
be signed and notarized by ORNL or an Apple Developer account.

Use
---
1. Select a folder of JPEG, PNG, 8-bit single-page TIFF, WebP, AVIF, or
   HEIC/HEIF images.
2. Wait for the bundled local models to load automatically.
3. Choose Start batch.
4. Strong badge edges are corner-fitted automatically; uncertain fits remain
   rectangles.
5. Review the centered image in the left-to-right carousel.
6. Drag over missed badges to add masks.
7. Click a mask and drag its four corner handles to match the badge.
8. Open Advanced settings only when you need to change detection, smooth
   Gaussian blur strength, mask expansion, or edge feather.
9. Click the red × at the lower-right edge of a false mask to remove it.
10. Toggle Before and After to compare the editable mask and redacted export.

Smooth Gaussian blur is the default. Advanced settings can adjust its strength
or switch to the optional pixelated mosaic.

The app does not modify or copy originals. As each image finishes, the app
auto-saves it into a unique "exports/badge-remover-run-..." folder inside the
selected source folder. A different destination can be chosen before starting.
A COCO-format
annotation file
records the final reviewed quadrilaterals and bounding boxes for possible
future local model training.
To revise an earlier batch, use "Import previous run," select its
badge-removal-manifest.json, and reselect the original source folder. The app
restores matching reviewed masks and settings locally.
The current model does not retrain itself while the app is running.
Detection and export run sequentially. The app keeps at most three bounded
review previews in memory and reopens one full-resolution source at a time.
Each output also gets a ".metadata.mie" archive. Writable photo metadata and
the ICC profile are transferred. Embedded thumbnails/previews are excluded
because they could reveal the unredacted badge. HEIC/HEIF input exports to
TIFF because portable HEIC encoding is not included.

Privacy
-------
Images stay on this Mac. The app binds only to 127.0.0.1 (the local computer),
contains its model and browser runtime, and has no analytics, accounts, cloud
API, or remote model access.

Limitations
-----------
- Human review is required. Automatic detection will miss some badges and can
  mark non-badge objects.
- Bulk folder export requires Google Chrome or Microsoft Edge.
- RAW, multi-page, and greater-than-8-bit images are rejected rather than
  silently flattened or reduced.
- HEIC/HEIF input exports as TIFF.
- This synthetic test package is an MVP, not a production accuracy validation.
- Production distribution should be reviewed for ORNL security, privacy,
  accessibility, code-signing, and software-management requirements.

Stop
----
Quit Badge Remover from the Dock or Activity Monitor. Closing only the browser
tab leaves the local app available so it can be reopened quickly.

Test images
-----------
The "demo-test-images" folder contains five fictional, synthetic images. They
are safe for demonstrating the workflow and contain no real employee badges.
