export type AlisaAiVisibilityMetrics = {
  query_count: number;
  mentions: number;
  citations: number;
  presence_rate: number;
  total_source_citations: number;
  zaruku_source_citations: number;
  citation_concentration: number;
};

export type AlisaAiVisibilityAnalysis = {
  metrics: AlisaAiVisibilityMetrics;
  missing_queries: Array<{
    query: string;
    alisa_answer_url: string;
  }>;
  zaruku_urls: Array<{
    url: string;
    citation_count: number;
    query_count: number;
    queries: string[];
  }>;
  competitor_source_domains: Array<{
    domain: string;
    citation_count: number;
    query_count: number;
    representative_urls: string[];
  }>;
  validation: {
    errors: string[];
    rows_checked: number;
    presence_source_consistency_checks: number;
  };
};

export type AlisaAiVisibilityWorkbookResult = {
  source: {
    path: string;
    filename: string;
    sha256: string;
    filename_timestamp: string;
    sheet_name: string;
  };
  analysis: AlisaAiVisibilityAnalysis;
};

type UrlAggregate = {
  citationCount: number;
  queries: Set<string>;
};

type DomainAggregate = UrlAggregate & {
  urls: Set<string>;
};

const requiredHeaders = [
  "Запрос",
  "Присутствует сайт",
  "Ответ в Алисе AI",
] as const;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeAlisaQuery(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ");
}

function parsePresence(value: unknown, rowNumber: number): boolean {
  if (typeof value === "boolean") return value;
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid presence value at row ${rowNumber}: ${cleanString(value) || "<blank>"}`);
}

function normalizeHttpUrl(value: unknown, rowNumber: number, label: string): {
  url: string;
  hostname: string;
} {
  const raw = cleanString(value);
  if (!raw) throw new Error(`Missing ${label} at row ${rowNumber}`);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid ${label} at row ${rowNumber}: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${label} protocol at row ${rowNumber}: ${parsed.protocol}`);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
  parsed.hostname = hostname;
  return { url: parsed.toString(), hostname };
}

function headerIndex(headers: string[], name: string): number {
  const indexes = headers.flatMap((value, index) => value === name ? [index] : []);
  if (!indexes.length) throw new Error(`Missing required header: ${name}`);
  if (indexes.length > 1) throw new Error(`Duplicate required header: ${name}`);
  return indexes[0];
}

function siteColumnIndexes(headers: string[]): number[] {
  const columns = headers.flatMap((value, index) => {
    const match = /^Сайт\s+(\d+)$/u.exec(value);
    return match ? [{ index, number: Number(match[1]) }] : [];
  });
  if (!columns.length) throw new Error("Missing source headers: expected Сайт 1");
  columns.sort((left, right) => left.number - right.number);
  for (let index = 0; index < columns.length; index += 1) {
    const expectedNumber = index + 1;
    if (columns[index].number !== expectedNumber) {
      throw new Error(`Non-consecutive source headers: expected Сайт ${expectedNumber}`);
    }
  }
  return columns.map((column) => column.index);
}

