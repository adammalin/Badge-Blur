---
format: 1920x1080
duration: 103s
message: "Install Badge Blur confidently, review and correct masks, and export redacted photos in one clear workflow."
arc: "Promise → Install → Import → Process → Inspect → Correct → Confirm → Export → Reassure"
audience: "First-time Badge Blur users"
mode: collaborative
design: "A calm charcoal review desk with Badge Blur green as the focus color, warm white type, rounded window framing, and one clear focal action per shot."
audio: "Friendly local AI narration over soft, low-tempo instrumental music; restrained click, whoosh, and confirmation cues only at meaningful actions."
---

## Frame 1 — Blur badges, keep the photo

- type: hook
- status: animated
- src: compositions/frames/01-hook.html
- duration: 9s
- transition_in: cut
- scene: Badge Blur icon resolves beside a clean before/after photo split and the promise “Blur badges. Keep the photo.”
- voiceover: "Badge Blur finds identification badges, lets you refine every mask, and exports private copies without changing the originals."
- poster: 4s
- blueprint: titlecard-reveal (adapt, Product_Intro prelude)
- rules: spring-pop-entrance; ambient-glow-bloom; discrete-text-sequence

Designed open. The icon is the focal element; a thin green divider reveals the
blurred half of one synthetic image. Edge anchors carry “Local processing” and
“Originals stay untouched.” The move is restrained: icon settle, title reveal,
then a long readable hold. This establishes trust before any instruction.

## Frame 2 — Fresh install from the script

- type: product_intro
- status: animated
- src: compositions/frames/02-install.html
- duration: 12s
- transition_in: blur crossfade
- scene: A clean, cropped Terminal window types the two-command installer, shows verified setup progress, and launches Badge Blur.
- voiceover: "On a Mac, open Terminal and run the two commands from the project readme. The script creates an isolated source-test copy, verifies its dependencies, and opens the app."
- poster: 8s
- blueprint: device-surface-showcase (adapt, stepwise-flow)
- rules: discrete-text-sequence; spring-pop-entrance; asr-keyword-glow

This is a real recording, framed as a floating Terminal surface with no desktop
visible. Editorial zooms follow the download, verification, and launch lines.
Only the generic tutorial directory appears. A small “1 · Install” chapter pill
and a verification check remain fixed so the viewer never loses context.

## Frame 3 — Choose the source and output

- type: key_feature
- status: animated
- src: compositions/frames/03-import.html
- duration: 13s
- transition_in: push slide
- scene: Badge Blur opens to a fresh synthetic-image folder, then the output-format choice is highlighted before import completes.
- voiceover: "Choose the folder of photos, then select the output format for this batch. Match source is the default, or choose JPEG, PNG, TIFF, or WebP. Exports stay in a new nested folder."
- poster: 7s
- blueprint: cursor-ui-demo (adapt, static-stage state tour)
- rules: cursor-click-ripple; coordinate-target-zoom; asr-keyword-glow

The real pointer is the actor. A soft focus frame moves from “Choose photos” to
the output-format control, followed by a concise overlay: “Originals are
read-only.” The camera remains stable except for one motivated crop-in on the
format menu.

## Frame 4 — Start the batch

- type: key_feature
- status: animated
- src: compositions/frames/04-process.html
- duration: 10s
- transition_in: directional blur
- scene: Start batch is clicked; the filmstrip fills with processing states while the progress rail, workers, and elapsed timer remain visible.
- voiceover: "Select Start batch. Detection and redaction run locally, and completed previews are prepared while the remaining photos continue processing."
- poster: 8s
- blueprint: agent-progress-theater (adapt)
- rules: dynamic-content-sequencing; asr-keyword-glow; multi-phase-camera

The recording shows genuine processing rather than a fabricated progress
animation. A gentle push begins on Start batch and settles on the progress rail.
Three micro-callouts—“Local,” “Parallel,” and “Preview prepared”—appear only
when the matching evidence is visible.

## Frame 5 — Review every photo

- type: feature_showcase
- status: animated
- src: compositions/frames/05-review.html
- duration: 13s
- transition_in: crossfade
- scene: The selected filmstrip item is clearly outlined; Fit in window, Fill width, zoom, pan, and Before/After are demonstrated in one continuous review pass.
- voiceover: "Review each photo in the large viewer. Fit shows the whole frame; Fill width gives you more inspection detail. Zoom with Command-scroll, hold Space to pan, and switch between Before and After."
- poster: 8s
- blueprint: cursor-ui-demo (adapt, continuous zoom-breathing)
- rules: coordinate-target-zoom; camera-cursor-tracking; cursor-drag

