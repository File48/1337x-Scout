// background.js — MV3 service worker

importScripts('defaults.js');

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startScrape') {
    handleStartScrape(msg.tabId, msg.settings)
      .then(payload => sendResponse({ ok: true, payload }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ─── Main orchestration ───────────────────────────────────────────────────────
async function handleStartScrape(tabId, settings) {
  const filters = settings?.filters  || DEFAULTS.filters;
  const mode    = settings?.mode     || DEFAULTS.mode;
  const prompts = settings?.prompts  || DEFAULTS.prompts;

  // 1. Scrape the results listing
  const [exec] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const rows = document.querySelectorAll('table.table-list tbody tr');
      if (!rows.length) return { error: 'No result rows found. Are you on a search results page?' };

      const results = [];
      rows.forEach(row => {
        const nameEl     = row.querySelector('td.name a:nth-child(2)');
        const seedEl     = row.querySelector('td.seeds');
        const leechEl    = row.querySelector('td.leeches');
        const dateEl     = row.querySelector('td.coll-date');
        const sizeEl     = row.querySelector('td.size');
        const uploaderEl = row.querySelector('td.coll-5 a, td.uploader a');

        if (!nameEl) return;

        const detailPath = nameEl.getAttribute('href');
        const detailUrl  = detailPath
          ? (detailPath.startsWith('http') ? detailPath : `https://1337x.to${detailPath}`)
          : null;

        // Strip hidden child text nodes from size cell
        let sizeText = sizeEl ? sizeEl.innerText.trim().split('\n')[0].trim() : '';

        results.push({
          name:     nameEl.innerText.trim(),
          detailUrl,
          seeders:  seedEl   ? parseInt(seedEl.innerText.trim(),  10) || 0 : 0,
          leechers: leechEl  ? parseInt(leechEl.innerText.trim(), 10) || 0 : 0,
          size:     sizeText,
          date:     dateEl     ? dateEl.innerText.trim()     : '',
          uploader: uploaderEl ? uploaderEl.innerText.trim() : 'anonymous',
        });
      });

      return { results };
    },
  });

  const scrapeResult = exec.result;
  if (scrapeResult.error) throw new Error(scrapeResult.error);

  const torrents = scrapeResult.results;
  const total    = torrents.length;

  // Separate filtered from those needing detail fetches
  const enriched = new Array(torrents.length);
  let filteredSoFar = 0;
  const fetchQueue = []; // { index, torrent }

  for (let i = 0; i < torrents.length; i++) {
    const torrent = torrents[i];
    const filterResult = applyFilters(torrent, filters);

    if (filterResult.filtered) {
      filteredSoFar++;
      enriched[i] = {
        ...torrent,
        filtered: true,
        filterReason: filterResult.reason,
        mediainfo: null, magnetLink: null, infoHash: null,
      };
    } else if (!torrent.detailUrl) {
      enriched[i] = { ...torrent, filtered: false, mediainfo: null, magnetLink: null, infoHash: null };
    } else {
      fetchQueue.push({ index: i, torrent });
    }
  }

  // 2. Block CSS + images on 1337x detail pages for all background tabs
  await enableResourceBlocking();

  // 3. Process fetch queue with concurrency pool of 3
  const CONCURRENCY = 3;
  let completed = 0;
  let queuePos  = 0;

  broadcastProgress(0, total, torrents[0]?.name || '', filteredSoFar);

  async function runWorker() {
    while (queuePos < fetchQueue.length) {
      const { index, torrent } = fetchQueue[queuePos++];

      try {
        const detail = await scrapeDetailPage(torrent.detailUrl, filters.scrapeComments);
        enriched[index] = { ...torrent, filtered: false, ...detail };
      } catch (e) {
        enriched[index] = {
          ...torrent, filtered: false,
          mediainfo: null, magnetLink: null, infoHash: null,
          detailError: e.message,
        };
      }

      completed++;
      broadcastProgress(completed + filteredSoFar, total, torrent.name, filteredSoFar);
    }
  }

  // Launch pool
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, fetchQueue.length) }, runWorker)
  );

  // 4. Remove blocking rules
  await disableResourceBlocking();

  broadcastProgress(total, total, 'Done', filteredSoFar);

  // 5. Build payload
  const activePrompt = (prompts && prompts[mode]) || DEFAULTS.prompts[mode] || DEFAULTS.prompts.manual;
  return buildPayload(enriched, activePrompt, mode, filters);
}

