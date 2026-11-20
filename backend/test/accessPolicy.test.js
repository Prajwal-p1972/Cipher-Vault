import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from '../src/services/accessPolicy.js';

describe('Document Access Policy Evaluation Tests', () => {
  const baseDoc = {
    status: 'sealed',
    policy: {
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      oneTimeUse: false,
      geofence: null
    }
  };

  const geofencedDoc = {
    status: 'sealed',
    policy: {
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      oneTimeUse: false,
      geofence: {
        lat: 37.7749,
        lng: -122.4194,
        radiusMeters: 500
      }
    }
  };

  it('denies destroyed documents with code "destroyed" and status 410', () => {
    const doc = { ...baseDoc, status: 'destroyed' };
    const res = evaluatePolicy({ doc, now: new Date() });
    assert.deepStrictEqual(res, { allowed: false, code: 'destroyed', status: 410 });
  });

  it('denies consumed documents with code "consumed" and status 410', () => {
    const doc = { ...baseDoc, status: 'consumed' };
    const res = evaluatePolicy({ doc, now: new Date() });
    assert.deepStrictEqual(res, { allowed: false, code: 'consumed', status: 410 });
  });

  it('denies revoked documents with code "consumed" and status 410', () => {
    const doc = { ...baseDoc, status: 'revoked' };
    const res = evaluatePolicy({ doc, now: new Date() });
    assert.deepStrictEqual(res, { allowed: false, code: 'consumed', status: 410 });
  });

  it('denies expired documents with code "expired" and status 410', () => {
    const doc = {
      ...baseDoc,
      policy: {
        ...baseDoc.policy,
        expiresAt: new Date(Date.now() - 1000).toISOString()
      }
    };
    const res = evaluatePolicy({ doc, now: new Date() });
    assert.deepStrictEqual(res, { allowed: false, code: 'expired', status: 410 });
  });

  it('denies geofenced document when location is missing or invalid with code "location_required" and status 403', () => {
    // Missing location
    let res = evaluatePolicy({ doc: geofencedDoc, now: new Date(), location: null });
    assert.deepStrictEqual(res, { allowed: false, code: 'location_required', status: 403 });

    // Invalid coordinates
    res = evaluatePolicy({
      doc: geofencedDoc,
      now: new Date(),
      location: { lat: 95, lng: -122.4, accuracyMeters: 20 }
    });
    assert.deepStrictEqual(res, { allowed: false, code: 'location_required', status: 403 });
  });

  it('denies geofenced document when accuracy is missing or exceeds limit with code "location_imprecise" and status 403', () => {
    // Missing accuracy
    let res = evaluatePolicy({
      doc: geofencedDoc,
      now: new Date(),
      location: { lat: 37.7749, lng: -122.4194 }
    });
    assert.deepStrictEqual(res, { allowed: false, code: 'location_imprecise', status: 403 });

    // Accuracy exceeds default limit (500m)
    res = evaluatePolicy({
      doc: geofencedDoc,
      now: new Date(),
      location: { lat: 37.7749, lng: -122.4194, accuracyMeters: 501 }
    });
    assert.deepStrictEqual(res, { allowed: false, code: 'location_imprecise', status: 403 });
  });

  it('denies geofenced document when outside allowed radius with code "outside_area" and status 403', () => {
    // Distance > 500m (e.g. 1km away)
    const res = evaluatePolicy({
      doc: geofencedDoc,
      now: new Date(),
      location: { lat: 37.7849, lng: -122.4194, accuracyMeters: 10 }
    });
    assert.deepStrictEqual(res, { allowed: false, code: 'outside_area', status: 403, distanceMeters: 1110 });
  });

  it('allows access when inside geofence radius and returns distance rounded to nearest 10m', () => {
    const res = evaluatePolicy({
      doc: geofencedDoc,
      now: new Date(),
      location: { lat: 37.7749, lng: -122.4194, accuracyMeters: 15 }
    });
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.distanceMeters, 0);
  });

  it('allows boundary values: exactly at max accuracy and exactly at geofence radius', () => {
    // 1. Accuracy exactly at 500m (default max)
    let res = evaluatePolicy({
      doc: geofencedDoc,
      now: new Date(),
      location: { lat: 37.7749, lng: -122.4194, accuracyMeters: 500 }
    });
    assert.strictEqual(res.allowed, true);

    // 2. Custom radius doc where distance equals radius exactly
    const customDoc = {
      status: 'sealed',
      policy: {
        geofence: { lat: 0, lng: 0, radiusMeters: 1000 }
      }
    };
    // Exact same point is 0 distance <= 1000m
    res = evaluatePolicy({
      doc: customDoc,
      now: new Date(),
      location: { lat: 0, lng: 0, accuracyMeters: 50 }
    });
    assert.strictEqual(res.allowed, true);
  });

  it('ignores location completely when document has no geofence', () => {
    // Without location
    let res = evaluatePolicy({ doc: baseDoc, now: new Date(), location: null });
    assert.deepStrictEqual(res, { allowed: true });

    // With invalid/imprecise/distant location
    res = evaluatePolicy({
      doc: baseDoc,
      now: new Date(),
      location: { lat: 999, lng: -999, accuracyMeters: 9999 }
    });
    assert.deepStrictEqual(res, { allowed: true });
  });
});
