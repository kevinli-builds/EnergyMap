// Minimal, dependency-free .xlsx reader (just enough to import spreadsheet data).
// Handles the standard OOXML layout: a ZIP of XML parts with shared strings.
// Supports STORE + DEFLATE entries; no zip64 / encryption (not used by normal
// spreadsheet exports). Returns rows as arrays of strings/numbers.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// --- ZIP (read-only) -------------------------------------------------------
function unzip(buf) {
  const EOCD_SIG = 0x06054b50;
  const minStart = Math.max(0, buf.length - 65557); // max comment (65535) + EOCD (22)
  let eocd = -1;
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx/.zip file (no end-of-central-directory record).');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break; // central directory header
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    // Sizes/offsets in the central directory are authoritative; use the local
    // header only to find where the entry's data begins.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    files[name] = method === 8 ? inflateRawSync(comp) : Buffer.from(comp);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// --- XML helpers -----------------------------------------------------------
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? m;
  });
}

function collectText(fragment) {
  let text = '';
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let tm;
  while ((tm = tRe.exec(fragment))) text += tm[1];
  return decodeEntities(text);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) out.push(collectText(m[1]));
  return out;
}

function colToIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let autoCol = 0;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? null;
      const col = ref ? colToIndex(ref) : autoCol;
      autoCol = col + 1;
      let value = '';
      if (type === 'inlineStr') {
        value = collectText(body);
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        if (type === 's') value = shared[parseInt(raw, 10)] ?? '';
        else if (type === 'str') value = decodeEntities(raw);
        else value = raw === '' ? '' : Number(raw);
      }
      cells[col] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

function parseWorkbook(files) {
  const wb = files['xl/workbook.xml']?.toString('utf8') || '';
  const rels = files['xl/_rels/workbook.xml.rels']?.toString('utf8') || '';
  const relMap = {};
  const relRe = /<Relationship\b[^>]*\/?>/g;
  let r;
  while ((r = relRe.exec(rels))) {
    const id = /Id="([^"]+)"/.exec(r[0])?.[1];
    let target = /Target="([^"]+)"/.exec(r[0])?.[1];
    if (!id || !target) continue;
    target = target.replace(/^\.\//, '');
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    relMap[id] = target;
  }
  const sheets = [];
  const shRe = /<sheet\b[^>]*\/?>/g;
  let s;
  while ((s = shRe.exec(wb))) {
    const name = /name="([^"]*)"/.exec(s[0])?.[1];
    const rid = /r:id="([^"]*)"/.exec(s[0])?.[1];
    const file = relMap[rid];
    if (name && file && files[file]) sheets.push({ name, file });
  }
  return sheets;
}

/**
 * Read an .xlsx file.
 * @param {string} filePath
 * @param {{ sheet?: string }} [opts] - sheet name to read; defaults to the sheet
 *   with the most rows (i.e. the data sheet, skipping cover/README tabs).
 * @returns {{ sheetName: string, sheetNames: string[], rows: (string|number)[][] }}
 */
export function readXlsx(filePath, opts = {}) {
  const files = unzip(readFileSync(filePath));
  const shared = parseSharedStrings(files['xl/sharedStrings.xml']?.toString('utf8'));
  const sheets = parseWorkbook(files);
  if (!sheets.length) throw new Error('No worksheets found in the workbook.');

  let chosen;
  if (opts.sheet) {
    chosen = sheets.find((s) => s.name.toLowerCase() === String(opts.sheet).toLowerCase());
    if (!chosen) {
      throw new Error(`Sheet "${opts.sheet}" not found. Available sheets: ${sheets.map((s) => s.name).join(', ')}`);
    }
  } else {
    // Pick the largest data table by CELL count — this favours a real data sheet
    // (tens of columns wide) over a verbose "About"/cover tab (many rows, 1 column).
    chosen = sheets
      .map((s) => ({ ...s, cells: (files[s.file].toString('utf8').match(/<c[ >/]/g) || []).length }))
      .sort((a, b) => b.cells - a.cells)[0];
  }
  return {
    sheetName: chosen.name,
    sheetNames: sheets.map((s) => s.name),
    rows: parseSheet(files[chosen.file].toString('utf8'), shared),
  };
}
