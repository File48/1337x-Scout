# 1337x Scout

Scrapes 1337x search results + per-torrent mediainfo blocks and copies a structured Markdown payload to your clipboard, ready to paste into an AI chat for filtering recommendations.

---

## Install (Brave / Chrome)

1. Open `brave://extensions` or `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder (`1337x-scraper/`)

The extension icon appears in your toolbar. Pin it for easy access.

---

## Usage

1. Go to **1337x.to** and run a search (film, show, season pack, etc.)
2. Click the extension icon in the toolbar
3. Click **Scrape & Copy**
4. Watch the progress bar as it visits each detail page in the background
5. When done, paste into your AI chat of choice

The popup will tell you how many torrents were processed and confirm the copy.

---

## What gets collected per torrent

| Field | Source |
|---|---|
| Name | Search results table |
| Size | Search results table |
| Seeders / Leechers | Search results table |
| Uploader | Search results table |
| Date | Search results table |
| Info Hash | Detail page (magnet link) |
| MediaInfo block | Detail page `<pre>` element |
| Comments (optional) | Detail page comment section |

---

## Output format

The clipboard payload is structured Markdown:

```
# 1337x Torrent Research Payload
# Generated: 2024-11-15 14:32:01
# Total results: 20
```
---

## PROMPT FOR AI
Below are 20 torrent options scraped from 1337x. Please analyse them...

---

#### [1] Movie.Name.2024.2160p.BluRay...
- **Size:** 58.3 GB
- **Seeds / Leeches:** 142 / 23
- **Uploader:** someUploader
- **Date:** Nov. 10th '24
- **Info Hash:** ABC123...

##### MediaInfo
```
General
Complete name: Movie.Name.2024...
Format: Matroska
...
```
---

## Notes

- **Cloudflare**: The extension runs in your live browser session so Cloudflare challenges are already handled. A 400ms delay between detail page visits avoids triggering rate limits.
- **Background tabs**: Each detail page opens in a hidden tab and is automatically closed after scraping.
- **No external requests**: All data stays local. Nothing is sent anywhere — only your clipboard is written.
- **MediaInfo missing**: Not every torrent has a mediainfo block in its description. The output will note when one wasn't found.

---

## Permissions used

| Permission | Why |
|---|---|
| `tabs` | Open background tabs for detail pages |
| `scripting` | Execute content scripts to read page DOM |
| `activeTab` | Read the current search results page |
| `clipboardWrite` | Write the compiled payload to clipboard |
| `host_permissions: 1337x.to` | Required to inject scripts into 1337x pages |
