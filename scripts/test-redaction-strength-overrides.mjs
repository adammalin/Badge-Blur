import assert from "node:assert/strict";
import {
  normalizeRedactionStrength,
  redactionStrengthRecord,
  resolveRedactionStrength,
} from "../shared/redaction-strength.js";

assert.equal(normalizeRedactionStrength(null), null);
assert.equal(normalizeRedactionStrength(""), null);
assert.equal(normalizeRedactionStrength("8"), 8);
assert.equal(normalizeRedactionStrength(1), 2);
assert.equal(normalizeRedactionStrength(20), 12);
assert.equal(resolveRedactionStrength(null, 4), 4);
assert.equal(resolveRedactionStrength(9, 4), 9);
assert.equal(resolveRedactionStrength("invalid", "invalid"), 3);

const serializedMask = JSON.parse(
  JSON.stringify({
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    ...redactionStrengthRecord({ redactionStrength: 11 }),
  }),
);
assert.equal(serializedMask.redactionStrength, 11);
assert.equal(
  resolveRedactionStrength(serializedMask.redactionStrength, 3),
  11,
);

console.log(
  JSON.stringify({
    passed: true,
    defaultStrengthInherited: true,
    overrideClamped: true,
    overrideRoundTrips: true,
  }),
);
