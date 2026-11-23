// Η σελίδα (μία για κάθε γλώσσα): render(lang, t, c, icon) → HTML.
// t: κείμενα από το content.mjs · c: έκδοση, μεγέθη, σύνδεσμοι από το scripts/build-site.mjs
// icon(name): inline SVG από τα εικονίδια Lucide (τα ίδια με της εφαρμογής).

const stripHtml = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const THEME_INIT = `<script>(function(){try{var t=localStorage.getItem('ruru-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}})();</script>`;

export function render(lang, t, c, icon) {
  const fill = (s) =>
    String(s).replace(/\{(\w+)\}/g, (m, k) => {
      if (k === 'contactEmail') return c.email ? fill(t.faq.email) : '';
      return k in c.vars ? c.vars[k] : m;
    });

  const r = c.root;
  const img = (name) => `${r}assets/img/${name}-${lang}.webp`;
  const ext = (href) => (/^https?:/.test(href) ? ' rel="noopener"' : '');
  const d = t.download;

  // Πλήρες Schema.org @graph (WebSite + Organization + SoftwareApplication + FAQPage)
  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${c.site ?? 'https://ruruchess.com/'}#website`,
      url: c.site ?? 'https://ruruchess.com/',
      name: 'Ruru Chess',
      alternateName: ['Ruru', 'RuruChess'],
      inLanguage: ['en', 'el'],
      publisher: { '@id': `${c.site ?? 'https://ruruchess.com/'}#org` },
    },
    {
      '@type': 'Organization',
      '@id': `${c.site ?? 'https://ruruchess.com/'}#org`,
      name: 'Ruru Chess',
      alternateName: 'Ruru',
      url: c.site ?? 'https://ruruchess.com/',
      ...(c.site ? { logo: `${c.site}assets/icon.png` } : {}),
      ...(c.links.repo.startsWith('http') ? { sameAs: [c.links.repo] } : {}),
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${c.site ?? 'https://ruruchess.com/'}#app`,
      name: 'Ruru Chess',
      alternateName: ['Ruru', 'Ruru Chess Database'],
      description: t.description,
      operatingSystem: 'Windows 10, Windows 11',
      applicationCategory: 'GameApplication',
      applicationSubCategory: 'Chess',
      softwareVersion: c.rev,
      inLanguage: ['en', 'el'],
      isAccessibleForFree: true,
      license: ['https://www.gnu.org/licenses/gpl-3.0.html', 'https://www.gnu.org/licenses/agpl-3.0.html'],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      publisher: { '@id': `${c.site ?? 'https://ruruchess.com/'}#org` },
      featureList: [
        'Stockfish, Leela Chess Zero & Maia engine analysis',
        'PDF chess book to playable database conversion',
        'Opens PGN, ChessBase (.cbh, .cbv) and Scid (.si4) databases',
        'Opponent preparation across FIDE/OTB, Lichess and Chess.com',
        'Shared live chess analysis with encrypted WebRTC voice, camera and video',
        'Glicko-2 tactics trainer, classic master lessons and human-like bots',
      ],
      ...(c.links.full.startsWith('http') ? { downloadUrl: c.links.full } : {}),
      ...(c.site
        ? {
            url: c.pageUrl,
            screenshot: [
              `${c.site}assets/img/analysis-${lang}.webp`,
              `${c.site}assets/img/share-${lang}.webp`,
              `${c.site}assets/img/book-${lang}.webp`,
              `${c.site}assets/img/prep-${lang}.webp`,
              `${c.site}assets/img/tactics-${lang}.webp`,
            ],
          }
        : {}),
    },
    {
      '@type': 'FAQPage',
      '@id': `${c.pageUrl ?? 'https://ruruchess.com/'}#faq`,
      mainEntity: t.faq.items.map(([q, a]) => ({
        '@type': 'Question',
        name: stripHtml(q),
        acceptedAnswer: {
          '@type': 'Answer',
          text: stripHtml(fill(a)),
        },
      })),
    },
  ];

  const jsonLd = { '@context': 'https://schema.org', '@graph': graph };

  const renderShowcaseTabs = (groupName, tabs) => {
    const first = tabs[0];
    return `<div class="workbench" data-tabs="${groupName}">
      <div class="wb-bar" role="tablist" aria-label="${escAttr(groupName)}">
        ${tabs
          .map(
            (tab, i) => `<button type="button" role="tab" class="wb-tab${i === 0 ? ' is-active' : ''}" aria-selected="${i === 0 ? 'true' : 'false'}" data-tab-idx="${i}">${tab.label}</button>`,
          )
          .join('')}
      </div>
      <div class="wb-panels">
        ${tabs
          .map(
            (tab, i) => `<div class="wb-panel${i === 0 ? ' is-active' : ''}" role="tabpanel" data-panel-idx="${i}"${i === 0 ? '' : ' hidden'}>
          <div class="wb-copy">
            <h3>${tab.heading}</h3>
            <p>${tab.text}</p>
            <ul class="check-list">${tab.points.map((x) => `<li>${icon('check')}<span>${x}</span></li>`).join('')}</ul>
          </div>
          <div class="wb-media">
            <button class="frame zoom" type="button" data-full="${img(tab.id)}" aria-label="${escAttr(t.hero.zoom)}: ${escAttr(tab.alt)}">
              <img src="${img(tab.id)}" width="2160" height="1350" alt="${escAttr(tab.alt)}" loading="lazy" decoding="async">
              <span class="zoom-hint" aria-hidden="true">${icon('maximize-2')}</span>
            </button>
          </div>
        </div>`,
          )
          .join('\n        ')}
      </div>
    </div>`;
  };

  const heroFirst = t.hero.tabs[0];

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<meta name="description" content="${escAttr(t.description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F9F7F2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0C121E" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${r}favicon.ico" sizes="any">
<link rel="icon" href="${r}assets/icon.png" type="image/png" sizes="128x128">
<link rel="apple-touch-icon" href="${r}assets/icon.png">
<link rel="manifest" href="${r}site.webmanifest">
${
  c.site
    ? `<link rel="canonical" href="${c.pageUrl}">
<link rel="alternate" hreflang="en" href="${c.site}">
<link rel="alternate" hreflang="el" href="${c.site}el/">
<link rel="alternate" hreflang="x-default" href="${c.site}">
<meta property="og:url" content="${c.pageUrl}">
<meta property="og:image" content="${c.site}assets/img/og-${lang}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escAttr(t.ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(t.title)}">
<meta name="twitter:description" content="${escAttr(t.description)}">
<meta name="twitter:image" content="${c.site}assets/img/og-${lang}.png">`
    : ''
}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ruru Chess">
<meta property="og:locale" content="${t.locale}">
<meta property="og:locale:alternate" content="${t.altLocale}">
<meta property="og:title" content="${escAttr(t.title)}">
<meta property="og:description" content="${escAttr(t.description)}">
${THEME_INIT}
<link rel="stylesheet" href="${r}assets/style.css?v=${c.rev}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>
${c.preview ? `<div class="preview-bar">${t.preview}</div>` : ''}

