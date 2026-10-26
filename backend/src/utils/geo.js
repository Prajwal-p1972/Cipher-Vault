const EARTH_RADIUS_METERS = 6371008.8;

/**
 * Validates if latitude and longitude represent valid geographical coordinates.
 *
 * @param {number} lat - Latitude in degrees (-90 to +90)
 * @param {number} lng - Longitude in degrees (-180 to +180)
 * @returns {boolean} True if coordinates are valid numbers within range
 */
export function isValidCoord(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return false;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  if (lat < -90 || lat > 90) {
    return false;
  }
  if (lng < -180 || lng > 180) {
    return false;
  }
  return true;
}

/**
 * Computes great-circle distance between two geographical points using the Haversine formula.
 * Earth radius R = 6,371,008.8 meters.
 *
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lng1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lng2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  if (!isValidCoord(lat1, lng1) || !isValidCoord(lat2, lng2)) {
    throw new TypeError('Invalid coordinates provided to haversineMeters');
  }

  // Same point optimization and zero distance
  if (lat1 === lat2 && lng1 === lng2) {
    return 0;
  }

  const toRad = (deg) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lng2 - lng1);

  const sinDeltaPhi = Math.sin(deltaPhi / 2);
  const sinDeltaLambda = Math.sin(deltaLambda / 2);

  const a =
    sinDeltaPhi * sinDeltaPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda;

  // Clamp a to [0, 1] to guard against floating-point inaccuracies
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));

  return EARTH_RADIUS_METERS * c;
}
