let isSelectionAvailableGlobally = false;
let canThisFrameListenForMouseDown = false;
let isCurrentlySelectingInThisFrame = false;
let isDragging = false;
let selectionRequest = null;
let selectionBox = null;
let overlayHost = null;
let overlayRoot = null;
let startX = 0, startY = 0, currentX = 0, currentY = 0;
let preserveLayoutOption = false;
let availabilityRevision = 0;
let otherFrameSelecting = false;
const LINE_BREAK_THRESHOLD_VERTICAL = 5;

chrome.storage.sync.get({ preserveLayout: false }, items => {
    preserveLayoutOption = !!items.preserveLayout;
});
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.preserveLayout) {
        preserveLayoutOption = !!changes.preserveLayout.newValue;
    }
});

function sendSelectionMessage(action, request = selectionRequest) {
    try {
        return chrome.runtime.sendMessage({ action, requestId: request?.id });
    } catch (error) {
        return Promise.reject(error);
    }
}

function makeSelectionAvailable() {
    isSelectionAvailableGlobally = true;
    otherFrameSelecting = false;
    canThisFrameListenForMouseDown = !isCurrentlySelectingInThisFrame;
    document.addEventListener('mousedown', handleMouseDown, true);
    document.body?.classList.add('selection-active');
}

function makeSelectionUnavailable() {
    isSelectionAvailableGlobally = false;
    otherFrameSelecting = false;
    canThisFrameListenForMouseDown = false;
    document.removeEventListener('mousedown', handleMouseDown, true);
    document.body?.classList.remove('selection-active');
    cancelSelectionDrag();
}

function blockSelectionClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    document.removeEventListener('click', blockSelectionClick, true);
}