<header class="topbar" id="top">
  <div class="wrap topbar-in">
    <a class="brand" href="#top">
      <img src="${r}assets/icon.png" width="30" height="30" alt="Ruru Chess owl emblem">
      <span class="brand-name">Ruru <span>Chess</span></span>
    </a>
    <nav class="nav" id="menu" aria-label="${escAttr(t.menu)}">
      <a href="#analysis">${t.nav.overview}</a>
      <a href="#books">${t.nav.books}</a>
      <a href="#study">${t.nav.study}</a>
      <a href="#training">${t.nav.train}</a>
      <a href="#faq">${t.nav.faq}</a>
      ${c.kofi ? `<a href="#support">${t.nav.support}</a>` : ''}
      <a class="nav-lang" href="${c.otherLangHref}" hreflang="${c.otherLang}" lang="${c.otherLang}">${t.otherLang}</a>
    </nav>
    <div class="topbar-act">
      <button class="icon-toggle" type="button" id="theme-toggle" aria-label="${escAttr(t.themeToggle)}" title="${escAttr(t.themeToggle)}">
        <span class="ic-sun">${icon('sun')}</span>
        <span class="ic-moon">${icon('moon')}</span>
      </button>
      <a class="btn btn-ink btn-sm nav-dl" href="#download">${icon('download')}<span>${t.nav.download}</span></a>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu" aria-label="${escAttr(t.menu)}">${icon('menu')}</button>
    </div>
  </div>
