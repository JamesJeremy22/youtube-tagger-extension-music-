
function getCurrentYouTubeVideoId(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) {
      callback(null);
      return;
    }
    const tab = tabs[0];
    try {
      const url = new URL(tab.url);
      if (url.hostname.includes("youtube.com")) {
        const videoId = url.searchParams.get("v");
        callback(videoId || null);
      } else if (url.hostname === "youtu.be") {
        const videoId = url.pathname.slice(1);
        callback(videoId || null);
      } else {
        callback(null);
      }
    } catch {
      callback(null);
    }
  });
}

function normalizeTagInput(input) {
  return input
    .split(",")
    .map(tag => tag.trim())
    .filter(tag => tag)
    .map(tag => tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase());
}

function showMessage(msg, color = "green") {
  const msgDiv = document.getElementById("status");
  msgDiv.textContent = msg;
  msgDiv.style.color = color;
  setTimeout(() => {
    msgDiv.textContent = "";
  }, 1200);
}

function saveTagsForVideo(videoId) {
  const composer = document.getElementById("composer").value.trim();
  const genres = normalizeTagInput(document.getElementById("genre").value);
  const moods = normalizeTagInput(document.getElementById("mood").value);

  if (!composer && genres.length === 0 && moods.length === 0) {
    showMessage("Please enter at least one tag", "red");
    return;
  }

  // First get the active tab title, then read/modify storage and write back
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabTitle = (tabs && tabs[0] && tabs[0].title) ? tabs[0].title : "";

  chrome.storage.local.get("videos", (data) => {
    const videos = data.videos || {};
    const existing = videos[videoId];

    if (existing) {
      // Existing entry — merge tags (dedupe) and keep an edited title if present
      const existingGenres = Array.isArray(existing.genre) ? existing.genre : (existing.genre ? [existing.genre] : []);
      const existingMoods  = Array.isArray(existing.mood)  ? existing.mood  : (existing.mood  ? [existing.mood]  : []);

      const mergedGenres = Array.from(new Set([...existingGenres, ...genres]));
      const mergedMoods  = Array.from(new Set([...existingMoods,  ...moods ]));

      videos[videoId] = {
        ...existing,
        url: existing.url || `https://www.youtube.com/watch?v=${videoId}`,
        title: existing.title || tabTitle,
        composer: composer || existing.composer || "",
        genre: mergedGenres,
        mood: mergedMoods
      };
    } else {
      // New entry — create fresh
      videos[videoId] = {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: tabTitle,
        composer: composer,
        genre: genres,
        mood: moods
      };
    }

    chrome.storage.local.set({ videos }, () => {
      // keep your existing success behavior here
      showMessage("\u2714 Tags saved!");
      document.getElementById("composer").value = "";
      document.getElementById("genre").value = "";
      document.getElementById("mood").value = "";
    });
  });
});

}

document.getElementById("save-button").addEventListener("click", () => {
  getCurrentYouTubeVideoId((videoId) => {
    if (!videoId) {
      showMessage("Not a YouTube video", "red");
      return;
    }
    saveTagsForVideo(videoId);
  });
});

document.getElementById("openSearch").addEventListener("click", () => {
  chrome.runtime.sendMessage("openSiteWithCheck");
});
