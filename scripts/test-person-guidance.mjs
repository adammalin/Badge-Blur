import assert from "node:assert/strict";
import {
  candidateInsideTorso,
  torsoRegionForPerson,
} from "../src/person-guidance.js";

const region = torsoRegionForPerson(
  { x: 100, y: 50, width: 200, height: 500 },
  800,
  600,
);
assert.deepEqual(region, {
  left: 108,
  top: 85,
  width: 184,
  height: 320,
});
assert.equal(
  candidateInsideTorso(
    { x: 180, y: 220, width: 50, height: 70 },
    [region],
  ),
  true,
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
    { x: 275, y: 360, width: 60, height: 80 },
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
    backgroundSignRejected: true,
    partialOverlapRejected: true,
    noPersonFallbackPreserved: true,
  }),
);
