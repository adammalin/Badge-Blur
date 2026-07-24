LOCAL BADGE REMOVER — WINDOWS OFFLINE MVP
=========================================

Compatibility
-------------
This package is for 64-bit Windows 10 and Windows 11 PCs. Use Microsoft Edge
or Google Chrome. It does not require Ollama, Python, Node.js, an account, or
an internet connection after the ZIP has been downloaded and unpacked.

Start
-----
1. Right-click the ZIP and choose "Extract All". Do not run it inside the ZIP.
2. Open the extracted "Local Badge Remover" folder.
3. Double-click "Start Badge Remover.cmd".
4. Keep the Command Prompt window open while using the app.
5. The app opens in Microsoft Edge.

If Windows, Microsoft Defender SmartScreen, or organizational application
controls block the launcher or runtime, follow organizational policy or
contact support. Do not bypass a managed security control. This MVP is not
code-signed.

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
9. Select false masks and remove them.
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
Images stay on this PC. The app binds only to 127.0.0.1 (the local computer),
contains its model and browser runtime, and has no analytics, accounts, cloud
API, or remote model access.

Limitations
-----------
- Human review is required. Automatic detection will miss some badges and can
  mark non-badge objects.
- Bulk folder export requires Microsoft Edge or Google Chrome.
- RAW, multi-page, and greater-than-8-bit images are rejected rather than
  silently flattened or reduced.
- HEIC/HEIF input exports as TIFF.
- This synthetic test package is an MVP, not a production accuracy validation.
- Production distribution should be reviewed for ORNL security, privacy,
  accessibility, code-signing, and software-management requirements.

Stop
----
Press Control-C in the Command Prompt window or close that window.

Test images
-----------
The "demo-test-images" folder contains five fictional, synthetic images. They
are safe for demonstrating the workflow and contain no real employee badges.
