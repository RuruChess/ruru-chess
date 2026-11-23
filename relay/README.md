# KnightBase — «Παίξε με φίλο» (server των παρτίδων)

Μικρός server στο Cloudflare (Worker + ένα Durable Object ανά δωμάτιο), που περνά τις κινήσεις ανάμεσα
στο KnightBase του οικοδεσπότη και στον browser του φίλου. Δεν είναι μέρος της εφαρμογής ούτε του installer.

- `src/worker.ts`: `POST /api/new` (νέο δωμάτιο), `GET /ws/<id>` (WebSocket), ό,τι άλλο → σελίδα του φίλου.
- Κανόνες της παρτίδας (κίνηση, ρολόι, ισοπαλία, εγκατάλειψη, ρεβάνς, PGN): `../src/core/online.ts`
  (τεστ: `../tests/online.test.ts`). Τους ίδιους χρησιμοποιούν και οι σκακιέρες.
- Σελίδα του φίλου: `web/` → `dist/` (χρησιμοποιεί τα `../src/web/online/*` και τα πιόνια/ήχους του `../public`).
- `/licenses`: «Κώδικας και άδειες» της σελίδας (`web/licenses.tsx`). Το link δείχνει στο δημόσιο repo, άρα αυτό
  δημοσιεύεται πριν ή μαζί με το deploy, με τον ίδιο κώδικα που ανεβαίνει.
- Καρτέλα στο KnightBase: `../src/web/windows/FriendWindow.tsx`.
- **Κοινή ανάλυση live** (`AnalysisRoom`): `POST /api/analysis/new`, WebSocket `/wa/<id>`, σελίδα `/a/<id>`
  (`web/analysis.tsx`). Ο server κρατά το τελευταίο PGN (βαριάντες, σχόλια, σύμβολα, βέλη) και το chat· όποιος
  αλλάζει κάτι στέλνει το νέο PGN (`../src/web/share/useShare.ts`). Στο KnightBase: καρτέλα «Κοινή ανάλυση»
  (`ShareWindow.tsx`) και κουμπί στο παράθυρο της παρτίδας (`../src/web/share/ShareHost.tsx`), ώστε οι αλλαγές
  να μένουν στην παρτίδα και να αποθηκεύονται κανονικά. Η μηχανή του οικοδεσπότη φτάνει στους άλλους.
- **Φίλοι και Ομάδες** (`src/social.ts`, σχέδιο στο `SOCIAL.md`): Durable Objects `Directory`, `UserHub`, `Conversation`, `Team` (SQLite),
  `POST /api/social/register|recover`, WebSocket `/social?u=<id>`. Στο KnightBase: στήλη «Φίλοι» στις Βάσεις,
  chat κάτω δεξιά, ειδοποιήσεις με ✓ / ✗ πάνω δεξιά (`../src/web/social/`). Τα chats μένουν μέχρι να σβηστούν.
  Αποστολή βάσεων: `POST /api/social/file` (μόνο PGN σε απλό κείμενο έως 1 MB, με έλεγχο περιεχομένου, στο Workers KV `FILES` για 7 μέρες, το φτιάχνει
  μόνο του το `npm run deploy`), `GET /api/social/file/<id>` μόνο για τα μέλη της συνομιλίας.
- Τα δωμάτια σβήνουν μόνα τους μία μέρα μετά την τελευταία κίνηση. Δεν κρατιούνται προσωπικά στοιχεία,
  μόνο τα ονόματα που γράφουν οι παίκτες.

## Τοπική δοκιμή

```
npm install
npm run dev        # χτίζει τη σελίδα και ανοίγει τον server στο http://localhost:8787
```

Για να τον χρησιμοποιήσει το KnightBase: «Για προχωρημένους» στην καρτέλα «Παίξε με φίλο» → `http://localhost:8787`.

## Ανέβασμα (όταν υπάρχει λογαριασμός Cloudflare)

```
npx wrangler login     # μία φορά, στο δικό σου terminal
npm run deploy         # → Worker «ruru-play» στο https://play.ruruchess.com (Custom Domain, wrangler.jsonc)
```

Ανεβασμένο στο **https://play.ruruchess.com** (23/11/2026): αυτό είναι το `DEFAULT_PLAY_SERVER` στο
`src/web/online/server.ts`. Προαιρετικά secrets: `TURN_KEY_ID` και `TURN_API_TOKEN` (Cloudflare TURN για φωνή και
κάμερα), `ADMIN_KEY` (αναφορές και διαγραφές, `admin.mjs`).
Το δωρεάν πλάνο φτάνει άνετα (100.000 αιτήματα τη μέρα· οι κινήσεις μέσα στο WebSocket μετράνε ελάχιστα).
