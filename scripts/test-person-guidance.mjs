import assert from "node:assert/strict";
import {
  candidateLooksLikeCroppedForeground,
  candidateInsideTorso,
  torsoRegionForPerson,
} from "../src/person-guidance.js";

const region = torsoRegionForPerson(
  { x: 100, y: 50, width: 200, height: 500 },
  800,
  600,
);
assert.deepEqual(region, {
  left: 110,
  top: 65,
  width: 180,
  height: 470,
});
assert.equal(
  candidateInsideTorso(
    { x: 180, y: 220, width: 50, height: 70 },
    [region],
  ),
  true,
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
  true,
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
  true,
);

console.log(
  JSON.stringify({
    tightTorsoRegion: true,
    torsoBadgeRetained: true,
    hangingLanyardBadgeRetained: true,
    croppedForegroundBadgeRetained: true,
    backgroundSignRejected: true,
    partialOverlapRejected: true,
    noPersonFallbackPreserved: true,
  }),
);
