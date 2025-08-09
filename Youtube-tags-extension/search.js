// search.js
// Complete script for YouTube Tag Manager
// - Uses chrome.storage.local when available, falls back to localStorage
// - Renders cards, edit/delete, title search, tag filtering
// - Playlist built from visible results, shuffled on start
// - When a playlist fully loops, a new shuffle is produced
// - Embedded YouTube player (YT iframe API) shown during playlist
// - Auto-next 3s after a video ends, prev/next/play/pause/stop controls
// - Media keys support via Media Session API and keydown fallback
// - Designed to match the index.html you provided

// ----------------------------- Storage helpers -----------------------------
const HAS_CHROME_STORAGE = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

function storageGet(key, cb) {
  if (HAS_CHROME_STORAGE) {
    chrome.storage.local.get(key, (data) => cb(data[key]));
  } else {
    const raw = localStorage.getItem(key);
    cb(raw ? JSON.parse(raw) : undefined);
  }
}

function storageSet(obj, cb) {
  if (HAS_CHROME_STORAGE) {
    chrome.storage.local.set(obj, cb || (() => {}));
  } else {
    // obj is { key: value, ... }
    Object.keys(obj).forEach(k => localStorage.setItem(k, JSON.stringify(obj[k])));
    if (cb) cb();
  }
}

// ----------------------------- Globals -----------------------------
let playlist = [];         // the current shuffled playlist (array of video IDs)
let basePlaylist = [];     // the current ordered list of visible results (used for reshuffling)
let playlistIndex = 0;
let isPlaying = false;

let ytPlayerInstance = null;
let nextVideoTimeout = null;
let lastVideoEndedAt = 0;
const PREV_LOOP_WINDOW_MS = 5000; // within 5s after end, prev loops current
const AUTO_NEXT_DELAY_MS = 3000;  // 3s pause after end

// ----------------------------- YouTube API loader & player -----------------------------
function loadYouTubeAPI() {
  // If already available, call ready; otherwise inject the script
  if (window.YT && YT.Player) {
    onYouTubeIframeAPIReady();
    return;
  }
  if (document.getElementById('yt-api')) {
    // already injected
    return;
  }
  const tag = document.createElement('script');
  tag.id = 'yt-api';
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  // YouTube API will call this when ready
  window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
}

function onYouTubeIframeAPIReady() {
  try {
    // create player in the #ytplayer div
    ytPlayerInstance = new YT.Player('ytplayer', {
      height: '360',
      width: '640',
      playerVars: {
        controls: 1,
        rel: 0,
        modestbranding: 1,
        enablejsapi: 1
      },
      events: {
        'onStateChange': onPlayerStateChange,
        'onError': (e) => console.warn('YT player error', e)
      }
    });
  } catch (err) {
    console.error('Error creating YT Player', err);
  }
}

function onPlayerStateChange(event) {
  const state = event.data;
  // YT.PlayerState.ENDED === 0, PLAYING === 1, PAUSED === 2
  if (state === YT.PlayerState.ENDED) {
    lastVideoEndedAt = Date.now();
    isPlaying = false;
    // schedule next
    if (nextVideoTimeout) {
      clearTimeout(nextVideoTimeout);
      nextVideoTimeout = null;
    }
    nextVideoTimeout = setTimeout(() => {
      nextVideoTimeout = null;
      playNext();
    }, AUTO_NEXT_DELAY_MS);
    updateNowPlaying('Ended — next in 3s...');
    hidePlayPauseToggle(true);
  } else if (state === YT.PlayerState.PLAYING) {
    isPlaying = true;
    if (nextVideoTimeout) {
      clearTimeout(nextVideoTimeout);
      nextVideoTimeout = null;
    }
    updateNowPlaying(); // show title
    hidePlayPauseToggle(false);
  } else if (state === YT.PlayerState.PAUSED) {
    isPlaying = false;
    updateNowPlaying('Paused');
    hidePlayPauseToggle(true);
  }
}

