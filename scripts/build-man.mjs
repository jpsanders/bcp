#!/usr/bin/env node
// Build man/bcp.1 from docs/MANUAL.md, the one source for `bcp guide`, `bcp man` and `man bcp`.
//
//   node scripts/build-man.mjs           write man/bcp.1
//   node scripts/build-man.mjs --check   exit 1 when man/bcp.1 is out of date
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROG = 'bcp';

const escape = (text) => text.replace(/\\/g, '\\e');

function inline(text) {
  const out = text
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
        return `\\fB${escape(part.slice(1, -1)).replace(/-/g, '\\-')}\\fR`;
      }
      return escape(part)
        .replace(/\*\*([^*]+)\*\*/g, '\\fB$1\\fR')
        .replace(/\*([^*]+)\*/g, '\\fI$1\\fR')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    })
    .join('');
  return /^[.']/.test(out) ? `\\&${out}` : out;
}

export function toRoff(markdown) {
  const out = [`.TH ${PROG.toUpperCase()} 1 "" "${PROG}" "User Commands"`];
  const para = [];
  let inCode = false;
  let inTable = false;
  const flush = () => {
    if (para.length) {
      out.push('.PP', inline(para.join(' ')));
      para.length = 0;
    }
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      flush();
      out.push(...(inCode ? ['.fi', '.RE'] : ['.RS 4', '.nf']));
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      const text = escape(line).replace(/-/g, '\\-');
      out.push(/^[.']/.test(text) ? `\\&${text}` : text);
      continue;
    }
    if (line.startsWith('<!--') || line.startsWith('# ')) continue;
    if (line.startsWith('## ')) {
      flush();
      out.push(`.SH ${line.slice(3).toUpperCase()}`);
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      out.push(`.SS ${inline(line.slice(4))}`);
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (/^[\s-]*$/.test(cells.join(''))) continue;
      if (!inTable) {
        inTable = true;
        continue;
      }
      out.push('.TP', inline(cells[0]), inline(cells.slice(1).join(' ')));
      continue;
    }
    inTable = false;
    if (line.startsWith('- ')) {
      flush();
      out.push('.IP \\(bu 2', inline(line.slice(2)));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return `${out.join('\n')}\n`.replace(/\.SH NAME\n\.PP\n(\S+) \\?- /, '.SH NAME\n$1 \\- ');
}

function main() {
  const manual = readFileSync(path.join(root, 'docs', 'MANUAL.md'), 'utf-8');
  const target = path.join(root, 'man', `${PROG}.1`);
  const page = toRoff(manual);
  if (process.argv.includes('--check')) {
    if (!existsSync(target) || readFileSync(target, 'utf-8') !== page) {
      process.stderr.write('out of date: man/bcp.1 (run: npm run man)\n');
      process.exitCode = 1;
    }
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, page);
  process.stdout.write(`wrote ${path.relative(root, target)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
