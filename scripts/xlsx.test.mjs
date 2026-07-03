// Self-test for scripts/lib/xlsx.mjs. Builds a real .xlsx in memory (DEFLATE +
// shared strings + a cover sheet + a data sheet with a gapped column), then
// checks the reader parses it correctly. Run: npm run test:xlsx
import { deflateRawSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { readXlsx } from './lib/xlsx.mjs';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

// Minimal ZIP writer (DEFLATE) — mirrors the reader, to produce a valid .xlsx.
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data, 'utf8');
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

const strings = [
  'Project Name',
  'Capacity (MW)',
  'Status',
  'Country/Area',
  'Latitude',
  'Longitude',
  'Bhadla Solar Park',
  'operating',
  'India',
  'Cover — do not edit', // em dash exercises entity/unicode handling
];
const sharedStrings = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`;

const cover = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>9</v></c></row></sheetData></worksheet>`;
const dataSheet =
  `<worksheet><sheetData>` +
  `<row r="1">${[0, 1, 2, 3, 4, 5].map((i, n) => `<c r="${String.fromCharCode(65 + n)}1" t="s"><v>${i}</v></c>`).join('')}</row>` +
  `<row r="2"><c r="A2" t="s"><v>6</v></c><c r="B2"><v>2245</v></c><c r="C2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c><c r="E2"><v>27.54</v></c><c r="F2"><v>71.9</v></c></row>` +
  `<row r="3"><c r="A3" t="s"><v>6</v></c><c r="C3" t="s"><v>7</v></c></row>` + // gap at column B
  `</sheetData></worksheet>`;

const workbook = `<workbook xmlns:r="x"><sheets><sheet name="Cover" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const rels = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`;

const file = join(tmpdir(), `energymap-xlsx-test-${process.pid}.xlsx`);
writeFileSync(
  file,
  zip([
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/sharedStrings.xml', data: sharedStrings },
    { name: 'xl/worksheets/sheet1.xml', data: cover },
    { name: 'xl/worksheets/sheet2.xml', data: dataSheet },
  ])
);

// Default picks the data sheet (most rows), not the cover.
const res = readXlsx(file);
assert.equal(res.sheetName, 'Data', 'should auto-pick the sheet with the most rows');
assert.deepEqual(res.sheetNames, ['Cover', 'Data']);
assert.deepEqual(res.rows[0], ['Project Name', 'Capacity (MW)', 'Status', 'Country/Area', 'Latitude', 'Longitude']);
assert.equal(res.rows[1][0], 'Bhadla Solar Park');
assert.equal(res.rows[1][1], 2245); // numeric cell stays a number
assert.equal(res.rows[1][2], 'operating'); // shared string resolved
assert.equal(res.rows[1][4], 27.54);
assert.equal(res.rows[1][5], 71.9);
assert.equal(res.rows[2][1], '', 'gapped column B should be empty');
assert.equal(res.rows[2][2], 'operating', 'column C should survive the gap');

// Explicit sheet selection + unicode shared string.
const coverRes = readXlsx(file, { sheet: 'Cover' });
assert.equal(coverRes.rows[0][0], 'Cover — do not edit');

// Unknown sheet errors clearly.
assert.throws(() => readXlsx(file, { sheet: 'Nope' }), /not found/);

console.log('xlsx.test.mjs: all assertions passed ✓');
