/**
 * NTPS addons - Chromium Manifest V3 Content Script
 *
 * Provides a lightweight convenience layer for community discussion items:
 * 1. Remove (Comment): Invokes the site's verified comment deletion request (POST /comment--delete.php) for own comments.
 * 2. Report (Thread): Reuses or activates the site's native #report interface (POST /report--process.php) for the thread.
 *
 * Strict Compliance:
 * - Works seamlessly across both standalone full pages (/thread/ID) and dynamic popup dialog cards.
 * - Uses only verified endpoints and form parameters.
 * - Relies entirely on the browser's existing authenticated session cookies.
 * - Server remains the sole authority on authentication and permissions.
 */

(function () {
  'use strict';

  // --- Verified Selectors & Endpoints ---
  const SELECTORS = {
    // Verified discussion comment structure: <div class="comment" data="COMMENT_ID">
    commentItem: '.comment[data]',
    // Dynamic popup thread containers
    threadWrapper: '#thread__wrapper',
    threadContainer: '#thread__container',
    threadContent: '#thread__content',
    // Navigation and header controls
    threadAuthor: '.maincolumn__author',
    threadNav: '#mainnav',
    photoNav: '.maincolumn__photo__nav',
    // Verified existing report form in DOM
    reportForm: '#report',
    reportThreadInput: 'input[name="threadid"], input#threadid',
    reportReasonSelect: 'select[name="report__reason"], select#report__reason',
    // Verified overlay element
    overlay: '#overlay',
    // Comment specific selectors
    commentInfoAuthorLink: '.comment__info a[href*="/user/"]',
    commentConfirmArea: '.comment__confirm',
    // Current user context
    navbar: '#navbar[data-userid]'
  };

  const ENDPOINTS = {
    // Verified site comment deletion endpoint:
    // POST /comment--delete.php with body: thread=THREAD_ID&comment=COMMENT_ID
    deleteComment: '/comment--delete.php',
    // Verified site report processing endpoint:
    reportProcess: '/report--process.php'
  };

  /**
   * Determine the current logged-in user ID from the navbar.
   * @returns {string|null}
   */
  function getCurrentUserId() {
    const navbar = document.querySelector(SELECTORS.navbar);
    return navbar ? navbar.getAttribute('data-userid') : null;
  }

  /**
   * Determine the comment author's user ID from the comment info link.
   * @param {HTMLElement} element 
   * @returns {string|null}
   */
  function getCommentAuthorId(element) {
    const authorLink = element.querySelector(SELECTORS.commentInfoAuthorLink);
    if (authorLink) {
      const href = authorLink.getAttribute('href');
      const match = href.match(/\/user\/(\d+)/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Determine if the comment has already been deleted.
   * @param {HTMLElement} element
   * @returns {boolean}
   */
  function isCommentDeleted(element) {
    if (element.classList.contains('comment--deleted')) return true;
    if (element.textContent.includes('This comment has been removed.')) return true;
    return false;
  }

  /**
   * Determine the current active thread identifier.
   * Prioritizes the active thread popup (#thread__content[data="THREAD_ID"]),
   * followed by hidden threadid inputs, favorite button attributes, container data, and URL patterns.
   * @returns {string|null}
   */
  function getThreadId() {
    // 1. Inspect dynamic thread content in popup or page: <div id="thread__content" data="THREAD_ID">
    const threadContent = document.querySelector(SELECTORS.threadContent);
    if (threadContent && threadContent.getAttribute('data')) {
      const dataId = threadContent.getAttribute('data').trim();
      if (/^[a-zA-Z0-9_\-\.]+$/.test(dataId)) {
        return dataId;
      }
    }

    // 2. Inspect hidden thread ID input in page or popup: <input id="threadid" value="THREAD_ID">
    const threadInput = document.querySelector('input#threadid, input[name="threadid"]');
    if (threadInput && threadInput.value) {
      const val = threadInput.value.trim();
      if (/^[a-zA-Z0-9_\-\.]+$/.test(val)) {
        return val;
      }
    }

    // 3. Inspect favorite button data-id in popup: <div id="favorite" data-id="THREAD_ID">
    const favoriteBtn = document.querySelector('#favorite[data-id]');
    if (favoriteBtn && favoriteBtn.getAttribute('data-id')) {
      const id = favoriteBtn.getAttribute('data-id').trim();
      if (/^[a-zA-Z0-9_\-\.]+$/.test(id)) {
        return id;
      }
    }

    // 4. Inspect thread wrapper / container data attributes
    const threadContainer = document.querySelector(`${SELECTORS.threadContainer}, ${SELECTORS.threadWrapper}, .thread, #thread`);
    if (threadContainer) {
      const val = threadContainer.getAttribute('data') ||
                  threadContainer.getAttribute('data-thread') ||
                  threadContainer.getAttribute('data-thread-id');
      if (val && /^[a-zA-Z0-9_\-\.]+$/.test(val.trim())) {
        return val.trim();
      }
    }

    // 5. Inspect URL pathname (/threads/:id, /thread/:id, /posts/:id)
    const pathname = window.location.pathname;
    const pathMatch = pathname.match(/\/(?:thread|threads|posts|discussion|t)\/([a-zA-Z0-9_\-\.]+)/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1];

    // 6. Inspect URL search parameters (?thread=..., ?thread_id=..., ?id=..., ?t=...)
    try {
      const params = new URLSearchParams(window.location.search);
      for (const param of ['thread', 'thread_id', 'threadid', 't', 'id', 'post_id']) {
        const val = params.get(param);
        if (val && /^[a-zA-Z0-9_\-\.]+$/.test(val.trim())) return val.trim();
      }
    } catch {}

    return null;
  }

  /**
   * Extract and validate the comment identifier.
   * @param {HTMLElement} element
   * @returns {string|null}
   */
  function getItemId(element) {
    if (!element || !(element instanceof HTMLElement)) return null;
    const rawId = element.getAttribute('data');
    if (!rawId) return null;
    const sanitizedId = String(rawId).trim();
    if (/^[a-zA-Z0-9_\-\.]+$/.test(sanitizedId)) return sanitizedId;
    return null;
  }

  /**
   * Display concise status or error message within the action bar.
   * @param {HTMLElement} container
   * @param {string} message
   * @param {'info'|'success'|'error'} [type='info']
   * @param {number} [autoClearMs=0]
   */
  function showStatus(container, message, type = 'info', autoClearMs = 0) {
    if (!container) return;
    container.textContent = message;
    container.className = `community-helper-status community-helper-status-${type}`;
    if (autoClearMs > 0) {
      setTimeout(() => {
        if (container.textContent === message) {
          container.textContent = '';
          container.className = 'community-helper-status';
        }
      }, autoClearMs);
    }
  }

  /**
   * Remove comment handler.
   */
  async function removeItem(threadId, itemId, itemElement, removeButton, statusElement) {
    if (!window.confirm('Remove this item?')) return;
    if (!itemId) return showStatus(statusElement, 'Error: Missing comment ID.', 'error', 4000);
    if (!threadId) return showStatus(statusElement, 'Error: Could not determine thread ID.', 'error', 4000);

    removeButton.disabled = true;
    const originalText = removeButton.textContent;
    removeButton.textContent = 'Removing...';
    showStatus(statusElement, '', 'info');

    try {
      const params = new URLSearchParams();
      params.append('thread', threadId);
      params.append('comment', itemId);

      const response = await fetch(ENDPOINTS.deleteComment, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        credentials: 'same-origin',
        body: params.toString()
      });

      if (response.ok) {
        removeButton.textContent = 'Removed';
        itemElement.classList.add('community-helper-item-removed');
        const actionBar = itemElement.querySelector('.community-helper-action-bar');
        if (actionBar) actionBar.remove();

        const notice = document.createElement('div');
        notice.className = 'community-helper-removed-notice';
        notice.textContent = '[Comment removed]';
        itemElement.appendChild(notice);
        itemElement.classList.add('comment--deleted');
      } else {
        removeButton.disabled = false;
        removeButton.textContent = originalText;
        if (response.status === 401 || response.status === 403) {
          showStatus(statusElement, 'Unauthorized: You cannot remove this comment.', 'error', 6000);
        } else if (response.status === 404) {
          showStatus(statusElement, 'Comment not found.', 'error', 6000);
        } else {
          showStatus(statusElement, `Removal failed (HTTP ${response.status}).`, 'error', 6000);
        }
      }
    } catch (networkError) {
      removeButton.disabled = false;
      removeButton.textContent = originalText;
      showStatus(statusElement, 'Network error. Please try again.', 'error', 6000);
    }
  }

  /**
   * Report/Flag action handler.
   * Reuses the site's verified report interface or creates the native report modal
   * if opening from a listing page where #report wasn't pre-rendered by the server.
   */
  function openFlagInterface(threadId) {
    let reportForm = document.querySelector(SELECTORS.reportForm);
    let overlay = document.querySelector(SELECTORS.overlay);

    // 1. Ensure the native overlay exists
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'overlay';
      overlay.className = 'overlay';
      overlay.addEventListener('click', () => {
        if (reportForm) reportForm.classList.remove('report--visible');
        overlay.classList.remove('overlay--visible');
      });
      document.body.appendChild(overlay);
    }

    // 2. If #report does not exist in DOM (e.g. popup opened from main listing), create native form structure
    if (!reportForm) {
      reportForm = document.createElement('form');
      reportForm.id = 'report';
      reportForm.className = 'report';
      reportForm.method = 'POST';
      reportForm.action = ENDPOINTS.reportProcess;

      const closeBtn = document.createElement('div');
      closeBtn.id = 'report__close';
      closeBtn.className = 'report__close';
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'position: absolute; top: 10px; right: 15px; font-size: 22px; cursor: pointer; color: #6b7280;';
      closeBtn.addEventListener('click', () => {
        reportForm.classList.remove('report--visible');
        overlay.classList.remove('overlay--visible');
      });

      const threadInput = document.createElement('input');
      threadInput.type = 'hidden';
      threadInput.name = 'threadid';
      threadInput.id = 'threadid';
      threadInput.value = threadId;

      const titleDiv = document.createElement('div');
      titleDiv.className = 'report__title';
      titleDiv.style.cssText = 'font-weight: bold; margin-bottom: 12px; font-size: 15px;';
      titleDiv.textContent = `Report Thread #${threadId}`;

      const reasonSelect = document.createElement('select');
      reasonSelect.name = 'report__reason';
      reasonSelect.id = 'report__reason';
      reasonSelect.style.cssText = 'width: 100%; padding: 6px; margin-bottom: 10px; border-radius: 4px; border: 1px solid #d1d5db;';
      const reasons = [
        { val: '1', label: 'DMCA Takedown / Copyright Infringement' },
        { val: '2', label: 'Illegal content' },
        { val: '3', label: 'Spam' },
        { val: '4', label: 'Other' }
      ];
      reasons.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.val;
        opt.textContent = r.label;
        reasonSelect.appendChild(opt);
      });

      const commentTextarea = document.createElement('textarea');
      commentTextarea.name = 'report__comment';
      commentTextarea.id = 'report__comment';
      commentTextarea.placeholder = 'Optional comments...';
      commentTextarea.style.cssText = 'width: 100%; height: 80px; padding: 6px; margin-bottom: 12px; border-radius: 4px; border: 1px solid #d1d5db; font-family: inherit;';

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.id = 'report__submit';
      submitBtn.className = 'button button__pink';
      submitBtn.style.cssText = 'cursor: pointer; padding: 8px 16px; font-weight: bold; border-radius: 4px;';
      submitBtn.textContent = `Report Thread #${threadId}`;

      // Submit handler using verified POST /report--process.php
      submitBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        const formData = new FormData();
        formData.append('threadid', threadInput.value);
        formData.append('report__reason', reasonSelect.value);
        formData.append('report__comment', commentTextarea.value);

        try {
          const res = await fetch(ENDPOINTS.reportProcess, {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
          });

          if (res.ok) {
            submitBtn.textContent = 'Report submitted!';
            setTimeout(() => {
              reportForm.classList.remove('report--visible');
              overlay.classList.remove('overlay--visible');
              submitBtn.disabled = false;
              submitBtn.textContent = `Report Thread #${threadId}`;
            }, 1200);
          } else {
            submitBtn.textContent = `Submission failed (${res.status})`;
            setTimeout(() => {
              submitBtn.disabled = false;
              submitBtn.textContent = `Report Thread #${threadId}`;
            }, 2500);
          }
        } catch {
          submitBtn.textContent = 'Network error';
          setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = `Report Thread #${threadId}`;
          }, 2500);
        }
      });

      reportForm.appendChild(closeBtn);
      reportForm.appendChild(threadInput);
      reportForm.appendChild(titleDiv);
      reportForm.appendChild(reasonSelect);
      reportForm.appendChild(commentTextarea);
      reportForm.appendChild(submitBtn);

      document.body.appendChild(reportForm);
    } else {
      // 3. Existing pre-rendered #report form in DOM: update thread ID value
      const threadInput = reportForm.querySelector(SELECTORS.reportThreadInput);
      if (threadInput) {
        threadInput.value = threadId;
      }
    }

    // 4. Activate native visible classes
    reportForm.classList.add('report--visible');
    overlay.classList.add('overlay--visible');

    const reasonSelect = reportForm.querySelector(SELECTORS.reportReasonSelect);
    if (reasonSelect) {
      reasonSelect.focus();
    }
  }

  /**
   * Append action bar ([ Remove ]) to a comment item, if authorized.
   */
  function addActions(itemElement) {
    if (!itemElement || !(itemElement instanceof HTMLElement)) return;
    if (isCommentDeleted(itemElement)) return;
    if (itemElement.querySelector('.community-helper-action-bar')) return;

    const itemId = getItemId(itemElement);
    if (!itemId) return;

    const currentUserId = getCurrentUserId();
    const authorId = getCommentAuthorId(itemElement);
    const canRemove = currentUserId && (currentUserId === authorId);

    if (!canRemove) return;

    const actionBar = document.createElement('div');
    actionBar.className = 'community-helper-action-bar';
    actionBar.setAttribute('role', 'group');
    actionBar.setAttribute('aria-label', 'Comment moderation actions');

    const statusSpan = document.createElement('span');
    statusSpan.className = 'community-helper-status';
    statusSpan.setAttribute('aria-live', 'polite');

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'community-helper-btn community-helper-btn-remove';
    btnRemove.textContent = 'Remove';
    btnRemove.setAttribute('title', `Remove comment #${itemId}`);
    btnRemove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const currentThreadId = getThreadId();
      removeItem(currentThreadId, itemId, itemElement, btnRemove, statusSpan);
    });
    
    actionBar.appendChild(btnRemove);
    actionBar.appendChild(statusSpan);

    const confirmArea = itemElement.querySelector(SELECTORS.commentConfirmArea);
    if (confirmArea) {
      if (confirmArea.nextSibling) {
        confirmArea.parentNode.insertBefore(actionBar, confirmArea.nextSibling);
      } else {
        confirmArea.parentNode.appendChild(actionBar);
      }
    } else {
      itemElement.appendChild(actionBar);
    }
  }

  function processItem(element) {
    if (!element || !(element instanceof HTMLElement)) return;
    if (element.dataset.communityHelperProcessed === 'true') return;
    const itemId = getItemId(element);
    if (!itemId) return;
    element.dataset.communityHelperProcessed = 'true';
    addActions(element);
  }

  /**
   * Attach the [Report Thread] button to the active thread (both in popup and standalone mode).
   * Inserts into both the photo nav bar (#mainnav) and the author line (.maincolumn__author).
   */
  function attachThreadReportAction() {
    const threadId = getThreadId();
    if (!threadId) return;

    // 1. Target A: Main Photo Navigation Bar (#mainnav)
    const mainNavs = document.querySelectorAll('#mainnav');
    mainNavs.forEach(nav => {
      let existingNavBtn = nav.querySelector('.community-helper-thread-report-nav');
      if (existingNavBtn) {
        if (existingNavBtn.dataset.threadId === threadId) return;
        existingNavBtn.remove();
      }

      const navBtn = document.createElement('div');
      navBtn.className = 'maincolumn__photo__nav__button community-helper-thread-report-nav';
      navBtn.title = `Report Thread #${threadId}`;
      navBtn.dataset.threadId = threadId;
      navBtn.innerHTML = '<span style="font-size: 13px; line-height: 1;">🚩</span>';
      navBtn.style.cursor = 'pointer';

      navBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFlagInterface(threadId);
      });

      nav.appendChild(navBtn);
    });

    // 2. Target B: Author line (.maincolumn__author)
    const authorLines = document.querySelectorAll('.maincolumn__author');
    authorLines.forEach(authorLine => {
      let existingBtn = authorLine.querySelector('.community-helper-thread-report-btn');
      if (existingBtn) {
        if (existingBtn.dataset.threadId === threadId) return;
        existingBtn.remove();
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'community-helper-btn community-helper-btn-report community-helper-thread-report-btn';
      btn.textContent = 'Report Thread';
      btn.title = `Report thread #${threadId}`;
      btn.dataset.threadId = threadId;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFlagInterface(threadId);
      });

      authorLine.appendChild(btn);
    });
  }

  /**
   * Run a full pass over all comments and the active thread container.
   */
  function checkAndProcessAll() {
    const existingItems = document.querySelectorAll(SELECTORS.commentItem);
    for (let i = 0; i < existingItems.length; i++) {
      processItem(existingItems[i]);
    }
    attachThreadReportAction();
  }

  /**
   * Initialize MutationObserver, user interaction listeners, and background heartbeat.
   */
  function observeItems() {
    // 1. Initial pass
    checkAndProcessAll();

    // 2. MutationObserver for dynamic DOM updates (popup insertions, comment loads)
    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;

      for (let i = 0; i < mutations.length; i++) {
        const mutation = mutations[i];

        if (mutation.type === 'attributes') {
          if (mutation.target && (
            mutation.target.id === 'thread__content' ||
            mutation.target.id === 'thread__wrapper' ||
            mutation.target.id === 'thread__container'
          )) {
            shouldCheck = true;
          }
          continue;
        }

        if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;

        for (let j = 0; j < mutation.addedNodes.length; j++) {
          const node = mutation.addedNodes[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Ignore extension's own UI elements
          if (node.classList && (
            node.classList.contains('community-helper-action-bar') ||
            node.classList.contains('community-helper-status') ||
            node.classList.contains('community-helper-removed-notice') ||
            node.classList.contains('community-helper-thread-report-btn') ||
            node.classList.contains('community-helper-thread-report-nav')
          )) {
            continue;
          }

          shouldCheck = true;

          // Check if node is or contains comments
          if (node.matches && node.matches(SELECTORS.commentItem)) {
            processItem(node);
          }
          if (node.querySelectorAll) {
            const nestedItems = node.querySelectorAll(SELECTORS.commentItem);
            for (let k = 0; k < nestedItems.length; k++) {
              processItem(nestedItems[k]);
            }
          }
        }
      }

      if (shouldCheck) {
        checkAndProcessAll();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data', 'data-popup', 'class', 'style']
    });

    // 3. User navigation listeners (clicking thumbnails, history state changes)
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a[href*="/thread/"], .thumb, .nav__action, #mainphoto, .maincolumn__photo__nav__button');
      if (target) {
        setTimeout(checkAndProcessAll, 50);
        setTimeout(checkAndProcessAll, 200);
        setTimeout(checkAndProcessAll, 500);
        setTimeout(checkAndProcessAll, 1000);
      }
    }, { passive: true });

    window.addEventListener('popstate', () => {
      setTimeout(checkAndProcessAll, 50);
      setTimeout(checkAndProcessAll, 300);
    });

    // 4. Background heartbeat to guarantee 100% detection regardless of AJAX transition timings
    setInterval(checkAndProcessAll, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeItems);
  } else {
    observeItems();
  }
})();
