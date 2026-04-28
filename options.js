// options.js

let settings = null; // live working copy

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  settings = await Storage.get();

  // Merge in any missing prompt keys from DEFAULTS (handles upgrades)
  settings.prompts = Object.assign({}, DEFAULTS.prompts, settings.prompts || {});

  // Populate filters
  document.getElementById('sizeMin').value = settings.filters.sizeMinGB || '';
  document.getElementById('sizeMax').value = settings.filters.sizeMaxGB || '';
  setToggle('yifyBox', settings.filters.skipYify);
  setToggle('commentsBox', settings.filters.scrapeComments);

  // Populate prompt textareas
  ['quality', 'compatibility', 'size', 'manual'].forEach(key => {
    const ta = document.getElementById('prompt' + capitalise(key));
    ta.value = settings.prompts[key] || DEFAULTS.prompts[key] || '';
    updateCharCount(key);

    ta.addEventListener('input', () => updateCharCount(key));
  });

  // Activate URL hash section if present
  const hash = location.hash.replace('#', '');
  if (hash) activateSection(hash);
})();

// ─── Nav ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const sectionKey = item.dataset.section;
    activateSection(sectionKey);
    location.hash = sectionKey;
  });
});

function activateSection(key) {
  // Nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    const match = item.dataset.section === key;
    item.classList.toggle('active', match);

    // Apply colour class
    item.classList.remove('blue', 'amber', 'muted');
    if (match && item.dataset.color) item.classList.add(item.dataset.color);
  });

  // Sections
  document.querySelectorAll('.section').forEach(s => {
    s.classList.toggle('active', s.id === `section-${key}`);
  });
}

// ─── Toggle rows ─────────────────────────────────────────────────────────────
document.getElementById('toggleYify').addEventListener('click', () => {
  const box = document.getElementById('yifyBox');
  setToggle('yifyBox', !box.classList.contains('on'));
});

document.getElementById('toggleComments').addEventListener('click', () => {
  const box = document.getElementById('commentsBox');
  setToggle('commentsBox', !box.classList.contains('on'));
});

function setToggle(id, on) {
  const box = document.getElementById(id);
  box.classList.toggle('on', on);
}

// ─── Reset buttons ────────────────────────────────────────────────────────────
document.querySelectorAll('[data-reset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.reset;
    const ta  = document.getElementById('prompt' + capitalise(key));
    if (!ta) return;
    ta.value = DEFAULTS.prompts[key] || '';
    updateCharCount(key);
    ta.focus();
  });
});

// ─── Save all ────────────────────────────────────────────────────────────────
document.getElementById('saveAllBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveAllBtn');
  btn.disabled = true;

  // Collect current values
  const updatedFilters = {
    sizeMinGB: document.getElementById('sizeMin').value.trim(),
    sizeMaxGB: document.getElementById('sizeMax').value.trim(),
    skipYify:        document.getElementById('yifyBox').classList.contains('on'),
    scrapeComments:  document.getElementById('commentsBox').classList.contains('on'),
  };

  const updatedPrompts = {};
  ['quality', 'compatibility', 'size', 'manual'].forEach(key => {
    updatedPrompts[key] = document.getElementById('prompt' + capitalise(key)).value;
  });

  await Storage.set({
    filters: updatedFilters,
    prompts: updatedPrompts,
    // don't overwrite mode from options page
  });

  // Flash indicator
  const indicator = document.getElementById('savedIndicator');
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 2000);

  btn.disabled = false;
});

// ─── Char counts ─────────────────────────────────────────────────────────────
function updateCharCount(key) {
  const ta    = document.getElementById('prompt' + capitalise(key));
  const span  = document.getElementById('char' + capitalise(key));
  if (!ta || !span) return;
  span.textContent = ta.value.length.toLocaleString() + ' chars';
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
