// ==UserScript==
// @name         文章导出 Markdown ZIP
// @namespace    https://github.com/openai/codex
// @version      0.9.0
// @description  导出当前页面文章为 Markdown 和图片 ZIP，适配知乎、CSDN、博客园及常见个人博客
// @author       Codex
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @require      https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js
// @require      https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'tm-article-exporter-button';
  const CLOSE_BUTTON_ID = 'tm-article-exporter-close';
  const STATUS_ID = 'tm-article-exporter-status';
  const IMAGE_DIR = 'image';
  const MAX_FILENAME_LENGTH = 96;
  const STATUS_AUTO_HIDE_MS = 5000;
  const BUTTON_POSITION_KEY = 'tmArticleExporterButtonPositionV1';
  const BUTTON_VISIBILITY_KEY = 'tmArticleExporterButtonVisibleV1';
  const FLOATING_BUTTON_SIZE = 36;
  const FLOATING_BUTTON_MARGIN = 8;
  const FLOATING_BUTTON_IDLE_MS = 5000;

  let statusHideTimer = 0;
  let collapseTimer = 0;
  let buttonDragState = null;
  let suppressNextButtonClick = false;
  let isWorking = false;
  let buttonCollapsed = false;
  let hasBoundWindowEvents = false;

  const GENERIC_TITLE_SELECTORS = [
    'article h1',
    'main h1',
    '.post-title',
    '.entry-title',
    '.article-title',
    '.title',
    'h1',
  ];

  const GENERIC_CONTENT_SELECTORS = [
    'article',
    'main article',
    '.article-content',
    '.article-body',
    '.post-content',
    '.entry-content',
    '.post-body',
    '.markdown-body',
    '.rich-text',
    '.content',
    'main',
  ];

  const GENERIC_REMOVE_SELECTORS = [
    'script',
    'style',
    'iframe',
    'canvas',
    'form',
    'button',
    'input',
    'textarea',
    'select',
    'nav',
    'header nav',
    'footer',
    'aside',
    '.advertisement',
    '.adsbygoogle',
    '.ads',
    '.ad',
    '.share',
    '.sharing',
    '.social-share',
    '.comment',
    '.comments',
    '.comment-list',
    '.comment-box',
    '.comment-area',
    '.recommend',
    '.recommend-box',
    '.related-posts',
    '.related',
    '.catalog',
    '.toc',
    '.table-of-contents',
    '.sidebar',
    '.entry-footer',
    '.post-footer',
    '.author-box',
    '.author-info',
    '.breadcrumb',
    '.tag-list',
    '.copyright',
    '.tool-box',
    '.toolbar',
    '.floating-toolbar',
    '.fixed-right',
  ];

  const GENERIC_NOISE_PATTERNS = [
    /关于我们/,
    /招贤纳士/,
    /商务合作/,
    /寻求报道/,
    /在线客服/,
    /工作时间/,
    /公安备案号/,
    /京ICP备/,
    /经营性网站备案信息/,
    /北京互联网违法和不良信息举报中心/,
    /网络110报警服务/,
    /中国互联网举报中心/,
    /版权与免责声明/,
    /版权申诉/,
    /出版物许可证/,
    /营业执照/,
    /©\s*1999-/,
  ];

  const KNOWN_CODE_LANGUAGES = new Set([
    'bash',
    'c',
    'clojure',
    'cpp',
    'csharp',
    'css',
    'dart',
    'dockerfile',
    'go',
    'graphql',
    'groovy',
    'html',
    'java',
    'javascript',
    'json',
    'jsx',
    'kotlin',
    'latex',
    'less',
    'lua',
    'makefile',
    'markdown',
    'matlab',
    'objectivec',
    'perl',
    'php',
    'plaintext',
    'powershell',
    'python',
    'r',
    'ruby',
    'rust',
    'scala',
    'scss',
    'shell',
    'sql',
    'swift',
    'tsx',
    'typescript',
    'vb',
    'xml',
    'yaml',
  ]);

  const CODE_UI_SELECTORS = [
    '.hljs-button',
    '.copy-code',
    '.copy-btn',
    '.copy-button',
    '.code-copy',
    '.code-toolbar__header',
    '.code-header',
    '.code-title',
    '.code-lang',
    '.language-type',
    '.show-lang',
    '.line-numbers-rows',
    '.hljs-ln-numbers',
    '.hljs-ln-actions',
    '.gutter',
    '.code-index',
    '.line-numbers',
    '.linenumber',
    '.line-number',
    '.lineNo',
  ];
  const SITE_CONFIGS = [
    {
      name: 'Zhihu Column',
      match: (host, path) => host === 'zhuanlan.zhihu.com' || (host.endsWith('zhihu.com') && /^\/p\/\d+/.test(path)),
      titleSelectors: ['h1.Post-Title', 'h1'],
      contentSelectors: ['article.Post-content', '.Post-RichTextContainer', '.RichText.ztext'],
      removeSelectors: [
        '.Post-SideActions',
        '.ContentItem-actions',
        '.Post-Sub',
        '.Post-topicsAndReviewer',
        '.Recommendations-Main',
        '.ColumnPageHeader-Menu',
        '.RichText-video',
      ],
    },
    {
      name: 'Zhihu Question',
      match: (host, path) => host.endsWith('zhihu.com') && path.startsWith('/question/'),
      titleSelectors: ['h1.QuestionHeader-title', '.QuestionHeader-title', 'h1'],
      contentSelectors: [
        '.Question-mainColumn .AnswerCard .RichContent .RichContent-inner',
        '.Question-mainColumn .RichContent .RichContent-inner',
        '.RichContent .RichContent-inner',
      ],
      removeSelectors: [
        '.RichContent-actions',
        '.ContentItem-actions',
        '.Comments-container',
        '.Recommendations-Main',
        '.AuthorInfo',
      ],
    },
    {
      name: 'CSDN',
      match: (host) => host.includes('csdn.net'),
      titleSelectors: ['h1.title-article', '.article-title-box h1', 'h1'],
      contentSelectors: ['#content_views', 'article.baidu_pl', 'main #article_content'],
      removeSelectors: [
        '.blog-extension-box',
        '.article-info-box',
        '.readall_box',
        '.hljs-button',
        '.set-code-style',
        '.article-copyright',
        '.directory-box',
        '.recommend-box',
        '.recommend-item-box',
        '.comment-box',
        '.tool-box',
        '.meau-gotop-box',
        '.passport-login-tip-container',
        '.reward-box',
        '.aside-box',
        '.csdn-side-toolbar',
        '.blog_container_aside',
        '.article-btm-box',
        '.more-toolbox',
        '.first-recommend-box',
        '.second-recommend-box',
        '.recommend-right',
        '.profile-box',
        '.toolbar-advert',
        '.vip-caise',
        '.vip-card-box',
        '.activity-box',
        '.csdn-toolbar',
        '.csdn-tracking-statistics',
        '.template-box',
        '.operate',
        '.left-toolbox',
        '.right-toolbox',
        '[class*="recommend-ad-box"]',
        '[class*="passport-login"]',
        '[class*="toolbar-ad"]',
      ],
      noisePatterns: [
        /确定要放弃本次机会/,
        /福利倒计时/,
        /立减\s*¥/,
        /普通VIP年卡可用/,
        /立即使用/,
        /金山电脑医生/,
        /点赞/,
        /收藏/,
        /评论/,
        /复制链接/,
        /分享到\s*QQ/,
        /分享到新浪微博/,
        /扫一扫/,
        /举报/,
      ],
    },
    {
      name: 'Cnblogs',
      match: (host) => host.includes('cnblogs.com'),
      titleSelectors: ['#cb_post_title_url', '.postTitle a', 'h1'],
      contentSelectors: ['#cnblogs_post_body', '.postBody', '.blogpost-body'],
      removeSelectors: [
        '#blog_post_info_block',
        '#green_channel',
        '#comment_form_container',
        '#comment_nav',
        '#under_post_news',
        '.postDesc',
        '.feedback_area_title',
        '.feedbackItem',
        '.diggit',
      ],
    },
  ];

  function injectStyles() {
    GM_addStyle(`
      #${BUTTON_ID} {
        position: fixed;
        right: 8px;
        bottom: 8px;
        z-index: 2147483647;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        background: rgba(15, 118, 110, 0.68);
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
        cursor: grab;
        user-select: none;
        touch-action: none;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        white-space: normal;
        opacity: 0.86;
        backdrop-filter: blur(10px);
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.2);
        transition: left 180ms ease, top 180ms ease, opacity 180ms ease, box-shadow 180ms ease, transform 180ms ease;
      }

      #${BUTTON_ID}:hover {
        opacity: 0.96;
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.26);
      }

      #${BUTTON_ID}[data-working='true'] {
        cursor: wait;
        opacity: 0.74;
      }

      #${BUTTON_ID}[data-dragging='true'] {
        cursor: grabbing;
        opacity: 0.98;
        transform: scale(1.06);
        transition: none;
      }

      #${BUTTON_ID}[data-collapsed='true'] {
        opacity: 0.72;
      }

      #${CLOSE_BUTTON_ID} {
        position: fixed;
        z-index: 2147483647;
        width: 16px;
        height: 16px;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.72);
        color: #fff;
        font-size: 10px;
        line-height: 1;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
      }

      #${CLOSE_BUTTON_ID}:hover {
        background: rgba(127, 29, 29, 0.82);
      }

      #${STATUS_ID} {
        position: fixed;
        right: 24px;
        bottom: 78px;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 32px));
        padding: 14px;
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.96);
        color: #e2e8f0;
        font-size: 13px;
        line-height: 1.5;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.36);
        backdrop-filter: blur(10px);
        display: none;
        word-break: break-word;
      }

      #${STATUS_ID}[data-state='success'] {
        background: rgba(6, 95, 70, 0.96);
      }

      #${STATUS_ID}[data-state='error'] {
        background: rgba(127, 29, 29, 0.96);
      }

      #${STATUS_ID} .tm-status-phase {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #99f6e4;
      }

      #${STATUS_ID}[data-state='success'] .tm-status-phase,
      #${STATUS_ID}[data-state='error'] .tm-status-phase {
        color: #f8fafc;
      }

      #${STATUS_ID} .tm-status-message {
        margin-top: 6px;
        font-size: 14px;
        font-weight: 600;
        color: #f8fafc;
      }

      #${STATUS_ID} .tm-status-meta {
        margin-top: 6px;
        min-height: 20px;
        color: rgba(226, 232, 240, 0.92);
      }

      #${STATUS_ID} .tm-status-progress {
        margin-top: 10px;
        height: 8px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(148, 163, 184, 0.2);
      }

      #${STATUS_ID} .tm-status-progress[hidden] {
        display: none;
      }

      #${STATUS_ID} .tm-status-progress-bar {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #14b8a6 0%, #5eead4 100%);
        transition: width 180ms ease;
      }

      #${STATUS_ID}[data-state='success'] .tm-status-progress-bar {
        background: linear-gradient(90deg, #34d399 0%, #bbf7d0 100%);
      }

      #${STATUS_ID}[data-state='error'] .tm-status-progress-bar {
        background: linear-gradient(90deg, #f87171 0%, #fecaca 100%);
      }
    `);
  }

  function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function readStoredButtonPosition() {
    try {
      const raw = window.localStorage?.getItem(BUTTON_POSITION_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) {
        return null;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function saveStoredButtonPosition(position) {
    try {
      window.localStorage?.setItem(BUTTON_POSITION_KEY, JSON.stringify(position));
    } catch (error) {
      // Ignore storage failures on restricted pages.
    }
  }

  function readFloatingVisibility() {
    try {
      return window.localStorage?.getItem(BUTTON_VISIBILITY_KEY) !== "0";
    } catch (error) {
      return true;
    }
  }

  function saveFloatingVisibility(visible) {
    try {
      window.localStorage?.setItem(BUTTON_VISIBILITY_KEY, visible ? "1" : "0");
    } catch (error) {
      // Ignore storage failures on restricted pages.
    }
  }

  function clearCollapseTimer() {
    if (collapseTimer) {
      window.clearTimeout(collapseTimer);
      collapseTimer = 0;
    }
  }

  function getDefaultButtonPosition(button) {
    const width = button?.offsetWidth || FLOATING_BUTTON_SIZE;
    const height = button?.offsetHeight || FLOATING_BUTTON_SIZE;
    return {
      left: window.innerWidth - width - FLOATING_BUTTON_MARGIN,
      top: window.innerHeight - height - FLOATING_BUTTON_MARGIN,
      edge: "right",
    };
  }

  function getClampedButtonPosition(position, button = document.getElementById(BUTTON_ID)) {
    const width = button?.offsetWidth || FLOATING_BUTTON_SIZE;
    const height = button?.offsetHeight || FLOATING_BUTTON_SIZE;
    const maxLeft = Math.max(FLOATING_BUTTON_MARGIN, window.innerWidth - width - FLOATING_BUTTON_MARGIN);
    const maxTop = Math.max(FLOATING_BUTTON_MARGIN, window.innerHeight - height - FLOATING_BUTTON_MARGIN);
    return {
      left: clampNumber(Number.isFinite(position?.left) ? position.left : maxLeft, FLOATING_BUTTON_MARGIN, maxLeft),
      top: clampNumber(Number.isFinite(position?.top) ? position.top : maxTop, FLOATING_BUTTON_MARGIN, maxTop),
    };
  }

  function getButtonEdge(left, button = document.getElementById(BUTTON_ID)) {
    const width = button?.offsetWidth || FLOATING_BUTTON_SIZE;
    return left + width / 2 < window.innerWidth / 2 ? "left" : "right";
  }

  function snapButtonToEdge(position, button = document.getElementById(BUTTON_ID)) {
    const clamped = getClampedButtonPosition(position, button);
    const width = button?.offsetWidth || FLOATING_BUTTON_SIZE;
    const edge = position?.edge || getButtonEdge(clamped.left, button);
    const targetLeft = edge === "left"
      ? FLOATING_BUTTON_MARGIN
      : Math.max(FLOATING_BUTTON_MARGIN, window.innerWidth - width - FLOATING_BUTTON_MARGIN);
    return {
      left: targetLeft,
      top: clamped.top,
      edge,
    };
  }

  function positionCloseButton() {
    const button = document.getElementById(BUTTON_ID);
    const close = document.getElementById(CLOSE_BUTTON_ID);
    if (!button || !close) {
      return;
    }
    if (button.style.display === "none" || buttonCollapsed || button.dataset.dragging === "true" || isWorking) {
      close.style.display = "none";
      return;
    }
    const size = close.offsetWidth || 16;
    const rect = button.getBoundingClientRect();
    const left = clampNumber(rect.right - size * 0.45, 4, Math.max(4, window.innerWidth - size - 4));
    const top = clampNumber(rect.top - size * 0.35, 4, Math.max(4, window.innerHeight - size - 4));
    close.style.left = `${left}px`;
    close.style.top = `${top}px`;
    close.style.display = "flex";
  }

  function positionStatusPanel() {
    const button = document.getElementById(BUTTON_ID);
    const status = document.getElementById(STATUS_ID);
    if (!button || !status || status.style.display === "none" || button.style.display === "none") {
      return;
    }
    const rect = button.getBoundingClientRect();
    const width = Math.min(status.offsetWidth || 360, Math.max(220, window.innerWidth - 32));
    const height = status.offsetHeight || 160;
    const maxLeft = Math.max(16, window.innerWidth - width - 16);
    const left = clampNumber(rect.right - width, 16, maxLeft);
    const topAbove = rect.top - height - 12;
    const maxTop = Math.max(16, window.innerHeight - height - 16);
    const top = topAbove >= 16 ? topAbove : clampNumber(rect.bottom + 12, 16, maxTop);
    status.style.left = `${left}px`;
    status.style.top = `${top}px`;
    status.style.right = "auto";
    status.style.bottom = "auto";
  }

  function applyButtonPosition(position, persist = false) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) {
      return null;
    }
    const clamped = getClampedButtonPosition(position, button);
    const edge = position?.edge || getButtonEdge(clamped.left, button);
    buttonCollapsed = false;
    button.dataset.collapsed = "false";
    button.dataset.edge = edge;
    button.style.left = `${clamped.left}px`;
    button.style.top = `${clamped.top}px`;
    button.style.right = "auto";
    button.style.bottom = "auto";
    button.dataset.positioned = "1";
    if (persist) {
      saveStoredButtonPosition({ left: clamped.left, top: clamped.top, edge });
    }
    positionStatusPanel();
    positionCloseButton();
    return { ...clamped, edge };
  }

  function collapseFloatingButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button || button.style.display === "none" || button.dataset.dragging === "true" || isWorking || buttonCollapsed) {
      return;
    }
    const width = button.offsetWidth || FLOATING_BUTTON_SIZE;
    const top = getClampedButtonPosition({
      left: Number.parseFloat(button.style.left),
      top: Number.parseFloat(button.style.top),
    }, button).top;
    const edge = button.dataset.edge || getButtonEdge(Number.parseFloat(button.style.left), button);
    const collapsedLeft = edge === "left" ? Math.round(-(width / 2)) : Math.round(window.innerWidth - width / 2);
    buttonCollapsed = true;
    button.dataset.collapsed = "true";
    button.dataset.edge = edge;
    button.style.left = `${collapsedLeft}px`;
    button.style.top = `${top}px`;
    button.style.right = "auto";
    button.style.bottom = "auto";
    positionCloseButton();
  }

  function expandFloatingButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button || button.style.display === "none") {
      return;
    }
    const edge = button.dataset.edge || "right";
    const width = button.offsetWidth || FLOATING_BUTTON_SIZE;
    const fallback = getDefaultButtonPosition(button);
    const top = getClampedButtonPosition({
      left: Number.parseFloat(button.style.left),
      top: Number.parseFloat(button.style.top),
    }, button).top;
    const left = edge === "left"
      ? FLOATING_BUTTON_MARGIN
      : Math.max(FLOATING_BUTTON_MARGIN, window.innerWidth - width - FLOATING_BUTTON_MARGIN);
    applyButtonPosition({ left, top: Number.isFinite(top) ? top : fallback.top, edge }, false);
  }

  function scheduleFloatingCollapse() {
    clearCollapseTimer();
    const button = document.getElementById(BUTTON_ID);
    if (!button || button.style.display === "none" || isWorking) {
      return;
    }
    collapseTimer = window.setTimeout(() => {
      collapseFloatingButton();
    }, FLOATING_BUTTON_IDLE_MS);
  }

  function setFloatingVisibility(visible, persist = true) {
    const button = document.getElementById(BUTTON_ID);
    const close = document.getElementById(CLOSE_BUTTON_ID);
    if (persist) {
      saveFloatingVisibility(visible);
    }
    if (!visible) {
      clearCollapseTimer();
      buttonCollapsed = false;
      if (button) {
        button.style.display = "none";
      }
      if (close) {
        close.style.display = "none";
      }
      return;
    }
    if (button) {
      button.style.display = "flex";
      expandFloatingButton();
    }
    positionCloseButton();
    scheduleFloatingCollapse();
  }

  function bindFloatingButton(button) {
    if (!button || button.dataset.dragReady === "1") {
      return;
    }
    button.dataset.dragReady = "1";
    button.dataset.dragging = "false";
    button.dataset.collapsed = "false";

    const finishDrag = (event) => {
      if (!buttonDragState || event.pointerId !== buttonDragState.pointerId) {
        return;
      }
      if (button.hasPointerCapture?.(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
      button.dataset.dragging = "false";
      if (buttonDragState.moved) {
        suppressNextButtonClick = true;
        const left = Number.parseFloat(button.style.left);
        const top = Number.parseFloat(button.style.top);
        applyButtonPosition(snapButtonToEdge({ left, top, edge: button.dataset.edge }, button), true);
      } else {
        positionCloseButton();
      }
      buttonDragState = null;
      scheduleFloatingCollapse();
    };

    button.addEventListener("pointerenter", () => {
      expandFloatingButton();
      scheduleFloatingCollapse();
    });

    button.addEventListener("focus", () => {
      expandFloatingButton();
      scheduleFloatingCollapse();
    });

    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      expandFloatingButton();
      clearCollapseTimer();
      const rect = button.getBoundingClientRect();
      buttonDragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originLeft: rect.left,
        originTop: rect.top,
        moved: false,
      };
      suppressNextButtonClick = false;
      button.dataset.dragging = "true";
      button.setPointerCapture?.(event.pointerId);
    });

    button.addEventListener("pointermove", (event) => {
      if (!buttonDragState || event.pointerId !== buttonDragState.pointerId) {
        return;
      }
      const deltaX = event.clientX - buttonDragState.startX;
      const deltaY = event.clientY - buttonDragState.startY;
      if (!buttonDragState.moved && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
        buttonDragState.moved = true;
      }
      applyButtonPosition({
        left: buttonDragState.originLeft + deltaX,
        top: buttonDragState.originTop + deltaY,
        edge: button.dataset.edge,
      });
      event.preventDefault();
    });

    button.addEventListener("pointerup", finishDrag);
    button.addEventListener("pointercancel", finishDrag);
  }

  function bindCloseButton(close) {
    if (!close || close.dataset.bound === "1") {
      return;
    }
    close.dataset.bound = "1";
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isWorking) {
        return;
      }
      setFloatingVisibility(false);
      hideStatus();
    });
  }

  function bindWindowEvents() {
    if (hasBoundWindowEvents) {
      return;
    }
    hasBoundWindowEvents = true;
    window.addEventListener("resize", () => {
      const button = document.getElementById(BUTTON_ID);
      if (!button || button.style.display === "none") {
        return;
      }
      const wasCollapsed = buttonCollapsed;
      const edge = button.dataset.edge || "right";
      const snapped = snapButtonToEdge({
        left: Number.parseFloat(button.style.left),
        top: Number.parseFloat(button.style.top),
        edge,
      }, button);
      applyButtonPosition(snapped, true);
      if (wasCollapsed) {
        collapseFloatingButton();
      }
      scheduleFloatingCollapse();
    });
  }

  function ensureUi() {
    if (!document.body) {
      window.requestAnimationFrame(ensureUi);
      return;
    }
    if (!document.getElementById(STATUS_ID)) {
      const status = document.createElement("div");
      status.id = STATUS_ID;
      status.dataset.state = "info";
      status.innerHTML = `
        <div class="tm-status-phase"></div>
        <div class="tm-status-message"></div>
        <div class="tm-status-meta"></div>
        <div class="tm-status-progress" hidden>
          <div class="tm-status-progress-bar"></div>
        </div>
      `;
      document.body.appendChild(status);
    }
    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "ZIP";
      button.addEventListener("click", (event) => {
        if (suppressNextButtonClick) {
          suppressNextButtonClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (buttonCollapsed) {
          expandFloatingButton();
          scheduleFloatingCollapse();
          event.preventDefault();
          return;
        }
        if (isWorking) {
          event.preventDefault();
          return;
        }
        void exportCurrentPage();
      });
      document.body.appendChild(button);
    }
    let close = document.getElementById(CLOSE_BUTTON_ID);
    if (!close) {
      close = document.createElement("button");
      close.id = CLOSE_BUTTON_ID;
      close.type = "button";
      close.textContent = "x";
      close.setAttribute("aria-label", "Hide floating ball");
      document.body.appendChild(close);
    }
    button.dataset.working = isWorking ? "true" : "false";
    button.dataset.dragging = button.dataset.dragging || "false";
    button.dataset.collapsed = buttonCollapsed ? "true" : "false";
    button.textContent = isWorking ? "..." : "ZIP";
    bindFloatingButton(button);
    bindCloseButton(close);
    bindWindowEvents();
    if (button.dataset.positioned !== "1") {
      const stored = readStoredButtonPosition();
      applyButtonPosition(stored || getDefaultButtonPosition(button), Boolean(stored));
    }
    setFloatingVisibility(readFloatingVisibility(), false);
    positionStatusPanel();
    positionCloseButton();
  }

  function setWorking(working) {
    isWorking = working;
    const button = document.getElementById(BUTTON_ID);
    if (button) {
      button.dataset.working = working ? "true" : "false";
      button.textContent = working ? "..." : "ZIP";
      button.setAttribute("aria-busy", working ? "true" : "false");
    }
    if (working) {
      clearCollapseTimer();
      expandFloatingButton();
    } else {
      scheduleFloatingCollapse();
    }
    positionCloseButton();
  }

  function clearStatusTimer() {
    if (statusHideTimer) {
      window.clearTimeout(statusHideTimer);
      statusHideTimer = 0;
    }
  }

  function hideStatus() {
    clearStatusTimer();
    const status = document.getElementById(STATUS_ID);
    if (status) {
      status.style.display = 'none';
    }
  }

  function setStatus(input, isError = false) {
    const status = document.getElementById(STATUS_ID);
    if (!status) {
      return;
    }

    clearStatusTimer();

    const options = typeof input === 'string'
      ? { message: input, state: isError ? 'error' : 'info' }
      : (input || {});

    const phase = options.phase || '';
    const message = options.message || '';
    const meta = options.meta || '';
    const state = options.state || (isError ? 'error' : 'info');
    const progress = Number.isFinite(options.progress) ? Math.max(0, Math.min(100, options.progress)) : null;
    const autoHideMs = options.autoHideMs || 0;

    if (!phase && !message && !meta && progress === null) {
      hideStatus();
      return;
    }

    const phaseEl = status.querySelector('.tm-status-phase');
    const messageEl = status.querySelector('.tm-status-message');
    const metaEl = status.querySelector('.tm-status-meta');
    const progressEl = status.querySelector('.tm-status-progress');
    const barEl = status.querySelector('.tm-status-progress-bar');

    status.dataset.state = state;
    status.style.display = 'block';
    phaseEl.textContent = phase || (state === 'error' ? '导出失败' : state === 'success' ? '导出完成' : '正在导出');
    messageEl.textContent = message;
    metaEl.textContent = meta;

    if (progress === null) {
      progressEl.hidden = true;
      barEl.style.width = '0%';
    } else {
      progressEl.hidden = false;
      barEl.style.width = `${progress}%`;
    }

    positionStatusPanel();

    if (autoHideMs > 0) {
      statusHideTimer = window.setTimeout(() => {
        hideStatus();
      }, autoHideMs);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function formatProgress(current, total) {
    if (!total || total <= 0) {
      return 0;
    }
    return Math.round((current / total) * 100);
  }

  function sanitizeFileName(input) {
    const cleaned = (input || 'article')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');
    return (cleaned || 'article').slice(0, MAX_FILENAME_LENGTH);
  }

  function sanitizeAlt(input) {
    return (input || '').replace(/\s+/g, ' ').trim();
  }

  function absoluteUrl(url) {
    if (!url) {
      return '';
    }
    try {
      return new URL(url, location.href).href;
    } catch (error) {
      return '';
    }
  }

  function parseSrcset(srcset) {
    if (!srcset) {
      return '';
    }
    const candidates = srcset
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const parts = item.split(/\s+/);
        return {
          url: parts[0],
          score: Number.parseFloat(parts[1]) || 1,
        };
      })
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.url || '';
  }

  function pickImageUrl(img) {
    const attrs = [
      'data-original',
      'data-src',
      'data-actualsrc',
      'data-image',
      'data-lazy-src',
      'data-lazyload',
      'data-original-src',
      'data-zoomable',
      'src',
    ];

    for (const attr of attrs) {
      const value = img.getAttribute(attr);
      if (value && !/^data:image\/gif;base64,R0lGODlhAQABA/i.test(value)) {
        return absoluteUrl(value);
      }
    }

    const currentSrc = img.currentSrc || img.getAttribute('currentSrc');
    if (currentSrc) {
      return absoluteUrl(currentSrc);
    }

    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    return absoluteUrl(parseSrcset(srcset));
  }

  function normalizeImages(root) {
    root.querySelectorAll('picture').forEach((picture) => {
      const img = picture.querySelector('img');
      const source = picture.querySelector('source[srcset]');
      if (img && source && !img.getAttribute('src')) {
        img.setAttribute('src', parseSrcset(source.getAttribute('srcset')));
      }
    });

    root.querySelectorAll('noscript').forEach((node) => {
      const html = node.textContent || '';
      if (!html || !/<img[\s>]/i.test(html)) {
        return;
      }
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      if (wrapper.childElementCount > 0) {
        node.replaceWith(...Array.from(wrapper.childNodes));
      }
    });

    root.querySelectorAll('img').forEach((img) => {
      const actualUrl = pickImageUrl(img);
      if (actualUrl) {
        img.setAttribute('src', actualUrl);
      }
      img.removeAttribute('srcset');
      img.removeAttribute('data-srcset');
      img.removeAttribute('loading');
      img.removeAttribute('decoding');
    });
  }

  function removeNodes(root, selectors) {
    const seen = new Set();
    selectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => {
        if (!seen.has(node) && node.parentNode) {
          seen.add(node);
          node.remove();
        }
      });
    });
  }

  function normalizedText(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function linkDensity(node) {
    const text = normalizedText(node);
    if (!text) {
      return node.querySelectorAll('a').length > 0 ? 1 : 0;
    }
    const linkTextLength = Array.from(node.querySelectorAll('a')).reduce((sum, link) => {
      return sum + normalizedText(link).length;
    }, 0);
    return linkTextLength / Math.max(text.length, 1);
  }

  function hasProtectedContent(node) {
    return Boolean(node.closest('pre, code, table, blockquote'))
      || Boolean(node.querySelector('pre, code, table, blockquote'));
  }

  function normalizeCodeLanguage(input) {
    const raw = (input || '').toString().trim().toLowerCase();
    if (!raw) {
      return '';
    }
    const cleaned = raw
      .replace(/^language[-_:]?/, '')
      .replace(/^lang[-_:]?/, '')
      .replace(/^brush:\s*/, '')
      .replace(/[()]/g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9#+.-]/g, '');
    const aliases = {
      'c++': 'cpp',
      'cplusplus': 'cpp',
      'cc': 'cpp',
      'c#': 'csharp',
      'cs': 'csharp',
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'bash',
      'shellscript': 'bash',
      'objective-c': 'objectivec',
      'objc': 'objectivec',
      'text': 'plaintext',
      'plain': 'plaintext',
      'txt': 'plaintext',
      'yml': 'yaml',
    };
    const normalized = aliases[cleaned] || cleaned;
    return KNOWN_CODE_LANGUAGES.has(normalized) ? normalized : '';
  }

  function getCodeLanguageHints(node) {
    const hints = [];
    const pushHint = (value) => {
      if (value) {
        hints.push(value);
      }
    };
    if (!node || typeof node.getAttribute !== 'function') {
      return hints;
    }
    pushHint(node.getAttribute('data-language'));
    pushHint(node.getAttribute('data-lang'));
    pushHint(node.getAttribute('lang'));
    const className = typeof node.className === 'string' ? node.className : '';
    const classMatches = className.match(/(?:lang(?:uage)?[-_:]|language[-_:]|brush:\s*)([a-z0-9#+.-]+)/ig) || [];
    classMatches.forEach((item) => {
      const match = item.match(/([a-z0-9#+.-]+)$/i);
      pushHint(match?.[1] || '');
    });
    className
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => pushHint(token));
    return hints;
  }

  function readCodeFenceLanguage(node) {
    const candidates = [
      node,
      node?.querySelector?.('code'),
      node?.parentElement,
      node?.parentElement?.parentElement,
      node?.closest?.('[data-language], [data-lang], [class*="language-"], [class*="lang-"]'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      for (const hint of getCodeLanguageHints(candidate)) {
        const language = normalizeCodeLanguage(hint);
        if (language) {
          return language;
        }
      }
    }

    const descendants = Array.from(node?.querySelectorAll?.('[data-language], [data-lang], [class*="language-"], [class*="lang-"], .code-lang, .lang, .language') || []);
    for (const descendant of descendants) {
      const hints = [...getCodeLanguageHints(descendant), normalizedText(descendant)];
      for (const hint of hints) {
        const language = normalizeCodeLanguage(hint);
        if (language) {
          return language;
        }
      }
    }

    return '';
  }

  function findAdjacentLanguageLabel(node) {
    const candidates = [
      node?.previousElementSibling,
      node?.nextElementSibling,
      node?.parentElement?.previousElementSibling,
      node?.parentElement?.nextElementSibling,
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (candidate.querySelector('pre, code')) {
        continue;
      }
      const text = normalizedText(candidate);
      const language = normalizeCodeLanguage(text);
      if (language && text.length <= 20) {
        candidate.remove();
        return language;
      }
    }

    return '';
  }

  function isLikelyLineNumberText(text) {
    const trimmed = (text || '').trim();
    return Boolean(trimmed) && /^[\d\s]+$/.test(trimmed) && trimmed.replace(/\s+/g, '').length >= 2;
  }

  function isLineNumberBlock(node) {
    const text = normalizedText(node);
    const classHint = `${node.className || ''} ${node.parentElement?.className || ''} ${node.closest('td,th')?.className || ''}`.toLowerCase();
    if (/line-number|linenumber|gutter|hljs-ln|code-index|line-no|numbers/.test(classHint)) {
      return true;
    }
    if (!isLikelyLineNumberText(text)) {
      return false;
    }
    const siblingPreCount = node.parentElement
      ? Array.from(node.parentElement.children).filter((child) => child.tagName === 'PRE').length
      : 0;
    const rowPreCount = node.closest('tr') ? node.closest('tr').querySelectorAll('pre').length : 0;
    return siblingPreCount > 1 || rowPreCount > 1 || Boolean(node.closest('td,th'));
  }

  function isLineNumberElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const text = normalizedText(node);
    const classHint = `${node.className || ''} ${node.getAttribute?.('data-role') || ''} ${node.parentElement?.className || ''}`.toLowerCase();
    if (/line-number|linenumber|gutter|hljs-ln|code-index|line-no|numbers/.test(classHint)) {
      return true;
    }
    if (!isLikelyLineNumberText(text)) {
      return false;
    }
    if ((node.tagName === 'TD' || node.tagName === 'TH') && node.parentElement && node.parentElement.children.length > 1) {
      return node.parentElement.firstElementChild === node;
    }
    return false;
  }

  function isBlockLikeCodeNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const tag = node.tagName;
    const classHint = `${node.className || ''}`.toLowerCase();
    if (['DIV', 'P', 'LI', 'TR', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'SECTION', 'ARTICLE', 'UL', 'OL'].includes(tag)) {
      return true;
    }
    return /code-line|hljs-ln-line|line-content|line-wrapper|code-row|blob-code|view-line/.test(classHint);
  }

  function appendCodeLineBreak(chunks) {
    if (!chunks.length) {
      return;
    }
    const last = chunks[chunks.length - 1];
    if (!last.endsWith('\n')) {
      chunks.push('\n');
    }
  }

  function normalizeRenderedCodeText(text) {
    return (text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function stripCodeLineNumbers(text) {
    const lines = normalizeRenderedCodeText(text).split('\n');
    if (lines.length <= 1) {
      return normalizeRenderedCodeText(text);
    }

    const numberedLines = lines.filter((line) => /^\s*\d+\s+\S/.test(line));
    const shouldStripLeadingNumbers = numberedLines.length >= Math.max(2, Math.ceil(lines.length * 0.5));

    return lines
      .map((line) => {
        if (/^\s*\d+\s*$/.test(line)) {
          return '';
        }
        if (shouldStripLeadingNumbers) {
          return line.replace(/^\s*\d+\s+/, '');
        }
        return line;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function looksLikeCodeContent(text) {
    const normalized = normalizeRenderedCodeText(text);
    if (!normalized) {
      return false;
    }

    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      return false;
    }

    const codePattern = /[{};=<>()[\]]|^\s*(?:@[\w.]+|#include|SELECT\b|INSERT\b|UPDATE\b|DELETE\b|public\b|private\b|protected\b|class\b|interface\b|enum\b|def\b|function\b|const\b|let\b|var\b|if\b|for\b|while\b|return\b|import\b|from\b|package\b)/i;
    const codeLikeLineCount = lines.filter((line) => codePattern.test(line)).length;
    if (lines.length === 1) {
      return codeLikeLineCount === 1 && normalized.length >= 12;
    }
    return codeLikeLineCount >= Math.max(2, Math.ceil(lines.length * 0.4));
  }

  function isLikelyCodeTable(table) {
    if (!table || table.tagName !== 'TABLE') {
      return false;
    }

    const classHint = [
      table.className || '',
      table.getAttribute?.('data-language') || '',
      table.parentElement?.className || '',
      table.closest?.('[class]')?.className || '',
    ].join(' ').toLowerCase();

    const rows = Array.from(table.querySelectorAll('tr')).filter((row) => row.querySelectorAll('th, td').length > 0);
    if (rows.length === 0) {
      return false;
    }

    let compactRowCount = 0;
    let numberedRowCount = 0;
    let codeLikeRowCount = 0;

    rows.forEach((row) => {
      const cells = Array.from(row.children).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD');
      if (cells.length <= 2) {
        compactRowCount += 1;
      }
      if (cells.length >= 2 && isLikelyLineNumberText(normalizedText(cells[0]))) {
        numberedRowCount += 1;
      }

      const codeCell = cells[cells.length - 1];
      if (!codeCell) {
        return;
      }
      const codeText = stripCodeLineNumbers(
        normalizeRenderedCodeText(codeCell.innerText || codeCell.textContent || '')
      );
      if (looksLikeCodeContent(codeText)) {
        codeLikeRowCount += 1;
      }
    });

    const hasCodeClassHint = /(highlight|syntax|prism|hljs|code|rouge|prettyprint|gutter|line-number|linenumber|blob-code|programlisting)/.test(classHint);
    const mostlyCompactRows = compactRowCount >= Math.max(1, Math.ceil(rows.length * 0.8));
    const mostlyNumberedRows = numberedRowCount >= Math.max(1, Math.ceil(rows.length * 0.5));
    const mostlyCodeRows = codeLikeRowCount >= Math.max(1, Math.ceil(rows.length * 0.5));

    return (hasCodeClassHint && (mostlyCompactRows || mostlyCodeRows))
      || (mostlyCompactRows && mostlyNumberedRows)
      || (mostlyCompactRows && mostlyCodeRows);
  }

  function extractCodeTextFromNode(node) {
    const clone = node.cloneNode(true);
    removeNodes(clone, CODE_UI_SELECTORS);
    const source = clone.querySelector('code') || clone;
    const chunks = [];

    const walk = (current) => {
      if (!current) {
        return;
      }
      if (current.nodeType === Node.TEXT_NODE) {
        if (current.textContent) {
          chunks.push(current.textContent.replace(/\u00a0/g, ' '));
        }
        return;
      }
      if (current.nodeType !== Node.ELEMENT_NODE) {
        return;
      }
      if (isLineNumberElement(current)) {
        return;
      }
      if (current.tagName === 'BR') {
        appendCodeLineBreak(chunks);
        return;
      }

      const blockLike = isBlockLikeCodeNode(current) && current !== source;
      if (blockLike && chunks.length) {
        appendCodeLineBreak(chunks);
      }
      Array.from(current.childNodes).forEach(walk);
      if (blockLike) {
        appendCodeLineBreak(chunks);
      }
    };

    walk(source);
    const text = chunks.join('')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');

    const rendered = stripCodeLineNumbers(
      normalizeRenderedCodeText(
        node.querySelector('code')?.innerText
        || node.innerText
        || source.innerText
        || ''
      )
    );

    if (rendered.split('\n').length > text.split('\n').length) {
      return rendered;
    }
    return text;
  }

  function normalizeCodeBlocks(root) {
    Array.from(root.querySelectorAll('pre')).forEach((pre) => {
      if (pre.parentNode && isLineNumberBlock(pre)) {
        pre.remove();
      }
    });

    const codeNodes = uniqueNodes([
      ...Array.from(root.querySelectorAll('pre')),
      ...Array.from(root.querySelectorAll('code')).filter((code) => !code.closest('pre') && /[\r\n]/.test(code.textContent || '')),
      ...Array.from(root.querySelectorAll('table')).filter(isLikelyCodeTable),
    ]);

    codeNodes.forEach((node) => {
      if (!node.parentNode) {
        return;
      }

      const language = readCodeFenceLanguage(node) || findAdjacentLanguageLabel(node);
      const codeText = extractCodeTextFromNode(node);
      if (!codeText.trim()) {
        node.remove();
        return;
      }

      const doc = node.ownerDocument;
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      if (language) {
        pre.setAttribute('lang', language);
        code.setAttribute('lang', language);
      }
      code.textContent = codeText;
      pre.appendChild(code);

      const replaceTarget = node.tagName === 'CODE' && node.parentElement && node.parentElement.children.length === 1
        ? node.parentElement
        : node;
      replaceTarget.replaceWith(pre);
    });
  }
  function pruneNoiseBlocks(root, patterns = []) {
    const mergedPatterns = [...GENERIC_NOISE_PATTERNS, ...patterns];
    const nodes = Array.from(root.querySelectorAll('*')).reverse();

    nodes.forEach((node) => {
      if (!node.parentNode || node === root || hasProtectedContent(node)) {
        return;
      }

      const text = normalizedText(node);
      const links = node.querySelectorAll('a').length;
      const images = node.querySelectorAll('img').length;
      const paragraphs = node.querySelectorAll('p').length;
      const density = linkDensity(node);
      const matchedNoise = mergedPatterns.some((pattern) => pattern.test(text));
      const actionHeavy = /点赞|踩|收藏|评论|分享|复制链接|举报/.test(text) && (links + images) >= 2 && text.length < 220;
      const promoHeavy = /福利倒计时|立即使用|立减|VIP|年卡/.test(text) && text.length < 240;
      const footerHeavy = matchedNoise && (density > 0.2 || links >= 3 || images >= 1);
      const galleryHeavy = images >= 4 && paragraphs === 0 && text.length < 160;
      const denseLinkGroup = density > 0.65 && text.length < 280 && links >= 4;

      if (footerHeavy || actionHeavy || promoHeavy || galleryHeavy || denseLinkGroup) {
        node.remove();
      }
    });
  }

  function stripUnwantedAttributes(root) {
    root.querySelectorAll('*').forEach((node) => {
      for (const attr of Array.from(node.attributes)) {
        if (/^(class|style|id|data-|aria-)/i.test(attr.name)) {
          node.removeAttribute(attr.name);
        }
      }
    });
  }

  function removeTinyOrDecorativeImages(root) {
    root.querySelectorAll('img').forEach((img) => {
      const width = Number.parseInt(img.getAttribute('width') || '0', 10);
      const height = Number.parseInt(img.getAttribute('height') || '0', 10);
      const alt = sanitizeAlt(img.getAttribute('alt'));
      const src = img.getAttribute('src') || '';
      const classHint = `${img.className || ''} ${img.parentElement?.className || ''}`.toLowerCase();
      const maybeDecorative = classHint.includes('avatar')
        || classHint.includes('logo')
        || classHint.includes('icon')
        || classHint.includes('emoji')
        || /avatar|logo|icon|emoji/i.test(src)
        || alt === '表情包';
      if (maybeDecorative || (width > 0 && width <= 16) || (height > 0 && height <= 16)) {
        img.remove();
      }
    });
  }

  function collapseNoise(root) {
    root.querySelectorAll('*').forEach((node) => {
      if (node.children.length > 0) {
        return;
      }
      const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!text && node.tagName !== 'IMG' && node.tagName !== 'BR' && node.tagName !== 'HR') {
        node.remove();
      }
    });
  }

  function detectSiteConfig() {
    const host = location.hostname.toLowerCase();
    const path = location.pathname;
    return SITE_CONFIGS.find((config) => config.match(host, path)) || null;
  }

  function getTitleFromSelectors(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = node?.textContent?.replace(/\s+/g, ' ').trim();
      if (text) {
        return text;
      }
    }
    return '';
  }

  function scoreNode(node) {
    const textLength = node.innerText?.replace(/\s+/g, ' ').trim().length || 0;
    const paragraphCount = node.querySelectorAll('p').length;
    const imageCount = node.querySelectorAll('img').length;
    return textLength + paragraphCount * 80 + imageCount * 30;
  }

  function uniqueNodes(nodes) {
    return nodes.filter((node, index) => node && nodes.indexOf(node) === index);
  }

  function pickContentNode(selectors) {
    const candidates = uniqueNodes(
      selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))),
    );

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => scoreNode(b) - scoreNode(a));
    return candidates[0];
  }

  function pickPreferredContentNode(selectors) {
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      if (matches.length === 0) {
        continue;
      }
      matches.sort((a, b) => scoreNode(b) - scoreNode(a));
      return matches[0];
    }
    return null;
  }

  function prepareClone(root, removeSelectors, noisePatterns = []) {
    const clone = root.cloneNode(true);
    normalizeImages(clone);
    removeNodes(clone, [...GENERIC_REMOVE_SELECTORS, ...removeSelectors]);
    normalizeCodeBlocks(clone);
    removeTinyOrDecorativeImages(clone);
    pruneNoiseBlocks(clone, noisePatterns);
    collapseNoise(clone);
    stripUnwantedAttributes(clone);
    return clone;
  }

  function createFragmentFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
    return doc.body;
  }

  function extractWithReadability() {
    const clonedDoc = document.cloneNode(true);
    normalizeImages(clonedDoc);
    removeNodes(clonedDoc, GENERIC_REMOVE_SELECTORS);
    const parsed = new Readability(clonedDoc).parse();
    if (!parsed?.content) {
      return null;
    }
    const contentRoot = createFragmentFromHtml(parsed.content);
    const prepared = prepareClone(contentRoot, [], []);
    const title = parsed.title?.replace(/\s+/g, ' ').trim() || document.title;
    return {
      title,
      contentRoot: prepared,
      site: 'Readability',
    };
  }

  function extractArticle() {
    const config = detectSiteConfig();
    const removeSelectors = config?.removeSelectors || [];
    const noisePatterns = config?.noisePatterns || [];
    const titleSelectors = [...(config?.titleSelectors || []), ...GENERIC_TITLE_SELECTORS];
    const title =
      getTitleFromSelectors(titleSelectors)
      || document.title.replace(/\s*[-_|].*$/, '').trim()
      || 'article';

    const siteNode = config?.contentSelectors ? pickPreferredContentNode(config.contentSelectors) : null;
    if (siteNode) {
      const contentRoot = prepareClone(siteNode, removeSelectors, noisePatterns);
      if (scoreNode(contentRoot) > 200) {
        return {
          title,
          contentRoot,
          site: config?.name || 'Site selectors',
        };
      }
    }

    const genericNode = pickContentNode(GENERIC_CONTENT_SELECTORS);
    if (genericNode) {
      const contentRoot = prepareClone(genericNode, removeSelectors, noisePatterns);
      if (scoreNode(contentRoot) > 200) {
        return {
          title,
          contentRoot,
          site: config?.name ? `${config.name} + generic fallback` : 'Generic selectors',
        };
      }
    }

    const readable = extractWithReadability();
    if (readable) {
      return readable;
    }

    throw new Error('未识别到可导出的文章正文，请在文章详情页重试。');
  }

  function dataUrlToUint8Array(url) {
    const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(url);
    if (!match) {
      throw new Error('不支持的 data URL');
    }
    const mimeType = match[1] || 'application/octet-stream';
    const body = match[3] || '';
    const binary = match[2] ? window.atob(body) : decodeURIComponent(body);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      array[i] = binary.charCodeAt(i);
    }
    return { bytes: array, contentType: mimeType };
  }

  function guessExtension(url, contentType) {
    const normalizedContentType = (contentType || '').toLowerCase();
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/x-icon': 'ico',
      'image/vnd.microsoft.icon': 'ico',
      'image/avif': 'avif',
    };

    if (mimeMap[normalizedContentType]) {
      return mimeMap[normalizedContentType];
    }

    try {
      const pathname = new URL(url, location.href).pathname;
      const ext = pathname.split('.').pop()?.toLowerCase() || '';
      if (/^(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/.test(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    } catch (error) {
      // Ignore URL parsing failures and fall through.
    }

    return 'bin';
  }

  function extractContentType(headers) {
    return headers
      ?.split('\n')
      .map((line) => line.trim())
      .find((line) => /^content-type:/i.test(line))
      ?.split(':')
      .slice(1)
      .join(':')
      .trim() || '';
  }

  function fetchBinary(url) {
    if (!url) {
      return Promise.reject(new Error('图片地址为空'));
    }

    if (url.startsWith('data:')) {
      return Promise.resolve(dataUrlToUint8Array(url));
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        headers: {
          Referer: location.href,
        },
        onload: (response) => {
          const status = response.status || 200;
          if (status >= 200 && status < 400 && response.response) {
            resolve({
              bytes: new Uint8Array(response.response),
              contentType: extractContentType(response.responseHeaders),
            });
            return;
          }
          reject(new Error(`下载失败: ${status}`));
        },
        onerror: () => reject(new Error('网络请求失败')),
        ontimeout: () => reject(new Error('网络请求超时')),
      });
    });
  }

  async function downloadImages(root) {
    const zipImages = [];
    const seenUrls = new Map();
    const images = Array.from(root.querySelectorAll('img'));
    const total = images.length;

    if (total === 0) {
      setStatus({
        phase: '下载图片',
        message: '正文中没有图片，跳过下载。',
        meta: '继续生成 Markdown 和 ZIP 文件。',
        progress: 60,
      });
      return zipImages;
    }

    for (let index = 0; index < images.length; index += 1) {
      const img = images[index];
      const sourceUrl = pickImageUrl(img) || img.getAttribute('src') || '';
      const startedProgress = 20 + Math.round((index / total) * 55);
      const completedProgress = 20 + Math.round(((index + 1) / total) * 55);

      if (!sourceUrl) {
        img.remove();
        setStatus({
          phase: '下载图片',
          message: `正在处理图片 ${index + 1}/${total}`,
          meta: `第 ${index + 1} 张图片没有可用地址，已跳过。当前进度 ${formatProgress(index + 1, total)}%`,
          progress: completedProgress,
        });
        continue;
      }

      if (seenUrls.has(sourceUrl)) {
        img.setAttribute('src', seenUrls.get(sourceUrl));
        setStatus({
          phase: '下载图片',
          message: `正在处理图片 ${index + 1}/${total}`,
          meta: `检测到重复图片，直接复用已有文件。当前进度 ${formatProgress(index + 1, total)}%`,
          progress: completedProgress,
        });
        continue;
      }

      setStatus({
        phase: '下载图片',
        message: `正在下载图片 ${index + 1}/${total}`,
        meta: `已完成 ${index}/${total}，当前进度 ${formatProgress(index, total)}%`,
        progress: startedProgress,
      });

      try {
        const { bytes, contentType } = await fetchBinary(sourceUrl);
        const extension = guessExtension(sourceUrl, contentType);
        const fileName = `image-${String(zipImages.length + 1).padStart(3, '0')}.${extension}`;
        const relativePath = `${IMAGE_DIR}/${fileName}`;
        zipImages.push({
          path: relativePath,
          bytes,
        });
        seenUrls.set(sourceUrl, relativePath);
        img.setAttribute('src', relativePath);
        setStatus({
          phase: '下载图片',
          message: `正在下载图片 ${index + 1}/${total}`,
          meta: `已保存 ${zipImages.length} 张，当前进度 ${formatProgress(index + 1, total)}%`,
          progress: completedProgress,
        });
      } catch (error) {
        console.warn('[article-exporter] 图片下载失败', sourceUrl, error);
        img.remove();
        setStatus({
          phase: '下载图片',
          message: `正在下载图片 ${index + 1}/${total}`,
          meta: `这张图片下载失败，已跳过。当前进度 ${formatProgress(index + 1, total)}%`,
          progress: completedProgress,
        });
      }
    }

    return zipImages;
  }

  function escapeMarkdownTableCell(text) {
    return (text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line, index, lines) => line || lines.length === 1)
      .join('<br>')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/(<br>\s*){2,}/g, '<br>')
      .replace(/^<br>|<br>$/g, '');
  }

  function renderInlineMarkdownForTable(node) {
    if (!node) {
      return '';
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tag = node.tagName;
    if (tag === 'BR') {
      return '<br>';
    }

    const content = Array.from(node.childNodes).map((child) => renderInlineMarkdownForTable(child)).join('');

    if (tag === 'CODE') {
      const value = content.trim() || normalizedText(node);
      return value ? `\`${value.replace(/\`/g, '\\`')}\`` : '';
    }
    if (tag === 'STRONG' || tag === 'B') {
      return content ? `**${content}**` : '';
    }
    if (tag === 'EM' || tag === 'I') {
      return content ? `*${content}*` : '';
    }
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') {
      return content ? `~~${content}~~` : '';
    }
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      const label = content.trim() || normalizedText(node);
      if (href && label) {
        return `[${label}](${href})`;
      }
      return label || href;
    }
    if (tag === 'IMG') {
      return sanitizeAlt(node.getAttribute('alt')) || '';
    }
    if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'LI') {
      return content ? `${content}<br>` : '';
    }

    return content;
  }

  function tableCellToMarkdown(cell) {
    const raw = Array.from(cell.childNodes).map((child) => renderInlineMarkdownForTable(child)).join('');
    const compact = raw
      .replace(/<br>\s*<br>/g, '<br>')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return escapeMarkdownTableCell(compact || normalizedText(cell));
  }

  function buildTableMatrix(table) {
    const rowElements = Array.from(table.querySelectorAll('tr')).filter((row) => row.querySelectorAll('th, td').length > 0);
    if (rowElements.length === 0) {
      return { matrix: [], headerIndex: -1 };
    }

    const matrix = [];
    const occupied = [];
    let headerIndex = -1;

    rowElements.forEach((row, rowIndex) => {
      const cells = Array.from(row.children).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD');
      if (cells.some((cell) => cell.tagName === 'TH') && headerIndex === -1) {
        headerIndex = rowIndex;
      }

      matrix[rowIndex] = matrix[rowIndex] || [];
      let colIndex = 0;
      while (occupied[colIndex] > 0) {
        matrix[rowIndex][colIndex] = '';
        occupied[colIndex] -= 1;
        colIndex += 1;
      }

      cells.forEach((cell) => {
        while (occupied[colIndex] > 0) {
          matrix[rowIndex][colIndex] = '';
          occupied[colIndex] -= 1;
          colIndex += 1;
        }

        const value = tableCellToMarkdown(cell);
        const colspan = Math.max(1, Number.parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
        const rowspan = Math.max(1, Number.parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);

        matrix[rowIndex][colIndex] = value;
        for (let offset = 1; offset < colspan; offset += 1) {
          matrix[rowIndex][colIndex + offset] = '';
        }
        for (let offset = 0; offset < colspan; offset += 1) {
          occupied[colIndex + offset] = Math.max(occupied[colIndex + offset] || 0, rowspan - 1);
        }
        colIndex += colspan;
      });
    });

    const width = Math.max(...matrix.map((row) => row.length));
    matrix.forEach((row) => {
      while (row.length < width) {
        row.push('');
      }
    });

    return { matrix, headerIndex };
  }

  function renderMarkdownTable(table) {
    const { matrix, headerIndex } = buildTableMatrix(table);
    if (matrix.length === 0) {
      return '';
    }

    const normalizedRows = matrix.map((row) => row.map((cell) => cell || ' '));
    const header = headerIndex >= 0 ? normalizedRows[headerIndex] : normalizedRows[0];
    const body = headerIndex >= 0
      ? normalizedRows.filter((_, index) => index !== headerIndex)
      : normalizedRows.slice(1);

    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
    ];

    if (body.length === 0) {
      lines.push(`| ${header.map(() => ' ').join(' | ')} |`);
    } else {
      body.forEach((row) => {
        lines.push(`| ${row.join(' | ')} |`);
      });
    }

    return lines.join('\n');
  }

  function renderDefinitionList(node) {
    const items = [];
    let currentTerm = '';
    Array.from(node.children).forEach((child) => {
      if (child.tagName === 'DT') {
        currentTerm = normalizedText(child);
        return;
      }
      if (child.tagName === 'DD') {
        const definition = normalizedText(child);
        if (currentTerm || definition) {
          items.push(`- **${currentTerm || 'Term'}**: ${definition}`);
        }
      }
    });
    return items.join('\n');
  }
  function buildTurndownService() {
    const service = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      hr: '---',
    });

    if (window.turndownPluginGfm) {
      service.use(window.turndownPluginGfm.gfm);
    }

    service.addRule('removeEmptyLinks', {
      filter: (node) => node.nodeName === 'A' && !(node.getAttribute('href') || '').trim(),
      replacement: (content) => content,
    });

    service.addRule('normalizeTable', {
      filter: (node) => node.nodeName === 'TABLE',
      replacement: (_content, node) => {
        if (isLikelyCodeTable(node)) {
          const language = normalizeCodeLanguage(
            node.getAttribute('lang')
            || node.querySelector('code')?.getAttribute('lang')
            || readCodeFenceLanguage(node)
            || findAdjacentLanguageLabel(node)
            || ''
          );
          const code = extractCodeTextFromNode(node)
            .replace(/\r\n?/g, '\n')
            .replace(/\n+$/, '');
          return code ? '\n\n```' + (language || '') + '\n' + code + '\n```\n\n' : '\n\n';
        }
        const markdown = renderMarkdownTable(node);
        return markdown ? `\n\n${markdown}\n\n` : '\n\n';
      },
    });

    service.addRule('normalizeDefinitionList', {
      filter: (node) => node.nodeName === 'DL',
      replacement: (_content, node) => {
        const markdown = renderDefinitionList(node);
        return markdown ? `\n\n${markdown}\n\n` : '\n\n';
      },
    });

    service.addRule('normalizePre', {
      filter: (node) => node.nodeName === 'PRE',
      replacement: (_content, node) => {
        const language = normalizeCodeLanguage(
          node.getAttribute('lang')
          || node.querySelector('code')?.getAttribute('lang')
          || ''
        );
        const code = (node.querySelector('code')?.textContent || node.textContent || '')
          .replace(/\r\n?/g, '\n')
          .replace(/\n+$/, '');
        return `\n\n\`\`\`${language || ''}\n${code}\n\`\`\`\n\n`;
      },
    });

    service.addRule('normalizeImage', {
      filter: (node) => node.nodeName === 'IMG',
      replacement: (_content, node) => {
        const src = node.getAttribute('src') || '';
        const alt = sanitizeAlt(node.getAttribute('alt'));
        const title = sanitizeAlt(node.getAttribute('title'));
        if (!src) {
          return '';
        }
        const titlePart = title ? ` \"${title.replace(/\"/g, '\\\"')}\"` : '';
        return `![${alt}](${src}${titlePart})`;
      },
    });

    return service;
  }

  function htmlToMarkdown(root, title) {
    const turndown = buildTurndownService();
    const markdownBody = turndown.turndown(root.innerHTML)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return [
      `# ${title}`,
      '',
      `> 来源：${location.href}`,
      '',
      markdownBody,
      '',
    ].join('\n');
  }
  function encodeText(text) {
    if (window.fflate && typeof window.fflate.strToU8 === 'function') {
      return window.fflate.strToU8(text);
    }
    return new TextEncoder().encode(text);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const digits = unitIndex === 0 ? 0 : 2;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
  }

  function addZipEntry(tree, path, data) {
    const parts = path.split('/').filter(Boolean);
    let current = tree;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const key = parts[index];
      if (!current[key] || current[key] instanceof Uint8Array) {
        current[key] = {};
      }
      current = current[key];
    }
    current[parts[parts.length - 1]] = data;
  }

  async function buildZipBlobWithFflate(markdownFileName, markdown, imageFiles) {
    const zipEntries = {};
    const markdownBytes = encodeText(markdown);
    addZipEntry(zipEntries, markdownFileName, markdownBytes);
    imageFiles.forEach((image) => {
      addZipEntry(zipEntries, image.path, image.bytes);
    });

    const totalBytes = markdownBytes.length + imageFiles.reduce((sum, image) => sum + image.bytes.length, 0);
    setStatus({
      phase: '打包 ZIP',
      message: '正在生成压缩包...',
      meta: `正在写入 ${1 + imageFiles.length} 个文件，约 ${formatBytes(totalBytes)}。`,
      progress: 90,
    });

    await wait(0);

    return new Promise((resolve, reject) => {
      window.fflate.zip(zipEntries, { level: 0 }, (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(new Blob([data], { type: 'application/zip' }));
      });
    });
  }

  async function buildZipBlobWithJsZip(markdownFileName, markdown, imageFiles) {
    const zip = new JSZip();
    zip.file(markdownFileName, markdown, {
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    imageFiles.forEach((image) => {
      zip.file(image.path, image.bytes, {
        binary: true,
        compression: 'STORE',
      });
    });

    return zip.generateAsync({
      type: 'blob',
      compression: 'STORE',
      streamFiles: true,
    }, (metadata) => {
      const zipProgress = 90 + Math.round((metadata.percent || 0) * 0.08);
      const currentFile = metadata.currentFile ? `当前文件：${metadata.currentFile}` : '正在整理压缩包内容...';
      setStatus({
        phase: '打包 ZIP',
        message: '正在生成压缩包...',
        meta: `${currentFile} 打包进度 ${Math.round(metadata.percent || 0)}%`,
        progress: Math.min(98, zipProgress),
      });
    });
  }

  async function buildZipBlob(markdownFileName, markdown, imageFiles) {
    if (window.fflate && typeof window.fflate.zip === 'function') {
      return buildZipBlobWithFflate(markdownFileName, markdown, imageFiles);
    }
    return buildZipBlobWithJsZip(markdownFileName, markdown, imageFiles);
  }

  function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function exportCurrentPage() {
    setWorking(true);
    setStatus({
      phase: '准备导出',
      message: '正在分析页面结构...',
      meta: '将识别标题、正文和正文中的图片。',
      progress: 5,
    });

    try {
      await wait(50);
      const { title, contentRoot, site } = extractArticle();
      const safeTitle = sanitizeFileName(title);

      setStatus({
        phase: '正文识别完成',
        message: `已识别站点规则：${site}`,
        meta: `文章标题：${title}`,
        progress: 18,
      });

      const imageFiles = await downloadImages(contentRoot);

      setStatus({
        phase: '生成 Markdown',
        message: '正在将正文转换为 Markdown...',
        meta: `图片处理完成，共保留 ${imageFiles.length} 张图片。`,
        progress: 82,
      });
      const markdown = htmlToMarkdown(contentRoot, title);

      const markdownFileName = `${safeTitle}.md`;
      const blob = await buildZipBlob(markdownFileName, markdown, imageFiles);

      setStatus({
        phase: '触发下载',
        message: `正在下载 ${safeTitle}.zip`,
        meta: '如果浏览器拦截下载，请检查下载栏或允许当前站点下载文件。',
        progress: 98,
      });
      triggerDownload(blob, `${safeTitle}.zip`);

      setStatus({
        phase: '导出完成',
        message: `${safeTitle}.zip 已生成`,
        meta: `包含 Markdown 1 个，图片 ${imageFiles.length} 张。`,
        progress: 100,
        state: 'success',
        autoHideMs: STATUS_AUTO_HIDE_MS,
      });
    } catch (error) {
      console.error('[article-exporter] 导出失败', error);
      setStatus({
        phase: '导出失败',
        message: error.message || String(error),
        meta: '请打开浏览器控制台查看详细报错，或把报错信息发给我继续处理。',
        progress: 100,
        state: 'error',
      });
    } finally {
      setWorking(false);
    }
  }
  injectStyles();
  ensureUi();
  GM_registerMenuCommand('Export current article as Markdown ZIP', () => {
    void exportCurrentPage();
  });
  GM_registerMenuCommand('Toggle floating ball', () => {
    ensureUi();
    const button = document.getElementById(BUTTON_ID);
    const visible = !button || button.style.display === "none";
    setFloatingVisibility(visible);
  });
})();