function handleMouseDown(event) {
    if (!isSelectionAvailableGlobally || !canThisFrameListenForMouseDown || isCurrentlySelectingInThisFrame || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    // Listen before contacting the worker so a quick release cannot be lost.
    // getRandomValues also works on HTTP, where randomUUID is unavailable.
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
    const request = { id, confirmed: false };
    selectionRequest = request;
    isCurrentlySelectingInThisFrame = isDragging = true;
    canThisFrameListenForMouseDown = false;
    startX = currentX = event.clientX;
    startY = currentY = event.clientY;
    document.body?.classList.add('cs-prevent-select');
    initSelectionBox();
    selectionBox.style.display = 'block';
    updateSelectionBox(event);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('keydown', handleKeyDownUp, true);
    document.addEventListener('keyup', handleKeyDownUp, true);
    document.addEventListener('click', blockSelectionClick, true);
    window.addEventListener('blur', handleSelectionInterruption);

    sendSelectionMessage('frameStartedSelection', request).then(response => {
        if (selectionRequest !== request) return;
        if (response?.canProceed && isSelectionAvailableGlobally) request.confirmed = true;
        else cancelSelectionDrag(true);
    }).catch(() => {
        if (selectionRequest === request) cancelSelectionDrag(true);
    });
}

function selectionViewportRect() {
    return makeRect(Math.min(startX, currentX), Math.min(startY, currentY),
        Math.max(startX, currentX), Math.max(startY, currentY));
}

function updateSelectionBox(event) {
    const rect = selectionViewportRect();
    Object.assign(selectionBox.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`
    });
    updateSelectionBoxVisuals(event);
}

function handleMouseMove(event) {
    if (!isDragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    currentX = event.clientX;
    currentY = event.clientY;
    updateSelectionBox(event);
}

function updateSelectionBoxVisuals(event) {
    selectionBox?.classList.toggle('preserve-layout', preserveLayoutOption || event.altKey);
}

function handleKeyDownUp(event) {
    if (event.key === 'Escape' && event.type === 'keydown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelSelectionDrag(true);
    } else if (event.key === 'Alt') updateSelectionBoxVisuals(event);
}

function handleSelectionInterruption() {
    cancelSelectionDrag(true);
}

function detachDragListeners() {
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('keydown', handleKeyDownUp, true);
    document.removeEventListener('keyup', handleKeyDownUp, true);
    window.removeEventListener('blur', handleSelectionInterruption);
    // A click synthesized from this mouseup must still be consumed.
    setTimeout(() => {
        if (!isDragging) document.removeEventListener('click', blockSelectionClick, true);
    }, 0);
}

function handleMouseUp(event) {
    if (!isDragging || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    currentX = event.clientX;
    currentY = event.clientY;
    const rect = selectionViewportRect();
    const request = selectionRequest;
    if (!request?.confirmed || rect.width <= 2 || rect.height <= 2) {
        cancelSelectionDrag(true);
        return;
    }

    isDragging = false;
    detachDragListeners();
    document.body?.classList.remove('cs-prevent-select');
    try {
        const text = extractTextInBox(rect, LINE_BREAK_THRESHOLD_VERTICAL, preserveLayoutOption || event.altKey);
        if (text) {
            copyToClipboard(text).then(() => displayTemporaryMessage('Text Copied!', 1500), () => {
                displayTemporaryMessage('Copy failed', 3000, true);
            });
        } else displayTemporaryMessage('No text found', 1500, true);
    } catch (error) {
        console.error('Freeform Copy: extraction failed', error);
        displayTemporaryMessage('Could not extract text', 3000, true);
    } finally {
        // Always release the frame lock, including synchronous extraction failures.
        makeSelectionUnavailable();
        sendSelectionMessage('frameEndedSelection', request).catch(() => {});
    }
}

function cancelSelectionDrag(notifyBackground = false) {
    const request = selectionRequest;
    selectionRequest = null;
    isDragging = isCurrentlySelectingInThisFrame = false;
    canThisFrameListenForMouseDown = isSelectionAvailableGlobally && !otherFrameSelecting;
    detachDragListeners();
    document.body?.classList.remove('cs-prevent-select');
    if (selectionBox) selectionBox.style.display = 'none';
    if (request && notifyBackground) sendSelectionMessage('frameCancelledSelection', request).catch(() => {});
}

function getOverlayRoot() {
    if (overlayHost?.isConnected) return overlayRoot;
    overlayHost = document.createElement('freeform-copy-overlay');
    overlayHost.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;display:block!important;pointer-events:none!important;z-index:2147483647!important;';
    overlayRoot = overlayHost.attachShadow({ mode: 'open' });
    overlayRoot.innerHTML = `<style>
        .box { position:absolute; outline:2px dashed #007bff; background:rgba(0,123,255,.1); pointer-events:none; display:none; }
        .box.preserve-layout { outline:2px solid #28a745; background:rgba(40,167,69,.1); }
        .message { position:absolute; bottom:20px; left:50%; transform:translateX(-50%); padding:10px 20px;
            border-radius:5px; font:bold 14px system-ui,sans-serif; box-shadow:0 2px 5px #0003;
            text-align:center; max-width:80%; border:1px solid; }
    </style>`;
    document.documentElement.appendChild(overlayHost);
    selectionBox = null;
    return overlayRoot;
}

function initSelectionBox() {
    const root = getOverlayRoot();
    if (!selectionBox) {
        selectionBox = document.createElement('div');
        selectionBox.className = 'box';
        root.appendChild(selectionBox);
    }
}

function makeRect(left, top, right, bottom) {
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function intersectRects(a, b) {
    return makeRect(Math.max(a.left, b.left), Math.max(a.top, b.top), Math.min(a.right, b.right), Math.min(a.bottom, b.bottom));
}

function rectsIntersect(a, b) {
    return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function clippedElementRect(element, style, inheritedClip) {
    let clip = inheritedClip;
    const clipsX = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX);
    const clipsY = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY);
    const paintContained = /\b(paint|strict|content)\b/.test(style.contain);
    if (clipsX || clipsY || paintContained || style.clip !== 'auto' || style.clipPath !== 'none') {
        const r = element.getBoundingClientRect();
        if (clipsX || clipsY || paintContained) {
            const sx = element.offsetWidth ? r.width / element.offsetWidth : 1;
            const sy = element.offsetHeight ? r.height / element.offsetHeight : 1;
            const left = r.left + element.clientLeft * sx;
            const top = r.top + element.clientTop * sy;
            clip = intersectRects(clip, makeRect(
                clipsX || paintContained ? left : clip.left, clipsY || paintContained ? top : clip.top,
                clipsX || paintContained ? left + element.clientWidth * sx : clip.right,
                clipsY || paintContained ? top + element.clientHeight * sy : clip.bottom));
        }
        const legacy = style.clip.match(/^rect\(([^)]+)\)$/);
        if (legacy && ['absolute', 'fixed'].includes(style.position)) {
            const values = legacy[1].split(/[,\s]+/);
            const offsets = values.map((value, index) => value === 'auto' ? [0, r.width, r.height, 0][index] : parseFloat(value));
            clip = intersectRects(clip, makeRect(r.left + offsets[3], r.top + offsets[0], r.left + offsets[1], r.top + offsets[2]));
        }
        const inset = style.clipPath.match(/^inset\(([^)]+)\)$/);
        if (inset) {
            const parts = inset[1].split('round')[0].trim().split(/\s+/);
            if (parts.length <= 4 && parts.every(part => /^-?[\d.]+(px|%)?$/.test(part))) {
                const sides = [parts[0], parts[1] || parts[0], parts[2] || parts[0], parts[3] || parts[1] || parts[0]];
                const offsets = sides.map((part, index) => parseFloat(part) * (part.endsWith('%') ? (index % 2 ? r.width : r.height) / 100 : 1));
                clip = intersectRects(clip, makeRect(r.left + offsets[3], r.top + offsets[0], r.right - offsets[1], r.bottom - offsets[2]));
            }
        }
    }
    return clip;
}

function shadowRootsFor(node) {
    const roots = [];
    let root = node.getRootNode();
    while (root.host) {
        roots.push(root);
        root = root.host.getRootNode();
    }
    return roots;
}

function caretOffset(node, x, y, roots) {
    try {
        if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y, { shadowRoots: roots });
            if (pos?.offsetNode === node) return pos.offset;
        } else if (document.caretRangeFromPoint) {
            const pos = document.caretRangeFromPoint(x, y);
            if (pos?.startContainer === node) return pos.startOffset;
        }
    } catch { /* Use range geometry when the caret API cannot enter this root. */ }
    return null;
}

// The fallback measures characters instead of accepting the entire text node.
function geometryOffset(node, lineRect, x, rtl, range) {
    let low = 0, high = node.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        range.setStart(node, mid);
        range.setEnd(node, mid + 1);
        const r = range.getBoundingClientRect();
        const before = r.bottom <= lineRect.top + 0.5 ? true : r.top >= lineRect.bottom - 0.5 ? false :
            rtl ? (r.left + r.right) / 2 > x : (r.left + r.right) / 2 < x;
        if (before) low = mid + 1;
        else high = mid;
    }
    return low;
}

function collectTextFragments(node, style, clip, selection, range, fragments) {
    if (!node.nodeValue) return;
    const target = intersectRects(selection, clip);
    range.selectNodeContents(node);
    if (!rectsIntersect(target, range.getBoundingClientRect())) return;
    const rects = Array.from(range.getClientRects());
    const roots = shadowRootsFor(node);
    const seenOffsets = new Set();
    for (const r of rects) {
        if (!rectsIntersect(target, r)) continue;
        const intersection = intersectRects(target, r);
        const y = (intersection.top + intersection.bottom) / 2;
        let start, end;
        if (rects.length === 1 && target.left <= r.left && target.right >= r.right) {
            start = 0; end = node.length;
        } else {
            const rtl = style.direction === 'rtl';
            const left = intersection.left + Math.min(0.1, intersection.width / 4);
            const right = intersection.right - Math.min(0.1, intersection.width / 4);
            start = caretOffset(node, rtl ? right : left, y, roots);
            end = caretOffset(node, rtl ? left : right, y, roots);
            if (start === null) start = geometryOffset(node, r, rtl ? right : left, rtl, range);
            if (end === null) end = geometryOffset(node, r, rtl ? left : right, rtl, range);
            if (start > end) [start, end] = [end, start];
        }
        if (start >= end || seenOffsets.has(`${start}:${end}`)) continue;
        seenOffsets.add(`${start}:${end}`);
        const raw = node.nodeValue.substring(start, end);
        const text = /^(normal|nowrap|pre-line)$/.test(style.whiteSpace)
            ? raw.replace(/[ \t\r\n\f]+/g, ' ') : raw.replace(/[\r\n]+/g, '');
        if (!text) continue;
        range.setStart(node, start);
        range.setEnd(node, end);
        const selectedRects = Array.from(range.getClientRects());
        const selectedRect = selectedRects.find(selected => rectsIntersect(selected, r));
        if (selectedRect) fragments.push({ text, rect: intersectRects(selectedRect, clip) });
    }
}

function collectControlFragments(element, style, clip, selection, range, fragments) {
    const rect = element.getBoundingClientRect();
    const target = intersectRects(clip, rect);
    if (!rectsIntersect(selection, target)) return;
    if (element.tagName === 'SELECT') {
        const text = Array.from(element.selectedOptions, option => option.textContent.trim()).join(' ');
        if (text) fragments.push({ text, rect: target });
        return;
    }
    if (element.tagName === 'INPUT' && !['text', 'search', 'email', 'url', 'tel', 'number', 'button', 'submit', 'reset'].includes(element.type)) return;
    if (!element.value) return;

    // Native controls do not expose value text nodes. A noninteractive mirror supplies geometry.
    const mirror = document.createElement('div');
    mirror.style.cssText = 'all:initial;position:absolute;box-sizing:border-box;overflow:hidden;opacity:0;pointer-events:none;';
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight', 'letterSpacing',
        'textAlign', 'textIndent', 'textTransform', 'direction', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']) mirror.style[property] = style[property];
    Object.assign(mirror.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
        borderStyle: 'solid', borderColor: 'transparent', whiteSpace: element.tagName === 'TEXTAREA' && element.wrap !== 'off' ? 'pre-wrap' : 'pre',
        overflowWrap: element.tagName === 'TEXTAREA' ? 'break-word' : 'normal' });
    const textContainer = document.createElement('div');
    textContainer.style.transform = `translate(${-element.scrollLeft}px, ${-element.scrollTop}px)`;
    textContainer.textContent = element.value;
    mirror.appendChild(textContainer);
    getOverlayRoot().appendChild(mirror);
    try {
        const contentRect = makeRect(rect.left + element.clientLeft, rect.top + element.clientTop,
            rect.left + element.clientLeft + element.clientWidth, rect.top + element.clientTop + element.clientHeight);
        collectTextFragments(textContainer.firstChild, getComputedStyle(mirror), intersectRects(target, contentRect), selection, range, fragments);
    } finally { mirror.remove(); }
}

function extractTextInBox(selection, lineBreakThreshold = 5, preserveLayout = false) {
    if (!selection || selection.width <= 0 || selection.height <= 0) return '';
    const viewport = makeRect(0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight);
    const fragments = [];
    const range = document.createRange();
    const excluded = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION']);
    function visit(node, inheritedStyle, inheritedClip) {
        if (node.nodeType === Node.TEXT_NODE) {
            if (inheritedStyle.visibility !== 'hidden' && inheritedStyle.visibility !== 'collapse') {
                collectTextFragments(node, inheritedStyle, inheritedClip, selection, range, fragments);
            }
            return;
        }
        if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            for (const child of node.childNodes) visit(child, inheritedStyle, inheritedClip);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || node === overlayHost || excluded.has(node.tagName)) return;
        const control = ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
        // Range bounds include overflowing text, unlike the element's own bounding box.
        // Reject off-selection leaf subtrees before expensive computed-style checks.
        if (!control && !node.shadowRoot && node.childElementCount === 0) {
            range.selectNodeContents(node);
            if (!rectsIntersect(selection, range.getBoundingClientRect())) return;
        }
        const style = getComputedStyle(node);
        if (style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return;
        const clip = clippedElementRect(node, style, inheritedClip);
        if (!rectsIntersect(selection, clip)) return;
        if (control) {
            if (style.visibility !== 'hidden' && style.visibility !== 'collapse') collectControlFragments(node, style, clip, selection, range, fragments);
            return;
        }
        // Visibility may be overridden by a descendant; opacity/display cannot.
        if (node.shadowRoot) visit(node.shadowRoot, style, clip);
        for (const child of node.childNodes) visit(child, style, clip);
    }
    visit(document.documentElement, getComputedStyle(document.documentElement), viewport);
    return mergeTextFragments(fragments, selection, lineBreakThreshold, preserveLayout);
}

function mergeTextFragments(fragments, selection, lineBreakThreshold, preserveLayout) {
    // A total ordering followed by explicit row grouping avoids tolerance-based comparison cycles.
    fragments.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const rows = [];
    let activeRows = [];
    for (const fragment of fragments) {
        activeRows = activeRows.filter(row => row.bottom > fragment.rect.top);
        let best = null, bestOverlap = 0;
        for (const row of activeRows) {
            const overlap = Math.min(row.bottom, fragment.rect.bottom) - Math.max(row.top, fragment.rect.top);
            const minimum = Math.min(Math.max(0, lineBreakThreshold), Math.min(row.bottom - row.top, fragment.rect.height) * 0.5);
            if (overlap > 0 && overlap >= minimum && overlap > bestOverlap) { best = row; bestOverlap = overlap; }
        }
        if (best) {
            best.fragments.push(fragment);
            best.top = Math.max(best.top, fragment.rect.top);
            best.bottom = Math.min(best.bottom, fragment.rect.bottom);
        } else {
            const row = { top: fragment.rect.top, bottom: fragment.rect.bottom, fragments: [fragment] };
            rows.push(row);
            activeRows.push(row);
        }
    }
    let totalWidth = 0, totalChars = 0;
    for (const fragment of fragments) { totalWidth += fragment.rect.width; totalChars += fragment.text.length; }
    const charWidth = Math.max(totalChars ? totalWidth / totalChars : 8, 4);
    rows.sort((a, b) => a.top - b.top);
    return rows.map(row => {
        row.fragments.sort((a, b) => a.rect.left - b.rect.left);
        let line = '', last = null;
        for (const fragment of row.fragments) {
            if (preserveLayout) {
                const column = Math.max(0, Math.round((fragment.rect.left - selection.left) / charWidth));
                if (column > line.length) line += ' '.repeat(column - line.length);
            }
            if (last && fragment.rect.left - last.rect.right > 1 && !/\s$/.test(line) && !/^\s/.test(fragment.text)) line += ' ';
            line += fragment.text;
            last = fragment;
        }
        return preserveLayout ? line.trimEnd() : line.trim();
    }).filter(line => line.trim()).join('\n');
}

async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); return; }
        catch { /* Permissions policy can block the API even on HTTPS frames. */ }
    }
    // HTTP content scripts have no Clipboard API. Use the permission-backed legacy copy path.
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const inputSelection = active && typeof active.selectionStart === 'number'
        ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
    const selection = window.getSelection();
    const savedRanges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;';
    getOverlayRoot().appendChild(textarea);
    try {
        textarea.focus({ preventScroll: true });
        textarea.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard copy failed');
    } finally {
        textarea.remove();
        if (selection) {
            selection.removeAllRanges();
            for (const saved of savedRanges) selection.addRange(saved);
        }
        active?.focus?.({ preventScroll: true });
        if (inputSelection) active.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction);
    }
}

let messageTimeout = null;
function displayTemporaryMessage(message, duration = 2000, isError = false) {
    const root = getOverlayRoot();
    let div = root.querySelector('.message');
    if (!div) { div = document.createElement('div'); div.className = 'message'; root.appendChild(div); }
    div.textContent = message;
    div.style.display = 'block';
    div.style.backgroundColor = isError ? '#f8d7da' : '#d4edda';
    div.style.color = isError ? '#721c24' : '#155724';
    div.style.borderColor = isError ? '#f5c6cb' : '#c3e6cb';
    clearTimeout(messageTimeout);
    messageTimeout = setTimeout(() => { div.style.display = 'none'; }, duration);
}

chrome.runtime.onMessage.addListener(request => {
    if (request.action === 'setSelectionAvailability') {
        availabilityRevision++;
        if (request.available) makeSelectionAvailable(); else makeSelectionUnavailable();
    } else if (request.action === 'disableOtherMouseDowns' && selectionRequest?.id !== request.selectingRequestId) {
        otherFrameSelecting = true;
        canThisFrameListenForMouseDown = false;
    }
});
window.addEventListener('pagehide', handleSelectionInterruption);
sendSelectionMessage('getSelectionAvailability').then(response => {
    if (availabilityRevision === 0 && response?.available) {
        makeSelectionAvailable();
        if (response.busy) { otherFrameSelecting = true; canThisFrameListenForMouseDown = false; }
    }
}).catch(() => {});
