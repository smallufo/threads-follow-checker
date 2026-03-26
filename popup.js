document.addEventListener("DOMContentLoaded", () => {
  const btnScanFollowing = document.getElementById("btn-scan-following");
  const btnScanFollowers = document.getElementById("btn-scan-followers");
  const btnReport = document.getElementById("btn-report");
  const btnClear = document.getElementById("btn-clear");
  const followingStatus = document.getElementById("following-status");
  const followersStatus = document.getElementById("followers-status");

  // Load saved data counts on popup open
  chrome.storage.local.get(["followingList", "followersList"], (data) => {
    if (data.followingList && data.followingList.length > 0) {
      followingStatus.innerHTML = `<span class="done">已收集 <span class="count">${data.followingList.length}</span> 位</span>`;
    }
    if (data.followersList && data.followersList.length > 0) {
      followersStatus.innerHTML = `<span class="done">已收集 <span class="count">${data.followersList.length}</span> 位</span>`;
    }
    if (data.followingList?.length > 0 || data.followersList?.length > 0) {
      btnClear.style.display = "inline-block";
    }
  });

  function sendScanMessage(type, statusEl, btn) {
    btn.disabled = true;
    statusEl.innerHTML = `<span class="scanning">掃描中... 請勿關閉 Threads 頁面</span>`;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !(tab.url.includes("threads.net") || tab.url.includes("threads.com"))) {
        statusEl.innerHTML = `<span class="error">請先開啟 Threads 頁面</span>`;
        btn.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: "scan", type }, (response) => {
        if (chrome.runtime.lastError) {
          statusEl.innerHTML = `<span class="error">無法連接頁面，請重新整理 Threads 頁面後再試</span>`;
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
          statusEl.innerHTML = `<span class="scanning">掃描中... 已找到 <span class="count">${progress.count}</span> 位</span>`;
        } else if (progress.status === "done") {
          const list = data[listKey] || [];
          statusEl.innerHTML = `<span class="done">完成！共收集 <span class="count">${list.length}</span> 位</span>`;
          btn.disabled = false;
          btnClear.style.display = "inline-block";
          clearInterval(interval);
          chrome.storage.local.remove(key);
        } else if (progress.status === "error") {
          statusEl.innerHTML = `<span class="error">${progress.message || "掃描失敗"}</span>`;
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
        alert("請先掃描 Following 名單");
        return;
      }
      if (!data.followersList || data.followersList.length === 0) {
        alert("請先掃描 Followers 名單");
        return;
      }
      chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
    });
  });

  // Clear data
  btnClear.addEventListener("click", () => {
    if (!confirm("確定要清除所有已收集的資料嗎？")) return;
    chrome.storage.local.remove(["followingList", "followersList"], () => {
      followingStatus.innerHTML = "";
      followersStatus.innerHTML = "";
      btnClear.style.display = "none";
    });
  });
});
