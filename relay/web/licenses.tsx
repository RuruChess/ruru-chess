/** «Κώδικας και άδειες» (/licenses): ο κώδικας της σελίδας και τα πλήρη κείμενα των αδειών όσων μοιράζει. */
import { useEffect, useState } from 'react';
import gpl from '../../LICENSE?raw';
import agpl from '../../licenses/AGPL-3.0.txt?raw';
import notices from '../../licenses/NOTICES.txt?raw';
import { L } from '../../src/web/i18n.ts';

const SOURCE = 'https://github.com/RuruChess/ruru-chess';
/** το γράφει το build (vite.config.ts, build.license) */
const LIBRARIES = '/libraries.txt';

export default function Licenses() {
  const [libraries, setLibraries] = useState('');
  useEffect(() => {
    fetch(LIBRARIES)
      .then(async (r) => (r.ok ? setLibraries(await r.text()) : undefined))
      .catch(() => {}); // μένει ο σύνδεσμος στο αρχείο
  }, []);
  const texts = [
    [L('Δημιουργοί και ειδοποιήσεις', 'Authors and notices'), notices],
    ['GNU GPL 3.0', gpl],
    ['GNU AGPL 3.0', agpl],
    [L('Βιβλιοθήκες της σελίδας', 'Libraries of this page'), libraries],
  ];
  return (
    <div className="legal-text small">
      <h2>{L('Κώδικας και άδειες', 'Code and licences')}</h2>
      <p>
        {L(
          'Το Ruru Chess και αυτή η σελίδα είναι ελεύθερο λογισμικό: GPL-3.0-or-later, με μέρη AGPL-3.0, χωρίς καμία εγγύηση. Μπορείς να τα χρησιμοποιείς, να τα αλλάζεις και να τα μοιράζεις με τους όρους αυτών των αδειών.',
          'Ruru Chess and this page are free software: GPL-3.0-or-later, with parts under AGPL-3.0, with no warranty of any kind. You may use, change and share them under the terms of these licences.',
        )}
      </p>
      <p>
        {L('Κώδικας: ', 'Source code: ')}
        <a href={SOURCE} target="_blank" rel="noreferrer">
          {SOURCE}
        </a>
      </p>
      <p>
        {L(
          'Κομμάτια: Colin M.L. Burnett και Armando Hernandez Marroquin (GPLv2+). Ήχοι: el_boss (CC0) και Enigmahack, από το lila (AGPL-3.0-or-later). Βιβλιοθήκες: React, Lucide και όσες άλλες γράφει η λίστα παρακάτω.',
          'Pieces: Colin M.L. Burnett and Armando Hernandez Marroquin (GPLv2+). Sounds: el_boss (CC0) and Enigmahack, from lila (AGPL-3.0-or-later). Libraries: React, Lucide and any others in the list below.',
        )}
      </p>
      {texts.map(([title, text]) => (
        <details key={title}>
          <summary>{title}</summary>
          {text ? <pre>{text}</pre> : <a href={LIBRARIES}>{LIBRARIES}</a>}
        </details>
      ))}
    </div>
  );
}
