// Μενού κινητού, εναλλαγή φωτεινού/σκοτεινού θέματος, διαδραστικές καρτέλες και lightbox.
// Η σελίδα λειτουργεί πλήρως και χωρίς JavaScript.
(() => {
  // Μενού κινητού
  const menuBtn = document.querySelector('.menu-btn');
  const menu = document.getElementById('menu');
  const setOpen = (open) => {
    menu?.classList.toggle('open', open);
    menuBtn?.setAttribute('aria-expanded', String(open));
  };
  menuBtn?.addEventListener('click', () => setOpen(!menu?.classList.contains('open')));
  menu?.addEventListener('click', (e) => e.target.closest('a') && setOpen(false));

  // Κλείσιμο dropdown «Οδηγοί / Guides» με κλικ έξω ή Escape
  const navDd = document.querySelector('.nav-dd');
  if (navDd) {
    document.addEventListener('click', (e) => {
      if (navDd.open && !navDd.contains(e.target)) navDd.open = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navDd.open) navDd.open = false;
    });
  }

  // Εναλλαγή θέματος (χωρίς cookies, μόνο τοπικό localStorage)
  const themeBtn = document.getElementById('theme-toggle');
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  themeBtn?.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.classList.add('no-trans');
    document.documentElement.dataset.theme = next;
    void document.documentElement.offsetWidth;
    document.documentElement.classList.remove('no-trans');
    try {
      localStorage.setItem('ruru-theme', next);
    } catch {}
  });

  // Βοηθητικό: αλλαγή καρτέλας και με τα βελάκια του πληκτρολογίου (← / →)
  const wireArrows = (tabs) => {
    tabs.forEach((tab, i) => {
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        next.focus();
        next.click();
      });
    });
  };

  // Hero διαδραστική σκηνή (5 καρτέλες)
  const stage = document.querySelector('[data-hero-stage]');
  if (stage) {
    const tabs = [...stage.querySelectorAll('.stage-tab')];
    wireArrows(tabs);
    const img = document.getElementById('hero-img');
    const zoomBtn = document.getElementById('hero-zoom');
    const caption = document.getElementById('hero-caption');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        for (const t of tabs) {
          const active = t === tab;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', String(active));
        }
        const src = tab.dataset.src;
        const alt = tab.dataset.alt || '';
        if (img && src) {
          img.src = src;
          img.alt = alt;
        }
        if (zoomBtn && src) zoomBtn.dataset.full = src;
        if (caption) caption.textContent = tab.dataset.caption || '';
      });
    }
  }

  // Καρτέλες κεφαλαίων (Ανάλυση & Προπόνηση)
  for (const wb of document.querySelectorAll('[data-tabs]')) {
    const tabs = [...wb.querySelectorAll('[data-tab-idx]')];
    wireArrows(tabs);
    const panels = [...wb.querySelectorAll('[data-panel-idx]')];
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        const idx = tab.dataset.tabIdx;
        for (const t of tabs) {
          const active = t.dataset.tabIdx === idx;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', String(active));
        }
        for (const p of panels) {
          const active = p.dataset.panelIdx === idx;
          p.classList.toggle('is-active', active);
          p.hidden = !active;
        }
      });
    }
  }

  // Οδηγός εγκατάστασης / SmartScreen αμέσως μόλις πατηθεί το Download
  const dlModal = document.getElementById('dl-modal');
  if (dlModal?.showModal) {
    for (const a of document.querySelectorAll('[data-dl-guide]')) {
      a.addEventListener('click', () => {
        setTimeout(() => {
          if (!dlModal.open) dlModal.showModal();
        }, 120);
      });
    }
    dlModal.addEventListener('click', (e) => {
      if (e.target === dlModal || e.target.closest('[data-dl-close]')) dlModal.close();
    });
  }

  // Μεγέθυνση εικόνων (Lightbox)
  const box = document.getElementById('lightbox');
  if (!box?.showModal) return;
  const big = box.querySelector('img');
  for (const z of document.querySelectorAll('.zoom')) {
    z.addEventListener('click', () => {
      if (!big) return;
      big.src = z.dataset.full || z.querySelector('img')?.src || '';
      big.alt = z.querySelector('img')?.alt || '';
      box.showModal();
    });
  }
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.closest('.lightbox-close')) box.close();
  });
})();