// ----------------------------- DOM helpers & rendering -----------------------------
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function appendCard(id, v) {
  const genres = Array.isArray(v.genre) ? v.genre : (v.genre ? [v.genre] : []);
  const moods = Array.isArray(v.mood) ? v.mood : (v.mood ? [v.mood] : []);
  const title = v.title || "No Title";

  const card = document.createElement("div");
  card.className = "video-entry";
  card.dataset.id = id;
  card.innerHTML = `
    <a href="${v.url}" target="_blank" rel="noopener noreferrer">
      <img src="https://img.youtube.com/vi/${id}/0.jpg" alt="">
    </a>
    <p class="title">${escapeHtml(title)}</p>
    <div class="tags">
      ${v.composer ? `<span class="tag composer">${escapeHtml(v.composer)}</span>` : ""}
      ${genres.map(g => `<span class="tag genre">${escapeHtml(g)}</span>`).join("")}
      ${moods.map(m => `<span class="tag mood">${escapeHtml(m)}</span>`).join("")}
    </div>
    <div class="buttons">
      <button class="edit-btn">Edit</button>
      <button class="delete-btn">Delete</button>
    </div>
  `;
  document.getElementById("results").appendChild(card);
}

function attachCardListeners() {
  document.querySelectorAll(".edit-btn").forEach(btn => {
    btn.removeEventListener('click', editBtnHandler);
    btn.addEventListener("click", editBtnHandler);
  });
  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.removeEventListener('click', deleteBtnHandler);
    btn.addEventListener("click", deleteBtnHandler);
  });
}

function editBtnHandler(e) {
  const card = e.currentTarget.closest(".video-entry");
  if (card) inlineEdit(card);
}

function deleteBtnHandler(e) {
  const card = e.currentTarget.closest(".video-entry");
  if (card) deleteVideo(card.dataset.id);
}

function renderResults(compTags = [], genreTags = [], moodTags = []) {
  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "";

  storageGet("videos", (videos) => {
    const all = videos || {};
    for (let id in all) {
      const v = all[id];

      if (compTags.length) {
        const c = (v.composer || "").toLowerCase();
        if (!compTags.every(t => c.includes(t))) continue;
      }
      if (genreTags.length) {
        const arr = Array.isArray(v.genre) ? v.genre : (v.genre ? [v.genre] : []);
        if (!genreTags.every(t => arr.some(g => g.toLowerCase().includes(t)))) continue;
      }
      if (moodTags.length) {
        const arr = Array.isArray(v.mood) ? v.mood : (v.mood ? [v.mood] : []);
        if (!moodTags.every(t => arr.some(m => m.toLowerCase().includes(t)))) continue;
      }

      appendCard(id, v);
    }
    attachCardListeners();
    updateStartPlaylistButton();
  });
}

function searchByTitle() {
  const q = document.getElementById("titleInput").value.trim().toLowerCase();
  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "";

  if (!q) {
    renderResults();
    return;
  }
  storageGet("videos", (videos) => {
    const all = videos || {};
    for (let id in all) {
      const v = all[id];
      if ((v.title || "").toLowerCase().includes(q)) {
        appendCard(id, v);
      }
    }
    attachCardListeners();
    hideStartPlaylistButton();
  });
}

// Inline edit UI (replaces card content temporarily)
function inlineEdit(card) {
  const id = card.dataset.id;
  storageGet("videos", data => {
    const v = (data || {})[id] || {};
    const title    = v.title || "";
    const composer = v.composer || "";
    const genreStr = Array.isArray(v.genre) ? v.genre.join(", ") : (v.genre || "");
    const moodStr  = Array.isArray(v.mood)  ? v.mood.join(", ")  : (v.mood || "");

    card.dataset.editing = "true";

    card.innerHTML = `
      <p class="title">Edit</p>
      <label>Title:<br>
        <input type="text" class="edit-title" value="${escapeHtml(title)}">
      </label><br>
      <label>Composer:<br>
        <input type="text" class="edit-composer" value="${escapeHtml(composer)}">
      </label><br>
      <label>Genre:<br>
        <input type="text" class="edit-genre" value="${escapeHtml(genreStr)}">
      </label><br>
      <label>Mood:<br>
        <input type="text" class="edit-mood" value="${escapeHtml(moodStr)}">
      </label><br>
      <div class="buttons">
        <button class="save-btn">Save</button>
        <button class="cancel-btn">Cancel</button>
      </div>
    `;

    card.querySelector(".save-btn").addEventListener("click", () => {
      const newTitle    = card.querySelector(".edit-title").value.trim();
      const newComposer = card.querySelector(".edit-composer").value.trim();
      const newGenres   = card.querySelector(".edit-genre").value
                           .split(",").map(s => s.trim()).filter(s => s);
      const newMoods    = card.querySelector(".edit-mood").value
                           .split(",").map(s => s.trim()).filter(s => s);

      storageGet("videos", d => {
        const vids = d || {};
        const old = vids[id] || {};
        vids[id] = {
          ...old,
          title: newTitle || old.title || "",
          composer: newComposer || "",
          genre: newGenres,
          mood: newMoods,
          url: old.url || `https://www.youtube.com/watch?v=${id}`
        };
        storageSet({ videos: vids }, () => renderResults());
      });
    });

    card.querySelector(".cancel-btn").addEventListener("click", () => renderResults());
  });
}

