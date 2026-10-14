import type { AddInput } from "./pipeline";

/** RFC 4180-ish CSV: quoted fields, "" escapes, commas/newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(body);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === "\"") {
        if (body[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === "\"" && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (char === sep) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((cells) => cells.map((cell) => cell.trim())).filter((cells) => cells.some((cell) => cell !== ""));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((sep) => ({ sep, count: firstLine.split(sep).length - 1 }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].sep : ",";
}

const URL_HEADERS = ["website", "url", "domain", "site", "homepage", "web", "website url", "company website", "company url", "company domain", "link"];
const DOMAINISH = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:[/?#].*)?$/i;

export function looksLikeUrl(value: string): boolean {
  return DOMAINISH.test(value.trim()) && !value.includes("@");
}

export type CsvLeads = { inputs: AddInput[]; skipped: Array<{ row: number; reason: string }>; urlColumn?: string };

/**
 * Turns CSV rows into lead inputs. Uses --url-column when given, else a header named website/url/
 * domain/…, else a headerless single-column list of domains. Every other column is kept in lead.input.
 */
export function csvToLeads(text: string, options: { urlColumn?: string } = {}): CsvLeads {
  const rows = parseCsv(text);
  if (rows.length === 0) return { inputs: [], skipped: [] };
  const header = rows[0].map((cell) => cell.toLowerCase().replace(/\s+/g, " ").trim());
  let urlIndex = -1;
  if (options.urlColumn) {
    urlIndex = header.indexOf(options.urlColumn.toLowerCase().trim());
    if (urlIndex < 0) throw new Error(`column "${options.urlColumn}" not found; columns are: ${rows[0].join(", ")}`);
  } else {
    for (const name of URL_HEADERS) {
      urlIndex = header.indexOf(name);
      if (urlIndex >= 0) break;
    }
  }
  const skipped: CsvLeads["skipped"] = [];
  if (urlIndex < 0) {
    // No recognizable header: accept a bare list of domains (first column that looks like one).
    const column = rows[0].findIndex(looksLikeUrl);
    if (column < 0) throw new Error(`no website column found; pass --url-column (columns: ${rows[0].join(", ")})`);
    const inputs: AddInput[] = [];
    rows.forEach((row, index) => {
      const value = row[column] ?? "";
      if (looksLikeUrl(value)) inputs.push(value);
      else skipped.push({ row: index + 1, reason: `not a URL: ${value || "(empty)"}` });
    });
    return { inputs, skipped };
  }
  const names = rows[0];
  const inputs: AddInput[] = [];
  rows.slice(1).forEach((row, index) => {
    const value = (row[urlIndex] ?? "").trim();
    if (!looksLikeUrl(value)) {
      skipped.push({ row: index + 2, reason: `not a URL: ${value || "(empty)"}` });
      return;
    }
    const input: Record<string, string> = {};
    names.forEach((name, column) => {
      if (column !== urlIndex && name && row[column] !== undefined && row[column] !== "") input[name] = row[column];
    });
    inputs.push({ url: value, input });
  });
  return { inputs, skipped, urlColumn: names[urlIndex] };
}
