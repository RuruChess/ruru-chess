// Ο υπεύθυνος: αναφορές και διαγραφές στον server των Φίλων.
//
//   node admin.mjs reports                     οι ανοιχτές αναφορές
//   node admin.mjs test-accounts               οι λογαριασμοί της παλιάς δοκιμής (μόνο λίστα)
//   node admin.mjs remove-message <αναφορά>    σβήνει το μήνυμα (και το αρχείο) της αναφοράς
//   node admin.mjs delete-team <id ομάδας>     σβήνει ομάδα με όλο το chat της
//   node admin.mjs delete-user <id | Όνομα#TAG> πλήρης διαγραφή λογαριασμού (δεν αναιρείται)
//   node admin.mjs close <αναφορά>             η αναφορά εξετάστηκε και σβήνεται
//
// Θέλει στο περιβάλλον ADMIN_KEY (ίδιο με το secret του Worker) και RELAY_URL (χωρίς προεπιλογή, για να
// μη γίνει ποτέ κατά λάθος διαγραφή στον πραγματικό server αντί για τον τοπικό).
const { ADMIN_KEY, RELAY_URL } = process.env;
const [action, id = ''] = process.argv.slice(2);
const ACTIONS = ['reports', 'test-accounts', 'remove-message', 'delete-team', 'delete-user', 'close'];

if (!ADMIN_KEY || !RELAY_URL || !ACTIONS.includes(action) || (!['reports', 'test-accounts'].includes(action) && !id)) {
  console.error(`Χρήση (με ADMIN_KEY και RELAY_URL στο περιβάλλον): node admin.mjs <${ACTIONS.join(' | ')}> [id]`);
  process.exitCode = 2;
} else {
  const r = await fetch(`${RELAY_URL.replace(/\/+$/, '')}/api/admin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    console.error(`Δεν έγινε (${r.status}):`, data.error ?? data);
    process.exitCode = 1;
  } else if (action === 'reports') {
    for (const x of data.reports) console.log(JSON.stringify({ ...x, at: new Date(x.at).toLocaleString('el-GR') }, null, 2));
    console.log(`${data.reports.length} αναφορές`);
  } else if (action === 'test-accounts') {
    for (const x of data.accounts) console.log(`${x.id}  ${x.name}#${x.tag}  ${new Date(x.at).toLocaleString('el-GR')}`);
    console.log(`${data.accounts.length} λογαριασμοί`);
  } else console.log('Έγινε.');
}