function deleteVideo(videoId) {
  if (!confirm("Are you sure you want to delete this video?")) return;
  storageGet("videos", data => {
    const vids = data || {};
    delete vids[videoId];
    storageSet({ videos: vids }, () => renderResults());
  });
}

// ----------------------------- Playlist helpers -----------------------------
function updateStartPlaylistButton() {
  const mode = document.getElementById("modeSelect").value;
  const hasResults = document.getElementById("results").children.length > 0;
  const btn = document.getElementById("startPlaylistBtn");

  if (mode === "tags" && hasResults) {
    btn.style.display = "inline-block";
  } else {
    btn.style.display = "none";
  }
}

function hideStartPlaylistButton() {
  document.getElementById("startPlaylistBtn").style.display = "none";
}

function highlightPlayingVideo() {
  const results = document.querySelectorAll("#results .video-entry");
  results.forEach(card => card.classList.remove("playing"));

  if (playlist.length && playlistIndex >= 0 && playlistIndex < playlist.length) {
    const playingId = playlist[playlistIndex];
    const playingCard = document.querySelector(`#results .video-entry[data-id="${playingId}"]`);
    if (playingCard) {
      playingCard.classList.add("playing");
      // scroll into view if desired (commented out for UX)
      // playingCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

function updateNowPlaying(text) {
  const nowPlayingSpan = document.getElementById("nowPlaying");
  if (text !== undefined) {
    nowPlayingSpan.textContent = text;
    return;
  }
  if (playlist.length === 0) {
    nowPlayingSpan.textContent = "";
    return;
  }
  const videoId = playlist[playlistIndex];
  // Attempt to read title from the card (most reliable)
  const card = document.querySelector(`#results .video-entry[data-id="${videoId}"]`);
  if (card) {
    const title = card.querySelector(".title").textContent;
    nowPlayingSpan.textContent = `Now Playing: ${title}`;
  } else {
    nowPlayingSpan.textContent = `Now Playing: ${videoId}`;
  }
}

// Show/hide playlist controls and player container
function showPlaylistControls() {
  document.getElementById("playlistControls").style.display = "flex";
  document.getElementById("playerContainer").style.display = "block";
  document.getElementById("playBtn").style.display = "none";
  document.getElementById("pauseBtn").style.display = "inline-block";
  document.getElementById("playerContainer").ariaHidden = "false";
  document.getElementById("playlistControls").ariaHidden = "false";
}

function hidePlaylistControls() {
  document.getElementById("playlistControls").style.display = "none";
  document.getElementById("playerContainer").style.display = "none";
  document.getElementById("playerContainer").ariaHidden = "true";
  document.getElementById("playlistControls").ariaHidden = "true";
}

function hidePlayPauseToggle(paused) {
  if (paused) {
    document.getElementById("pauseBtn").style.display = "none";
    document.getElementById("playBtn").style.display = "inline-block";
  } else {
    document.getElementById("pauseBtn").style.display = "inline-block";
    document.getElementById("playBtn").style.display = "none";
  }
}

// Shuffle helper (Fisher-Yates)
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Play a specific index in the *current* shuffled playlist
function playVideoByIndex(index) {
  if (!playlist.length || index < 0 || index >= playlist.length) return;
  playlistIndex = index;
  const videoId = playlist[playlistIndex];

  // Ensure player is visible
  showPlaylistControls();
  highlightPlayingVideo();

  // If YT API available, load by ID; otherwise fallback to setting iframe HTML
  if (ytPlayerInstance && typeof ytPlayerInstance.loadVideoById === 'function') {
    try {
      ytPlayerInstance.loadVideoById(videoId);
    } catch (err) {
      console.warn('ytPlayerInstance.loadVideoById failed, falling back to iframe', err);
      const container = document.getElementById('ytplayer');
      container.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&enablejsapi=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    }
  } else {
    // Fallback: create an iframe inside #ytplayer div
    const container = document.getElementById('ytplayer');
    container.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&enablejsapi=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  }

  isPlaying = true;
  updateNowPlaying();
  hidePlayPauseToggle(false);

  // Clear any pending auto-next timeout
  if (nextVideoTimeout) {
    clearTimeout(nextVideoTimeout);
    nextVideoTimeout = null;
  }

  // Update media session metadata (best effort)
  try {
    if ('mediaSession' in navigator) {
      const title = (document.querySelector(`#results .video-entry[data-id="${videoId}"] .title`) || {}).textContent || '';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || videoId
      });
    }
  } catch (err) {
    // ignore
  }
}

function playNext() {
  if (!basePlaylist.length) return;

  // advance index in shuffled playlist
  playlistIndex += 1;
  if (playlistIndex >= playlist.length) {
    // we've finished a cycle — create a new shuffle from basePlaylist
    playlist = shuffleArray(basePlaylist);
    playlistIndex = 0;
  }
  playVideoByIndex(playlistIndex);
}

function playPrev() {
  if (!playlist.length) return;

  const now = Date.now();
  if (now - lastVideoEndedAt <= PREV_LOOP_WINDOW_MS) {
    // replay current
    playVideoByIndex(playlistIndex);
    return;
  }
  // normal previous
  playlistIndex = (playlistIndex - 1 + playlist.length) % playlist.length;
  playVideoByIndex(playlistIndex);
}

function pauseVideo() {
  if (ytPlayerInstance && typeof ytPlayerInstance.pauseVideo === 'function') {
    try { ytPlayerInstance.pauseVideo(); } catch (e) {}
  } else {
    // fallback: hide iframe (stops audio)
    const container = document.getElementById('ytplayer');
    const iframe = container.querySelector('iframe');
    if (iframe) {
      // remove src to stop audio playback
      iframe.dataset._src = iframe.src;
      iframe.src = 'about:blank';
    }
  }
  isPlaying = false;
  updateNowPlaying('Paused');
  hidePlayPauseToggle(true);
}

function resumeVideo() {
  if (!playlist.length) return;
  if (ytPlayerInstance && typeof ytPlayerInstance.playVideo === 'function') {
    try { ytPlayerInstance.playVideo(); } catch(e) {}
  } else {
    // fallback: re-insert the iframe with stored src
    const container = document.getElementById('ytplayer');
    let iframe = container.querySelector('iframe');
    if (!iframe) {
      const videoId = playlist[playlistIndex];
      container.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&enablejsapi=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    } else {
      const stored = iframe.dataset._src;
      if (stored) iframe.src = stored;
    }
  }
  isPlaying = true;
  updateNowPlaying();
  hidePlayPauseToggle(false);
}

function stopPlaylist() {
  const container = document.getElementById('ytplayer');
  container.innerHTML = '';
  isPlaying = false;
  playlist = [];
  basePlaylist = [];
  playlistIndex = 0;
  updateNowPlaying('');
  hidePlaylistControls();
  clearHighlight();
  if (nextVideoTimeout) {
    clearTimeout(nextVideoTimeout);
    nextVideoTimeout = null;
  }
}

// ----------------------------- UI wiring -----------------------------
function buildPlaylistFromVisibleResults() {
  const videoElems = document.querySelectorAll("#results .video-entry");
  const ids = Array.from(videoElems).map(el => el.dataset.id);
  return ids;
}

// Start playlist button handler
function onStartPlaylistClick() {
  const ids = buildPlaylistFromVisibleResults();
  if (!ids.length) {
    alert("No videos to play!");
    return;
  }
  basePlaylist = ids.slice();         // store base order for reshuffle
  playlist = shuffleArray(basePlaylist);
  playlistIndex = 0;
  loadYouTubeAPI();                   // ensure API is loaded
  playVideoByIndex(playlistIndex);
}

// Attach control listeners (called once during init)
function attachControlListeners() {
  document.getElementById("startPlaylistBtn").addEventListener("click", onStartPlaylistClick);
  document.getElementById("nextBtn").addEventListener("click", () => { playNext(); });
  document.getElementById("prevBtn").addEventListener("click", () => { playPrev(); });
  document.getElementById("pauseBtn").addEventListener("click", () => { pauseVideo(); });
  document.getElementById("playBtn").addEventListener("click", () => { resumeVideo(); });
  document.getElementById("stopBtn").addEventListener("click", () => { stopPlaylist(); });
}

// Media key / headphone support
function setupMediaKeys() {
  // Media Session API preferred
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => { resumeVideo(); });
      navigator.mediaSession.setActionHandler('pause', () => { pauseVideo(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => { playPrev(); });
      navigator.mediaSession.setActionHandler('nexttrack', () => { playNext(); });
    }
  } catch (e) {
    // ignore
  }

  // Fallback keydown listener
  window.addEventListener('keydown', (e) => {
    // Some browsers/platforms send Media* keys as keyboard events
    if (!playlist.length) return; // only active when playlist exists
    switch (e.code) {
      case 'MediaPlayPause':
        e.preventDefault();
        if (isPlaying) pauseVideo(); else resumeVideo();
        break;
      case 'MediaTrackNext':
        e.preventDefault();
        playNext();
        break;
      case 'MediaTrackPrevious':
        e.preventDefault();
        playPrev();
        break;
    }
  });
}

