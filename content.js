function injectPreventSelectStyle() {
    const styleId = 'cs-prevent-select-style';
    if (document.getElementById(styleId)) return;

    const css = `
    body.cs-prevent-select {
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
    }
  `;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    console.log("CS: Injected prevent-select style.");
}

injectPreventSelectStyle();

let isSelectionAvailableGlobally = false;
let canThisFrameListenForMouseDown = true;
let isCurrentlySelectingInThisFrame = false;

let startX, startY;
let selectionBox = null;
let isDragging = false;

const LINE_BREAK_THRESHOLD_VERTICAL = 5;
let preserveLayoutOption = false;

// Load user's layout preference
if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ preserveLayout: false }, (items) => {
        preserveLayoutOption = items.preserveLayout;
    });
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.preserveLayout) {
            preserveLayoutOption = changes.preserveLayout.newValue;
        }
    });
}

console.log(`FF Copy CS Loaded in frame: ${window.location.href.substring(0, 100)}...`);

function makeSelectionAvailable() {
    if (isSelectionAvailableGlobally) return;
    isSelectionAvailableGlobally = true;
    canThisFrameListenForMouseDown = true;
    document.addEventListener('mousedown', handleMouseDown, true);
    document.body.classList.add('selection-active');
    console.log("CS: Selection AVAILABLE.");
}

function makeSelectionUnavailable() {
    if (!isSelectionAvailableGlobally) return;
    isSelectionAvailableGlobally = false;
    canThisFrameListenForMouseDown = false;
    document.removeEventListener('mousedown', handleMouseDown, true);
    document.body.classList.remove('selection-active');
    console.log("CS: Selection UNAVAILABLE.");
    if (isCurrentlySelectingInThisFrame || isDragging) {
        cancelSelectionDrag();
    }
}

function handleMouseDown(event) {
    if (!isSelectionAvailableGlobally || !canThisFrameListenForMouseDown || isCurrentlySelectingInThisFrame || event.button !== 0) return;
    console.log("CS: MouseDown detected, attempting to start selection...");
    chrome.runtime.sendMessage({ action: "frameStartedSelection" })
        .then(response => {
            if (response?.canProceed) {
                console.log("CS: Background confirmed, starting selection in this frame.");
                isCurrentlySelectingInThisFrame = true; isDragging = true; canThisFrameListenForMouseDown = false;

                document.body.classList.add('cs-prevent-select');

                event.preventDefault(); event.stopPropagation();
                startX = event.pageX; startY = event.pageY;
                initSelectionBox();
                selectionBox.style.left = `${startX}px`; selectionBox.style.top = `${startY}px`;
                selectionBox.style.width = '0px'; selectionBox.style.height = '0px';
                selectionBox.style.display = 'block';
                selectionBox.style.borderColor = ''; // Reset any success/error inline colors
                updateSelectionBoxVisuals(event);
                document.addEventListener('mousemove', handleMouseMove, true);
                document.addEventListener('mouseup', handleMouseUp, true);
                document.addEventListener('keydown', handleKeyDownUp, true);
                document.addEventListener('keyup', handleKeyDownUp, true);
            } else {
                console.log("CS: Background denied selection start.");
            }
        })
        .catch(err => console.error("CS: Error communicating with background on mousedown:", err));
}

function handleMouseMove(event) {
    if (!isDragging) return;
    event.preventDefault(); event.stopPropagation();
    const currentX = event.pageX; const currentY = event.pageY;
    const left = Math.min(startX, currentX); const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX); const height = Math.abs(currentY - startY);
    if (selectionBox) {
        selectionBox.style.left = `${left}px`; selectionBox.style.top = `${top}px`;
        selectionBox.style.width = `${width}px`; selectionBox.style.height = `${height}px`;
        updateSelectionBoxVisuals(event);
    }
}

function updateSelectionBoxVisuals(event) {
    if (!selectionBox) return;
    const usePreserveLayout = preserveLayoutOption || event.altKey;
    if (usePreserveLayout) {
        selectionBox.classList.add('preserve-layout');
    } else {
        selectionBox.classList.remove('preserve-layout');
    }
}

function handleKeyDownUp(event) {
    if (event.key === 'Alt') {
        updateSelectionBoxVisuals(event);
    }
}

