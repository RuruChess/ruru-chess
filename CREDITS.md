# Πηγές και άδειες

Το Ruru Chess είναι GPL-3.0-or-later ([LICENSE](LICENSE)), με μέρη AGPL-3.0 ([κείμενο](licenses/AGPL-3.0.txt)).
Ο συνδυασμός επιτρέπεται από το §13 των δύο αδειών και κάθε μέρος κρατά τη δική του. Οι ειδοποιήσεις και τα
πλήρη κείμενα τρίτων είναι στο [licenses/NOTICES.txt](licenses/NOTICES.txt).

| Τι | Από | Άδεια |
|---|---|---|
| Λογότυπο (`Ruru.ico`, `public/icon.png`) | Σχέδιο του δημιουργού του Ruru Chess: η αρχική εικόνα φτιάχτηκε με το Google Gemini μόνο από γραπτή περιγραφή και ο δημιουργός τη διόρθωσε σε πρόγραμμα επεξεργασίας (ασπίδα, κόψιμο) | του δημιουργού· η Google δεν διεκδικεί την κυριότητα ([Όροι Google](https://policies.google.com/terms)) |
| Κομμάτια «Cburnett» (`public/pieces/cburnett`) | Colin M.L. Burnett | GPLv2+ |
| Κομμάτια «Merida» (`public/pieces/merida`) | Armando Hernandez Marroquin | GPLv2+ |
| Ονόματα ανοιγμάτων ECO (`src/data/openings.tsv`) | ανοιχτά δεδομένα | CC0 1.0 |
| Τεκμηρίωση μορφής ChessBase (.cbh/.cbg/.cba/.cbp/.cbt) | [asdfjkl/cbh2pgn](https://github.com/asdfjkl/cbh2pgn) (Dominik Klein) και [itshak/cbvault](https://github.com/itshak/cbvault) | MIT |
| Μορφή βάσεων Scid 4 (.si4/.sn4/.sg4): ευρετήριο, ονόματα, σχόλια, κωδικοποίηση κινήσεων και λίστες κομματιών, από τα οποία προέρχεται το `src/server/formats/scid.ts` (τροποποιήθηκε 2026-11-16 έως 2026-11-22) | [Scid](https://github.com/benini/scid): Shane Hudson (1999-2003), Pascal Georges (2006-2009), Fulvio Benini (2014-2017) και συνεργάτες (`codec_scid4.cpp`, `game.cpp`, `position.cpp`, `bytebuf.h`) | `bytebuf.h`: MIT. Τα άλλα: GPL χωρίς αριθμό έκδοσης στις κεφαλίδες· το §9 του COPYING (GPLv2) επιτρέπει τότε και την v3, που χρησιμοποιούμε. Δεν το έχουν επιβεβαιώσει οι δημιουργοί του Scid, που αλλού γράφουν «GPL-2.0» |
| Περιγραφή της μορφής .cbv (μπλοκ, LZ, Huffman), από την οποία γράφτηκε το `src/server/formats/cbv.ts` | [itshak/cbvault](https://github.com/itshak/cbvault) (`cbvault-format`, γραμμένο κι αυτό από δημοσιευμένα στοιχεία, χωρίς κώδικα της ChessBase) | MIT |
| 7-Zip για .7z/.zip (`7zip-bin`) | Igor Pavlov / develar | LGPL / MIT |
| Ήχοι κινήσεων «Ξύλο» (`public/sounds/wood`): πακέτο «Chess Puzzle Blitz SFX» | [el_boss](https://freesound.org/people/el_boss/packs/30764/) (Freesound) | CC0 1.0 |
| Ήχοι κινήσεων «Πιάνο» και «Ρετρό» (`public/sounds/piano`, `nes`) | [Enigmahack](https://github.com/Enigmahack), από το [lila](https://github.com/lichess-org/lila) | AGPL-3.0-or-later (συνδυάζεται με τη GPLv3, §13) |
| Node.js, μέσα στον εγκαταστάτη και στη φορητή έκδοση (`node\`) | OpenJS Foundation και συντελεστές | MIT κ.ά. (`node\LICENSE`) |
| Inno Setup (εγκαταστάτης, `installer/Ruru.iss`) | Jordan Russell, Martijn Laan | Άδεια Inno Setup |
| Ελληνική μετάφραση του Inno Setup (`installer/Greek.isl`) | Anastasis Chatzioglou, XhmikosR, Vasileios Karamichail | Όπως το Inno Setup |
| React, Vite, TanStack Virtual, Zustand, Lucide | αντίστοιχοι δημιουργοί | MIT / ISC |
| Τακτική: εκπαιδευτής puzzles, βαθμός Glicko-2, επανάληψη, γρήγοροι γύροι και κύκλοι, θέματα και ονόματα μοτίβων (`src/server/tactics`, `src/web/tactics`, `src/core/puzzle.ts`, `glicko2.ts`, `motifNames.ts`, `src/web/sounds.ts`) | Λάζαρος Μπατσής | GPL-3.0-or-later, εκτός από τα μέρη των επόμενων γραμμών |
| Μέρη μεταφρασμένα σε TypeScript και τροποποιημένα (ημερομηνίες στην κεφαλίδα κάθε αρχείου): έλεγχος απάντησης και στόχοι εξάσκησης (`src/core/puzzle.ts`), κανόνες και όρια βαθμού (`src/core/glicko2.ts`), πίνακας επιδόσεων, επιλογή puzzles, ρυθμίσεις Storm (`src/server/tactics/dashboard.ts`, `select.ts`, `index.ts`), τύποι πιθανότητας νίκης και ακρίβειας (`src/web/annotate.ts`, `src/web/components/EnginePanel.tsx`) | the lila authors, [lichess-org/lila](https://github.com/lichess-org/lila) ([δημιουργοί](https://github.com/lichess-org/lila/graphs/contributors)) | AGPL-3.0-or-later |
| Κανόνες θεμάτων του `tagger/cook.py`, μεταφρασμένοι και τροποποιημένοι στο `src/core/puzzle.ts` | ornicar (Thibault Duplessis) και συντελεστές, [ornicar/lichess-puzzler](https://github.com/ornicar/lichess-puzzler) | AGPL-3.0 |
| Υπολογισμός Glicko-2 (`src/core/glicko2.ts`) | Thibault Duplessis, [scalachess](https://github.com/lichess-org/scalachess), με βάση το [goochjs/glicko2](https://github.com/goochjs/glicko2) του Jeremy Gooch | MIT · BSD-2-Clause |
| Ονόματα και περιγραφές θεμάτων puzzles (`src/data/puzzle-themes.json`): τα αγγλικά από το lila, μέρος των ελληνικών από τη μετάφραση του Lichess, με αλλαγές | the lila authors και οι [μεταφραστές του Lichess](https://crowdin.com/project/lichess) | αγγλικά CC0 1.0 · ελληνικά AGPL-3.0-or-later |
| Παίξε με bots: αντίπαλοι με προσωπικότητα, επιλογή κίνησης ανά στυλ, βιβλίο από τη βάση αναφοράς, ισοπαλία, βοήθειες (`src/web/play/*`, `src/web/windows/BotsWindow.tsx`)· στο Ruru προστέθηκαν ενδιάμεσα επίπεδα, όριο κόμβων και «χοντρά λάθη» για τα αδύναμα bots | Λάζαρος Μπατσής | GPL-3.0 |
| Θέσεις του «Παίξε τη θέση» (`src/data/lessons/playouts.json`): θέσεις από παρτίδες (γεγονότα) μέσα από τη δωρεάν βάση Lumbras Gigabase, και κλασικές θεωρητικές θέσεις· η επιλογή, οι στόχοι και τα κείμενα είναι του Ruru | οι παίκτες των παρτίδων· Lumbras Gigabase (πηγή των παρτίδων) | γεγονότα· επιλογή και κείμενα GPL-3.0 |
| Lc0 (Leela Chess Zero), προαιρετική λήψη από την εφαρμογή (`src/server/lc0.ts`), δεν περιλαμβάνεται στο πακέτο | οι συντελεστές του [LeelaChessZero/lc0](https://github.com/LeelaChessZero/lc0) | GPL-3.0 |
| Δίκτυο της Leela T1-256x10-distilled (λήψη από το storage.lczero.org), δεν περιλαμβάνεται στο πακέτο | οι συντελεστές του έργου Leela Chess Zero | όπως το έργο Lc0 |
| Βάρη Maia 1100–1900 (λήψη από την εφαρμογή), δεν περιλαμβάνονται στο πακέτο | CSSLab, [CSSLab/maia-chess](https://github.com/CSSLab/maia-chess) | GPL-3.0 |
| Λήψη και έλεγχοι του Lc0 και της Maia, «ανθρώπινες» κινήσεις της Maia (`src/server/lc0.ts`, `parseVerboseStats`, `sampleHuman`) | Λάζαρος Μπατσής | GPL-3.0 |
| ts-fsrs (διαστήματα επανάληψης FSRS) | open-spaced-repetition | MIT |
| pdf.js (`pdfjs-dist`, ανάγνωση του κειμένου των PDF για το «Βιβλίο σε βάση»· μπαίνει στο πακέτο χωρίς canvas) | Mozilla και οι συντελεστές του [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | Apache-2.0 |
| Κύρια συλλογή puzzles (λήψη από την Τακτική, δεν περιλαμβάνεται στο πακέτο) | ανοιχτά δεδομένα | CC0 1.0 |
| Συλλογές puzzles του Lucas Chess (λήψη από την Τακτική) | Lucas Monge και οι συγγραφείς κάθε συλλογής, [lukasmonk/lucaschessR2](https://github.com/lukasmonk/lucaschessR2) | GPL-3.0 |
| Μαθήματα φινάλε (`src/data/lessons/endgame.json`, μέσα στην εφαρμογή): κείμενο σε μετάφραση και προσαρμογή από άρθρα της αγγλικής Wikipedia (Lucena position, Philidor position, Rook and pawn versus rook endgame, King and pawn versus king endgame, Opposition, Key square, Triangulation, Réti endgame study, Queen versus pawn endgame, Saavedra position)· κάθε μάθημα γράφει το άρθρο και την έκδοσή του | οι συντάκτες των άρθρων της [Wikipedia](https://en.wikipedia.org/) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Μαθήματα φινάλε, «Βασικά ματ» (`src/data/lessons/endgame.json`): τα ματ με πύργο (δύο θέσεις), με δύο αξιωματικούς και με βασίλισσα, με βάση τα παραδείγματα του κεφαλαίου I («Some simple mates») του «Chess Fundamentals» (1921)· δική μας μετάφραση και προσαρμογή. Τα μαθήματα «ματ με δύο πύργους» και «πατ με βασίλισσα» είναι του Ruru | José Raúl Capablanca (1888–1942) | Κοινό κτήμα (ΕΕ: ζωή + 70· ΗΠΑ: έκδοση πριν από το 1931) |
| Μαθήματα στρατηγικής (`src/data/lessons/games.json`, μέσα στην εφαρμογή): σχολιασμένες παρτίδες από τα «Chess Fundamentals» (1921, Μέρος II) και «My Chess Career» (1920) του José Raúl Capablanca και από το «Der Schachwettkampf Lasker–Tarrasch» (1908) του Siegbert Tarrasch· σύγχρονη σημειογραφία και μεταφράσεις από το Ruru (από τα γερμανικά σε μερικά σημεία συντομευμένες) | José Raúl Capablanca (1888–1942), Siegbert Tarrasch (1862–1934) | Κοινό κτήμα (ΕΕ: ζωή + 70· ΗΠΑ: έκδοση πριν από το 1931) |
| Τεστ θέσεων Bratko–Kopec, STS, Arasan (λήψη από την Τακτική) | I. Bratko & D. Kopec · [fsmosca/STS-Rating](https://github.com/fsmosca/STS-Rating) · Jon Dart | BSD-2 (αρχείο του thgreiner/amy) · MIT · Arasan |
| Βάση αναφοράς Lumbra’s Gigabase (σύνδεσμος στη σελίδα της, δεν περιλαμβάνεται στο πακέτο) | Michael Jansen, [lumbrasgigabase.com](https://lumbrasgigabase.com) | CC BY-NC 4.0 (μη εμπορική χρήση) |

Ο αναγνώστης ChessBase (`src/server/formats/cbh.ts`) είναι ανεξάρτητη υλοποίηση σε
TypeScript, με βάση την ανοιχτή τεκμηρίωση παραπάνω και έλεγχο σε βάσεις του χρήστη.
Η μηχανή ανάλυσης (π.χ. Stockfish, GPLv3) τρέχει ως ξεχωριστό πρόγραμμα μέσω UCI. Το Stockfish
κατεβαίνει, όταν το ζητήσει ο χρήστης ή το πακέτο, από τις επίσημες εκδόσεις του
([official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish), GPLv3), μαζί με την άδεια
και τον κώδικά του, στο `engines\Stockfish` του φακέλου των βάσεων.
Το πλήρες κείμενο της GPL-3.0 είναι στο [LICENSE](LICENSE) και της AGPL-3.0 στο [licenses/AGPL-3.0.txt](licenses/AGPL-3.0.txt). Τα κείμενα των αδειών των βιβλιοθηκών που μπαίνουν στο πακέτο (React, Lucide κ.ά., και το 7-Zip) είναι στο `THIRD-PARTY-LICENSES.txt` του πακέτου και στον φάκελο `licenses`.
