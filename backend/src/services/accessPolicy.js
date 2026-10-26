import { env } from '../config/env.js';
import { isValidCoord, haversineMeters } from '../utils/geo.js';

/**
 * Pure policy evaluation engine gating access to sealed documents.
 * Evaluates document status, expiration timestamp, and physical geofence boundaries in strict order.
 *
 * @param {{
 *   doc: object,
 *   now?: Date|number,
 *   location?: { lat: number, lng: number, accuracyMeters: number }|null
 * }} params
 * @param {{ maxAccuracyMeters?: number }} [options={}]
 * @returns {{ allowed: boolean, code?: string, status?: number, distanceMeters?: number }}
 */
export function evaluatePolicy({ doc, now = new Date(), location }, options = {}) {
  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const maxAccuracy =
    options.maxAccuracyMeters ?? env.GEO_MAX_ACCURACY_METERS ?? 500;

  // a) Document status is 'consumed' or 'revoked'
  if (doc?.status === 'consumed' || doc?.status === 'revoked') {
    return { allowed: false, code: 'consumed', status: 410 };
  }

  // b) Access policy expired
  if (doc?.policy?.expiresAt) {
    const expiresTime = new Date(doc.policy.expiresAt).getTime();
    if (!Number.isNaN(expiresTime) && expiresTime <= currentTime) {
      return { allowed: false, code: 'expired', status: 410 };
    }
  }

  // Check if geofence is configured
  const geofence = doc?.policy?.geofence;
  const hasGeofence =
    geofence &&
    geofence.lat !== null &&
    geofence.lat !== undefined &&
    geofence.lng !== null &&
    geofence.lng !== undefined &&
    typeof geofence.radiusMeters === 'number' &&
    geofence.radiusMeters > 0;

  if (hasGeofence) {
    // c) Geofence set and location missing or invalid
    if (
      !location ||
      typeof location !== 'object' ||
      !isValidCoord(location.lat, location.lng)
    ) {
      return { allowed: false, code: 'location_required', status: 403 };
    }

    // d) Geofence set and accuracyMeters missing, invalid, or exceeds threshold
    if (
      typeof location.accuracyMeters !== 'number' ||
      !Number.isFinite(location.accuracyMeters) ||
      location.accuracyMeters < 0 ||
      location.accuracyMeters > maxAccuracy
    ) {
      return { allowed: false, code: 'location_imprecise', status: 403 };
    }

    // e) Geofence set and haversine distance exceeds allowed radius
    const distance = haversineMeters(
      geofence.lat,
      geofence.lng,
      location.lat,
      location.lng
    );

    if (distance > geofence.radiusMeters) {
      return { allowed: false, code: 'outside_area', status: 403 };
    }

    // f) Allowed with rounded distance (rounded to nearest 10 meters, for audit only)
    const distanceMeters = Math.round(distance / 10) * 10;
    return { allowed: true, distanceMeters };
  }

  // Geofence not set: location parameters are ignored
  return { allowed: true };
}
