/** Sphere maths shared by the hazard collectors. */

export const EARTH_RADIUS_KM = 6371;

export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Destination point `distanceKm` from `center` along `bearingDeg` (0 = north), used to run a storm's movement vector forward. */
export function destinationPoint(center, bearingDeg, distanceKm) {
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = rad(bearingDeg);
  const lat1 = rad(center.lat);
  const lon1 = rad(center.lon);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lon: deg(lon2), lat: deg(lat2) };
}

export const round3 = (value) => Number(value.toFixed(3));
