/** Τυφλή λύση: η θέση ως λίστα κομματιών (χωρίς σκακιέρα), στη σημειογραφία του χρήστη. */
import { Position, squareName } from '../../core/chess.ts';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { displaySan, type NotationStyle } from '../sanText.ts';

const ORDER = [6, 5, 4, 3, 2, 1];
const LETTER = ' PNBRQK';

/** Τα κομμάτια μιας πλευράς: «Ρg1, Βd1, Πa1, Πf1, Ιf3» και τα πιόνια χωριστά («a2 b2 c3»). */
export function pieceList(fen: string, color: 0 | 1, style: NotationStyle): { pieces: string; pawns: string } {
  const pos = Position.fromFen(fen);
  const by: Record<number, string[]> = {};
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = pos.board[sq];
    if (!p || p >> 3 !== color) continue;
    (by[p & 7] ??= []).push(squareName(sq));
  }
  const pieces: string[] = [];
  for (const t of ORDER) {
    if (t === 1) continue;
    for (const s of (by[t] ?? []).sort()) pieces.push(displaySan(LETTER[t] + s, style));
  }
  return { pieces: pieces.join(', '), pawns: (by[1] ?? []).sort().join(' ') };
}

/** Η θέση σε λέξεις για τη λύση χωρίς σκακιέρα. */
export function BlindPosition({ fen, style: given }: { fen: string; style?: NotationStyle }) {
  const ui = useApp((s) => s.settings?.ui);
  const style: NotationStyle = given ?? ((ui?.notation as NotationStyle | undefined) ?? 'figurine');
  const w = pieceList(fen, 0, style);
  const b = pieceList(fen, 1, style);
  const turn = fen.split(' ')[1] === 'b' ? L('Παίζουν τα μαύρα', 'Black to move') : L('Παίζουν τα λευκά', 'White to move');
  return (
    <div className="blind-pos" role="group" aria-label={L('Η θέση χωρίς σκακιέρα', 'The position without a board')}>
      <div className="blind-row">
        <span className="side w" aria-hidden />
        <b>{L('Λευκά', 'White')}</b>
        <span className="blind-p">{w.pieces}</span>
        {w.pawns && <span className="faint blind-pawns">{L(`πιόνια ${w.pawns}`, `pawns ${w.pawns}`)}</span>}
      </div>
      <div className="blind-row">
        <span className="side b" aria-hidden />
        <b>{L('Μαύρα', 'Black')}</b>
        <span className="blind-p">{b.pieces}</span>
        {b.pawns && <span className="faint blind-pawns">{L(`πιόνια ${b.pawns}`, `pawns ${b.pawns}`)}</span>}
      </div>
      <div className="faint blind-turn">{turn} · {L('γράψε την κίνηση στο πεδίο (π.χ. Ιf3, Nf3, g1f3)', 'type the move in the field (e.g. Nf3, g1f3)')}</div>
    </div>
  );
}
