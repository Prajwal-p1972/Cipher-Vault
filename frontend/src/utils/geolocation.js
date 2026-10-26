/**
 * Promisified browser geolocation helper with high accuracy constraints.
 * Rejects with standardized error codes: 'denied' | 'unavailable' | 'timeout' | 'unsupported'.
 *
 * @returns {Promise<{ lat: number, lng: number, accuracyMeters: number }>}
 */
export function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const err = new Error('Geolocation is not supported by this browser environment');
      err.code = 'unsupported';
      return reject(err);
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy
        });
      },
      (error) => {
        let code = 'unavailable';
        let message = 'Unable to determine geographical location';

        switch (error.code) {
          case 1: // PERMISSION_DENIED
            code = 'denied';
            message = 'Location permission was denied. Please enable location permissions.';
            break;
          case 2: // POSITION_UNAVAILABLE
            code = 'unavailable';
            message = 'Location position is currently unavailable.';
            break;
          case 3: // TIMEOUT
            code = 'timeout';
            message = 'Location request timed out. Please try again.';
            break;
          default:
            code = 'unavailable';
            message = error.message || 'Geographical location error.';
        }

        const err = new Error(message);
        err.code = code;
        reject(err);
      },
      options
    );
  });
}

export default getCurrentLocation;