</header>

<main id="main">
  <section class="hero">
    <div class="wrap">
      <div class="hero-grid">
        <div class="hero-copy">
          <p class="kicker"><span class="kicker-dot" aria-hidden="true"></span>${fill(t.hero.kicker)}</p>
          <h1>${t.hero.title}</h1>
          <p class="lead">${t.hero.lead}</p>
        </div>
        <div class="hero-action">
          <a class="btn btn-cobalt btn-lg hero-btn" href="${c.links.full}" data-dl-guide>
            ${icon('download')}
            <span class="btn-stack">
              <strong>${t.hero.cta}</strong>
              <small>${fill(t.hero.ctaMeta)}</small>
            </span>
          </a>
          <p class="hero-links">
            <a href="${c.links.portable}">${t.hero.portable}</a>
            <span aria-hidden="true">·</span>
            <a href="#download">${t.hero.checksums}</a>
            <span aria-hidden="true">·</span>
            <a href="${c.links.repo}"${ext(c.links.repo)}>${t.hero.source}</a>
          </p>
          <p class="hero-note">${t.hero.formats}</p>
        </div>
      </div>

      <div class="stage" data-hero-stage>
        <div class="stage-bar" role="tablist" aria-label="Ruru Chess workspace">
          ${t.hero.tabs
            .map(
              (tab, i) => `<button type="button" role="tab" class="stage-tab${i === 0 ? ' is-active' : ''}" aria-selected="${i === 0 ? 'true' : 'false'}" data-src="${img(tab.id)}" data-alt="${escAttr(tab.alt)}" data-caption="${escAttr(tab.caption)}">${tab.label}</button>`,
            )
            .join('')}
        </div>
        <button class="stage-frame zoom" type="button" id="hero-zoom" data-full="${img(heroFirst.id)}" aria-label="${escAttr(t.hero.zoom)}: ${escAttr(heroFirst.alt)}">
          <img id="hero-img" src="${img(heroFirst.id)}" width="2160" height="1350" alt="${escAttr(heroFirst.alt)}" fetchpriority="high" decoding="async">
          <span class="zoom-hint" aria-hidden="true">${icon('maximize-2')}</span>
        </button>
        <p class="stage-caption" id="hero-caption">${heroFirst.caption}</p>
      </div>
    </div>
  </section>

  <section class="facts" aria-label="Key highlights">
    <div class="wrap">
      <dl class="facts-grid">
        ${t.facts
          .map(
            ([dt, dd], i) => `<div class="fact">
          <dt><span class="fact-n">0${i + 1}</span>${dt}</dt>
          <dd>${dd}</dd>
        </div>`,
          )
          .join('\n        ')}
      </dl>
    </div>
  </section>

  <section class="band" id="analysis">
    <div class="wrap">
      <header class="ch-head">
        <p class="ch-eyebrow"><span class="ch-num">${t.ch1.num}</span>${t.ch1.eyebrow}</p>
        <h2>${t.ch1.title}</h2>
        <p class="ch-lead">${t.ch1.lead}</p>
      </header>
      ${renderShowcaseTabs(t.ch1.eyebrow, t.ch1.tabs)}
    </div>
  </section>

  <section class="band band-warm" id="books">
    <div class="wrap">
      <div class="book-spread">
        <div class="book-copy">
          <p class="ch-eyebrow"><span class="ch-num">${t.ch2.num}</span>${t.ch2.eyebrow}</p>
          <h2>${t.ch2.title}</h2>
          <p class="ch-lead">${t.ch2.lead}</p>
          <ul class="check-list">
            ${t.ch2.points.map((x) => `<li>${icon('check')}<span>${x}</span></li>`).join('\n            ')}
          </ul>
        </div>
        <div class="book-visual">
          <button class="frame zoom book-main" type="button" data-full="${img('book')}" aria-label="${escAttr(t.hero.zoom)}: ${escAttr(t.ch2.alt)}">
            <img src="${img('book')}" width="2160" height="1350" alt="${escAttr(t.ch2.alt)}" loading="lazy" decoding="async">
            <span class="zoom-hint" aria-hidden="true">${icon('maximize-2')}</span>
          </button>
          <figure class="book-inset" aria-hidden="true">
            <span class="pdf-badge">${icon('file-text')}${t.ch2.pdfTag}</span>
            <img src="${r}assets/img/bookpage.webp" width="960" height="600" alt="${escAttr(t.ch2.insetAlt)}" loading="lazy" decoding="async">
            <span class="pdf-arrow">${icon('arrow-right')}</span>
          </figure>
        </div>
      </div>
    </div>
  </section>

  <section class="band" id="study">
    <div class="wrap">
      <header class="ch-head">
        <p class="ch-eyebrow"><span class="ch-num">${t.ch3.num}</span>${t.ch3.eyebrow}</p>
        <h2>${t.ch3.title}</h2>
        <p class="ch-lead">${t.ch3.lead}</p>
      </header>
      <div class="bento">
        ${t.ch3.cards
          .map((card, i) =>
            card.img
              ? `<article class="bento-card bento-wide${i % 2 ? ' bento-flip' : ''}">
          <div class="bento-wide-copy">
            <span class="bento-tag">${card.tag}</span>
            <h3>${card.title}</h3>
            <p>${card.text}</p>
            <ul class="check-list">
              ${card.points.map((x) => `<li>${icon('check')}<span>${x}</span></li>`).join('')}
            </ul>
          </div>
          <div class="bento-wide-media">
            <button class="frame zoom" type="button" data-full="${img(card.img)}" aria-label="${escAttr(t.hero.zoom)}: ${escAttr(card.alt)}">
              <img src="${img(card.img)}" width="2160" height="1350" alt="${escAttr(card.alt)}" loading="lazy" decoding="async">
              <span class="zoom-hint" aria-hidden="true">${icon('maximize-2')}</span>
            </button>
          </div>
        </article>`
              : `<article class="bento-card bento-strip">
          <div>
            <span class="bento-tag">${card.tag}</span>
            <h3>${card.title}</h3>
            <p>${card.text}</p>
          </div>
          <ul class="check-list">
            ${card.points.map((x) => `<li>${icon('check')}<span>${x}</span></li>`).join('')}
          </ul>
        </article>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>

  <section class="band band-warm" id="training">
    <div class="wrap">
      <header class="ch-head">
        <p class="ch-eyebrow"><span class="ch-num">${t.ch4.num}</span>${t.ch4.eyebrow}</p>
        <h2>${t.ch4.title}</h2>
        <p class="ch-lead">${t.ch4.lead}</p>
      </header>
      ${renderShowcaseTabs(t.ch4.eyebrow, t.ch4.tabs)}
    </div>
  </section>

  <section class="band" id="features">
    <div class="wrap">
      <header class="ch-head ch-head-tight">
        <p class="ch-eyebrow">${t.index.eyebrow}</p>
        <h2>${t.index.title}</h2>
      </header>
      <div class="spec-grid">
        ${t.index.groups
          .map(
            (g) => `<div class="spec-col">
          <h3>${g.title}</h3>
          <dl>
            ${g.items.map(([k, v]) => `<div class="spec-item"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
          </dl>
        </div>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>

  <section class="band band-warm" id="download">
    <div class="wrap">
      <header class="ch-head ch-head-tight">
        <p class="ch-eyebrow">${d.eyebrow}</p>
        <h2>${d.title}</h2>
        <p class="ch-lead">${d.lead}</p>
      </header>

      <div class="dl-panel">
        <div class="dl-main">
          <a class="btn btn-cobalt btn-lg" href="${c.links.full}" data-dl-guide>${icon('download')}<span>${d.btn}</span></a>
          <p class="dl-meta mono">${fill(d.fileInfo)}</p>
          <p class="dl-sub">${fill(d.portable)}</p>
          <p class="dl-links">
            <a href="${c.links.release}"${ext(c.links.release)}>${d.whatsNew}</a>
            <span aria-hidden="true">·</span>
            <a href="${c.links.releases}"${ext(c.links.releases)}>${d.allReleases}</a>
            <span aria-hidden="true">·</span>
            <a href="${c.links.repo}"${ext(c.links.repo)}>${t.footer.code}</a>
          </p>
        </div>
        <aside class="dl-aside">
          <div>
            <h3>${d.reqTitle}</h3>
            <ul class="check-list check-sm">${d.req.map((x) => `<li>${icon('check')}<span>${x}</span></li>`).join('')}</ul>
          </div>
          <div>
            <h3>${d.stepsTitle}</h3>
            <ol class="step-list">${d.steps.map((x) => `<li>${x}</li>`).join('')}</ol>
          </div>
        </aside>
      </div>

      ${
        c.files.length
          ? `<details class="checksums">
        <summary>${icon('shield-check')}<span>${d.filesTitle}</span>${icon('chevron-down')}</summary>
        <div class="checksums-body">
          <table>
            <tbody>
              ${c.files.map((f) => `<tr><td><a href="${f.href}">${f.name}</a></td><td class="muted mono">${f.mb} MB</td><td class="mono hash">${f.hash}</td></tr>`).join('\n              ')}
            </tbody>
          </table>
          <p class="small muted">${d.shaHow} <code>Get-FileHash .\\${c.fullName}</code></p>
        </div>
      </details>`
          : ''
      }

      <div class="smartscreen">
        <span class="smartscreen-ic">${icon('info')}</span>
        <div>
          <h3>${d.warnTitle}</h3>
          <p>${d.warn}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="band" id="faq">
    <div class="wrap wrap-narrow">
      <header class="ch-head ch-head-tight">
        <p class="ch-eyebrow">${t.faq.eyebrow}</p>
        <h2>${t.faq.title}</h2>
      </header>
      <div class="faq-list">
        ${t.faq.items
          .map(
            ([q, a]) => `<details class="faq-item">
          <summary><span>${q}</span>${icon('chevron-down')}</summary>
          <div class="faq-ans"><p>${fill(a)}</p></div>
        </details>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>

  ${
    c.kofi
      ? `<section class="band band-warm" id="support">
    <div class="wrap">
      <div class="support-box">
        <div>
          <h2>${t.support.title}</h2>
          <p class="ch-lead">${t.support.lead}</p>
          <ul class="check-list">${t.support.goals.map((x) => `<li>${icon('check')}<span>${x}</span></li>`).join('')}</ul>
        </div>
        <div class="support-act">
          <a class="btn btn-ink btn-lg" href="${c.links.kofi}"${ext(c.links.kofi)} target="_blank">${icon('coffee')}<span>${t.support.btn}</span></a>
          <p class="small muted">${t.support.note}</p>
          <p class="small muted">${fill(t.support.other)}</p>
        </div>
      </div>
    </div>
  </section>`
      : ''
  }
</main>

<footer class="footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="brand" href="#top">
          <img src="${r}assets/icon.png" width="28" height="28" alt="Ruru Chess">
          <span class="brand-name">Ruru <span>Chess</span></span>
        </a>
        <p>${t.footer.tagline}</p>
      </div>
      <nav class="footer-col" aria-label="${escAttr(t.footer.program)}">
        <h4>${t.footer.program}</h4>
        <a href="#download">${t.nav.download}</a>
        <a href="${c.links.release}"${ext(c.links.release)}>${d.whatsNew}</a>
        <a href="#faq">${t.nav.faq}</a>
        ${c.kofi ? `<a href="#support">${t.nav.support}</a>` : ''}
      </nav>
      <nav class="footer-col" aria-label="${escAttr(t.footer.project)}">
        <h4>${t.footer.project}</h4>
        <a href="${c.links.repo}"${ext(c.links.repo)}>${t.footer.code}</a>
        <a href="${c.links.issues}"${ext(c.links.issues)}>${t.footer.issues}</a>
        <a href="${c.links.license}"${ext(c.links.license)}>${t.footer.license}</a>
        <a href="${c.links.agpl}"${ext(c.links.agpl)}>${t.footer.agpl}</a>
        <a href="${c.links.credits}"${ext(c.links.credits)}>${t.footer.credits}</a>
        <a href="privacy.html">${t.footer.privacy}</a>
        <a href="terms.html">${t.footer.terms}</a>
      </nav>
    </div>
    <div class="footer-base">
      <p>© ${c.year} Ruru Chess. ${t.footer.legal}</p>
      <a class="footer-lang" href="${c.otherLangHref}" hreflang="${c.otherLang}" lang="${c.otherLang}">${icon('languages')}<span>${t.otherLang}</span></a>
    </div>
  </div>
</footer>

<dialog class="dl-modal" id="dl-modal" aria-labelledby="dl-modal-title">
  <div class="dl-modal-in">
    <div class="dl-modal-head">
      <span class="dl-modal-ic">${icon('download')}</span>
      <h3 id="dl-modal-title">${d.modalTitle}</h3>
      <button type="button" class="dl-modal-x" aria-label="${escAttr(d.modalClose)}" data-dl-close>${icon('x')}</button>
    </div>
    <p class="dl-modal-sub">${d.modalSub}</p>
    <ol class="dl-modal-steps">${d.modalSteps.map((x) => `<li>${x}</li>`).join('')}</ol>
    <p class="dl-modal-note">${icon('shield-check')}<span>${d.modalNote}</span></p>
    <div class="dl-modal-foot">
      <a class="small" href="#download" data-dl-close>${d.modalCheck}</a>
      <button type="button" class="btn btn-ink btn-sm" data-dl-close>${d.modalClose}</button>
    </div>
  </div>
</dialog>

<dialog class="lightbox" id="lightbox" aria-label="${escAttr(t.hero.zoom)}">
  <button type="button" class="lightbox-close" aria-label="Close">${icon('x')}</button>
  <img alt="">
</dialog>
<script src="${r}assets/site.js?v=${c.rev}" defer></script>
</body>
</html>
`;
}

export function renderPrivacy(lang, t, c, md) {
  return renderLegal(lang, t, c, md, t.footer.privacy, 'privacy.html');
}

export function renderTerms(lang, t, c, md) {
  return renderLegal(lang, t, c, md, t.footer.terms, 'terms.html');
}

function renderLegal(lang, t, c, md, title, file) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = md
    .trim()
    .split(/\n{2,}/)
    .map((b) => {
      if (b.startsWith('## ')) return `<h2>${esc(b.slice(3))}</h2>`;
      if (b.startsWith('# ')) return `<h1>${esc(b.slice(2))}</h1>`;
      if (b.startsWith('- ')) return `<ul>${b.split('\n').map((x) => `<li>${esc(x.slice(2))}</li>`).join('')}</ul>`;
      return `<p>${esc(b)}</p>`;
    })
    .join('\n');

  const pageUrl = c.pageUrl ? `${c.pageUrl}${file}` : null;
  const enUrl = c.site ? `${c.site}${file}` : null;
  const elUrl = c.site ? `${c.site}el/${file}` : null;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Ruru Chess</title>
<meta name="description" content="${escAttr(`${title} for Ruru Chess (${c.site ?? 'ruruchess.com'}).`)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${c.root}favicon.ico" sizes="any">
<link rel="icon" href="${c.root}assets/icon.png" type="image/png">
${
  pageUrl
    ? `<link rel="canonical" href="${pageUrl}">
<link rel="alternate" hreflang="en" href="${enUrl}">
<link rel="alternate" hreflang="el" href="${elUrl}">
<link rel="alternate" hreflang="x-default" href="${enUrl}">`
    : ''
}
${THEME_INIT}
<link rel="stylesheet" href="${c.root}assets/style.css?v=${c.rev}">
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-in">
    <a class="brand" href="./">
      <img src="${c.root}assets/icon.png" width="28" height="28" alt="Ruru Chess">
      <span class="brand-name">Ruru <span>Chess</span></span>
    </a>
    <div class="topbar-act">
      <a class="nav-lang" href="${c.otherLangHref || './'}${file}" hreflang="${c.otherLang}" lang="${c.otherLang}">${t.otherLang}</a>
    </div>
  </div>
</header>
<main class="band">
  <article class="wrap wrap-narrow legal-doc">
    <p class="legal-back"><a href="./">← Ruru Chess</a></p>
    ${body}
  </article>
</main>
</body>
</html>
`;
}
