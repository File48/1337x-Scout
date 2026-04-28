// content.js — injected into all 1337x pages
// Responds to messages from background.js for any fallback scraping needs.

(function () {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'scrapeResults') {
      sendResponse(scrapeSearchResults());
    } else if (msg.action === 'scrapeDetail') {
      sendResponse(scrapeTorrentDetail());
    }
    return true;
  });

  function scrapeSearchResults() {
    const rows = document.querySelectorAll('table.table-list tbody tr');
    if (!rows.length) return { error: 'No result rows found.' };

    const results = [];
    rows.forEach(row => {
      try {
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
      } catch (_) {}
    });

    return { results };
  }

  function scrapeTorrentDetail() {
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

    return { mediainfo, magnetLink, infoHash };
  }
})();
