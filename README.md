# Badge Blur MVP

A local-only browser tool that detects likely identification badges, lets a
reviewer correct the masks, and saves redacted copies without changing the
original images.

## Start the app

From this folder:

```bash
npm run setup
npm start
```

Open:

```text
http://127.0.0.1:4173/
```

`npm run setup` installs the JavaScript dependencies, downloads the pinned
local models, verifies their SHA-256 checksums, and builds the app. `npm start`
serves the already-built app only on the local loopback interface.

Version 0.11.0 verifies that the browser and local image-processing server are
the same release before enabling work. On Mac, launching a newly unpacked
release no longer reuses an older server solely because it has the same page
title.

Do not use `npm run dev` for normal photo processing. The packaged local
runtime is the supported MVP path.

## Model download

Version 0.11.0 uses the Apache-2.0 quantized ONNX conversion of
[`Grounding DINO Tiny`](https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX).
Enhanced mode adds the quantized Transformers.js conversion of
[`CLIP ViT-B/32`](https://huggingface.co/Xenova/clip-vit-base-patch32) to
reject likely shirt details, signs, equipment labels, uniform patches, and
clipped objects. Both run locally and do not require Python, Ollama, or a
network connection after packaging.

Pinned model file:

```text
https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX/resolve/ff690b0a8050566c290287545bd059350f3e9096/onnx/model_quantized.onnx?download=true
```

Expected destination:

```text
public/models/onnx-community/grounding-dino-tiny-ONNX/onnx/model_quantized.onnx
```

Expected SHA-256:

```text
70bf2d3310d1ae73769c96a71e00cbf2861eb33a1f4d97d84a108a7bf02c03c9
```

Pinned CLIP revision:
`d15189d7028b43f1d3e65039190477f6af591c2a`  
CLIP model SHA-256:
`0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328`

The recommended route is:

```bash
npm run prepare:model
```

That script downloads both models plus their small configuration/tokenizer
files and refuses to continue if either checksum does not match. If direct
downloading is blocked, download the pinned file through an approved route,
copy it to the expected destination, then rerun `npm run prepare:model` to
verify it and obtain any missing small files.

## Workflow

1. Select a folder of JPEG, PNG, 8-bit single-page TIFF, WebP, AVIF, or
   HEIC/HEIF images.
2. Wait for the bundled local models to load automatically.
3. Choose **Start batch**.
4. Grounding DINO runs one period-delimited grounding prompt over each image.
5. With **Enhanced detection and filtering** enabled, the app uses CLIP to
   reject only strongly negative lower-confidence full-image candidates, then
   detects people and searches enlarged upper-torso crops for missed badges.
6. The local corner fitter refines strong badge edges and keeps a rectangle
   when the fit is uncertain.
7. Review the centered image in the left-to-right carousel. Its immediate
   neighbors remain visible as smaller previews.
8. Drag over a missed badge to add a mask.
9. Click a mask and drag its four corner handles to match badge perspective.
10. Open **Advanced settings** only when you need to change detection,
    Gaussian blur strength, mask expansion, edge feather, or parallel
    processing.
11. Click a false mask and use **Remove selected** or the Delete key.
12. Toggle **Before · edit masks** and **After · exported** to compare the
    current mask with its redacted output.

The default redaction is a smooth Gaussian blur sized to 3% of the badge's
shorter edge. The Advanced settings panel can increase or decrease that
strength or switch to the optional pixelated mosaic style. Changing a
redaction setting refreshes and re-saves completed outputs in the active run.

Parallel processing defaults to **Auto**. The app uses logical-processor and
browser memory signals plus a short local compute benchmark to select one, two,
or four detector workers conservatively. Manual 1/2/4 choices are available
for controlled testing. Each worker owns a separate Grounding DINO and CLIP
session; final files and manifests are still written one at a time.

Each processed image is saved progressively into
`source-folder/exports/badge-remover-run-YYYYMMDD-HHMMSS-xxxxxxxx` by default.
**Choose different export folder** overrides that destination for the next
run. Every run folder contains redacted
copies, an adjacent `.metadata.mie` metadata archive for each copy, plus
`badge-removal-manifest.json` and
`badge-training-annotations.coco.json`. The timestamp and random run ID prevent
a new export from reusing or overwriting an older run folder. Source
subfolders are preserved inside each run so duplicate filenames from different
folders do not collide.

Original images remain read-only and are deliberately not copied into the
output. Keeping the originals out avoids duplicating unredacted sensitive
pixels and reduces storage use. To revise a run, click **Import previous run**,
choose its `badge-removal-manifest.json`, and reselect the original source
folder. The app restores final reviewed masks and run settings by relative path
and verifies the source file size before applying them. It can also restore a
run created by an earlier app version that contains compatible reviewed masks.

The COCO file records final reviewed quadrilaterals and COCO bounding boxes for
later local model training; it does not train or alter the bundled model during
use.

JPEG, PNG, TIFF, WebP, and AVIF retain their format. HEIC/HEIF input is
exported as TIFF with `-redacted-from-heic` or `-redacted-from-heif` in its
name because portable HEIC encoding is not included. Writable EXIF, IPTC, XMP,
copyright, camera, and ICC-profile metadata is transferred. Orientation is
normalized after pixels are rotated. Embedded thumbnails and previews are
intentionally excluded because they could contain the original visible badge.
The MIE archive preserves the remaining source metadata for audit/recovery.

## Local-only controls

- Model loading from remote services is disabled in application code.
- The model, tokenizer, and ONNX runtime files are bundled locally.
- Content Security Policy allows network reads only from the local app origin
  and local in-memory `blob:` image URLs.
- The server binds to `127.0.0.1`, not the LAN.
- There are no analytics, telemetry, accounts, or cloud APIs.
- Bulk export uses the folder-write API in Microsoft Edge or Google Chrome and
  writes files sequentially into the source folder's `exports` subfolder
  unless the reviewer chooses another destination.
- Detection uses the selected bounded worker pool while redaction/export and
  audit-manifest writes remain sequential. Detection can overlap the previous
  image's local export. Only three bounded 1200-pixel review previews plus
  active worker previews are retained; full-resolution sources are opened only
  for the active processing stages.

The one-time setup step does contact npm and Hugging Face to download public
software/model files. Image processing after setup is local.

## Installers and portable packages

### Install and test on macOS

The current Mac package supports Apple-silicon Macs running macOS 13 or later.
Use the newest `Badge-Blur-Mac-arm64-vX.Y.Z.dmg` from a successful
[**Build installable apps**](https://github.com/adammalin/Badge-Blur/actions/workflows/build-installers.yml)
GitHub Actions run. The matching ZIP still works, but the DMG is the preferred
test package.

1. Download the Mac artifact and unzip the GitHub artifact if necessary.
2. Optional but recommended: place the DMG and its `.sha256` file together,
   open Terminal in that folder, and run:

   ```bash
   shasum -a 256 -c Badge-Blur-Mac-arm64-v*.dmg.sha256
   ```

3. Open the DMG and drag **Badge Blur.app** onto the **Applications**
   shortcut.
4. Open `/Applications/Badge Blur.app` once. Because this test build is not
   Developer ID signed or notarized, macOS may block it. Dismiss the warning
   without moving the app to the Trash.
5. Open **System Settings > Privacy & Security**, scroll to **Security**, and
   click **Open Anyway** for Badge Blur. Apple makes this option available for
   about one hour after the blocked launch.
6. Authenticate when prompted. When macOS shows the warning again, click
   **Open**.
7. Badge Blur should open in Google Chrome or Microsoft Edge at a local
   `127.0.0.1` address. No Terminal window, account, Ollama installation, or
   internet connection is required after installation.
8. Select the bundled `demo-test-images` folder, run a batch, review every
   mask, and confirm that redacted copies and the run manifest are written to
   a new uniquely named export folder. Confirm that the source images are
   unchanged.
9. Quit Badge Blur from the Dock or Activity Monitor. Closing only the browser
   tab does not stop the local app.

After the first approved launch, macOS saves Badge Blur as an exception and it
normally opens by double-clicking. Do not disable Gatekeeper globally or use
commands that recursively remove quarantine attributes. On a managed Mac, the
**Open Anyway** option may be unavailable; use the organization's approved
software-distribution or support process instead.

To uninstall, quit Badge Blur and move `/Applications/Badge Blur.app` to the
Trash. The app installs no system extensions or background agents. Export
folders created by the tester are user data and are intentionally preserved.

Apple's current instructions are available in
[Open a Mac app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).

### Build packages from source

To create both offline packages from the same production build:

```bash
npm run package:all
```

Individual packages can also be created:

```bash
npm run package:mac
npm run package:windows
```

The Mac packaging command writes both a traditional drag-to-Applications DMG
and a portable ZIP, with SHA-256 checksums, to `releases/`. Both packages
contain the same built app, model, five synthetic demo images, system icon, and
private Node runtime:

- macOS Apple silicon: `Badge Blur.app`
- Windows x64 portable ZIP: `Start Badge Blur.cmd`

The Windows installer is built natively on Windows with:

```powershell
npm run package:windows:installer
```

It installs per user, creates Badge Blur shortcuts with the system icon, runs
without a persistent Command Prompt, provides an Open/Quit tray menu, and
registers a normal uninstaller under **Settings > Apps > Installed apps**.
The GitHub Actions workflow builds the Mac ARM DMG/ZIP and Windows x64 setup
executable on their matching hosted operating systems.

Recipients do not need Ollama, Python, Node.js, npm, or an internet connection.
The Mac app has an ad-hoc integrity signature, but it is not Developer ID
signed or Apple notarized. After the first blocked launch, testers can use
**System Settings > Privacy & Security > Open Anyway** on an unmanaged Mac.
The unsigned Windows installer can similarly trigger SmartScreen. Installer
format and system icons do not bypass either security system. Managed computers
may require normal organizational approval or software distribution.

## MVP limitations

- Human review is required.
- Enhanced mode on the reviewed 18-image local regression currently measures
  75.6% automatic badge recall and 81.0% mask precision. It is useful as a first-pass reviewer,
  not as an unattended compliance control. White/translucent cards and distant
  small badges remain the main miss cases.
- Automatic detections begin with an angle-aware four-corner edge fit.
  Reviewers can move all four corners independently to conform the redaction
  to a tilted badge. Uncertain, weak, self-intersecting, or unsafe geometry
  falls back to the original detection rectangle.
- The corner fitter does not use a second cloud or generative model. It scores
  continuous local edges inside the Grounding DINO detection and verifies that the
  expanded fitted mask still covers the original detection.
- Feathering softens the transition at the expanded mask boundary. Keep enough
  mask expansion to cover all sensitive badge pixels.
- A lighter Gaussian setting can preserve too much text on unusually large or
  high-contrast credentials. Always review the After view at useful zoom.
- The bundled model is fixed during inference. Reviewed corrections are saved
  as local annotations but do not update the model automatically.
- The frozen five-image synthetic browser test found all 11 visible badge
  regions with 11 complete boxes and no false boxes. This small synthetic
  result does not predict accuracy on cleared production photographs.
- The queued design avoids loading every full-resolution image at once, but a
  representative hundreds/thousands-image soak test is still required before
  production use.
- Enhanced mode is substantially slower because it verifies ambiguous global
  candidates, runs a person pass, one badge pass per torso, and a classifier
  on rescue candidates. Turn it off for the faster v0.9-style full-image pass.
- More detector workers are not guaranteed to scale linearly because each
  ONNX session competes for CPU and memory bandwidth. On the development
  workstation, two model workers were 1.04× faster than one on the four-image
  detector benchmark; pipeline overlap can provide additional batch benefit.
- Four-worker mode is intentionally marked as high-memory and should be
  qualified on the actual Windows or Mac workstation before large batches.
- RAW files, multi-page images, and images above 8 bits per channel are
  rejected instead of being silently developed, flattened, or reduced.
- HEIC/HEIF output is TIFF, not HEIC/HEIF.
- Pixel edits necessarily re-encode the image; this is metadata-preserving,
  not byte-for-byte image preservation.
- No Lightroom catalog or Photoshop integration yet.
- Synthetic images are useful for pipeline testing but do not establish
  production accuracy.

See [TEST-REPORT.md](TEST-REPORT.md) for the frozen demo result.

## Local real-photo regression

Place approved local test images in
`test-data/local-badge-evaluation/`. That directory and generated
`test-output/` artifacts are git-ignored so sensitive pixels are not packaged.
The reviewed normalized badge centers live in
`test-data/badge-ground-truth.json`.

Run the same enhanced local path used by the app:

```bash
npm run test:badge-production
```

Each run creates a unique folder under `test-output/` containing a JSON report,
per-image overlays, and a contact sheet. Green circles are covered reference
points; red circles are missed reference points.
