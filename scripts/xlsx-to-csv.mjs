// Convert an .xlsx sheet to CSV (no Excel needed).
//   node scripts/xlsx-to-csv.mjs <input.xlsx> [output.csv] [--sheet "Name"]
// Without --sheet, the sheet with the most rows is used. Defaults the output
// path to the input name with a .csv extension.
import { writeFileSync } from 'node:fs';
import { readXlsx } from './lib/xlsx.mjs';

const args = process.argv.slice(2);
let sheet;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sheet') sheet = args[++i];
  else positional.push(args[i]);
}
const input = positional[0];
if (!input) {
  console.error('Usage: node scripts/xlsx-to-csv.mjs <input.xlsx> [output.csv] [--sheet "Name"]');
  process.exit(1);
}
const output = positional[1] || input.replace(/\.xlsm?$/i, '') + '.csv';

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const { sheetName, rows } = readXlsx(input, sheet ? { sheet } : undefined);
writeFileSync(output, rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
console.log(`Wrote ${output} — ${rows.length} rows from sheet "${sheetName}".`);
