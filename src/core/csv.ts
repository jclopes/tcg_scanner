// Pure CSV formatting (RFC 4180).

/** `rows` under `header` as CSV text, CRLF line endings. A field containing a
 * comma, quote or line break is quoted, with inner quotes doubled. */
export function formatCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
