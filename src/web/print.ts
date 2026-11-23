/** Εκτύπωση παρτίδας (σημειογραφία + διάγραμμα) μέσω του διαλόγου εκτύπωσης του browser. */
import type { Game, GameNode } from '../core/game.ts';
import { isMoveNag, isPrefixNag, nagSymbol } from '../core/nag.ts';
import { displaySan, type NotationStyle } from './components/Notation.tsx';
import { L, language } from './i18n.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function moveHtml(game: Game, n: GameNode, force: boolean, style: NotationStyle): string {
  const white = n.whiteMoved(game.startTurn);
  const num = n.moveNumber(game.startFullmove, game.startTurn);
  const label = white ? `${num}.` : force ? `${num}...` : '';
  const nags = n.nags.filter(isMoveNag).map(nagSymbol).join('');
  const pos = n.nags.filter((g) => !isMoveNag(g) && !isPrefixNag(g)).map(nagSymbol).join(' ');
  const pre = n.nags.filter(isPrefixNag).map(nagSymbol).join(' ');
  let s = '';
  if (n.preComment) s += `<span class="c">${esc(n.preComment)}</span> `;
  if (pre) s += `<span class="n">${pre}</span> `;
  s += `<span class="${n.isMainline() ? 'm' : 'v'}">${label}${esc(displaySan(n.san, style))}${nags}</span>`;
  if (pos) s += ` <span class="n">${pos}</span>`;
  if (n.comment) s += ` <span class="c">${esc(n.comment)}</span>`;
  return s + ' ';
}

function lineHtml(game: Game, parent: GameNode, force: boolean, style: NotationStyle, depth: number): string {
  let s = '';
  let n = parent;
  let f = force;
  while (n.children.length) {
    const main = n.children[0];
    s += moveHtml(game, main, f, style);
    f = Boolean(main.comment);
    if (n.children.length > 1) {
      s += `<div class="vars d${Math.min(depth + 1, 4)}">`;
      for (const alt of n.children.slice(1)) s += `<div>(${moveHtml(game, alt, true, style)}${lineHtml(game, alt, Boolean(alt.comment), style, depth + 1)})</div>`;
      s += '</div>';
      f = true;
    }
    n = main;
  }
  return s;
}

export function printGame(game: Game, style: NotationStyle, diagramSvg: string | null): void {
  const h = game.headers;
  const title = `${h.White ?? '?'} – ${h.Black ?? '?'}`;
  const meta = [h.Event, h.Site, h.Date, h.Round && h.Round !== '?' ? `${L('γύρος', 'round')} ${h.Round}` : '', h.ECO]
    .filter((x) => x && x !== '?' && x !== '????.??.??')
    .join(' · ');
  const elo = (e?: string) => (e ? ` (${e})` : '');
  const html = `<!doctype html><html lang="el"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;margin:28px;color:#111}
h1{font-size:19px;margin:0 0 4px}
.meta{color:#555;font-size:13px;margin-bottom:14px}
.diagram{width:300px;float:right;margin:0 0 14px 18px}
.diagram svg{width:100%;height:auto}
.moves{font-size:13.5px;line-height:1.65}
.m{font-weight:600}
.c{color:#2e5d3a}
.n{color:#1f5aa6}
.vars{margin:2px 0 4px 14px;font-size:12.5px;color:#333}
.vars .m{font-weight:400}
.res{font-weight:700;margin-left:6px}
@media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(h.White ?? '?')}${esc(elo(h.WhiteElo))} – ${esc(h.Black ?? '?')}${esc(elo(h.BlackElo))} <span class="res">${esc((h.Result ?? '').replace('1/2-1/2', '½-½'))}</span></h1>
<div class="meta">${esc(meta)}</div>
${diagramSvg ? `<div class="diagram">${diagramSvg}</div>` : ''}
<div class="moves">${game.root.comment ? `<p class="c">${esc(game.root.comment)}</p>` : ''}${lineHtml(game, game.root, true, style, 0)}<span class="res">${esc((h.Result ?? '').replace('1/2-1/2', '½-½'))}</span></div>
<script>setTimeout(function(){window.print()},300)</script>
</body></html>`;
  openPrint(html);
}

