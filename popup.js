// popup.js

const scrapeBtn  = document.getElementById('scrapeBtn');
const btnLabel   = document.getElementById('btnLabel');
const statusBox  = document.getElementById('statusBox');
const statusText = document.getElementById('statusText');
const progressFill = document.getElementById('progressFill');
const countRow   = document.getElementById('countRow');
const countLabel = document.getElementById('countLabel');
const countFrac  = document.getElementById('countFrac');
const warning    = document.getElementById('warning');
const filterTags = document.getElementById('filterTags');
const gearBtn    = document.getElementById('gearBtn');
const filterEditLink = document.getElementById('filterEditLink');

let running = false;
let currentSettings = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  currentSettings = await Storage.get();
  renderModeButtons(currentSettings.mode);
  renderFilterStrip(currentSettings.filters);
  await checkCurrentTab();
})();

// ─── Tab check ───────────────────────────────────────────────────────────────
async function checkCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  if (!url.includes('1337x.to')) {
    showWarning('Not on 1337x. Navigate to a search results page first.');
    scrapeBtn.disabled = true;
    setStatus('idle', 'Not on 1337x.');
  } else if (!url.match(/1337x\.to\/(search|sort-search|category-search|sub)\//)) {
    showWarning('Navigate to a search results listing page, not a detail page.');
    scrapeBtn.disabled = true;
    setStatus('idle', 'Go to a search results page.');
  } else {
    setStatus('idle', 'Ready — click to scrape this results page.');
  }
}

// ─── Mode buttons ─────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    await Storage.set({ mode });
    currentSettings.mode = mode;
    renderModeButtons(mode);
  });
});

function renderModeButtons(activeMode) {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === activeMode);
  });
}

// ─── Filter strip ─────────────────────────────────────────────────────────────
function renderFilterStrip(filters) {
  const tags = [];

  const min = parseFloat(filters.sizeMinGB);
  const max = parseFloat(filters.sizeMaxGB);
  if (!isNaN(min) && min > 0 && !isNaN(max) && max > 0) {
    tags.push({ label: `${min}–${max} GB`, active: true });
  } else if (!isNaN(min) && min > 0) {
    tags.push({ label: `≥ ${min} GB`, active: true });
  } else if (!isNaN(max) && max > 0) {
    tags.push({ label: `≤ ${max} GB`, active: true });
  }

  if (filters.skipYify) tags.push({ label: 'No YIFY', active: true });

  if (!tags.length) {
    filterTags.innerHTML = '<span class="filter-tag">none active</span>';
  } else {
    filterTags.innerHTML = tags.map(t =>
      `<span class="filter-tag${t.active ? ' active' : ''}">${t.label}</span>`
    ).join('');
  }
}

// ─── Gear / filter edit → open options ───────────────────────────────────────
gearBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
filterEditLink.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ─── Scrape button ────────────────────────────────────────────────────────────
scrapeBtn.addEventListener('click', async () => {
  if (running) return;
  running = true;

  // Re-read settings fresh at scrape time
  currentSettings = await Storage.get();

  scrapeBtn.disabled = true;
  btnLabel.textContent = 'Working…';
  scrapeBtn.classList.add('running');
  countRow.style.display = 'flex';
  setStatus('running', 'Scraping results page…');

  const progressListener = (msg) => {
    if (msg.action === 'progress') {
      const pct = msg.total > 0 ? Math.round((msg.current / msg.total) * 100) : 0;
      progressFill.style.width = pct + '%';
      countFrac.textContent = `${msg.current} / ${msg.total}`;

      if (msg.filtered) {
        countLabel.textContent = `Fetching · ${msg.filtered} filtered`;
      } else {
        countLabel.textContent = msg.current < msg.total ? 'Fetching detail pages…' : 'Finalising…';
      }

      const short = (msg.label || '').length > 34 ? msg.label.slice(0, 31) + '…' : (msg.label || '');
      setStatus('running', `[${msg.current}/${msg.total}] ${short}`);
    }
  };
  chrome.runtime.onMessage.addListener(progressListener);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const response = await chrome.runtime.sendMessage({
      action: 'startScrape',
      tabId: tab.id,
      settings: currentSettings,
    });

    chrome.runtime.onMessage.removeListener(progressListener);

    if (!response.ok) throw new Error(response.error || 'Unknown error');

    await navigator.clipboard.writeText(response.payload);

    const torrentCount = (response.payload.match(/^## \[/gm) || []).length;
    const filteredCount = (response.payload.match(/\[FILTERED/g) || []).length;
    const fetchedCount  = torrentCount - filteredCount;

    const summary = filteredCount > 0
      ? `✓ Copied! ${torrentCount} total · ${fetchedCount} fetched · ${filteredCount} filtered`
      : `✓ Copied! ${torrentCount} torrents → clipboard`;

    setStatus('done', summary);
    btnLabel.textContent = 'Copied!';
    scrapeBtn.classList.remove('running');
    statusBox.classList.add('done');

    setTimeout(() => {
      setStatus('idle', 'Ready. Click to scrape again.');
      btnLabel.textContent = 'Scrape & Copy';
      scrapeBtn.disabled = false;
      statusBox.classList.remove('done');
      countRow.style.display = 'none';
      progressFill.style.width = '0%';
      running = false;
    }, 4000);

  } catch (err) {
    chrome.runtime.onMessage.removeListener(progressListener);
    setStatus('error', `✗ ${err.message}`);
    statusBox.classList.add('error');
    btnLabel.textContent = 'Scrape & Copy';
    scrapeBtn.classList.remove('running');
    scrapeBtn.disabled = false;
    countRow.style.display = 'none';
    running = false;
    setTimeout(() => statusBox.classList.remove('error'), 5000);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setStatus(state, text) {
  statusBox.classList.remove('running', 'done', 'error');
  if (state !== 'idle') statusBox.classList.add(state);
  statusText.textContent = text;
}

function showWarning(msg) {
  warning.textContent = '⚠ ' + msg;
  warning.classList.add('visible');
}
