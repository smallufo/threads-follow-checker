document.addEventListener("DOMContentLoaded", () => {
  const btnScanFollowing = document.getElementById("btn-scan-following");
  const btnScanFollowers = document.getElementById("btn-scan-followers");
  const btnReport = document.getElementById("btn-report");
  const btnClear = document.getElementById("btn-clear");
  const followingStatus = document.getElementById("following-status");
  const followersStatus = document.getElementById("followers-status");
  const tabHint = document.getElementById("tab-hint");

  function statusHtml(cls, text) {
    return `<span class="${cls}">${text}</span>`;
  }

  // Load saved data counts on popup open
  chrome.storage.local.get(["followingList", "followersList"], (data) => {
    if (data.followingList && data.followingList.length > 0) {
      followingStatus.innerHTML = statusHtml("done", msg("statusCollected", [String(data.followingList.length)]));
    }
    if (data.followersList && data.followersList.length > 0) {
      followersStatus.innerHTML = statusHtml("done", msg("statusCollected", [String(data.followersList.length)]));
    }
    if (data.followingList?.length > 0 || data.followersList?.length > 0) {
      btnClear.style.display = "inline-block";
    }
  });

  // Detect which tab is active and update buttons accordingly
  detectAndUpdateButtons();

  function detectAndUpdateButtons() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !(tab.url.includes("threads.net") || tab.url.includes("threads.com"))) {
        setTabState("no-threads");
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: "detectTab" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          setTabState("no-modal");
          return;
        }
        setTabState(response.activeTab);
      });
    });
  }

  function setTabState(activeTab) {
    btnScanFollowing.disabled = false;
    btnScanFollowers.disabled = false;

    if (activeTab === "no-threads") {
      tabHint.innerHTML = statusHtml("hint-warn", msg("hintNoThreads"));
      btnScanFollowing.disabled = true;
      btnScanFollowers.disabled = true;
    } else if (activeTab === "none" || activeTab === "no-modal") {
      tabHint.innerHTML = statusHtml("hint-warn", msg("hintNoModal"));
      btnScanFollowing.disabled = true;
      btnScanFollowers.disabled = true;
    } else if (activeTab === "following") {
      tabHint.innerHTML = statusHtml("hint-ok", msg("hintOnFollowing"));
      btnScanFollowing.disabled = false;
      btnScanFollowers.disabled = true;
    } else if (activeTab === "followers") {
      tabHint.innerHTML = statusHtml("hint-ok", msg("hintOnFollowers"));
      btnScanFollowing.disabled = true;
      btnScanFollowers.disabled = false;
    }
  }

  function sendScanMessage(type, statusEl, btn) {
    btn.disabled = true;
    statusEl.innerHTML = statusHtml("scanning", msg("statusScanning"));

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !(tab.url.includes("threads.net") || tab.url.includes("threads.com"))) {
        statusEl.innerHTML = statusHtml("error", msg("errorNoThreadsPage"));
        btn.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: "scan", type }, (response) => {
        if (chrome.runtime.lastError) {
          statusEl.innerHTML = statusHtml("error", msg("errorCannotConnect"));
          btn.disabled = false;
          return;
        }
        pollProgress(type, statusEl, btn);
      });
    });
  }

  function pollProgress(type, statusEl, btn) {
    const key = type === "following" ? "scanProgress_following" : "scanProgress_followers";
    const listKey = type === "following" ? "followingList" : "followersList";

    const interval = setInterval(() => {
      chrome.storage.local.get([key, listKey], (data) => {
        const progress = data[key];
        if (!progress) return;

        if (progress.status === "scanning") {
          statusEl.innerHTML = statusHtml("scanning", msg("statusScanningCount", [String(progress.count)]));
        } else if (progress.status === "done") {
          const list = data[listKey] || [];
          statusEl.innerHTML = statusHtml("done", msg("statusDone", [String(list.length)]));
          btn.disabled = false;
          btnClear.style.display = "inline-block";
          clearInterval(interval);
          chrome.storage.local.remove(key);
        } else if (progress.status === "error") {
          statusEl.innerHTML = statusHtml("error", progress.message || msg("errorScanFailed"));
          btn.disabled = false;
          clearInterval(interval);
          chrome.storage.local.remove(key);
        }
      });
    }, 500);
  }

  btnScanFollowing.addEventListener("click", () => {
    sendScanMessage("following", followingStatus, btnScanFollowing);
  });

  btnScanFollowers.addEventListener("click", () => {
    sendScanMessage("followers", followersStatus, btnScanFollowers);
  });

  // Open report in a new tab
  btnReport.addEventListener("click", () => {
    chrome.storage.local.get(["followingList", "followersList"], (data) => {
      if (!data.followingList || data.followingList.length === 0) {
        alert(msg("alertScanFollowingFirst"));
        return;
      }
      if (!data.followersList || data.followersList.length === 0) {
        alert(msg("alertScanFollowersFirst"));
        return;
      }
      chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
    });
  });

  // Clear data
  btnClear.addEventListener("click", () => {
    if (!confirm(msg("confirmClearData"))) return;
    chrome.storage.local.remove(["followingList", "followersList"], () => {
      followingStatus.innerHTML = "";
      followersStatus.innerHTML = "";
      btnClear.style.display = "none";
    });
  });
});