export function parseAlisaVisibilityRows(matrix: unknown[][]): AlisaAiVisibilityAnalysis {
  if (!Array.isArray(matrix) || !matrix.length) {
    throw new Error("Workbook has no rows");
  }
  const headers = matrix[0].map(cleanString);
  for (const header of requiredHeaders) headerIndex(headers, header);
  const queryIndex = headerIndex(headers, "Запрос");
  const presenceIndex = headerIndex(headers, "Присутствует сайт");
  const answerIndex = headerIndex(headers, "Ответ в Алисе AI");
  const sourceIndexes = siteColumnIndexes(headers);
  const duplicateHeaders = new Set<string>();
  headers.forEach((header, index) => {
    if (header && headers.indexOf(header) !== index) duplicateHeaders.add(header);
  });
  if (duplicateHeaders.size) {
    throw new Error(`Duplicate header: ${[...duplicateHeaders].sort(compareStrings)[0]}`);
  }

  const rows = matrix.slice(1).filter((row) => row.some((value) => cleanString(value)));
  if (!rows.length) throw new Error("Workbook has no query rows");

  const seenQueries = new Map<string, number>();
  const missingQueries: AlisaAiVisibilityAnalysis["missing_queries"] = [];
  const zarukuUrls = new Map<string, UrlAggregate>();
  const externalDomains = new Map<string, DomainAggregate>();
  let mentions = 0;
  let totalSourceCitations = 0;
  let zarukuSourceCitations = 0;

  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const query = cleanString(row[queryIndex]);
    if (!query) throw new Error(`Missing query at row ${rowNumber}`);
    const normalizedQuery = normalizeAlisaQuery(query);
    const duplicateRow = seenQueries.get(normalizedQuery);
    if (duplicateRow) {
      throw new Error(`Duplicate normalized query at rows ${duplicateRow} and ${rowNumber}: ${query}`);
    }
    seenQueries.set(normalizedQuery, rowNumber);

    const present = parsePresence(row[presenceIndex], rowNumber);
    const answer = normalizeHttpUrl(row[answerIndex], rowNumber, "Alice answer URL");
    let rowZarukuCitations = 0;

    for (const sourceIndex of sourceIndexes) {
      if (!cleanString(row[sourceIndex])) continue;
      const source = normalizeHttpUrl(row[sourceIndex], rowNumber, headers[sourceIndex]);
      totalSourceCitations += 1;
      if (source.hostname === "zaruku.ru") {
        rowZarukuCitations += 1;
        zarukuSourceCitations += 1;
        const aggregate = zarukuUrls.get(source.url) ?? {
          citationCount: 0,
          queries: new Set<string>(),
        };
        aggregate.citationCount += 1;
        aggregate.queries.add(query);
        zarukuUrls.set(source.url, aggregate);
      } else {
        const aggregate = externalDomains.get(source.hostname) ?? {
          citationCount: 0,
          queries: new Set<string>(),
          urls: new Set<string>(),
        };
        aggregate.citationCount += 1;
        aggregate.queries.add(query);
        aggregate.urls.add(source.url);
        externalDomains.set(source.hostname, aggregate);
      }
    }

    if (present !== (rowZarukuCitations > 0)) {
      throw new Error(
        `Presence/source mismatch at row ${rowNumber}: present=${present}, zaruku_sources=${rowZarukuCitations}`
      );
    }
    if (present) mentions += 1;
    else missingQueries.push({ query, alisa_answer_url: answer.url });
  });

  const zarukuUrlEvidence = [...zarukuUrls.entries()]
    .map(([url, aggregate]) => ({
      url,
      citation_count: aggregate.citationCount,
      query_count: aggregate.queries.size,
      queries: [...aggregate.queries].sort(compareStrings),
    }))
    .sort((left, right) => right.citation_count - left.citation_count || compareStrings(left.url, right.url));
  const competitorSourceDomains = [...externalDomains.entries()]
    .map(([domain, aggregate]) => ({
      domain,
      citation_count: aggregate.citationCount,
      query_count: aggregate.queries.size,
      representative_urls: [...aggregate.urls].sort(compareStrings).slice(0, 10),
    }))
    .sort((left, right) => right.citation_count - left.citation_count || compareStrings(left.domain, right.domain));
  const queryCount = rows.length;
  const topZarukuCitationCount = zarukuUrlEvidence[0]?.citation_count ?? 0;

  return {
    metrics: {
      query_count: queryCount,
      mentions,
      citations: queryCount,
      presence_rate: Number((mentions / queryCount).toFixed(4)),
      total_source_citations: totalSourceCitations,
      zaruku_source_citations: zarukuSourceCitations,
      citation_concentration: zarukuSourceCitations
        ? Number((topZarukuCitationCount / zarukuSourceCitations).toFixed(4))
        : 0,
    },
    missing_queries: missingQueries,
    zaruku_urls: zarukuUrlEvidence,
    competitor_source_domains: competitorSourceDomains,
    validation: {
      errors: [],
      rows_checked: queryCount,
      presence_source_consistency_checks: queryCount,
    },
  };
}

function filenameTimestamp(filename: string): string {
  const match = /^neurostatistics-zaruku\.ru-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.xlsx$/u.exec(
    filename
  );
  if (!match) {
    throw new Error(
      `Invalid workbook filename: expected neurostatistics-zaruku.ru-YYYYMMDD-HHmmss.xlsx, received ${filename}`
    );
  }
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function plainCellValue(value: CellValue): unknown {
  if (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value ?? null;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text;
  }
  if (typeof value === "object" && "result" in value) {
    return value.result ?? null;
  }
  return String(value);
}

export async function readAlisaAiVisibilityWorkbook(
  filePath: string
): Promise<AlisaAiVisibilityWorkbookResult> {
  const absolutePath = resolve(filePath);
  const filename = basename(absolutePath);
  const capturedFromFilename = filenameTimestamp(filename);
  const bytes = await readFile(absolutePath);
  const workbook = new Workbook();
  await workbook.xlsx.readFile(absolutePath);
  const sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 0);
  if (!sheet) throw new Error("Workbook has no non-empty worksheets");
  const columnCount = sheet.getRow(1).cellCount;
  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    for (let column = 1; column <= columnCount; column += 1) {
      values.push(plainCellValue(row.getCell(column).value));
    }
    matrix.push(values);
  });
  return {
    source: {
      path: absolutePath,
      filename,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      filename_timestamp: capturedFromFilename,
      sheet_name: sheet.name,
    },
    analysis: parseAlisaVisibilityRows(matrix),
  };
}
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { basename, resolve } from "path";
import { Workbook, type CellValue } from "exceljs";
