import assert from "node:assert/strict";
import {
  candidateCenterInsideRegion,
  candidateLooksLikeCroppedForeground,
  candidateInsideTorso,
  extendedTorsoRegionForPerson,
  isPlausiblePersonBox,
  lanyardBadgeSearchRegion,
  torsoRegionForPerson,
} from "../src/person-guidance.js";

const region = torsoRegionForPerson(
  { x: 100, y: 50, width: 200, height: 500 },
  800,
  600,
);
assert.deepEqual(region, {
  left: 120,
  top: 75,
  width: 160,
  height: 360,
});
assert.equal(
  candidateInsideTorso(
    { x: 180, y: 220, width: 50, height: 70 },
    [region],
  ),
  true,
);
const extendedRegion = extendedTorsoRegionForPerson(
  { x: 100, y: 50, width: 200, height: 500 },
  800,
  600,
);
assert.deepEqual(extendedRegion, {
  left: 110,
  top: 65,
  width: 180,
  height: 470,
});
assert.equal(
  candidateInsideTorso(
    { x: 165, y: 410, width: 70, height: 60 },
    [extendedRegion],
  ),
  true,
);
assert.equal(
  isPlausiblePersonBox(
    { label: "person", x: 10, y: 20, width: 900, height: 1450 },
    1024,
    1536,
  ),
  true,
);
assert.equal(
  isPlausiblePersonBox(
    { label: "person", x: 0, y: 0, width: 1024, height: 1536 },
    1024,
    1536,
  ),
  false,
);
assert.equal(
  candidateLooksLikeCroppedForeground(
    { x: 255, y: 768, width: 238, height: 255 },
    1536,
    1024,
  ),
  true,
);
assert.equal(
  candidateLooksLikeCroppedForeground(
    { x: 900, y: 300, width: 238, height: 255 },
    1536,
    1024,
  ),
  false,
);
assert.equal(
  candidateInsideTorso(
    { x: 430, y: 220, width: 120, height: 80 },
    [region],
  ),
  false,
);
assert.equal(
  candidateInsideTorso(
    { x: 165, y: 410, width: 70, height: 60 },
    [region],
  ),
  false,
);
assert.equal(
  candidateInsideTorso(
    { x: 275, y: 500, width: 60, height: 80 },
    [region],
  ),
  false,
);
assert.equal(
  candidateInsideTorso(
    { x: 430, y: 220, width: 120, height: 80 },
    [],
  ),
  false,
);
const lanyardSearch = lanyardBadgeSearchRegion(
  { x: 300, y: 120, width: 120, height: 280 },
  800,
  900,
);
assert.equal(
  candidateCenterInsideRegion(
    { x: 310, y: 360, width: 100, height: 130 },
    lanyardSearch,
  ),
  true,
);
assert.equal(
  candidateCenterInsideRegion(
    { x: 40, y: 360, width: 100, height: 130 },
    lanyardSearch,
  ),
  false,
);

console.log(
  JSON.stringify({
    tightTorsoRegion: true,
    torsoBadgeRetained: true,
    hangingLanyardBadgeRetained: true,
    croppedForegroundBadgeRetained: true,
    backgroundSignRejected: true,
    partialOverlapRejected: true,
    noPersonRequiresClassifierFallback: true,
    closePortraitPersonRetained: true,
    extendedTorsoFallbackCovered: true,
    lanyardBadgeSearchTargeted: true,
  }),
);
