export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Spreadsheet applications may interpret untrusted text as a formula.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) && typeof value !== "number") text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function utcDateRange(start: string, end: string): { start: string; end: string } | null {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
  };
  const first = parse(start), last = parse(end) + 86400_000;
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first || last - first > 366 * 86400_000) return null;
  return { start: new Date(first).toISOString(), end: new Date(last).toISOString() };
}