function handleMouseUp(event) {
    document.body.classList.remove('cs-prevent-select');

    if (!isDragging) return;

    event.preventDefault(); event.stopPropagation();
    console.log("CS: MouseUp detected, ending selection drag.");

    isDragging = false;
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('keydown', handleKeyDownUp, true);
    document.removeEventListener('keyup', handleKeyDownUp, true);

    const selectionViewportRect = selectionBox?.getBoundingClientRect();

    if (!selectionViewportRect || selectionViewportRect.width <= 2 || selectionViewportRect.height <= 2) {
        console.log("CS: Selection too small or box not found.");
        cancelSelectionDrag(true);
        return;
    }

     const plainSelectionViewportRect = {
        top: selectionViewportRect.top, left: selectionViewportRect.left,
        bottom: selectionViewportRect.bottom, right: selectionViewportRect.right,
        width: selectionViewportRect.width, height: selectionViewportRect.height
    };

    console.log("CS: Final Selection Viewport Rect (local):", plainSelectionViewportRect);

    let textFound = false;
    selectionBox.style.borderColor = 'orange';

    const usePreserveLayout = preserveLayoutOption || event.altKey;
    const text = extractTextInBox(plainSelectionViewportRect, LINE_BREAK_THRESHOLD_VERTICAL, usePreserveLayout);

    if (text) {
        copyToClipboard(text);
        textFound = true;
    } else {
        console.log("CS: No text found in local selection.");
        displayTemporaryMessage("No text found", 1500, true);
    }

    isCurrentlySelectingInThisFrame = false;
    if (selectionBox && !textFound) {
         selectionBox.style.borderColor = '';
    }
    if (selectionBox) selectionBox.style.display = 'none';

    chrome.runtime.sendMessage({ action: "frameEndedSelection" })
        .catch(err => console.error("CS: Error sending frameEndedSelection to background:", err));
}

function cancelSelectionDrag(notifyBackground = false) {
    console.log("CS: Cancelling active selection drag.");

    document.body.classList.remove('cs-prevent-select');

    const wasSelecting = isCurrentlySelectingInThisFrame || isDragging;
    isDragging = false;
    isCurrentlySelectingInThisFrame = false;
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('keydown', handleKeyDownUp, true);
    document.removeEventListener('keyup', handleKeyDownUp, true);
    if (selectionBox) {
        selectionBox.style.display = 'none';
        selectionBox.style.borderColor = '';
        selectionBox.classList.remove('preserve-layout');
    }
    if (wasSelecting && notifyBackground) {
         chrome.runtime.sendMessage({ action: "frameCancelledSelection" })
            .catch(err => console.error("CS: Error sending frameCancelledSelection:", err));
    }
}

function initSelectionBox() {
  if (!selectionBox) {
    console.log("CS: Initializing selection box in this frame.");
    selectionBox = document.createElement('div');
    selectionBox.className = 'freeform-selection-box-internal';
    selectionBox.style.position = 'absolute';
    document.body.appendChild(selectionBox);
    selectionBox.style.display = 'none';
  }
}

