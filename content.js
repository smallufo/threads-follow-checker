// Threads Follow Checker - Content Script
// Injected into threads.net / threads.com pages

(() => {
  console.log("[Threads Follow Checker] Content script loaded");

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "scan") {
      console.log("[TFC] Scan requested:", msg.type);
      sendResponse({ status: "started" });
      startScan(msg.type);
    }
    return true;
  });

  async function startScan(type) {
    const progressKey = type === "following" ? "scanProgress_following" : "scanProgress_followers";
    const listKey = type === "following" ? "followingList" : "followersList";

    try {
      updateProgress(progressKey, "scanning", 0);

      // Find the scrollable container for the follower/following list
      const scrollContainer = findScrollContainer();
      if (!scrollContainer) {
        updateProgress(progressKey, "error", 0,
          "找不到追蹤列表。請確認已打開「追蹤中」或「粉絲」的彈窗列表。");
        return;
      }

      console.log("[TFC] Found scroll container:", scrollContainer);

      const usernames = await autoScrollAndCollect(scrollContainer, progressKey);

      console.log("[TFC] Scan complete. Found", usernames.size, "users");

      // Save results
      chrome.storage.local.set({ [listKey]: [...usernames] }, () => {
        updateProgress(progressKey, "done", usernames.size);
      });
    } catch (err) {
      console.error("[TFC] Scan error:", err);
      updateProgress(progressKey, "error", 0, err.message);
    }
  }

  function updateProgress(key, status, count, message) {
    chrome.storage.local.set({ [key]: { status, count, message } });
  }

  /**
   * Find the scrollable container that holds the follower/following list.
   *
   * From the actual Threads UI: the modal has tabs (粉絲 / 追蹤中) at the top
   * and a scrollable list of user rows below. The modal is likely a div with
   * role="dialog" or a similar overlay structure.
   *
   * We try multiple strategies.
   */
  function findScrollContainer() {
    // Strategy 1: role="dialog" with scrollable child
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
      const sc = findBestScrollable(dialog);
      if (sc) return sc;
    }

    // Strategy 2: Common modal/overlay containers
    // Threads uses divs that act as modals. Look for fixed/absolute positioned overlays.
    const overlays = document.querySelectorAll("div[style*='position: fixed'], div[style*='position:fixed']");
    for (const overlay of overlays) {
      const sc = findBestScrollable(overlay);
      if (sc) return sc;
    }

    // Strategy 3: Brute force — find ALL scrollable elements on the page that contain /@username links
    const candidates = getAllScrollableWithUsers();
    if (candidates.length > 0) {
      // Pick the one with the most user links
      candidates.sort((a, b) => b.userCount - a.userCount);
      return candidates[0].element;
    }

    // Strategy 4: Maybe the list is not in a separately scrollable div
    // but is in the main page scroll. Look for a container with many user links.
    const containers = findContainersWithManyUsers();
    if (containers.length > 0) {
      // The container itself might not scroll, but its parent or the page does
      const container = containers[0];
      // Walk up to find the nearest scrollable ancestor
      let el = container.parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
          return el;
        }
        el = el.parentElement;
      }
      // Fallback: return the document scrolling element
      return document.scrollingElement || document.documentElement;
    }

    return null;
  }

  function findBestScrollable(root) {
    const all = root.querySelectorAll("*");
    let best = null;
    let bestScore = 0;

    for (const el of all) {
      const style = window.getComputedStyle(el);
      const isScrollable =
        (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflow === "auto" || style.overflow === "scroll") &&
        el.scrollHeight > el.clientHeight + 5;

      if (isScrollable) {
        const count = countUserLinks(el);
        if (count > bestScore) {
          best = el;
          bestScore = count;
        }
      }
    }

    // Also check if the root itself is scrollable
    if (root.scrollHeight > root.clientHeight + 5) {
      const rootCount = countUserLinks(root);
      if (rootCount > bestScore) {
        best = root;
      }
    }

    return best;
  }

  function getAllScrollableWithUsers() {
    const result = [];
    const all = document.querySelectorAll("*");
    for (const el of all) {
      const style = window.getComputedStyle(el);
      const isScrollable =
        (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflow === "auto" || style.overflow === "scroll") &&
        el.scrollHeight > el.clientHeight + 5;

      if (isScrollable) {
        const userCount = countUserLinks(el);
        if (userCount >= 3) {
          result.push({ element: el, userCount });
        }
      }
    }
    return result;
  }

  function findContainersWithManyUsers() {
    // Find divs that contain many /@username links (likely the list container)
    const divs = document.querySelectorAll("div");
    const result = [];
    for (const div of divs) {
      const count = countUserLinks(div);
      if (count >= 5) {
        result.push(div);
      }
    }
    // Sort by specificity: prefer smaller containers (fewer total children)
    result.sort((a, b) => a.children.length - b.children.length);
    return result;
  }

  function countUserLinks(container) {
    return extractUsernames(container).size;
  }

  /**
   * Extract usernames from the visible DOM.
   * Threads profile links follow the pattern: /@username
   */
  function extractUsernames(container) {
    const usernames = new Set();

    // Method 1: Find <a> elements with href containing /@username
    const links = container.querySelectorAll('a[href*="/@"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      // Match /@username at the end of the path or followed by /
      const match = href.match(/\/@([a-zA-Z0-9_.]+)/);
      if (match) {
        const username = match[1];
        if (!isReservedPath(username)) {
          usernames.add(username);
        }
      }
    }

    return usernames;
  }

  function isReservedPath(path) {
    const reserved = new Set([
      "explore", "search", "activity", "settings", "notifications",
      "direct", "reels", "stories", "about", "help", "privacy", "terms",
      "p", "t", "login", "signup",
    ]);
    return reserved.has(path.toLowerCase());
  }

  /**
   * Auto-scroll the container and collect all usernames.
   * Uses two signals to detect "reached the bottom":
   *   1. scrollTop didn't change after scrolling → physically at the bottom
   *   2. No new usernames found after a few extra attempts (in case lazy-load is slow)
   */
  async function autoScrollAndCollect(container, progressKey) {
    const allUsernames = new Set();
    const SCROLL_DELAY = 1200; // ms between scrolls
    const SCROLL_STEP = 800;  // pixels per scroll

    // Initial collection
    collectFromContainer(container, allUsernames);
    updateProgress(progressKey, "scanning", allUsernames.size);
    console.log("[TFC] Initial scan found", allUsernames.size, "users");

    let totalScrolls = 0;
    let noNewCount = 0;
    const MAX_NO_NEW = 3; // Only need 3 retries once we detect bottom

    let hitPhysicalBottom = false;

    while (true) {
      const prevSize = allUsernames.size;
      const prevScrollTop = container.scrollTop;

      // Scroll down
      container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });

      // Short wait for DOM to update
      await sleep(SCROLL_DELAY);

      const newScrollTop = container.scrollTop;

      // Detect physical bottom: scrollTop didn't move (or barely moved)
      if (Math.abs(newScrollTop - prevScrollTop) < 2) {
        if (!hitPhysicalBottom) {
          console.log("[TFC] Hit physical bottom of scroll container");
          hitPhysicalBottom = true;
        }
      } else {
        hitPhysicalBottom = false;
      }

      // Collect usernames from current view
      collectFromContainer(container, allUsernames);
      totalScrolls++;

      if (allUsernames.size > prevSize) {
        noNewCount = 0;
        updateProgress(progressKey, "scanning", allUsernames.size);
        console.log("[TFC] Scroll #" + totalScrolls + ": found", allUsernames.size, "users (+", allUsernames.size - prevSize, ")");
      } else {
        noNewCount++;
      }

      // Exit conditions
      if (hitPhysicalBottom && noNewCount >= MAX_NO_NEW) {
        console.log("[TFC] Confirmed end: at physical bottom with no new users after", MAX_NO_NEW, "retries");
        break;
      }

      // Fallback: if not at physical bottom but no new users for a long time
      // (handles edge cases like virtualized lists)
      if (!hitPhysicalBottom && noNewCount >= 8) {
        console.log("[TFC] Fallback stop: no new users for 8 consecutive scrolls");
        break;
      }

      // Safety cap
      if (allUsernames.size > 50000 || totalScrolls > 2000) {
        console.log("[TFC] Safety cap reached, stopping.");
        break;
      }
    }

    return allUsernames;
  }

  function collectFromContainer(container, usernamesSet) {
    const found = extractUsernames(container);
    for (const u of found) {
      usernamesSet.add(u);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
