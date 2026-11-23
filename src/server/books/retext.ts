/**
 * Ένωση δύο αναγνώσεων μιας σκαναρισμένης σελίδας: οι λέξεις του OCR των Windows έχουν θέση (x, y, μέγεθος) αλλά
 * συχνά λάθος κείμενο («Came lD» = Game 1, «es» = e5, «dl» = d1, κινήσεις που λείπουν)· το μοντέλο (VLM, `vlm.ts`)
 * δίνει σχεδόν σωστό κείμενο, χωρίς θέσεις, και τα σύμβολα των κομματιών όλα ως ένα («⚓c4», «🦷xd2»).
 *
 * Οι λέξεις του μοντέλου στοιχίζονται με του OCR (Needleman–Wunsch στη σειρά ανάγνωσης, με ομοιότητα γραμμάτων) και
 * παίρνουν τη θέση τους· όσες δεν έχουν ζευγάρι μπαίνουν ανάμεσα στους γείτονές τους. Σε κίνηση με σύμβολο κρατιέται
 * το «σκουπίδι» του OCR («Oc4», «lLlc4»): είναι διαφορετικό για κάθε κομμάτι, και ο αναλυτής μαθαίνει ποιο είναι.
 */
import type { Item } from './diagrams.ts';

/** κλειδί σύγκρισης: πεζά γράμματα και ψηφία */
const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return prev[b.length];
}

const sim = (a: string, b: string) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);

