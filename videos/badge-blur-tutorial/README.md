# Badge Blur tutorial source

This directory contains the editable HyperFrames source for the Badge Blur
macOS tutorial, including its composition files, narration, music, sound
effects, processed screen footage, and cleared synthetic example images.

## Preview and validate

From this directory:

```bash
npm run dev
npm run check
```

The preview command starts the local HyperFrames studio. The check command
validates timing, layout, motion, and contrast.

## Render

```bash
npm run render -- --quality high --fps 30 \
  --output Badge-Blur-macOS-Tutorial.mp4
```

The published 1920×1080 render is available from the
[v0.22.1 GitHub Release](https://github.com/adammalin/Badge-Blur/releases/tag/v0.22.1).

## Original captures

The original lossless app recordings are intentionally excluded from normal
Git history because the four files total roughly 400 MB. They are preserved in
the numbered `Badge-Blur-Tutorial-Source-v0.22.1.zip.part-*` assets attached
to the v0.22.1 GitHub Release. After downloading every part, restore the full
ZIP with:

```bash
cat Badge-Blur-Tutorial-Source-v0.22.1.zip.part-* \
  > Badge-Blur-Tutorial-Source-v0.22.1.zip
unzip Badge-Blur-Tutorial-Source-v0.22.1.zip
```

The reconstructed archive includes `assets/captures/` plus the editable
composition, all supporting media, the PDF generator, and the finished flyer.

Generated HyperFrames caches, preview thumbnails, and QA snapshots are also
excluded from Git because they can be regenerated from the editable source.
