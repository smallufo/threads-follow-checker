(() => {
  const tbody = document.querySelector("#report-table tbody");
  const searchInput = document.getElementById("search");

  let reportData = [];
  let currentFilter = "all";

  // Load data from storage and build report
  chrome.storage.local.get(["followingList", "followersList"], (data) => {
    document.getElementById("loading").style.display = "none";

    const following = data.followingList || [];
    const followers = data.followersList || [];

    if (following.length === 0 && followers.length === 0) {
      document.getElementById("no-data").style.display = "block";
      return;
    }

    const followersSet = new Set(followers.map((u) => u.toLowerCase()));

    reportData = following.map((username) => ({
      username,
      followsBack: followersSet.has(username.toLowerCase()),
    }));

    // Sort: not following back first, then alphabetical
    reportData.sort((a, b) => {
      if (a.followsBack === b.followsBack) return a.username.localeCompare(b.username);
      return a.followsBack ? 1 : -1;
    });

    const totalFollowing = reportData.length;
    const totalFollowers = followers.length;
    const totalFollowBack = reportData.filter((r) => r.followsBack).length;
    const totalNotFollowBack = totalFollowing - totalFollowBack;

    document.getElementById("summary").innerHTML = `
      <div class="stat">
        <span class="big-num blue">${totalFollowing}</span>
        <span class="label">追蹤中</span>
      </div>
      <div class="stat">
        <span class="big-num blue">${totalFollowers}</span>
        <span class="label">粉絲</span>
      </div>
      <div class="stat">
        <span class="big-num green">${totalFollowBack}</span>
        <span class="label">有回追</span>
      </div>
      <div class="stat">
        <span class="big-num red">${totalNotFollowBack}</span>
        <span class="label">未回追</span>
      </div>
    `;

    renderTable();
    document.getElementById("content").style.display = "block";
  });

  function getFiltered() {
    let filtered = reportData;
    if (currentFilter === "not-following-back") {
      filtered = filtered.filter((r) => !r.followsBack);
    } else if (currentFilter === "following-back") {
      filtered = filtered.filter((r) => r.followsBack);
    }

    const query = searchInput.value.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((r) => r.username.toLowerCase().includes(query));
    }

    return filtered;
  }

  function renderTable() {
    const filtered = getFiltered();
    tbody.innerHTML = "";

    filtered.forEach((row, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td><a class="username-link" href="https://www.threads.com/@${row.username}" target="_blank">@${row.username}</a></td>
        <td>${row.followsBack
          ? '<span class="badge badge-yes">有回追</span>'
          : '<span class="badge badge-no">未回追</span>'
        }</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("shown-count").textContent =
      `顯示 ${filtered.length} / ${reportData.length} 位`;
  }

  // Filter buttons
  document.getElementById("filter-bar").addEventListener("click", (e) => {
    if (!e.target.classList.contains("filter-btn")) return;
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    currentFilter = e.target.dataset.filter;
    renderTable();
  });

  // Search
  searchInput.addEventListener("input", () => {
    renderTable();
  });

  // CSV export
  document.getElementById("btn-export").addEventListener("click", () => {
    const filtered = getFiltered();
    if (filtered.length === 0) {
      alert("目前沒有資料可匯出");
      return;
    }
    const header = "Username,FollowsBack";
    const rows = filtered.map((r) => `${r.username},${r.followsBack ? "Yes" : "No"}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `threads_follow_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
})();
