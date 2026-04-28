// defaults.js — shared across background, popup, options
// Loaded as a plain script; also importable as a module in service worker via self.

const DEFAULTS = {
  mode: 'quality', // 'quality' | 'compatibility' | 'size' | 'manual'

  filters: {
    sizeMinGB: '',       // '' = no minimum
    sizeMaxGB: '',       // '' = no maximum
    skipYify: true,
    scrapeComments: false,
  },

  prompts: {
    quality: `You are helping select the best torrent for a home media server. Prioritise quality above all else.

PREFER:
- Remux (BDRemux, UHDRemux) — lossless source, always top pick if seeded
- Blu-ray / UHD encode from reputable scene groups (FGT, SPARKS, YIFY excluded)
- High bitrate (movies: 20GB+, TV: 3GB+ per episode)
- H.264 or H.265 video, lossless or high-quality audio (TrueHD, DTS-HD MA, FLAC)
- Seeder count 50+

FLAG / DEPRIORITISE:
- CAM, HDCAM, R5, TS, SCR, WEB-DL with low bitrate
- YIFY / YTS releases (small file size, crushed quality)
- Unknown uploaders with <10 seeds
- Audio: AC3 640k is acceptable; anything lower is suspicious
- HEVC from unknown encoders (may have compatibility issues)

For each torrent, state: codec, audio track, estimated bitrate if inferable from size/runtime, uploader reputation, and your recommendation tier (Recommended / Acceptable / Skip).`,

    compatibility: `You are helping select the best torrent for a home media server optimised for direct play across multiple clients (web player, Android TV, iOS, Chromecast).

PREFER:
- H.264 (AVC) video — universally compatible, no transcoding
- AAC or AC3 audio — direct plays everywhere
- MP4 or MKV container
- 1080p resolution (4K may force transcoding on weaker clients)
- Web-DL or Blu-ray encode, reputable uploader

FLAG / DEPRIORITISE:
- H.265 / HEVC — may transcode on older clients, check your hardware
- AV1 — limited hardware decode support, likely to transcode
- DTS, TrueHD, Atmos — will transcode audio on most clients; flag clearly
- Remux files (often too large and may cause buffering)
- 4K HDR — requires tone-mapping, high transcode load
- CAM / TS / R5 sources — poor quality

For each torrent, state: video codec, audio codec, container, resolution, and whether it is likely to DIRECT PLAY or TRANSCODE on a typical media server setup. Give a compatibility score (Direct Play Safe / Needs Transcode / Avoid).`,

    size: `You are helping select the best torrent for a home media server where storage efficiency matters.

PREFER:
- Smallest file that maintains acceptable quality (720p or 1080p x265/HEVC)
- Web-DL or WEBRip encodes — good quality/size ratio
- x265 encodes under 4GB for movies, under 800MB per TV episode
- AAC audio (efficient, small)
- YIFY acceptable ONLY if nothing better at similar size (note quality compromise)

FLAG / DEPRIORITISE:
- Remux / BDRemux — unnecessarily large for storage-conscious setups
- Anything over 20GB for a standard movie
- Lossless audio (TrueHD, FLAC) — large overhead with minimal benefit on most displays
- Duplicate entries at different sizes — identify the best size/quality tradeoff

For each torrent, calculate approximate GB per hour of content if runtime is known, or estimate from file size and resolution. Rank by storage efficiency while maintaining watchable quality. State: size, estimated quality tier, storage efficiency rating (Efficient / Acceptable / Wasteful).`,

    manual: `You are helping select the best torrent for a home media server.

Analyse each torrent and provide a recommendation. Consider: video codec, audio codec, file size, seeder count, uploader reputation, and source quality.

Flag: CAM/TS/SCR sources, very low seeds (<5), unknown uploaders, and unusual codecs that may cause compatibility or playback issues.`,
  },
};

// Storage helpers — used in both service worker and options page
const Storage = {
  async get() {
    return new Promise(resolve => {
      chrome.storage.sync.get({
        mode: DEFAULTS.mode,
        filters: DEFAULTS.filters,
        prompts: DEFAULTS.prompts,
      }, resolve);
    });
  },

  async set(data) {
    return new Promise(resolve => {
      chrome.storage.sync.set(data, resolve);
    });
  },
};