function extractTextInBox(selectionViewportRect, lineBreakThreshold = 5, preserveLayout = false) {
    console.log("CS: Extracting text within viewport rect:", selectionViewportRect);
    const fragments = [];
    const uniqueFragmentKeys = new Set();

    if (!selectionViewportRect || selectionViewportRect.width <= 0 || selectionViewportRect.height <= 0) {
        console.warn("CS: Invalid or zero-area selection rectangle.");
        return "";
    }

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    let node;
    const docWidth = document.documentElement.clientWidth;
    const docHeight = document.documentElement.clientHeight;
    const visibilityCache = new Map();

    while (node = walker.nextNode()) {
        const nodeTextPreview = node.nodeValue?.trim().substring(0, 50) + "...";
        if (!node.nodeValue || node.nodeValue.trim().length === 0) {
            continue;
        }

        const parentElement = node.parentElement;
        if (!parentElement) continue;

        let isSelectedOptionText = false;
        let associatedSelectElement = null;
        if (parentElement.tagName === 'OPTION') {
            associatedSelectElement = parentElement.closest('select');
            if (associatedSelectElement && parentElement.selected) {
                isSelectedOptionText = true;
            }
        }

        let elementToCheck = parentElement;
        let isVisible = true;
        let visibilityReason = "Passed";
        const chain = [];

        try {
            while (elementToCheck && elementToCheck !== document.body) {
                if (visibilityCache.has(elementToCheck)) {
                    isVisible = visibilityCache.get(elementToCheck);
                    visibilityReason = "Cached";
                    break;
                }
                chain.push(elementToCheck);
                const style = window.getComputedStyle(elementToCheck);
                if (!style) { isVisible = false; visibilityReason = "No Computed Style"; break; }
                if (style.display === 'none') { isVisible = false; visibilityReason = "display: none"; break; }
                 if (style.visibility === 'hidden' && !isSelectedOptionText) {
                     isVisible = false; visibilityReason = "visibility: hidden"; break;
                 }
                 if (parseFloat(style.opacity || '1') === 0 && !isSelectedOptionText) {
                     isVisible = false; visibilityReason = "opacity: 0"; break;
                 }
                 if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clip === 'rect(1px, 1px, 1px, 1px)' || style.clipPath === 'inset(100%)') {
                     isVisible = false; visibilityReason = "CSS Clip Hidden"; break;
                 }
                 if (style.overflow === 'hidden' && (style.width === '0px' || style.width === '1px' || style.height === '0px' || style.height === '1px')) {
                     isVisible = false; visibilityReason = "1px Overflow Hidden"; break;
                 }
                 if (parseFloat(style.textIndent) < -900) {
                     isVisible = false; visibilityReason = "Text Indent Hidden"; break;
                 }
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(elementToCheck.tagName)) {
                    isVisible = false; visibilityReason = `Tag: ${elementToCheck.tagName}`; break;
                }
                if (elementToCheck.classList.contains('sr-only') || elementToCheck.classList.contains('visually-hidden')) {
                    isVisible = false; visibilityReason = "Screen Reader Class"; break;
                }
                elementToCheck = elementToCheck.parentElement;
            }
            for (const el of chain) {
                visibilityCache.set(el, isVisible);
            }
        } catch (e) {
            console.warn("CS: Error checking visibility for node", node, e);
            isVisible = false; visibilityReason = "Error";
        }

        if (!isVisible) {
            continue;
        }


        const range = document.createRange();
        range.selectNodeContents(node);
        const nodeViewportRects = range.getClientRects();
        let fragmentAddedForThisNode = false;

        for (let i = 0; i < nodeViewportRects.length; i++) {
            const nodeViewportRect = nodeViewportRects[i];

            if (nodeViewportRect.width > 1 && nodeViewportRect.height > 1 &&
                rectsIntersect(selectionViewportRect, nodeViewportRect))
            {
                const intersectTop = Math.max(selectionViewportRect.top, nodeViewportRect.top);
                const intersectLeft = Math.max(selectionViewportRect.left, nodeViewportRect.left);
                const intersectBottom = Math.min(selectionViewportRect.bottom, nodeViewportRect.bottom);
                const intersectRight = Math.min(selectionViewportRect.right, nodeViewportRect.right);

                if (intersectRight <= intersectLeft || intersectBottom <= intersectTop) continue;

                const startX = Math.max(0, Math.min(docWidth - 1, intersectLeft + 0.1));
                const startY = Math.max(0, Math.min(docHeight - 1, intersectTop + 0.1));
                const endX = Math.max(0, Math.min(docWidth - 1, intersectRight - 0.1));
                const endY = Math.max(0, Math.min(docHeight - 1, intersectBottom - 0.1));

                let startOffset = 0;
                let endOffset = node.nodeValue.length;

                try {
                    let startPos = null, endPos = null;
                    if (document.caretPositionFromPoint) {
                        startPos = document.caretPositionFromPoint(startX, startY);
                        endPos = document.caretPositionFromPoint(endX, endY);
                    } else if (document.caretRangeFromPoint) {
                        const startRange = document.caretRangeFromPoint(startX, startY);
                        if (startRange) startPos = { offsetNode: startRange.startContainer, offset: startRange.startOffset };
                        const endRange = document.caretRangeFromPoint(endX, endY);
                        if (endRange) endPos = { offsetNode: endRange.startContainer, offset: endRange.startOffset };
                    }

                     if (startPos && startPos.offsetNode === node) { startOffset = startPos.offset; }
                     else if (startPos && range.comparePoint(startPos.offsetNode, startPos.offset) === -1) { startOffset = 0; }
                     else { if (!startPos) console.warn("CS: caretPositionFromPoint returned null for start", {startX, startY, node: node.nodeValue}); startOffset = 0; }

                     if (endPos && endPos.offsetNode === node) { endOffset = endPos.offset; }
                     else if (endPos && range.comparePoint(endPos.offsetNode, endPos.offset) === 1) { endOffset = node.nodeValue.length; }
                     else { if (!endPos) console.warn("CS: caretPositionFromPoint returned null for end", {endX, endY, node: node.nodeValue}); endOffset = node.nodeValue.length; }

                    if (startOffset > endOffset) { [startOffset, endOffset] = [endOffset, startOffset]; }

                } catch (e) {
                    console.error("CS: Error using caretPositionFromPoint within intersection", e);
                    continue;
                }

                if (startOffset < endOffset) {
                    const rawSubstring = node.nodeValue.substring(startOffset, endOffset);
                    const cleanedSubstring = rawSubstring.replace(/[\n\r\t]+/g, ' ').trim();

                    if (cleanedSubstring.length > 0) {
                        const fragmentKey = `${nodeViewportRect.top}-${nodeViewportRect.left}-${cleanedSubstring}`;
                        if (!uniqueFragmentKeys.has(fragmentKey)) {
                             fragments.push({
                                 text: cleanedSubstring,
                                 rect: {
                                     top: nodeViewportRect.top, left: nodeViewportRect.left,
                                     bottom: nodeViewportRect.bottom, right: nodeViewportRect.right,
                                     width: nodeViewportRect.width, height: nodeViewportRect.height
                                 }
                             });
                             uniqueFragmentKeys.add(fragmentKey);
                             fragmentAddedForThisNode = true;
                        }
                    }
                }
            }
        }
        range.detach();

        if (isSelectedOptionText && !fragmentAddedForThisNode && associatedSelectElement) {
            try {
                const selectRect = associatedSelectElement.getBoundingClientRect();
                if (selectRect.width > 0 && selectRect.height > 0 && rectsIntersect(selectionViewportRect, selectRect)) {
                    const optionText = parentElement.textContent;
                    const cleanedOptionText = optionText?.replace(/[\n\r\t]+/g, ' ').trim();

                    if (cleanedOptionText && cleanedOptionText.length > 0) {
                        const fragmentKey = `${selectRect.top}-${selectRect.left}-SELECT-${cleanedOptionText}`;
                        if (!uniqueFragmentKeys.has(fragmentKey)) {
                             fragments.push({
                                 text: cleanedOptionText,
                                 rect: {
                                     top: selectRect.top, left: selectRect.left,
                                     bottom: selectRect.bottom, right: selectRect.right,
                                     width: selectRect.width, height: selectRect.height
                                 }
                             });
                             uniqueFragmentKeys.add(fragmentKey);
                             console.log(`CS DEBUG: ADDING fallback fragment for selected option: "${cleanedOptionText}"`);
                        }
                    }
                }
            } catch (fallbackError) {
                console.error("CS: Error during selected option fallback", fallbackError);
            }
        }

    }

    if (fragments.length === 0) {
        console.warn("CS: No fragments collected.");
        return "";
    }
    fragments.sort((a, b) => {
        const verticalThreshold = Math.min(a.rect.height, b.rect.height) * 0.5;
        if (a.rect.top < b.rect.top - verticalThreshold) return -1;
        if (b.rect.top < a.rect.top - verticalThreshold) return 1;
        return a.rect.left - b.rect.left;
    });

    // Calculate a consistent character width for the entire selection to align columns
    let globalCharWidth = 8;
    if (preserveLayout && fragments.length > 0) {
        let totalChars = 0;
        let totalWidth = 0;
        fragments.forEach(f => {
            totalChars += f.text.length;
            totalWidth += f.rect.width;
        });
        if (totalChars > 0) {
            globalCharWidth = Math.max(totalWidth / totalChars, 4);
        }
    }

    let mergedLines = [];
    let currentLine = "";
    fragments.forEach((frag, index) => {
        const expectedStart = preserveLayout 
            ? Math.max(0, Math.floor((frag.rect.left - selectionViewportRect.left) / globalCharWidth))
            : 0;

        if (index === 0) {
            currentLine = preserveLayout ? " ".repeat(expectedStart) + frag.text : frag.text;
        } else {
            const lastFrag = fragments[index - 1];
            const verticalGap = frag.rect.top - lastFrag.rect.bottom;
            const horizontalGap = frag.rect.left - lastFrag.rect.right;
            const isNewLine = verticalGap > -lineBreakThreshold;

            if (isNewLine) {
                mergedLines.push(currentLine);
                currentLine = preserveLayout ? " ".repeat(expectedStart) + frag.text : frag.text;
            } else {
                if (preserveLayout) {
                    if (expectedStart > currentLine.length) {
                        currentLine += " ".repeat(expectedStart - currentLine.length);
                    } else if (horizontalGap > 1) {
                        currentLine += " ";
                    }
                } else {
                    if (horizontalGap > 1) {
                        currentLine += " ";
                    }
                }
                currentLine += frag.text;
            }
        }
    });
    if (currentLine.length > 0) {
         mergedLines.push(currentLine);
    }

    const cleanedLines = mergedLines
        .filter(line => line.trim().length > 0)
        .map(line => line.trim());
    const finalExtractedText = cleanedLines.join('\n');

    console.log("CS Extracted (Cleaned, Single-Line Fragments):", finalExtractedText);
    return finalExtractedText;
}

