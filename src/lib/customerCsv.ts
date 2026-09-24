export const CUSTOMER_IMPORT_MAX_BYTES = 128 * 1024;
export const CUSTOMER_IMPORT_MAX_ROWS = 100;
export const CUSTOMER_IMPORT_MAX_COLUMNS = 20;

export type ParsedCustomerCsv = {
  headers: string[];
  rows: string[][];
};

/** Parse a small RFC-4180-style CSV file without executing formulas or markup. */
export function parseCustomerCsv(text: string): ParsedCustomerCsv {
  if (new TextEncoder().encode(text).byteLength > CUSTOMER_IMPORT_MAX_BYTES) {
    throw new Error("CSV must be 128 KB or smaller.");
  }
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      if (rows.length > CUSTOMER_IMPORT_MAX_ROWS + 1) {
        throw new Error(
          `CSV can contain at most ${CUSTOMER_IMPORT_MAX_ROWS} contacts.`,
        );
      }
    } else cell += char;
    if (cell.length > CUSTOMER_IMPORT_MAX_BYTES)
      throw new Error("CSV contains an oversized field.");
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  if (rows.length < 2)
    throw new Error("Add a header row and at least one contact.");
  if (rows.length - 1 > CUSTOMER_IMPORT_MAX_ROWS) {
    throw new Error(
      `CSV can contain at most ${CUSTOMER_IMPORT_MAX_ROWS} contacts.`,
    );
  }

  const headers = rows[0].map((header) => header.trim());
  if (headers.length > CUSTOMER_IMPORT_MAX_COLUMNS) {
    throw new Error(
      `CSV can contain at most ${CUSTOMER_IMPORT_MAX_COLUMNS} columns.`,
    );
  }
  if (headers.some((header) => !header))
    throw new Error("Every CSV column needs a header.");
  if (rows.slice(1).some((values) => values.length > headers.length)) {
    throw new Error("Every contact row must match the CSV header columns.");
  }
  if (
    new Set(headers.map((header) => header.toLowerCase())).size !==
    headers.length
  ) {
    throw new Error("CSV headers must be unique, ignoring letter case.");
  }
  return { headers, rows: rows.slice(1) };
}

export function normalizeCustomerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidCustomerEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
