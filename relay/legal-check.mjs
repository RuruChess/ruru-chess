// Πριν από το deploy: το relay σερβίρει όρους και απόρρητο, άρα δεν ανεβαίνει με κενό υπεύθυνο.
import fs from 'node:fs';

for (const f of ['PRIVACY.md', 'TERMS.md']) {
  if (/\[(CONTROLLER|EMAIL)\]/.test(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))) {
    console.error(`Το ${f} δεν έχει όνομα υπευθύνου. Συμπλήρωσέ το πριν από το deploy.`);
    process.exit(1);
  }
}
