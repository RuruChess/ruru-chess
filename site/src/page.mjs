// Η σελίδα (μία για κάθε γλώσσα): render(lang, t, c, icon) → HTML.
// t: κείμενα από το content.mjs · c: έκδοση, μεγέθη, σύνδεσμοι από το scripts/build-site.mjs
// icon(name): inline SVG από τα εικονίδια Lucide (τα ίδια με της εφαρμογής).

const stripHtml = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const THEME_INIT = `<script>(function(){try{var t=localStorage.getItem('ruru-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}})();</script>`;

function renderNavGuides(lang, c, icon, prefix = '', currentSlug = null) {
  if (!c.guides?.length) return '';
  const label = lang === 'el' ? 'Οδηγοί' : 'Guides';
  return `<details class="nav-dd">
        <summary><span>${label}</span>${icon('chevron-down')}</summary>
        <div class="nav-dd-menu" role="menu">
          ${c.guides
            .map(
              (g) => `<a href="${prefix}${g.slug}/"${g.slug === currentSlug ? ' aria-current="page"' : ''}>${g[lang].navLabel}</a>`,
            )
            .join('\n          ')}
        </div>
      </details>`;
}

function renderSectionGuides(lang, c, icon, section) {
  const list = (c.guides ?? []).filter((g) => g.homeSection === section);
  if (!list.length) return '';
  return `<div class="section-guides">
        ${list.map((g) => `<a class="related-pill" href="${g.slug}/">${g[lang].navLabel} ${icon('arrow-right')}</a>`).join('\n        ')}
      </div>`;
}

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

  const siteBase = c.site ?? 'https://ruruchess.com/';
  const pageUrl = c.pageUrl ?? siteBase;
  const heroFirst = t.hero.tabs[0];
  const heroImgAbs = `${siteBase}assets/img/${heroFirst.id}-${lang}.webp`;

  // Πλήρες Schema.org @graph (WebSite + Organization + WebPage + SoftwareApplication + SoftwareSourceCode + FAQPage)
  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${siteBase}#website`,
      url: siteBase,
      name: 'Ruru Chess',
      alternateName: ['Ruru', 'RuruChess'],
      inLanguage: ['en', 'el'],
      publisher: { '@id': `${siteBase}#org` },
    },
    {
      '@type': 'Organization',
      '@id': `${siteBase}#org`,
      name: 'Ruru Chess',
      alternateName: 'Ruru',
      url: siteBase,
      ...(c.site ? { logo: `${c.site}assets/logo-256.png` } : {}),
      ...(c.links.repo.startsWith('http') ? { sameAs: [c.links.repo] } : {}),
    },
    {
      '@type': 'WebPage',
      '@id': `${pageUrl}#webpage`,
      url: pageUrl,
      name: t.title,
      description: t.description,
      inLanguage: lang,
      ...(c.lastmod ? { dateModified: c.lastmod } : {}),
      isPartOf: { '@id': `${siteBase}#website` },
      about: { '@id': `${siteBase}#app` },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: heroImgAbs,
        width: 2160,
        height: 1350,
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteBase}#app`,
      name: 'Ruru Chess',
      alternateName: ['Ruru', 'Ruru Chess Database'],
      description: t.description,
      keywords: t.schemaKeywords,
      operatingSystem: 'Windows 10, Windows 11',
      softwareRequirements: 'Windows 10 or Windows 11 (64-bit)',
      applicationCategory: 'GameApplication',
      applicationSubCategory: 'Chess',
      softwareVersion: c.rev,
      ...(c.lastmod ? { dateModified: c.lastmod } : {}),
      ...(/^\d+$/.test(String(c.vars.setupMB)) ? { fileSize: `${c.vars.setupMB}MB` } : {}),
      inLanguage: ['en', 'el'],
      isAccessibleForFree: true,
      license: ['https://www.gnu.org/licenses/gpl-3.0.html', 'https://www.gnu.org/licenses/agpl-3.0.html'],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      publisher: { '@id': `${siteBase}#org` },
      featureList: t.schemaFeatures,
      ...(c.links.full.startsWith('http') ? { downloadUrl: c.links.full } : {}),
      ...(c.links.release.startsWith('http') ? { releaseNotes: c.links.release } : {}),
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
    ...(c.links.repo.startsWith('http')
      ? [
          {
            '@type': 'SoftwareSourceCode',
            '@id': `${siteBase}#source`,
            name: 'Ruru Chess Source Code',
            codeRepository: c.links.repo,
            programmingLanguage: ['TypeScript', 'JavaScript'],
            runtimePlatform: 'Windows 10, Windows 11',
            license: ['https://www.gnu.org/licenses/gpl-3.0.html', 'https://www.gnu.org/licenses/agpl-3.0.html'],
            targetProduct: { '@id': `${siteBase}#app` },
          },
        ]
      : []),
    {
      '@type': 'FAQPage',
      '@id': `${pageUrl}#faq`,
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

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<meta name="description" content="${escAttr(t.description)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F9F7F2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0C121E" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${r}favicon.ico" sizes="48x48">
<link rel="icon" href="${r}assets/favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${r}assets/logo-256.png" type="image/png" sizes="256x256">
<link rel="apple-touch-icon" href="${r}assets/logo-256.png">
<link rel="manifest" href="${r}site.webmanifest">
<link rel="preload" as="image" href="${img(heroFirst.id)}" type="image/webp" fetchpriority="high">
${
  c.site
    ? `<link rel="canonical" href="${c.pageUrl}">
<link rel="alternate" hreflang="en" href="${c.site}">
<link rel="alternate" hreflang="el" href="${c.site}el/">
<link rel="alternate" hreflang="x-default" href="${c.site}">
<meta property="og:url" content="${c.pageUrl}">
<meta property="og:image" content="${c.site}assets/img/og-${lang}.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escAttr(t.ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(t.title)}">
<meta name="twitter:description" content="${escAttr(t.description)}">
<meta name="twitter:image" content="${c.site}assets/img/og-${lang}.png">
<meta name="twitter:image:alt" content="${escAttr(t.ogAlt)}">`
    : ''
}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ruru Chess">
<meta property="og:locale" content="${t.locale}">
<meta property="og:locale:alternate" content="${t.altLocale}">
<meta property="og:title" content="${escAttr(t.title)}">
<meta property="og:description" content="${escAttr(t.description)}">
${THEME_INIT}
<link rel="stylesheet" href="${r}assets/style.css?v=${c.assetVer ?? c.rev}">
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
      <a href="#study">${t.nav.study}</a>
      <a href="#training">${t.nav.train}</a>
      ${renderNavGuides(lang, c, icon, '')}
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
      ${renderSectionGuides(lang, c, icon, 'analysis')}
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
          ${
            c.guides?.find((g) => g.homeSection === 'books')
              ? (() => {
                  const g = c.guides.find((x) => x.homeSection === 'books');
                  return `<p class="guide-inline-link"><a href="${g.slug}/">${g[lang].navLabel} ${icon('arrow-right')}</a></p>`;
                })()
              : ''
          }
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
      ${renderSectionGuides(lang, c, icon, 'study')}
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
      ${
        c.guides?.length
          ? `<nav class="footer-col" aria-label="${lang === 'el' ? 'Οδηγοί' : 'Guides'}">
        <h4>${lang === 'el' ? 'Οδηγοί' : 'Guides'}</h4>
        ${c.guides.map((g) => `<a href="${g.slug}/">${g[lang].navLabel}</a>`).join('\n        ')}
      </nav>`
          : ''
      }
      <nav class="footer-col" aria-label="${escAttr(t.footer.project)}">
        <h4>${t.footer.project}</h4>
        <a href="${c.links.repo}"${ext(c.links.repo)}>${t.footer.code}</a>
        <a href="${c.links.issues}"${ext(c.links.issues)}>${t.footer.issues}</a>
        <a href="${c.links.license}"${ext(c.links.license)}>${t.footer.license}</a>
        <a href="${c.links.agpl}"${ext(c.links.agpl)}>${t.footer.agpl}</a>
        <a href="${c.links.credits}"${ext(c.links.credits)}>${t.footer.credits}</a>
        <a href="privacy">${t.footer.privacy}</a>
        <a href="terms">${t.footer.terms}</a>
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
<script src="${r}assets/site.js?v=${c.assetVer ?? c.rev}" defer></script>
</body>
</html>
`;
}

export function renderPrivacy(lang, t, c, md) {
  return renderLegal(lang, t, c, md, t.footer.privacy, 'privacy');
}

export function renderTerms(lang, t, c, md) {
  return renderLegal(lang, t, c, md, t.footer.terms, 'terms');
}

function renderLegal(lang, t, c, md, title, slug) {
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

  const pageUrl = c.pageUrl ? `${c.pageUrl}${slug}` : null;
  const enUrl = c.site ? `${c.site}${slug}` : null;
  const elUrl = c.site ? `${c.site}el/${slug}` : null;
  const breadcrumb = pageUrl
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Ruru Chess', item: c.pageUrl },
          { '@type': 'ListItem', position: 2, name: title, item: pageUrl },
        ],
      }
    : null;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Ruru Chess</title>
<meta name="description" content="${escAttr(`${title} for Ruru Chess (${c.site ?? 'ruruchess.com'}).`)}">
<meta name="robots" content="noindex, follow">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${c.root}favicon.ico" sizes="48x48">
<link rel="icon" href="${c.root}assets/favicon-48.png" type="image/png" sizes="48x48">
${
  pageUrl
    ? `<link rel="canonical" href="${pageUrl}">
<link rel="alternate" hreflang="en" href="${enUrl}">
<link rel="alternate" hreflang="el" href="${elUrl}">
<link rel="alternate" hreflang="x-default" href="${enUrl}">`
    : ''
}
${THEME_INIT}
<link rel="stylesheet" href="${c.root}assets/style.css?v=${c.assetVer ?? c.rev}">
${breadcrumb ? `<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>` : ''}
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-in">
    <a class="brand" href="./">
      <img src="${c.root}assets/icon.png" width="28" height="28" alt="Ruru Chess">
      <span class="brand-name">Ruru <span>Chess</span></span>
    </a>
    <div class="topbar-act">
      <a class="nav-lang" href="${c.otherLangHref || './'}${slug}" hreflang="${c.otherLang}" lang="${c.otherLang}">${t.otherLang}</a>
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

export function renderLanding(lang, page, t, c, icon) {
  const p = page[lang];
  const d = t.download;
  const fill = (s) =>
    String(s).replace(/\{(\w+)\}/g, (m, k) => (k in c.vars ? c.vars[k] : m));
  const ext = (href) => (/^https?:/.test(href) ? ' rel="noopener"' : '');

  const r = c.root; // '../' for EN, '../../' for EL
  const homeHref = '../';
  const imgSrc = `${r}assets/img/${page.img}-${lang}.webp`;
  const siteBase = c.site ?? 'https://ruruchess.com/';
  const enUrl = `${siteBase}${page.slug}/`;
  const elUrl = `${siteBase}el/${page.slug}/`;
  const hasOther = Boolean(page[c.otherLang]);
  const pageUrl = lang === 'el' ? elUrl : enUrl;
  const homeUrl = lang === 'el' ? `${siteBase}el/` : siteBase;
  const otherHref = hasOther
    ? lang === 'el'
      ? `../../${page.slug}/`
      : `../el/${page.slug}/`
    : lang === 'el'
      ? '../../'
      : '../el/';
  const related = (c.guides ?? []).filter((g) => g.slug !== page.slug && g[lang]);

  const graph = [
    {
      '@type': 'WebPage',
      '@id': `${pageUrl}#webpage`,
      url: pageUrl,
      name: p.title,
      description: p.description,
      keywords: p.keywords,
      inLanguage: lang,
      ...(c.lastmod ? { dateModified: c.lastmod } : {}),
      isPartOf: { '@id': `${siteBase}#website` },
      about: { '@id': `${siteBase}#app` },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: `${siteBase}assets/img/${page.img}-${lang}.webp`,
        width: 2160,
        height: 1350,
      },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${pageUrl}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ruru Chess', item: homeUrl },
        { '@type': 'ListItem', position: 2, name: p.navLabel, item: pageUrl },
      ],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteBase}#app`,
      name: 'Ruru Chess',
      operatingSystem: 'Windows 10, Windows 11',
      applicationCategory: 'GameApplication',
      applicationSubCategory: 'Chess',
      softwareVersion: c.rev,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      ...(c.links.full.startsWith('http') ? { downloadUrl: c.links.full } : {}),
    },
    {
      '@type': 'FAQPage',
      '@id': `${pageUrl}#faq`,
      mainEntity: p.faq.map(([q, a]) => ({
        '@type': 'Question',
        name: stripHtml(q),
        acceptedAnswer: { '@type': 'Answer', text: stripHtml(a) },
      })),
    },
  ];
  const jsonLd = { '@context': 'https://schema.org', '@graph': graph };

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${escAttr(p.description)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F9F7F2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0C121E" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${r}favicon.ico" sizes="48x48">
<link rel="icon" href="${r}assets/favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="${r}assets/logo-256.png" type="image/png" sizes="256x256">
<link rel="apple-touch-icon" href="${r}assets/logo-256.png">
<link rel="manifest" href="${r}site.webmanifest">
<link rel="preload" as="image" href="${imgSrc}" type="image/webp" fetchpriority="high">
${
  c.site
    ? `<link rel="canonical" href="${pageUrl}">
${
  hasOther
    ? `<link rel="alternate" hreflang="en" href="${enUrl}">
<link rel="alternate" hreflang="el" href="${elUrl}">
<link rel="alternate" hreflang="x-default" href="${enUrl}">`
    : `<link rel="alternate" hreflang="${lang}" href="${pageUrl}">
<link rel="alternate" hreflang="x-default" href="${pageUrl}">`
}
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${siteBase}assets/img/og-${lang}.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escAttr(p.imgAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(p.title)}">
<meta name="twitter:description" content="${escAttr(p.description)}">
<meta name="twitter:image" content="${siteBase}assets/img/og-${lang}.png">
<meta name="twitter:image:alt" content="${escAttr(p.imgAlt)}">`
    : ''
}
<meta property="og:type" content="article">
<meta property="og:site_name" content="Ruru Chess">
<meta property="og:locale" content="${t.locale}">
<meta property="og:locale:alternate" content="${t.altLocale}">
<meta property="og:title" content="${escAttr(p.title)}">
<meta property="og:description" content="${escAttr(p.description)}">
${THEME_INIT}
<link rel="stylesheet" href="${r}assets/style.css?v=${c.assetVer ?? c.rev}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>

<header class="topbar" id="top">
  <div class="wrap topbar-in">
    <a class="brand" href="${homeHref}">
      <img src="${r}assets/icon.png" width="30" height="30" alt="Ruru Chess owl emblem">
      <span class="brand-name">Ruru <span>Chess</span></span>
    </a>
    <nav class="nav" id="menu" aria-label="${escAttr(t.menu)}">
      <a href="${homeHref}#analysis">${t.nav.overview}</a>
      <a href="${homeHref}#study">${t.nav.study}</a>
      <a href="${homeHref}#training">${t.nav.train}</a>
      ${renderNavGuides(lang, c, icon, '../', page.slug)}
      <a href="#faq">${t.nav.faq}</a>
      <a class="nav-lang" href="${otherHref}" hreflang="${c.otherLang}" lang="${c.otherLang}">${t.otherLang}</a>
    </nav>
    <div class="topbar-act">
      <button class="icon-toggle" type="button" id="theme-toggle" aria-label="${escAttr(t.themeToggle)}" title="${escAttr(t.themeToggle)}">
        <span class="ic-sun">${icon('sun')}</span>
        <span class="ic-moon">${icon('moon')}</span>
      </button>
      <a class="btn btn-ink btn-sm nav-dl" href="${c.links.full}" data-dl-guide>${icon('download')}<span>${t.nav.download}</span></a>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu" aria-label="${escAttr(t.menu)}">${icon('menu')}</button>
    </div>
  </div>
</header>

<main id="main">
  <section class="hero guide-hero">
    <div class="wrap">
      <nav class="crumb" aria-label="Breadcrumb">
        <a href="${homeHref}">Ruru Chess</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">${p.navLabel}</span>
      </nav>

      <div class="book-spread guide-spread">
        <div class="book-copy">
          <p class="kicker"><span class="kicker-dot" aria-hidden="true"></span>${p.eyebrow}</p>
          <h1>${p.h1}</h1>
          <p class="lead">${p.lead}</p>
          <div class="guide-actions">
            <a class="btn btn-cobalt btn-lg" href="${c.links.full}" data-dl-guide>
              ${icon('download')}
              <span class="btn-stack">
                <strong>${p.cta}</strong>
                <small>${fill(p.ctaSub)}</small>
              </span>
            </a>
            <p class="hero-links">
              <a href="${c.links.portable}">${t.hero.portable}</a>
              <span aria-hidden="true">·</span>
              <a href="${homeHref}#download">${t.hero.checksums}</a>
              <span aria-hidden="true">·</span>
              <a href="${c.links.repo}"${ext(c.links.repo)}>${t.hero.source}</a>
            </p>
          </div>
        </div>
        <div class="book-visual">
          <button class="frame zoom book-main" type="button" data-full="${imgSrc}" aria-label="${escAttr(t.hero.zoom)}: ${escAttr(p.imgAlt)}">
            <img src="${imgSrc}" width="2160" height="1350" alt="${escAttr(p.imgAlt)}" fetchpriority="high" decoding="async">
            <span class="zoom-hint" aria-hidden="true">${icon('maximize-2')}</span>
          </button>
          ${
            page.insetImg
              ? `<figure class="book-inset" aria-hidden="true">
            <span class="pdf-badge">${icon('file-text')}${p.pdfTag}</span>
            <img src="${r}assets/img/${page.insetImg}" width="960" height="600" alt="${escAttr(p.insetAlt)}" loading="lazy" decoding="async">
            <span class="pdf-arrow">${icon('arrow-right')}</span>
          </figure>`
              : ''
          }
        </div>
      </div>
    </div>
  </section>

  <section class="band band-warm" id="how-it-works">
    <div class="wrap">
      <header class="ch-head ch-head-tight">
        <p class="ch-eyebrow">${p.stepsEyebrow}</p>
        <h2>${p.stepsTitle}</h2>
      </header>
      <ol class="steps-grid">
        ${p.steps
          .map(
            ([title, text], i) => `<li class="step-card">
          <span class="step-num">0${i + 1}</span>
          <h3>${title}</h3>
          <p>${text}</p>
        </li>`,
          )
          .join('\n        ')}
      </ol>
    </div>
  </section>

  <section class="band" id="details">
    <div class="wrap">
      <header class="ch-head">
        <p class="ch-eyebrow">${p.featuresEyebrow}</p>
        <h2>${p.featuresTitle}</h2>
        <p class="ch-lead">${p.featuresLead}</p>
      </header>
      <div class="bento">
        ${p.cards
          .map(
            (card) => `<article class="bento-card">
          <span class="bento-tag">${card.tag}</span>
          <h3>${card.title}</h3>
          <p>${card.text}</p>
        </article>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>

  <section class="band band-warm" id="comparison">
    <div class="wrap wrap-narrow">
      <header class="ch-head ch-head-tight">
        <p class="ch-eyebrow">${p.compareEyebrow}</p>
        <h2>${p.compareTitle}</h2>
      </header>
      <div class="compare-wrap">
        <table class="compare-table">
          <thead>
            <tr>${p.compareCols.map((col, idx) => `<th${idx === 2 ? ' class="col-hl"' : ''}>${col}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${p.compareRows
              .map(
                (row) => `<tr>
              <td><strong>${row[0]}</strong></td>
              <td class="muted">${row[1]}</td>
              <td class="col-hl">${icon('check')}<span>${row[2]}</span></td>
            </tr>`,
              )
              .join('\n            ')}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="band" id="faq">
    <div class="wrap wrap-narrow">
      <header class="ch-head ch-head-tight">
        <p class="ch-eyebrow">${p.faqEyebrow}</p>
        <h2>${p.faqTitle}</h2>
      </header>
      <div class="faq-list">
        ${p.faq
          .map(
            ([q, a]) => `<details class="faq-item">
          <summary><span>${q}</span>${icon('chevron-down')}</summary>
          <div class="faq-ans"><p>${a}</p></div>
        </details>`,
          )
          .join('\n        ')}
      </div>
    </div>
  </section>

  <section class="band band-warm">
    <div class="wrap">
      <div class="guide-cta">
        <div>
          <h2>${p.ctaTitle}</h2>
          <p class="ch-lead">${p.ctaLead}</p>
        </div>
        <div class="guide-cta-act">
          <a class="btn btn-cobalt btn-lg" href="${c.links.full}" data-dl-guide>${icon('download')}<span>${p.cta}</span></a>
          <a class="small" href="${homeHref}">${lang === 'el' ? '← Δες όλες τις δυνατότητες του Ruru Chess' : '← Explore all Ruru Chess features'}</a>
        </div>
      </div>
      ${
        related.length
          ? `<div class="related-guides">
        <p class="ch-eyebrow">${lang === 'el' ? 'Περισσότεροι οδηγοί' : 'More guides'}</p>
        <div class="related-links">
          ${related.map((g) => `<a class="related-pill" href="../${g.slug}/">${g[lang].navLabel} ${icon('arrow-right')}</a>`).join('')}
        </div>
      </div>`
          : ''
      }
    </div>
  </section>
</main>

<footer class="footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="brand" href="${homeHref}">
          <img src="${r}assets/icon.png" width="28" height="28" alt="Ruru Chess">
          <span class="brand-name">Ruru <span>Chess</span></span>
        </a>
        <p>${t.footer.tagline}</p>
      </div>
      <nav class="footer-col" aria-label="${escAttr(t.footer.program)}">
        <h4>${t.footer.program}</h4>
        <a href="${homeHref}#download">${t.nav.download}</a>
        <a href="${c.links.release}"${ext(c.links.release)}>${d.whatsNew}</a>
        <a href="${homeHref}#faq">${t.nav.faq}</a>
      </nav>
      <nav class="footer-col" aria-label="${lang === 'el' ? 'Οδηγοί' : 'Guides'}">
        <h4>${lang === 'el' ? 'Οδηγοί' : 'Guides'}</h4>
        ${(c.guides ?? []).map((g) => `<a href="../${g.slug}/">${g[lang].navLabel}</a>`).join('\n        ')}
      </nav>
      <nav class="footer-col" aria-label="${escAttr(t.footer.project)}">
        <h4>${t.footer.project}</h4>
        <a href="${c.links.repo}"${ext(c.links.repo)}>${t.footer.code}</a>
        <a href="${c.links.issues}"${ext(c.links.issues)}>${t.footer.issues}</a>
        <a href="${c.links.license}"${ext(c.links.license)}>${t.footer.license}</a>
        <a href="../privacy">${t.footer.privacy}</a>
        <a href="../terms">${t.footer.terms}</a>
      </nav>
    </div>
    <div class="footer-base">
      <p>© ${c.year} Ruru Chess. ${t.footer.legal}</p>
      <a class="footer-lang" href="${otherHref}" hreflang="${c.otherLang}" lang="${c.otherLang}">${icon('languages')}<span>${t.otherLang}</span></a>
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
      <a class="small" href="${homeHref}#download" data-dl-close>${d.modalCheck}</a>
      <button type="button" class="btn btn-ink btn-sm" data-dl-close>${d.modalClose}</button>
    </div>
  </div>
</dialog>

<dialog class="lightbox" id="lightbox" aria-label="${escAttr(t.hero.zoom)}">
  <button type="button" class="lightbox-close" aria-label="Close">${icon('x')}</button>
  <img alt="">
</dialog>
<script src="${r}assets/site.js?v=${c.assetVer ?? c.rev}" defer></script>
</body>
</html>
`;
}