function rectsIntersect(r1, r2) {
    return !(r2.left >= r1.right ||
             r2.right <= r1.left ||
             r2.top >= r1.bottom ||
             r2.bottom <= r1.top);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            console.log('CS: Text copied to clipboard!');
            displayTemporaryMessage("Text Copied!", 1500);
            if (selectionBox) selectionBox.style.borderColor = 'lightgreen';
        })
        .catch(err => {
            console.error('CS: Failed to copy text: ', err);
            displayTemporaryMessage(`Copy Failed! ${err.message}`, 3000, true);
            if (selectionBox) selectionBox.style.borderColor = 'red';
        });
}

let messageTimeout = null;
function displayTemporaryMessage(message, duration = 2000, isError = false) {
    let messageDiv = document.getElementById('freeform-copy-message-local');
    if (!messageDiv) {
        messageDiv = document.createElement('div');
        messageDiv.id = 'freeform-copy-message-local';
        messageDiv.style.position = 'fixed'; messageDiv.style.bottom = '20px'; messageDiv.style.left = '50%';
        messageDiv.style.transform = 'translateX(-50%)'; messageDiv.style.padding = '10px 20px';
        messageDiv.style.borderRadius = '5px'; messageDiv.style.zIndex = '2147483647';
        messageDiv.style.fontSize = '14px'; messageDiv.style.fontWeight = 'bold';
        messageDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)'; messageDiv.style.opacity = '0';
        messageDiv.style.transition = 'opacity 0.3s ease-in-out'; messageDiv.style.border = '1px solid';
        messageDiv.style.textAlign = 'center'; messageDiv.style.maxWidth = '80%';
        document.body.appendChild(messageDiv);
    }
    messageDiv.textContent = message;
    messageDiv.style.backgroundColor = isError ? '#f8d7da' : '#d4edda';
    messageDiv.style.color = isError ? '#721c24' : '#155724';
    messageDiv.style.borderColor = isError ? '#f5c6cb' : '#c3e6cb';
    if (messageTimeout) clearTimeout(messageTimeout);
    requestAnimationFrame(() => { messageDiv.style.opacity = '1'; });
    messageTimeout = setTimeout(() => {
        if (messageDiv) messageDiv.style.opacity = '0'; messageTimeout = null;
    }, duration);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "setSelectionAvailability") {
        if (request.available) makeSelectionAvailable(); else makeSelectionUnavailable();
    } else if (request.action === "disableOtherMouseDowns") {
        if (sender.frameId !== request.selectingFrameId) {
            console.log("CS: Disabling mousedown listener (other frame active).");
            canThisFrameListenForMouseDown = false;
        }
    }
});