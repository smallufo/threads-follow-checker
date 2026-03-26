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
    } else if (msg.action === "detectTab") {
      const tab = detectActiveTab();
      console.log("[TFC] Detected active tab:", tab);
      sendResponse({ activeTab: tab });
    }
    return true;
  });

  /**
   * Detect which tab is active in the followers/following modal.
   * Returns "following", "followers", or "none".
   *
   * The Threads modal has two tab buttons (粉絲 / 追蹤中).
   * The active tab typically has a visual indicator: bolder font-weight,
   * a bottom border, or different color. We look for these clues.
   */
  function detectActiveTab() {
    // Find the modal / dialog
    const dialogs = document.querySelectorAll('[role="dialog"]');
    let modal = dialogs.length > 0 ? dialogs[0] : null;

    // Fallback: look for any overlay containing tab-like text
    if (!modal) {
      const allElements = document.querySelectorAll("div");
      for (const el of allElements) {
        const text = el.textContent;
        if (text && text.includes("粉絲") && text.includes("追蹤中")) {
          modal = el;
          break;
        }
      }
    }

    if (!modal) return "none";

    // Find clickable tab elements that contain "粉絲" or "追蹤中"
    // They are typically <a>, <div>, <span>, or <button> with role="tab" or acting as tabs
    const candidates = modal.querySelectorAll('a, [role="tab"], button, div[tabindex], span[tabindex]');
    let followersEl = null;
    let followingEl = null;

    for (const el of candidates) {
      const text = el.textContent.trim();
      // Match tabs: text should contain the keyword but be reasonably short (tab label)
      if (text.length > 50) continue;

      if (/粉絲|followers/i.test(text) && !followersEl) {
        followersEl = el;
      }
      if (/追蹤中|following/i.test(text) && !/粉絲|followers/i.test(text) && !followingEl) {
        followingEl = el;
      }
    }

    // If we didn't find via role="tab", try broader search within first few children of modal
    if (!followersEl || !followingEl) {
      const spans = modal.querySelectorAll("span, div, a, p");
      for (const el of spans) {
        const text = el.textContent.trim();
        if (text.length > 30) continue;
        // Only match leaf-ish elements (not containers of many children)
        if (el.children.length > 3) continue;

        if (/^粉絲/.test(text) && !followersEl) followersEl = el;
        if (/^追蹤中/.test(text) && !followingEl) followingEl = el;
      }
    }

    if (!followersEl && !followingEl) return "none";

    // Determine which tab is "active" by comparing visual properties
    return isTabActive(followingEl, followersEl) ? "following" : "followers";
  }

  /**
   * Compare two tab elements to determine if the first one is the active tab.
   * Checks: font-weight, border-bottom, opacity, color brightness, aria-selected.
   */
  function isTabActive(targetEl, otherEl) {
    if (!targetEl || !otherEl) {
      // If only one exists, check aria-selected or bold styling
      if (targetEl) {
        const style = window.getComputedStyle(targetEl);
        return parseInt(style.fontWeight) >= 600 || targetEl.getAttribute("aria-selected") === "true";
      }
      return false;
    }

    // Check aria-selected first
    if (targetEl.getAttribute("aria-selected") === "true") return true;
    if (otherEl.getAttribute("aria-selected") === "true") return false;

    const targetStyle = window.getComputedStyle(targetEl);
    const otherStyle = window.getComputedStyle(otherEl);

    // Compare font-weight (active tab is usually bolder)
    const targetWeight = parseInt(targetStyle.fontWeight) || 400;
    const otherWeight = parseInt(otherStyle.fontWeight) || 400;
    if (targetWeight !== otherWeight) return targetWeight > otherWeight;

    // Compare border-bottom (active tab often has a visible bottom border)
    const targetBorder = parseBorderWidth(targetStyle.borderBottomWidth);
    const otherBorder = parseBorderWidth(otherStyle.borderBottomWidth);
    if (targetBorder !== otherBorder) return targetBorder > otherBorder;

    // Compare opacity
    const targetOpacity = parseFloat(targetStyle.opacity) || 1;
    const otherOpacity = parseFloat(otherStyle.opacity) || 1;
    if (Math.abs(targetOpacity - otherOpacity) > 0.05) return targetOpacity > otherOpacity;

    // Compare text color brightness (active tab text is usually brighter/whiter)
    const targetBright = getColorBrightness(targetStyle.color);
    const otherBright = getColorBrightness(otherStyle.color);
    if (Math.abs(targetBright - otherBright) > 10) return targetBright > otherBright;

    // Fallback: can't determine, assume not active
    return false;
  }

  function parseBorderWidth(val) {
    return parseFloat(val) || 0;
  }

  function getColorBrightness(color) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return 0;
    return (parseInt(match[1]) * 299 + parseInt(match[2]) * 587 + parseInt(match[3]) * 114) / 1000;
  }

  async function startScan(type) {
    const progressKey = type === "following" ? "scanProgress_following" : "scanProgress_followers";
    const listKey = type === "following" ? "followingList" : "followersList";

    try {
      updateProgress(progressKey, "scanning", 0);

      const scrollContainer = findScrollContainer();
      if (!scrollContainer) {
        updateProgress(progressKey, "error", 0,
          chrome.i18n.getMessage("errorNoList"));
        return;
      }

      console.log("[TFC] Found scroll container:", scrollContainer);

      // userMap: Map<username, displayName>
      const userMap = await autoScrollAndCollect(scrollContainer, progressKey);

      console.log("[TFC] Scan complete. Found", userMap.size, "users");

      // Save as array of {username, displayName}
      const list = Array.from(userMap.entries()).map(([username, displayName]) => ({
        username,
        displayName,
      }));

      chrome.storage.local.set({ [listKey]: list }, () => {
        updateProgress(progressKey, "done", userMap.size);
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
   */
  function findScrollContainer() {
    // Strategy 1: role="dialog" with scrollable child
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
      const sc = findBestScrollable(dialog);
      if (sc) return sc;
    }

    // Strategy 2: fixed positioned overlays
    const overlays = document.querySelectorAll("div[style*='position: fixed'], div[style*='position:fixed']");
    for (const overlay of overlays) {
      const sc = findBestScrollable(overlay);
      if (sc) return sc;
    }

    // Strategy 3: brute force — all scrollable elements with user links
    const candidates = getAllScrollableWithUsers();
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.userCount - a.userCount);
      return candidates[0].element;
    }

    // Strategy 4: container with many user links, walk up to scrollable ancestor
    const containers = findContainersWithManyUsers();
    if (containers.length > 0) {
      let el = containers[0].parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
          return el;
        }
        el = el.parentElement;
      }
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
    const divs = document.querySelectorAll("div");
    const result = [];
    for (const div of divs) {
      const count = countUserLinks(div);
      if (count >= 5) {
        result.push(div);
      }
    }
    result.sort((a, b) => a.children.length - b.children.length);
    return result;
  }

  function countUserLinks(container) {
    return extractUsers(container).size;
  }

  /**
   * Extract users from the visible DOM.
   * Returns Map<username, displayName>.
   *
   * Threads list rows typically look like:
   *   <div> (row)
   *     <a href="/@username">  (profile link with avatar or username text)
   *     <span>username</span>  (bold)
   *     <span>Display Name</span> (lighter color, below username)
   *     <button>追蹤中</button>
   *   </div>
   *
   * We find each /@username link, then look for the display name in the
   * surrounding row context.
   */
  function extractUsers(container) {
    const userMap = new Map();

    const links = container.querySelectorAll('a[href*="/@"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      const match = href.match(/\/@([a-zA-Z0-9_.]+)/);
      if (!match) continue;

      const username = match[1];
      if (isReservedPath(username)) continue;
      if (userMap.has(username)) continue;

      // Try to find display name from the row containing this link
      const displayName = findDisplayName(link, username);
      userMap.set(username, displayName);
    }

    return userMap;
  }

  /**
   * Given a profile link element, try to find the display name nearby.
   * Walk up to the "row" container, then look for text that isn't the username.
   */
  function findDisplayName(linkEl, username) {
    // Walk up a few levels to find the row container
    // (a row is typically 3-6 levels up from the <a>)
    let row = linkEl;
    for (let i = 0; i < 8; i++) {
      if (!row.parentElement) break;
      row = row.parentElement;

      // Heuristic: a "row" is a direct child of the scrollable list,
      // or has siblings that also contain /@username links.
      // We look for a container that has at least the username text and
      // something else (display name).
      const rowLinks = row.querySelectorAll('a[href*="/@' + username + '"]');
      if (rowLinks.length >= 1 && row.offsetHeight > 30 && row.offsetHeight < 200) {
        // This looks like a good row candidate
        break;
      }
    }

    // Now search for spans/divs inside this row that contain text
    const textNodes = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text && text.length > 0 && text.length < 100) {
        textNodes.push(text);
      }
    }

    // Filter out the username itself, button text, badge text, and common UI strings
    const skipTexts = new Set([
      username,
      "@" + username,
      "追蹤中", "追蹤", "追蹤對方", "移除", "Follow", "Following", "Unfollow",
      "Remove", "粉絲", "已要求",
      "已驗證", "Verified",  // verified badge text
    ]);

    const candidates = [];
    for (const text of textNodes) {
      if (skipTexts.has(text)) continue;
      if (text === username) continue;
      // Skip if it matches the username (case-insensitive)
      if (/^[a-zA-Z0-9_.]+$/.test(text) && text.toLowerCase() === username.toLowerCase()) continue;
      candidates.push(text);
    }

    if (candidates.length === 0) return "";

    // Prefer the candidate that looks most like a display name:
    // - Not purely ASCII alphanumeric (those are likely usernames)
    // - Contains CJK characters, spaces, or mixed case
    for (const c of candidates) {
      if (/[^\x00-\x7F]/.test(c)) return c;  // has non-ASCII (CJK, etc.)
    }
    for (const c of candidates) {
      if (/\s/.test(c)) return c;  // has spaces (e.g. "John Smith")
    }
    return candidates[0];
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
   * Auto-scroll the container and collect all users.
   * Returns Map<username, displayName>.
   */
  async function autoScrollAndCollect(container, progressKey) {
    const allUsers = new Map(); // username -> displayName
    const SCROLL_DELAY = 1200;
    const SCROLL_STEP = 800;

    // Initial collection
    collectFromContainer(container, allUsers);
    updateProgress(progressKey, "scanning", allUsers.size);
    console.log("[TFC] Initial scan found", allUsers.size, "users");

    let totalScrolls = 0;
    let noNewCount = 0;
    const MAX_NO_NEW = 3;
    let hitPhysicalBottom = false;

    while (true) {
      const prevSize = allUsers.size;
      const prevScrollTop = container.scrollTop;

      container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
      await sleep(SCROLL_DELAY);

      const newScrollTop = container.scrollTop;

      if (Math.abs(newScrollTop - prevScrollTop) < 2) {
        if (!hitPhysicalBottom) {
          console.log("[TFC] Hit physical bottom of scroll container");
          hitPhysicalBottom = true;
        }
      } else {
        hitPhysicalBottom = false;
      }

      collectFromContainer(container, allUsers);
      totalScrolls++;

      if (allUsers.size > prevSize) {
        noNewCount = 0;
        updateProgress(progressKey, "scanning", allUsers.size);
        console.log("[TFC] Scroll #" + totalScrolls + ": found", allUsers.size, "users (+", allUsers.size - prevSize, ")");
      } else {
        noNewCount++;
      }

      if (hitPhysicalBottom && noNewCount >= MAX_NO_NEW) {
        console.log("[TFC] Confirmed end: at physical bottom with no new users after", MAX_NO_NEW, "retries");
        break;
      }

      if (!hitPhysicalBottom && noNewCount >= 8) {
        console.log("[TFC] Fallback stop: no new users for 8 consecutive scrolls");
        break;
      }

      if (allUsers.size > 50000 || totalScrolls > 2000) {
        console.log("[TFC] Safety cap reached, stopping.");
        break;
      }
    }

    return allUsers;
  }

  function collectFromContainer(container, userMap) {
    const found = extractUsers(container);
    for (const [username, displayName] of found) {
      if (!userMap.has(username)) {
        userMap.set(username, displayName);
      }
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
