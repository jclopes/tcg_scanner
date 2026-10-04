import type { Matrix3x3, Quad, Size } from "./types";

/** The homography mapping `corners` onto an `outputSize` rectangle's corners.
 * Throws for a degenerate quad. */
export function computePerspectiveTransform(corners: Quad, outputSize: Size): Matrix3x3 {
  const { width, height } = outputSize;
  const targets = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  // With h22 = 1, each corner (x, y) → (u, v) gives two linear equations in
  // the other 8 entries: u = (h00·x + h01·y + h02) / (h20·x + h21·y + 1), and
  // likewise v with h10, h11, h12.
  const rows: number[][] = [];
  const rhs: number[] = [];
  corners.forEach(({ x, y }, i) => {
    const { x: u, y: v } = targets[i]!;
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    rhs.push(v);
  });
  const [h00, h01, h02, h10, h11, h12, h20, h21] = solveLinearSystem(rows, rhs);
  return [
    [h00!, h01!, h02!],
    [h10!, h11!, h12!],
    [h20!, h21!, 1],
  ];
}

/** Solves `a · x = b` by Gaussian elimination with partial pivoting. Throws
 * if `a` is singular. */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) {
        pivot = row;
      }
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) {
      throw new Error("Degenerate quad: it has no perspective transform.");
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let row = col + 1; row < n; row++) {
      const factor = m[row]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k++) {
        m[row]![k]! -= factor * m[col]![k]!;
      }
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row]![n]!;
    for (let k = row + 1; k < n; k++) {
      sum -= m[row]![k]! * x[k]!;
    }
    x[row] = sum / m[row]![row]!;
  }
  return x;
}
