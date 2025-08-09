let openTabId = null;
let confirmTabId = null;
let openingConfirmInProgress = false;

// Promisify chrome.tabs methods for easier async/await usage
function queryTabs(queryInfo) {
  return new Promise(resolve => chrome.tabs.query(queryInfo, resolve));
}
function createTab(createProperties) {
  return new Promise(resolve => chrome.tabs.create(createProperties, resolve));
}
function updateTab(tabId, updateProperties) {
  return new Promise(resolve => chrome.tabs.update(tabId, updateProperties, resolve));
}
function removeTab(tabId) {
  return new Promise(resolve => chrome.tabs.remove(tabId, resolve));
}
function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(tab);
    });
  });
}

async function safeRemoveTab(tabId) {
  if (!tabId) return;
  try {
    await getTab(tabId); // throws if tab doesn't exist
    await removeTab(tabId);
    console.log(`[background] safeRemoveTab: Closed tab ID ${tabId}`);
  } catch {
    console.log(`[background] safeRemoveTab: Tab ${tabId} not found or already closed`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message === "openSiteWithCheck") {
      if (openingConfirmInProgress) {
        console.log("[background] openSiteWithCheck ignored, already opening confirm tab");
        return;
      }
      openingConfirmInProgress = true;

      console.log("[background] openSiteWithCheck requested");
      const tabs = await queryTabs({});
      const existingTab = tabs.find(t => t.url && t.url.includes("index.html"));

      if (existingTab) {
        openTabId = existingTab.id;
        console.log("[background] index.html tab already open with ID:", openTabId);

        if (!confirmTabId) {
          const confirmTab = await createTab({
            url: chrome.runtime.getURL("confirm.html") + `?existingTabId=${openTabId}`
          });
          confirmTabId = confirmTab.id;
          console.log("[background] confirm.html tab created with ID:", confirmTabId);
        } else {
          console.log("[background] confirm.html tab already open with ID:", confirmTabId);
        }
      } else {
        const newTab = await createTab({ url: chrome.runtime.getURL("index.html") });
        openTabId = newTab.id;
        console.log("[background] No existing tab. New index.html tab created with ID:", openTabId);
      }

      openingConfirmInProgress = false;
      sendResponse(true);
      return;
    }

    if (message.action === "go-to-existing") {
      const tabId = message.tabId;
      console.log("[background] go-to-existing requested for tab ID:", tabId);

      if (!tabId) {
        console.warn("[background] go-to-existing missing tabId, opening new tab");
        const newTab = await createTab({ url: chrome.runtime.getURL("index.html") });
        openTabId = newTab.id;
        if (sender.tab?.id) await safeRemoveTab(sender.tab.id);
        sendResponse(true);
        return;
      }

      try {
        await getTab(tabId);
        await updateTab(tabId, { active: true });
        openTabId = tabId;
        console.log("[background] go-to-existing: Activated tab ID:", tabId);
      } catch {
        console.log("[background] go-to-existing: Tab not found, opening new index.html tab");
        const newTab = await createTab({ url: chrome.runtime.getURL("index.html") });
        openTabId = newTab.id;
      }

      if (sender.tab?.id) await safeRemoveTab(sender.tab.id);
      sendResponse(true);
      return;
    }

    if (message.action === "open-new") {
      const tabId = message.tabId;
      console.log("[background] open-new requested, will close tab ID", tabId, "and open new");

      if (tabId) {
        await safeRemoveTab(tabId);
        openTabId = null;
      }
      const newTab = await createTab({ url: chrome.runtime.getURL("index.html") });
      openTabId = newTab.id;
      console.log("[background] open-new: Created new index.html tab with ID:", openTabId);

      if (sender.tab?.id) await safeRemoveTab(sender.tab.id);
      sendResponse(true);
      return;
    }
  })();

  return true; // async listener
});

// Clear IDs when tabs closed manually
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === confirmTabId) {
    console.log(`[background] confirm.html tab ID ${tabId} closed manually, clearing confirmTabId`);
    confirmTabId = null;
  }
  if (tabId === openTabId) {
    console.log(`[background] index.html tab ID ${tabId} closed manually, clearing openTabId`);
    openTabId = null;
  }
});
