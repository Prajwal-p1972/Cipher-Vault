import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCoord, haversineMeters } from '../src/utils/geo.js';

describe('Geographical Coordinates and Haversine Distance Tests', () => {
  it('returns 0 for the exact same point', () => {
    const lat = 37.7749;
    const lng = -122.4194;
    assert.strictEqual(haversineMeters(lat, lng, lat, lng), 0);
  });

  it('computes 1 degree of latitude ~ 111.19 km (+/- 0.5%)', () => {
    const d = haversineMeters(0, 0, 1, 0);
    const expected = 111194.9; // meters
    const diffRatio = Math.abs(d - expected) / expected;
    assert.ok(diffRatio <= 0.005, `1 deg lat distance ${d} should be within 0.5% of ${expected}`);
  });

  it('guarantees symmetry: haversineMeters(p1, p2) === haversineMeters(p2, p1)', () => {
    const p1 = [40.7128, -74.006];
    const p2 = [51.5074, -0.1278];
    const d1 = haversineMeters(p1[0], p1[1], p2[0], p2[1]);
    const d2 = haversineMeters(p2[0], p2[1], p1[0], p1[1]);
    assert.strictEqual(d1, d2);
  });

  it('computes antipodal points ~ 20015 km', () => {
    const d = haversineMeters(90, 0, -90, 0);
    const expected = 20015114.4; // half circumference = R * pi
    assert.ok(Math.abs(d - expected) < 1, `Antipodal distance was ${d}, expected ~ ${expected}`);
  });

  it('validates coordinates correctly with isValidCoord', () => {
    assert.strictEqual(isValidCoord(0, 0), true);
    assert.strictEqual(isValidCoord(90, 180), true);
    assert.strictEqual(isValidCoord(-90, -180), true);
    assert.strictEqual(isValidCoord(90.1, 0), false);
    assert.strictEqual(isValidCoord(-90.1, 0), false);
    assert.strictEqual(isValidCoord(0, 180.1), false);
    assert.strictEqual(isValidCoord(0, -180.1), false);
    assert.strictEqual(isValidCoord(NaN, 0), false);
    assert.strictEqual(isValidCoord(0, Infinity), false);
    assert.strictEqual(isValidCoord('0', 0), false);
    assert.strictEqual(isValidCoord(null, undefined), false);
  });

  it('rejects invalid coordinates with TypeError in haversineMeters', () => {
    assert.throws(() => haversineMeters(95, 0, 0, 0), TypeError);
    assert.throws(() => haversineMeters(0, 200, 0, 0), TypeError);
    assert.throws(() => haversineMeters(0, 0, -95, 0), TypeError);
    assert.throws(() => haversineMeters(0, 0, 0, -200), TypeError);
    assert.throws(() => haversineMeters('0', 0, 0, 0), TypeError);
  });
});
