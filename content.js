/**
 * NTPS addons - Chromium Manifest V3 Content Script
 *
 * Provides a lightweight convenience layer for community discussion items:
 * 1. Remove (Comment): Invokes the site's verified comment deletion request (POST /comment--delete.php) for own comments.
 * 2. Report (Thread): Reuses the site's existing #report form (POST /report--process.php) for the thread.
 *
 * Strict Compliance:
 * - Uses only verified endpoints and parameters.
 * - No invented APIs, CSRF token assumptions, or alternative deletion routes.
 * - Relies entirely on the browser's existing authenticated session cookies.
 * - Server remains the sole authority on authentication and permissions.
 */

(function () {
  'use strict';

  // --- Verified Selectors & Endpoints ---
  const SELECTORS = {
    // Verified discussion comment structure: <div class="comment" data="COMMENT_ID">
    commentItem: '.comment[data]',
    // Verified thread navigation for placing thread-level report button
    threadNav: '#mainnav',
    // Verified existing report form in DOM
    reportForm: '#report',
    reportThreadInput: '#report input[name="threadid"], #report input#threadid',
    reportReasonSelect: '#report select[name="report__reason"], #report select#report__reason',
    // Assumed overlay based on standard naming convention corresponding to report--visible
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
    deleteComment: '/comment--delete.php'
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
   * Determine the current thread identifier.
   * @returns {string|null}
   */
  function getThreadId() {
    const reportThreadInput = document.querySelector(SELECTORS.reportThreadInput);
    if (reportThreadInput && reportThreadInput.value) {
      const val = reportThreadInput.value.trim();
      if (/^[a-zA-Z0-9_\-\.]+$/.test(val)) return val;
    }

    try {
      const params = new URLSearchParams(window.location.search);
      for (const param of ['thread', 'thread_id', 'threadid', 't', 'id', 'post_id']) {
        const val = params.get(param);
        if (val && /^[a-zA-Z0-9_\-\.]+$/.test(val.trim())) return val.trim();
      }
    } catch {}

    const pathname = window.location.pathname;
    const pathMatch = pathname.match(/\/(?:thread|threads|posts|discussion|t)\/([a-zA-Z0-9_\-\.]+)/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1];

    const threadElem = document.querySelector('.thread, #thread, [data-thread], [data-thread-id]');
    if (threadElem) {
      const val = threadElem.getAttribute('data') || threadElem.getAttribute('data-thread') || threadElem.getAttribute('data-thread-id');
      if (val && /^[a-zA-Z0-9_\-\.]+$/.test(val.trim())) return val.trim();
    }

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
   * Faithfully reproduces the verified native behavior:
   * 1. reportThread.addClass("report--visible")
   * 2. showOverlay() 
   */
  function openFlagInterface(threadId) {
    const reportForm = document.querySelector(SELECTORS.reportForm);

    if (!reportForm) {
      return;
    }

    // 1. Emulate native behavior: apply the verified CSS class to #report
    reportForm.classList.add('report--visible');

    // 2. Emulate showOverlay() behavior
    // NOTE: If the actual DOM ID for the overlay is different, 
    // update SELECTORS.overlay at the top of this file.
    const overlay = document.querySelector(SELECTORS.overlay);
    if (overlay) {
      overlay.classList.add('overlay--visible');
    }

    // Ensure threadid hidden input is populated
    if (threadId) {
      const threadInput = reportForm.querySelector(SELECTORS.reportThreadInput);
      if (threadInput && !threadInput.value) {
        threadInput.value = threadId;
      }
    }

    // Focus reason select to aid accessibility
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
   * Attach a top-level "Report Thread" button to the thread if appropriate.
   */
  function attachThreadReportAction() {
    const threadNav = document.querySelector(SELECTORS.threadNav);
    if (!threadNav || threadNav.querySelector('.community-helper-thread-report')) return;

    const threadId = getThreadId();
    if (!threadId) return;
    if (!document.querySelector(SELECTORS.reportForm)) return;

    const threadBtn = document.createElement('button');
    threadBtn.type = 'button';
    threadBtn.className = 'community-helper-btn community-helper-btn-report community-helper-thread-report';
    threadBtn.textContent = 'Report Thread';
    threadBtn.setAttribute('title', `Report thread #${threadId}`);

    threadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFlagInterface(threadId);
    });

    threadNav.appendChild(threadBtn);
  }

  function observeItems() {
    const existingItems = document.querySelectorAll(SELECTORS.commentItem);
    for (let i = 0; i < existingItems.length; i++) {
      processItem(existingItems[i]);
    }

    attachThreadReportAction();

    const observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const mutation = mutations[i];
        if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;

        for (let j = 0; j < mutation.addedNodes.length; j++) {
          const node = mutation.addedNodes[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (node.classList && (
            node.classList.contains('community-helper-action-bar') ||
            node.classList.contains('community-helper-status') ||
            node.classList.contains('community-helper-removed-notice') ||
            node.classList.contains('community-helper-thread-report')
          )) {
            continue;
          }

          if (node.matches && node.matches(SELECTORS.commentItem)) {
            processItem(node);
          }
          if (node.querySelectorAll) {
            const nestedItems = node.querySelectorAll(SELECTORS.commentItem);
            for (let k = 0; k < nestedItems.length; k++) {
              processItem(nestedItems[k]);
            }
          }
          
          if (node.matches && node.matches(SELECTORS.threadNav) || (node.querySelectorAll && node.querySelector(SELECTORS.threadNav))) {
            attachThreadReportAction();
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeItems);
  } else {
    observeItems();
  }
})();