// ----------------------------- Mode / Go button wiring -----------------------------
function toggleModeUi(mode) {
  document.getElementById("titleInput").style.display = mode === "title" ? "" : "none";
  document.getElementById("composerInput").style.display = mode === "tags" ? "" : "none";
  document.getElementById("genreInput").style.display = mode === "tags" ? "" : "none";
  document.getElementById("moodInput").style.display = mode === "tags" ? "" : "none";
  updateStartPlaylistButton();
}

function wireSearchUi() {
  document.getElementById("goBtn").addEventListener("click", () => {
    if (document.getElementById("modeSelect").value === "title") {
      searchByTitle();
    } else {
      const compTags = document.getElementById("composerInput").value
        .split(",").map(s => s.trim().toLowerCase()).filter(s => s);
      const genreTags = document.getElementById("genreInput").value
        .split(",").map(s => s.trim().toLowerCase()).filter(s => s);
      const moodTags = document.getElementById("moodInput").value
        .split(",").map(s => s.trim().toLowerCase()).filter(s => s);
      renderResults(compTags, genreTags, moodTags);
    }
  });

  // Enter key behavior
  ["titleInput", "composerInput", "genreInput", "moodInput"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keypress", e => {
      if (e.key === "Enter") document.getElementById("goBtn").click();
    });
  });

  // Mode toggle
  document.getElementById("modeSelect").addEventListener("change", (e) => {
    toggleModeUi(e.target.value);
    clearHighlight();
    stopPlaylist();
    updateStartPlaylistButton();
  });
}

// ----------------------------- Initialization -----------------------------
function clearHighlight() {
  document.querySelectorAll("#results .video-entry.playing").forEach(card => {
    card.classList.remove("playing");
  });
}

// Populate UI on load from storage
function initialLoad() {
  // If there are no videos in storage, create an empty object so UI works
  storageGet("videos", (v) => {
    if (!v) storageSet({ videos: {} }, () => {});
    // show defaults
    document.getElementById("modeSelect").value = "title";
    toggleModeUi("title");
    // initial render
    renderResults();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  attachControlListeners();
  wireSearchUi();
  attachCardListeners();
  setupMediaKeys();
  initialLoad();

  // load YouTube API lazily (it will be used only when starting a playlist)
  // but preloading helps avoid delay when starting
  loadYouTubeAPI();
});
