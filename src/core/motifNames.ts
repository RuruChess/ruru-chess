/** Τα ονόματα των τακτικών μοτίβων στις εξηγήσεις: ίδια με τα ελληνικά θέματα του εκπαιδευτή τακτικής (src/data/puzzle-themes.json). */

/*
 * Ο πυρήνας δεν διαβάζει αρχεία, οπότε τα ονόματα γράφονται εδώ με το γένος και την αιτιατική τους
 * (το JSON δίνει μόνο την ονομαστική). Το tests/core/motifNames.test.ts ελέγχει ότι κάθε όνομα είναι
 * το ίδιο με το `el` του puzzle-themes.json (πεζά, χωρίς άρθρο, το πρώτο μέρος πριν από « – »).
 * Μόνο η «υπερφόρτωση» δεν υπάρχει στα θέματα των puzzles.
 */
export interface MotifName {
  /** ονομαστική χωρίς άρθρο, όπως στον εκπαιδευτή («κάρφωμα», «εκτροπή») */
  el: string;
  /** αιτιατική με άρθρο («το κάρφωμα», «την εκτροπή») */
  acc: string;
  /** αγγλικά, με άρθρο («the pin») */
  en: string;
  /** ταιριάζει το «η κίνηση είναι <όνομα>» (αλλιώς μένει μόνο η περιγραφή) */
  named: boolean;
}

/** Μοτίβα που δεν υπάρχουν στα θέματα των puzzles. */
export const NON_LICHESS_MOTIFS: readonly string[] = ['overloading'];

export const MOTIF_NAMES: Record<string, MotifName> = {
  fork: { el: 'πιρούνι', acc: 'το πιρούνι', en: 'the fork', named: true },
  pin: { el: 'κάρφωμα', acc: 'το κάρφωμα', en: 'the pin', named: true },
  skewer: { el: 'σούβλα', acc: 'τη σούβλα', en: 'the skewer', named: true },
  discoveredAttack: { el: 'αποκάλυψη', acc: 'την αποκάλυψη', en: 'the discovered attack', named: true },
  discoveredCheck: { el: 'σαχ με αποκάλυψη', acc: 'το σαχ με αποκάλυψη', en: 'the discovered check', named: true },
  doubleCheck: { el: 'διπλό σαχ', acc: 'το διπλό σαχ', en: 'the double check', named: false },
  hangingPiece: { el: 'αφύλακτο κομμάτι', acc: 'το αφύλακτο κομμάτι', en: 'the hanging piece', named: false },
  trappedPiece: { el: 'παγιδευμένο κομμάτι', acc: 'το παγιδευμένο κομμάτι', en: 'the trapped piece', named: false },
  deflection: { el: 'εκτροπή', acc: 'την εκτροπή', en: 'the deflection', named: true },
  attraction: { el: 'έλξη', acc: 'την έλξη', en: 'the attraction', named: true },
  overloading: { el: 'υπερφόρτωση', acc: 'την υπερφόρτωση', en: 'the overloading', named: false },
  interference: { el: 'παρεμβολή', acc: 'την παρεμβολή', en: 'the interference', named: true },
  clearance: { el: 'εκκένωση', acc: 'την εκκένωση', en: 'the clearance', named: true },
  intermezzo: { el: 'ενδιάμεση κίνηση', acc: 'την ενδιάμεση κίνηση', en: 'the in-between move', named: false },
  capturingDefender: { el: 'κατάργηση της άμυνας', acc: 'την κατάργηση της άμυνας', en: 'capturing the defender', named: false },
  sacrifice: { el: 'θυσία', acc: 'τη θυσία', en: 'the sacrifice', named: true },
  promotion: { el: 'προαγωγή', acc: 'την προαγωγή', en: 'the promotion', named: false },
  underPromotion: { el: 'υποπροαγωγή', acc: 'την υποπροαγωγή', en: 'the underpromotion', named: false },
  zugzwang: { el: 'τσούγκτσβανγκ', acc: 'το τσούγκτσβανγκ', en: 'the zugzwang', named: false },
};

/** Ονόματα σχημάτων ματ (στην παρένθεση μετά το ματ), όπως στον εκπαιδευτή. */
export const MATE_NAMES: Record<string, { el: string; en: string }> = {
  backRankMate: { el: 'ματ τελευταίας γραμμής', en: 'a back-rank mate' },
  smotheredMate: { el: 'ματ αποπνιγμού', en: 'a smothered mate' },
  anastasiaMate: { el: 'ματ της Αναστασίας', en: "Anastasia's mate" },
  hookMate: { el: 'ματ με αγκίστρι', en: 'a hook mate' },
  arabianMate: { el: 'αραβικό ματ', en: 'an Arabian mate' },
  bodenMate: { el: 'ματ του Boden', en: "Boden's mate" },
  doubleBishopMate: { el: 'ματ με δύο αξιωματικούς', en: 'a double-bishop mate' },
  dovetailMate: { el: 'ματ «ουρά περιστεριού»', en: 'a dovetail mate' },
};