The viewer is the focal surface. The motion follows an Adobe-like rhythm:
zoom toward a badge, Space-drag once, then ease back to a readable overview.
The on-screen keystroke labels are large but brief; they never cover the mask.

## Frame 6 — Correct a mask

- type: feature_showcase
- status: animated
- src: compositions/frames/06-correct.html
- duration: 15s
- transition_in: focus pull
- scene: A genuine mask issue is corrected; if none exists, a clearly labeled “Training example” demonstrates adding a mask, adjusting corners, and changing the selected badge blur.
- voiceover: "If a badge was missed, drag across it to add a mask. Select a mask to move its corner handles, remove a false detection, or adjust blur for that badge alone. The After view refreshes with your latest edit."
- poster: 13s
- blueprint: panel-edit-live-sync (adapt)
- rules: cursor-drag; ai-tracking-box; dynamic-content-sequencing; scale-swap-transition

This is the tutorial’s longest and most important shot. The selected mask,
corner handle, and per-badge blur inspector stay visually linked by a thin
green guide. A magnified inset appears only during the corner adjustment.
Before/After is shown side by side for the final three seconds, with labels
instead of a caution color. We will use a naturally imperfect mask when one
appears; otherwise the overlay explicitly says “Training example.”

## Frame 7 — Save, review, and continue

- type: benefit_highlight
- status: animated
- src: compositions/frames/07-review-next.html
- duration: 11s
- transition_in: push slide
- scene: Save, review & next is clicked; the current image gains its reviewed state and the viewer advances to the next unreviewed image.
- voiceover: "Choose Save, review and next. Badge Blur saves the current masks, marks exactly this photo reviewed, and advances to the next image that still needs you."
- poster: 6s
- blueprint: cursor-ui-demo (adapt, static-stage state tour)
- rules: physics-press-reaction; cursor-click-ripple; spring-pop-entrance

The button, selected thumbnail, and next thumbnail form a simple cause-and-
effect triangle. A subtle check sound lands with the reviewed state. Supporting
copy reads “Saved · Reviewed · Advanced,” one phrase at a time.

## Frame 8 — Re-export only what changed

- type: benefit_highlight
- status: animated
- src: compositions/frames/08-export.html
- duration: 13s
- transition_in: blur crossfade
- scene: One edited image is re-exported, then the changed-images action and final export-folder confirmation are shown.
- voiceover: "After an adjustment, re-export that image—or export only photos changed since the last export. When the batch is ready, open the export folder to see the redacted files and run data."
- poster: 9s
- blueprint: device-surface-showcase (adapt, stepwise-flow)
- rules: press-release-spring; dynamic-content-sequencing; ambient-glow-bloom

The app stays full-frame through the action, then hands off to a tightly cropped
export-folder view containing only the tutorial outputs. No desktop or private
path is shown. The payoff is a green “Up to date” state plus a two-up view of
source and exported redaction.

## Frame 9 — Review stays human

- type: branding
- status: animated
- src: compositions/frames/09-outro.html
- duration: 11s
- transition_in: color dip
- scene: The finished before/after pair settles behind the Badge Blur lockup and three closing assurances.
- voiceover: "Automatic detection gets you moving quickly. Your review makes the result trustworthy. Badge Blur keeps the whole workflow local and leaves every original untouched."
- poster: 6s
- blueprint: titlecard-reveal (adapt, CTA card chain)
- rules: discrete-text-sequence; scale-swap-transition; ambient-glow-bloom

Designed close. “Detect locally,” “Review visually,” and “Export confidently”
arrive as three calm cards, then condense into the Badge Blur icon and name.
The music resolves without a hard stop, and the final lockup holds long enough
to read.

## Global production treatment

The composition uses a charcoal-to-deep-green radial field that never tiles,
warm white copy, Badge Blur green for active focus, and muted slate for
secondary rails. Rounded 22–28 px window shells echo the application without
imitating it. Typography uses a sturdy geometric sans for chapter titles and a
high-legibility mono only for Terminal commands and keyboard shortcuts.

Real screen recordings remain the evidence layer. HyperFrames supplies the
clean window crops, focus masks, smooth coordinate-target zooms, chapter pills,
callouts, captions, and transitions. The visual grammar stays quiet: blur
crossfades and short directional pushes between related steps, with a color dip
only before the close.

Audio identity: warm, conversational narration at an unhurried pace; a soft
instrumental bed without vocals or pronounced percussion; light UI clicks,
one restrained whoosh for chapter changes, and a soft confirmation tone for
saved/reviewed/exported states. Music ducks beneath speech and rises slightly
only during the opening, the final export reveal, and the close.