function openPrint(html: string): void {
  const w = window.open('', '_blank', 'width=820,height=1000');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/**
 * Φύλλο σημειογραφίας (όπως τα έντυπα των αγώνων): στοιχεία της παρτίδας, στήλες των 30
 * κινήσεων (τουλάχιστον 60) με τις κινήσεις της κύριας γραμμής και υπογραφές.
 */
export function printScoresheet(game: Game, style: NotationStyle): void {
  const h = game.headers;
  const moves = new Map<number, [string, string]>();
  for (const n of game.mainline()) {
    const num = n.moveNumber(game.startFullmove, game.startTurn);
    const row = moves.get(num) ?? ['', ''];
    row[n.whiteMoved(game.startTurn) ? 0 : 1] = displaySan(n.san, style);
    moves.set(num, row);
  }
  const first = game.startFullmove;
  const last = Math.max(first + 59, ...moves.keys());
  const cols: string[] = [];
  for (let a = first; a <= last; a += 30) {
    let rows = '';
    for (let k = a; k < a + 30; k++) {
      const [w, b] = moves.get(k) ?? ['', ''];
      rows += `<tr><td class="n">${k}</td><td>${esc(w)}</td><td>${esc(b)}</td></tr>`;
    }
    cols.push(`<table class="sheet"><thead><tr><th></th><th>${L('Λευκά', 'White')}</th><th>${L('Μαύρα', 'Black')}</th></tr></thead><tbody>${rows}</tbody></table>`);
  }
  const v = (x?: string) => esc(x && x !== '?' && x !== '????.??.??' ? x : '');
  const field = (label: string, value: string) => `<td><span>${label}</span><b>${value}</b></td>`;
  const html = `<!doctype html><html lang="${language()}"><head><meta charset="utf-8"><title>${esc(L('Φύλλο σημειογραφίας', 'Scoresheet'))}</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;margin:24px;color:#111}
h1{font-size:18px;margin:0 0 10px;text-align:center;letter-spacing:.5px}
.hdr{width:100%;border-collapse:collapse;margin-bottom:12px}
.hdr td{border:1px solid #444;padding:4px 6px;font-size:13px;width:33%}
.hdr span{display:block;font-size:10px;color:#555}
.hdr b{display:block;min-height:17px}
.cols{display:flex;flex-wrap:wrap;gap:14px}
.sheet{border-collapse:collapse;flex:1;min-width:300px;font-size:13px}
.sheet th,.sheet td{border:1px solid #444;height:21px;padding:0 6px}
.sheet th{background:#eee;font-size:12px}
.sheet td.n{width:26px;text-align:right;color:#555;background:#f6f6f6}
.sign{display:flex;justify-content:space-between;margin-top:22px;font-size:12px}
.sign div{width:42%;border-top:1px solid #444;padding-top:4px}
@media print{body{margin:10mm}}
</style></head><body>
<h1>${esc(L('ΦΥΛΛΟ ΣΗΜΕΙΟΓΡΑΦΙΑΣ', 'SCORESHEET'))}</h1>
<table class="hdr">
<tr>${field(L('Τουρνουά', 'Event'), v(h.Event))}${field(L('Τόπος', 'Site'), v(h.Site))}${field(L('Ημερομηνία / γύρος', 'Date / round'), [v(h.Date), v(h.Round)].filter(Boolean).join(' · '))}</tr>
<tr>${field(L('Λευκά', 'White'), [v(h.White), v(h.WhiteElo)].filter(Boolean).join(' · '))}${field(L('Μαύρα', 'Black'), [v(h.Black), v(h.BlackElo)].filter(Boolean).join(' · '))}${field(L('Αποτέλεσμα', 'Result'), esc(h.Result && h.Result !== '*' ? h.Result.replace('1/2-1/2', '½-½') : ''))}</tr>
</table>
<div class="cols">${cols.join('')}</div>
<div class="sign"><div>${esc(L('Υπογραφή λευκών', 'White’s signature'))}</div><div>${esc(L('Υπογραφή μαύρων', 'Black’s signature'))}</div></div>
<script>setTimeout(function(){window.print()},300)</script>
</body></html>`;
  openPrint(html);
}
