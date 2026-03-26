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

    // Build followers lookup — handle both old format (string[]) and new format ({username, displayName}[])
    const followersSet = new Set(
      followers.map((f) => (typeof f === "string" ? f : f.username).toLowerCase())
    );

    reportData = following.map((f) => {
      const username = typeof f === "string" ? f : f.username;
      const displayName = typeof f === "string" ? "" : (f.displayName || "");
      return {
        username,
        displayName,
        followsBack: followersSet.has(username.toLowerCase()),
      };
    });

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
        <span class="label">${msg("statFollowing")}</span>
      </div>
      <div class="stat">
        <span class="big-num blue">${totalFollowers}</span>
        <span class="label">${msg("statFollowers")}</span>
      </div>
      <div class="stat">
        <span class="big-num green">${totalFollowBack}</span>
        <span class="label">${msg("statFollowBack")}</span>
      </div>
      <div class="stat">
        <span class="big-num red">${totalNotFollowBack}</span>
        <span class="label">${msg("statNotFollowBack")}</span>
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
      filtered = filtered.filter((r) =>
        r.username.toLowerCase().includes(query) ||
        r.displayName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }

  function renderTable() {
    const filtered = getFiltered();
    tbody.innerHTML = "";

    filtered.forEach((row, i) => {
      const tr = document.createElement("tr");
      const nameHtml = row.displayName
        ? `<span class="display-name">${escapeHtml(row.displayName)}</span>`
        : "";
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>
          <a class="username-link" href="https://www.threads.com/@${row.username}" target="_blank">@${row.username}</a>
          ${nameHtml}
        </td>
        <td>${row.followsBack
          ? `<span class="badge badge-yes">${msg("badgeYes")}</span>`
          : `<span class="badge badge-no">${msg("badgeNo")}</span>`
        }</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("shown-count").textContent =
      msg("shownCount", [String(filtered.length), String(reportData.length)]);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
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
      alert(msg("alertNoDataExport"));
      return;
    }
    const header = "Username,DisplayName,FollowsBack";
    const rows = filtered.map((r) => {
      const name = r.displayName.includes(",") ? `"${r.displayName}"` : r.displayName;
      return `${r.username},${name},${r.followsBack ? "Yes" : "No"}`;
    });
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
