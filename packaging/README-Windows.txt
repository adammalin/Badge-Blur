BADGE BLUR — WINDOWS OFFLINE MVP
================================

Compatibility
-------------
This installer is for 64-bit Windows 10 and Windows 11 PCs. It includes its own
Electron Chromium runtime and does not require Edge, Chrome, Ollama, Python,
Node.js, an account, or an internet connection after setup.

Install and start
-----------------
1. Double-click "Badge-Blur-Windows-x64-Setup-v....exe".
2. The Squirrel.Windows setup installs Badge Blur for the current user without
   requiring an administrator account.
3. Launch Badge Blur from the Start Menu.
4. Badge Blur opens in its own desktop window with its bundled Chromium
   runtime.

If Windows, Microsoft Defender SmartScreen, or organizational application
controls block the unsigned installer, follow organizational policy or contact
support. On an unmanaged test PC, Windows may offer More info > Run anyway.
The installer is not code-signed and does not bypass security controls.

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
   Gaussian blur strength, mask expansion, edge feather, or parallel
   processing.
9. Select false masks and remove them.
10. Toggle Before and After to compare the editable mask and redacted export.

Smooth Gaussian blur is the default. Advanced settings can adjust its strength
or switch to the optional pixelated mosaic.
Parallel processing defaults to Auto. Manual 1, 2, and 4-image modes are
available; 4-image mode uses substantially more memory.

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
Detection uses the selected bounded worker pool. Redaction, export, and
manifest writes remain sequential to protect the run folder.
Each output also gets a ".metadata.mie" archive. Writable photo metadata and
the ICC profile are transferred. Embedded thumbnails/previews are excluded
because they could reveal the unredacted badge. HEIC/HEIF input exports to
TIFF because portable HEIC encoding is not included.

Privacy
-------
Images stay on this PC. The app binds only to 127.0.0.1 (the local computer),
contains its models and Electron runtime, and has no analytics, accounts,
cloud API, or remote model access.

Limitations
-----------
- Human review is required. Automatic detection will miss some badges and can
  mark non-badge objects.
- The bundled Electron Chromium runtime provides bulk folder export.
- RAW, multi-page, and greater-than-8-bit images are rejected rather than
  silently flattened or reduced.
- HEIC/HEIF input exports as TIFF.
- This synthetic test package is an MVP, not a production accuracy validation.
- Production distribution should be reviewed for ORNL security, privacy,
  accessibility, code-signing, and software-management requirements.

Stop
----
Click "Quit Badge Blur," close the application window, or use the normal
Windows close command. Electron stops the private local service and releases
its port before exiting.

Remove
------
Open Settings > Apps > Installed apps, find Badge Blur, and choose Uninstall.
The per-user uninstaller removes the app, private runtime, models, and Start
Menu entry.
Export folders created beside selected photographs are user output and are
intentionally not removed.

Test images
-----------
The "demo-test-images" folder contains five fictional, synthetic images. They
are safe for demonstrating the workflow and contain no real employee badges.
