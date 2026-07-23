# Synthetic badge-removal demo set

These five images were generated specifically for local badge-detection and
blur testing. The people, organizations, badge designs, portraits, text-like
marks, and code-like graphics are fictional. The images contain no ORNL or DOE
marks and no valid badge data.

| File | Expected badges | Intended challenge |
| --- | ---: | --- |
| `01-single-frontal-badge.png` | 1 | Easy baseline: large, frontal, well lit |
| `02-two-person-event-badges.png` | 2 | Event lighting, two subjects, slight badge angles |
| `03-four-person-group-badges.png` | 4 | Multiple people, varied badge positions, folded-arm occlusion |
| `04-outdoor-glare-motion-badge.png` | 1 | Rotation, glare, sunlight, and slight motion |
| `05-low-light-multiscale-badges.png` | 3 | Low light, noise, foreground crop, and different subject scales |

Expected total: **11 badge regions**.

These are useful for interface and pipeline testing, but synthetic images alone
cannot establish production accuracy. Any later evaluation with real
photographs should use an approved, locally stored, representative validation
set and documented human review.