/** Οι λέξεις του μοντέλου, με τη γραμμή τους (χωρίς σημάδια markdown/HTML). */
export function vlmTokens(text: string): Array<{ s: string; line: number }> {
  const out: Array<{ s: string; line: number }> = [];
  text.split('\n').forEach((raw, line) => {
    const l = raw
      .replace(/<[^>]*>/g, ' ')
      .replace(/\*\*|__|`|\$/g, '')
      .replace(/^\s*#+\s*/, '')
      .replace(/^\s*[-*]\s+/, '');
    for (const s of l.split(/\s+/)) if (s) out.push({ s, line });
  });
  return out;
}

/** κίνηση του μοντέλου με σύμβολο κομματιού (όχι ASCII) πριν από το τετράγωνο: αριθμός, σύμβολο, υπόλοιπο */
const VLM_PIECE_RE = /^(\d{1,3}\.{0,3})?([^\x00-\x7F]{1,3})(x?[a-h]?[1-8]?x?[a-h][1-8].*)$/u;
/** η ίδια κίνηση στο OCR: αριθμός, «σκουπίδι», υπόλοιπο (με το ψηφίο ίσως ως γράμμα: «Xfel») */
const OCR_PIECE_RE = /^(\d{1,3}\.{0,3})?(\S{1,5}?)(x?[a-h]?[1-8]?x?[a-h][1-8lIS?].*)$/;

/** Το κείμενο της λέξης: του μοντέλου, με το σύμβολο του OCR όπου αυτό διάβασε κάτι στη θέση του. */
function tokenText(v: string, w: string | null): string {
  const mv = VLM_PIECE_RE.exec(v);
  if (!mv) return v;
  const mw = w ? OCR_PIECE_RE.exec(w) : null;
  // (όχι μόνο γράμμα στήλης, «hf3»: θα έμοιαζε με κίνηση πιονιού)
  if (mw?.[2] && !/^[a-h]$/.test(mw[2]) && !/^\d+\.*$/.test(mw[2]) && !/^[.…]+$/.test(mw[2])) return (mv[1] ?? '') + mw[2] + mv[3];
  return v;
}

/**
 * Οι λέξεις της σελίδας με το κείμενο του μοντέλου. `words`: του OCR, με τη σειρά του (γραμμή-γραμμή). Αν το μοντέλο
 * δεν έδωσε σχεδόν τίποτα, μένουν όπως ήταν.
 */
export function retext(words: Item[], text: string): Item[] {
  const V = vlmTokens(text);
  if (V.length < 5 || words.length < 5) return words;

  // γραμμές του OCR (διαδοχικές λέξεις στο ίδιο ύψος, προς τα δεξιά)
  const runs: Item[][] = [];
  for (const w of words) {
    const r = runs[runs.length - 1];
    const last = r?.[r.length - 1];
    // (όχι πάνω από μεγάλο κενό: δύο στήλες στο ίδιο ύψος είναι δύο γραμμές)
    if (last && Math.abs(last.y - w.y) < Math.max(last.size, w.size) * 0.5 && w.x > last.x - last.size && w.x - (last.x + last.w) < Math.max(last.size, w.size) * 2.5) r.push(w);
    else runs.push([w]);
  }
  // σειρά των γραμμών όπως τις διαβάζει το μοντέλο: από λέξεις που υπάρχουν μία φορά και στις δύο αναγνώσεις
  const vk = V.map((t) => keyOf(t.s));
  const count = (ks: string[]) => ks.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const vc = count(vk);
  const wc = count(words.map((w) => keyOf(w.str)));
  const vAt = new Map(vk.map((k, i) => [k, i]));
  const order = runs.map((r) => {
    const at = r.map((w) => keyOf(w.str)).filter((k) => k.length >= 3 && vc.get(k) === 1 && wc.get(k) === 1).map((k) => vAt.get(k)!);
    return at.length ? at.sort((a, b) => a - b)[at.length >> 1] : NaN;
  });
  // τα όρια κάθε γραμμής: λέξεις χωρίς ζευγάρι δεν βγαίνουν έξω από αυτά (θα πήδαγαν στην άλλη στήλη και οι δύο
  // γραμμές θα γίνονταν μία)
  const edge = runs.map((r) => [Math.min(...r.map((w) => w.x)), Math.max(...r.map((w) => w.x + w.w))]);
  const overlap = (a: number, b: number) => Math.min(edge[a][1], edge[b][1]) - Math.max(edge[a][0], edge[b][0]) > 0;
  // γραμμές χωρίς τέτοια λέξη («2 Oc6»): αμέσως μετά την πιο κοντινή από πάνω στην ίδια στήλη που έχει θέση (αλλιώς
  // πριν από την πιο κοντινή από κάτω)· η σειρά του OCR των Windows πηγαίνει συχνά από στήλη σε στήλη. Σε στήλη χωρίς
  // καμία τέτοια γραμμή: με τη σειρά ανάγνωσης της σελίδας (αριστερή στήλη από πάνω προς τα κάτω, μετά η δεξιά)
  const fixed = order.map((o) => !Number.isNaN(o));
  for (let i = 0; i < runs.length; i++) {
    if (fixed[i]) continue;
    const y = runs[i][0].y;
    let above = -1;
    let below = -1;
    for (let k = 0; k < runs.length; k++) {
      if (!fixed[k] || !overlap(i, k)) continue;
      const d = runs[k][0].y - y;
      if (d > 0 && (above < 0 || d < runs[above][0].y - y)) above = k;
      if (d < 0 && (below < 0 || d > runs[below][0].y - y)) below = k;
    }
    if (above >= 0 || below >= 0) order[i] = above >= 0 ? order[above] + (runs[above][0].y - y) * 1e-5 : order[below] - (y - runs[below][0].y) * 1e-5;
  }
  const midX = (Math.min(...edge.map((e) => e[0])) + Math.max(...edge.map((e) => e[1]))) / 2;
  const col = (i: number) => (edge[i][0] >= midX - runs[i][0].size * 2 ? 1 : 0);
  const geo = runs.map((_, i) => i).sort((a, b) => col(a) - col(b) || runs[b][0].y - runs[a][0].y || edge[a][0] - edge[b][0]);
  let last = -1;
  let k0 = 0;
  for (const i of geo) {
    if (!Number.isNaN(order[i])) {
      last = order[i];
      k0 = 0;
    } else order[i] = last + ++k0 * 1e-4;
  }
  const idx = runs.map((_, i) => i).sort((a, b) => order[a] - order[b] || a - b);
  const W = idx.flatMap((i) => runs[i].map((w) => ({ w, run: i })));
  const wk = W.map((x) => keyOf(x.w.str));

  // στοίχιση (Needleman–Wunsch): ταίριασμα με ομοιότητα, κενό με ποινή
  const n = V.length;
  const m = W.length;
  const GAP = -0.35;
  const score = new Float32Array((n + 1) * (m + 1));
  const step = new Uint8Array((n + 1) * (m + 1)); // 1 διαγώνια, 2 κενό στο OCR (λέξη μόνο του μοντέλου), 3 κενό στο μοντέλο
  for (let i = 1; i <= n; i++) {
    score[i * (m + 1)] = i * GAP;
    step[i * (m + 1)] = 2;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP;
    step[j] = 3;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = sim(vk[i - 1], wk[j - 1]);
      // (σημεία στίξης μόνο: «...», «—»: ίσα αν είναι ίδια)
      const pair = !vk[i - 1] && !wk[j - 1] ? (V[i - 1].s === W[j - 1].w.str ? 0.3 : -0.3) : s >= 0.3 ? 2 * s - 0.8 : -0.55;
      const d = score[(i - 1) * (m + 1) + j - 1] + pair;
      const up = score[(i - 1) * (m + 1) + j] + GAP;
      const left = score[i * (m + 1) + j - 1] + GAP;
      const k = i * (m + 1) + j;
      if (d >= up && d >= left) {
        score[k] = d;
        step[k] = 1;
      } else if (up >= left) {
        score[k] = up;
        step[k] = 2;
      } else {
        score[k] = left;
        step[k] = 3;
      }
    }
  }
  const pairOf = new Int32Array(n).fill(-1);
  const pairedRuns = new Set<number>();
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const s = step[i * (m + 1) + j];
    if (s === 1) {
      pairOf[i - 1] = j - 1;
      pairedRuns.add(W[j - 1].run);
      i--;
      j--;
    } else if (s === 2) i--;
    else j--;
  }

  // θέσεις: του ζευγαριού, αλλιώς ανάμεσα στους γείτονες (στην ίδια γραμμή), αλλιώς αμέσως μετά/πριν από αυτούς
  const out: Item[] = [];
  const runOf: number[] = new Array(n).fill(-1);
  const placed: Array<Item | null> = V.map((t, i) => {
    const j = pairOf[i];
    if (j < 0) return null;
    const b = W[j].w;
    runOf[i] = W[j].run;
    return { str: tokenText(t.s, b.str), x: b.x, y: b.y, w: b.w, size: b.size, font: b.font };
  });
  /** η πιο κοντινή γραμμή του OCR πάνω (`dir` = 1) ή κάτω (-1) από τη `r`, στην ίδια στήλη */
  const nearest = (r: number, dir: 1 | -1) => {
    let best = -1;
    for (let k = 0; k < runs.length; k++) {
      const d = (runs[k][0].y - runs[r][0].y) * dir;
      if (k !== r && d > 0 && overlap(r, k) && (best < 0 || d < (runs[best][0].y - runs[r][0].y) * dir)) best = k;
    }
    return best;
  };
  /** κενό για νέες γραμμές: πάνω από τη γραμμή `before`, αλλιώς κάτω από την `after` (πάνω, κάτω, αριστερά, γείτονας) */
  const lineSlot = (before: number, after: number): [number, number, number, Item] | null => {
    for (const [r, dir] of [[before, 1], [after, -1]] as Array<[number, 1 | -1]>) {
      if (r < 0) continue;
      const ref = runs[r][0];
      const o = nearest(r, dir);
      // (χωρίς γραμμή από πάνω/κάτω: ως μιάμιση γραμμή πιο πέρα)
      const far = o >= 0 ? runs[o][0].y : ref.y + dir * ref.size * 3;
      if (Math.abs(far - ref.y) > ref.size * 1.6) return dir === 1 ? [far, ref.y, edge[r][0], ref] : [ref.y, far, edge[r][0], ref];
    }
    return null;
  };
  let slot: [number, number, number, Item] | null = null;
  for (let i = 0; i < n; ) {
    if (placed[i]) {
      i++;
      continue;
    }
    let e = i;
    while (e < n && !placed[e]) e++;
    const a = i > 0 ? placed[i - 1] : null;
    const b = e < n ? placed[e] : null;
    const gap = V.slice(i, e);
    const chars = gap.reduce((s, t) => s + t.s.length + 1, 0);
    if (a && b && Math.abs(a.y - b.y) < a.size * 0.4 && b.x > a.x + a.w) {
      // ανάμεσα στους δύο, στην ίδια γραμμή
      let x = a.x + a.w;
      const unit = (b.x - x) / Math.max(chars, 1);
      for (let k = i; k < e; k++) {
        const w = V[k].s.length * unit;
        // (στριμωγμένη: με κενό μπροστά, αλλιώς θα κολλούσε στην προηγούμενη λέξη, «1e4»)
        placed[k] = { str: (unit < a.size * 0.25 ? ' ' : '') + tokenText(V[k].s, null), x: x + unit * 0.5, y: a.y, w, size: a.size, font: a.font };
        x += w + unit;
      }
    } else if ((i === 0 || V[i].line !== V[i - 1].line) && (e === n || V[e].line !== V[e - 1].line) && (slot = lineSlot(b ? runOf[e] : -1, a ? runOf[i - 1] : -1))) {
      // ολόκληρες γραμμές του μοντέλου που λείπουν από το OCR («4 ... cxd4», «3 ♘c3»): νέες γραμμές στο κενό πάνω από
      // την επόμενη (ή κάτω από την προηγούμενη) γραμμή, στην ίδια στήλη· στριμωγμένες στη γραμμή του γείτονα θα
      // γίνονταν κομμάτι άλλης παραγράφου
      const [top, bottom, left, ref] = slot;
      const lines = [...new Set(gap.map((t) => t.line))];
      const unit = ref.w / Math.max(ref.str.length, 1);
      lines.forEach((ln, li) => {
        const y = top - ((top - bottom) * (li + 1)) / (lines.length + 1);
        let x = left;
        for (let k = i; k < e; k++) {
          if (V[k].line !== ln) continue;
          const w = V[k].s.length * unit;
          placed[k] = { str: tokenText(V[k].s, null), x, y, w, size: ref.size, font: ref.font };
          x += w + unit;
        }
      });
    } else if (a || b) {
      // στο τέλος της γραμμής του προηγούμενου (αν είναι η ίδια γραμμή του μοντέλου), αλλιώς στην αρχή του επόμενου
      const after = Boolean(a && (!b || V[i].line === V[i - 1].line));
      const ref = after ? a! : b!;
      const [left, right] = edge[runOf[after ? i - 1 : e]];
      // (όσο χωρά ως την άκρη της γραμμής· αλλιώς στριμωγμένες, με τη σειρά τους)
      const room = after ? right - (a!.x + a!.w) : ref.x - left;
      const unit = Math.max(0.01, Math.min(ref.w / Math.max(ref.str.length, 1), room / (chars + 1)));
      let x = after ? a!.x + a!.w + unit : ref.x - (chars + 1) * unit;
      for (let k = i; k < e; k++) {
        const w = V[k].s.length * unit;
        placed[k] = { str: (unit < ref.size * 0.25 ? ' ' : '') + tokenText(V[k].s, null), x, y: ref.y, w, size: ref.size, font: ref.font };
        x += w + unit;
      }
    }
    i = e;
  }
  for (const p of placed) if (p) out.push(p);
  // γραμμές του OCR που το μοντέλο δεν διάβασε καθόλου (π.χ. «W»/«B» δίπλα στο διάγραμμα, αριθμοί σελίδων): μένουν
  runs.forEach((r, i) => {
    if (!pairedRuns.has(i)) out.push(...r);
  });
  return out;
}
