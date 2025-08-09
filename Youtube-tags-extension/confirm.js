const qs = new URLSearchParams(location.search);
const existingTabId = Number(qs.get("existingTabId"));
console.log("[confirm.js] existingTabId from URL:", existingTabId);

document.getElementById("goToExisting").addEventListener("click", () => {
  if (!existingTabId) {
    alert("Error: Missing existing tab ID. Cannot proceed.");
    return;
  }
  chrome.runtime.sendMessage({ action: "go-to-existing", tabId: existingTabId });
  window.close();
});

document.getElementById("openNew").addEventListener("click", () => {
  if (!existingTabId) {
    alert("Error: Missing existing tab ID. Cannot proceed.");
    return;
  }
  chrome.runtime.sendMessage({ action: "open-new", tabId: existingTabId });
  window.close();
});
