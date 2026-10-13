/** Smooth value noise in [-1, 1]. */
export function noise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let fx = x - xi;
  let fy = y - yi;
  let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  return lerp(
    lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), fx), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), fx), fy),
    lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), fx), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), fx), fy),
    fz,
  );
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Lattice hash in [-1, 1). */
function h(i: number, j: number, k: number): number {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
}
