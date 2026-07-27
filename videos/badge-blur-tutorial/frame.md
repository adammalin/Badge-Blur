---
colors:
  canvas: "#373A36"
  canvas_deep: "#27302C"
  ink: "#FFFFFF"
  muted: "#CBD5CF"
  accent: "#70B94B"
  accent_deep: "#075B38"
  panel: "#2F4641"
typography:
  display:
    family: "Inter"
    weight: 800
  body:
    family: "Inter"
    weight: 600
  mono:
    family: "JetBrains Mono"
    weight: 600
spacing:
  safe_x: 112
  safe_y: 82
  gap: 28
components:
  panel_radius: 24
  control_radius: 12
  focus_stroke: 4
---

## Overview

A calm, product-led tutorial system derived from Badge Blur's dark interface
and icon colors. The frame should feel like a generous review workspace, not a
marketing commercial.

## The Frame

Each scene has one dominant evidence surface: Terminal, Badge Blur, a close
mask crop, or the finished export. Supporting labels sit outside that surface
whenever possible. The green accent marks the current action only.

## Composition Rules

- Keep all critical copy and controls inside the 112 px horizontal and 82 px
  vertical safe area.
- Use white for primary copy, silver for supporting copy, and green for one
  focal action or state at a time.
- Never use yellow or caution iconography for normal review states.
- Use rounded shells that echo the application, but do not redraw the
  application's internal controls.
- Terminal and shortcut copy use JetBrains Mono; everything else uses Inter.
- Gradients must be single, non-repeating radial or linear fields.
- Do not cover the selected badge or mask handles with captions or callouts.
