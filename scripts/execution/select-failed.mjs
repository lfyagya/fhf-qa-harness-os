#!/usr/bin/env node
/**
 * select-failed.mjs — build a SPEC_PATTERN from failed specs (JUnit or Cloud JSON).
 *
 * Usage:
 *   node scripts/execution/select-failed.mjs --junit reports/junit/merged.xml
 *   node scripts/execution/select-failed.mjs --from-json failed-tests.json
 *   cy-cloud test list --projectId nptdoe --runNumber 666 --status failed --limit 100 \
 *     | node scripts/execution/select-failed.mjs --from-json -
 *
 * Output (default): comma-separated unique spec paths for CodeBuild SPEC_PATTERN.
 *   --json   machine-readable { specs, count }
 *   --lines  one spec per line
 *
 * Does not call the network. Pipe Cloud CLI JSON in when needed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const out = { junit: null, fromJson: null, format: 'csv' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--junit') out.junit = argv[++i];
    else if (a === '--from-json') out.fromJson = argv[++i];
    else if (a === '--json') out.format = 'json';
    else if (a === '--lines') out.format = 'lines';
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

export function specsFromJUnit(xml) {
  const specs = new Set();
  for (const block of xml.split(/<testsuite\b/i).slice(1)) {
    const failures = Number(block.match(/\bfailures="(\d+)"/i)?.[1] || 0);
    const errors = Number(block.match(/\berrors="(\d+)"/i)?.[1] || 0);
    if (failures < 1 && errors < 1) continue;
    const file = block.match(/\bfile="([^"]+\.cy\.js)"/i)?.[1];
    if (file) specs.add(file.replace(/\\/g, '/'));
  }
  if (specs.size === 0) {
    // Fallback: any .cy.js file= attribute when the document has failures at suite root
    for (const m of xml.matchAll(/\bfile="([^"]+\.cy\.js)"/g)) specs.add(m[1].replace(/\\/g, '/'));
  }
  return [...specs].sort();
}

export function specsFromCloudJson(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const tests = data.tests || data.data || (Array.isArray(data) ? data : []);
  const specs = new Set();
  for (const t of tests) {
    const p = t.specPath || t.spec || t.file || t.specRelative || t?.spec?.relative;
    if (typeof p === 'string' && p.endsWith('.cy.js')) specs.add(p.replace(/\\/g, '/'));
  }
  return [...specs].sort();
}

function readInput(path) {
  if (path === '-') return readFileSync(0, 'utf8');
  return readFileSync(resolve(path), 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.junit && !args.fromJson)) {
    process.stdout.write(`select-failed.mjs — SPEC_PATTERN from failed specs

  --junit <file.xml>     JUnit / merged JUnit
  --from-json <file|->   cy-cloud test list JSON (or stdin with -)
  --json | --lines       output format (default: comma-separated)
`);
    process.exit(args.help ? 0 : 2);
  }

  let specs = [];
  if (args.junit) specs = specsFromJUnit(readInput(args.junit));
  else specs = specsFromCloudJson(readInput(args.fromJson));

  if (args.format === 'json') {
    process.stdout.write(`${JSON.stringify({ count: specs.length, specs }, null, 2)}\n`);
  } else if (args.format === 'lines') {
    process.stdout.write(specs.map((s) => `${s}\n`).join(''));
  } else {
    process.stdout.write(`${specs.join(',')}\n`);
  }
  process.exit(specs.length ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