// ─── declarativeNetRequest — block CSS + images on 1337x detail tabs ─────────
const DNR_RULE_IDS = [901, 902]; // arbitrary stable IDs, outside any static ruleset

async function enableResourceBlocking() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: DNR_RULE_IDS,
    addRules: [
      {
        id: DNR_RULE_IDS[0],
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: '||1337x.to/*',
          resourceTypes: ['stylesheet', 'image', 'font', 'media'],
          tabIds: [], // populated below — but DNR doesn't support dynamic tabIds easily
        },
      },
    ],
  }).catch(() => {});
  // Note: DNR doesn't support per-tab rules cleanly in MV3 without tabIds at rule creation,
  // so we scope by domain only. Rules are removed immediately after scraping completes.
}

async function disableResourceBlocking() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: DNR_RULE_IDS,
  }).catch(() => {});
}

// ─── Filter logic ─────────────────────────────────────────────────────────────
function applyFilters(torrent, filters) {
  // YIFY / YTS filter
  if (filters.skipYify) {
    const uploaderLower = (torrent.uploader || '').toLowerCase();
    const nameLower     = (torrent.name || '').toLowerCase();

    const yifyUploaderMatch = /\b(yify|yts\.mx|yts\.am|yts\.lt|yts)\b/.test(uploaderLower);
    const yifyNameMatch     = /\[yts\.|yify|yts\.mx|yts\.am|yts\.lt/.test(nameLower);

    if (yifyUploaderMatch || yifyNameMatch) {
      return { filtered: true, reason: 'YIFY/YTS release' };
    }
  }

  // Size filter — parse the size string to GB
  const sizeGB = parseSizeToGB(torrent.size);
  if (sizeGB !== null) {
    const minGB = parseFloat(filters.sizeMinGB);
    const maxGB = parseFloat(filters.sizeMaxGB);

    if (!isNaN(minGB) && minGB > 0 && sizeGB < minGB) {
      return { filtered: true, reason: `Size ${torrent.size} below minimum ${minGB} GB` };
    }
    if (!isNaN(maxGB) && maxGB > 0 && sizeGB > maxGB) {
      return { filtered: true, reason: `Size ${torrent.size} above maximum ${maxGB} GB` };
    }
  }

  return { filtered: false };
}

/**
 * Parse a size string like "4.2 GB", "720 MB", "1.1 TB" → GB as float.
 * Returns null if unparseable.
 */
function parseSizeToGB(sizeStr) {
  if (!sizeStr) return null;
  const m = sizeStr.match(/([\d.,]+)\s*(KB|MB|GB|TB)/i);
  if (!m) return null;

  const value = parseFloat(m[1].replace(',', '.'));
  const unit  = m[2].toUpperCase();

  switch (unit) {
    case 'KB': return value / (1024 * 1024);
    case 'MB': return value / 1024;
    case 'GB': return value;
    case 'TB': return value * 1024;
    default:   return null;
  }
}

// ─── Detail page scraper ──────────────────────────────────────────────────────
async function scrapeDetailPage(url, scrapeComments) {
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    await waitForTabLoad(tab.id);
    await sleep(300); // Cloudflare settle — faster since CSS/images are blocked

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (scrapeComments) => {
        let mediainfo = null;

        const pres = document.querySelectorAll('pre');
        for (const pre of pres) {
          const text = pre.innerText.trim();
          if (text.length > 50 && /^(General|VIDEO|AUDIO|Format\s*:)/im.test(text)) {
            mediainfo = text;
            break;
          }
        }

        if (!mediainfo) {
          const desc = document.querySelector('.torrent-detail, #description, .box-info-detail, .torrent-detail-info');
          if (desc) {
            const m = desc.innerText.match(/(General[\s\S]{20,})/);
            if (m) mediainfo = m[1].trim();
          }
        }

        // Fallback: quote blocks — uploaders sometimes paste encoding info into [quote] tags
        // which render as <blockquote> inside the description
        let quoteTechInfo = null;
        if (!mediainfo) {
          const blockquotes = document.querySelectorAll('.torrent-work-detail');
          const techKeywords = /\b(bitrate|encoding|codec|h\.?264|h\.?265|hevc|avc|aac|ac-?3|e-ac-?3|atmos|dts|format|source|audio|video|resolution|fps|kbps|kb\/s)\b/i;
          for (const bq of blockquotes) {
            const text = bq.innerText.trim();
            if (text.length > 20 && techKeywords.test(text)) {
              quoteTechInfo = text;
              break;
            }
          }
        }

        const magnetEl  = document.querySelector('a[href^="magnet:"]');
        const magnetLink = magnetEl ? magnetEl.getAttribute('href') : null;

        let infoHash = null;
        const hashEl = document.querySelector('.infohash-box span, #infohash');
        if (hashEl) {
          infoHash = hashEl.innerText.trim();
        } else if (magnetLink) {
          const m = magnetLink.match(/urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
          if (m) infoHash = m[1].toUpperCase();
        }

        // Comments — only scraped if enabled in settings
        let comments = null;
        if (scrapeComments) {
          // 1337x comment structure: #comments > .comment-content or .tab-pane .comment-list
          const commentEls = document.querySelectorAll(
            '#comments .comment-content p, .comment-row .comment-content, .tab-pane .media-body p'
          );
          if (commentEls.length) {
            const parsed = [];
            commentEls.forEach(el => {
              const text = el.innerText.trim();
              if (text.length > 10) parsed.push(text);
            });
            if (parsed.length) comments = parsed;
          }
        }

        return { mediainfo, quoteTechInfo, magnetLink, infoHash, comments };
      },
      args: [scrapeComments],
    });

    return result.result;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ─── Payload builder ──────────────────────────────────────────────────────────
function buildPayload(torrents, activePrompt, mode, filters) {
  const lines = [];
  const ts = new Date().toLocaleString('sv').slice(0, 19);
  const total    = torrents.length;
  const filtered = torrents.filter(t => t.filtered).length;
  const fetched  = total - filtered;

  lines.push(`# 1337x Torrent Research Payload`);
  lines.push(`# Generated: ${ts}`);
  lines.push(`# Mode: ${mode} | Total: ${total} | Fetched: ${fetched} | Filtered: ${filtered}`);
  if (filtered > 0) {
    const activeFilters = [];
    if (filters.skipYify) activeFilters.push('YIFY/YTS');
    const minGB = parseFloat(filters.sizeMinGB);
    const maxGB = parseFloat(filters.sizeMaxGB);
    if (!isNaN(minGB) && minGB > 0) activeFilters.push(`min ${minGB} GB`);
    if (!isNaN(maxGB) && maxGB > 0) activeFilters.push(`max ${maxGB} GB`);
    lines.push(`# Active filters: ${activeFilters.join(', ')}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## YOUR TASK');
  lines.push('');
  lines.push(activePrompt.trim());
  lines.push('');
  lines.push(`There are ${fetched} torrents to analyse below (${filtered} were pre-filtered and shown for reference).`);
  lines.push('');
  lines.push('---');
  lines.push('');

  torrents.forEach((t, i) => {
    const filteredLabel = t.filtered ? ` [FILTERED: ${t.filterReason}]` : '';
    lines.push(`## [${i + 1}]${filteredLabel} ${t.name}`);
    lines.push(`- **Size:** ${t.size || 'unknown'}`);
    lines.push(`- **Seeds / Leeches:** ${t.seeders} / ${t.leechers}`);
    lines.push(`- **Uploader:** ${t.uploader}`);
    lines.push(`- **Date:** ${t.date}`);
    if (t.infoHash)    lines.push(`- **Info Hash:** ${t.infoHash}`);
    if (t.detailError) lines.push(`- **Detail fetch error:** ${t.detailError}`);

    if (!t.filtered) {
      lines.push('');
      if (t.mediainfo) {
        lines.push('### MediaInfo');
        lines.push('```');
        lines.push(t.mediainfo.trim());
        lines.push('```');
      } else if (t.quoteTechInfo) {
        lines.push('### MediaInfo (from description quote)');
        lines.push('```');
        lines.push(t.quoteTechInfo.trim());
        lines.push('```');
      } else {
        lines.push('### MediaInfo');
        lines.push('_No mediainfo block found on detail page._');
      }

      if (t.comments && t.comments.length) {
        lines.push('');
        lines.push('### Comments');
        t.comments.forEach((c, i) => {
          lines.push(`${i + 1}. ${c}`);
        });
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function broadcastProgress(current, total, label, filtered) {
  chrome.runtime.sendMessage({ action: 'progress', current, total, label, filtered }).catch(() => {});
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 30000);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
