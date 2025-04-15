function injectPreventSelectStyle() {
    const styleId = 'cs-prevent-select-style';
    if (document.getElementById(styleId)) return; // Already injected

    const css = `
    body.cs-prevent-select {
      -webkit-user-select: none; /* Safari */
      -moz-user-select: none;    /* Firefox */
      -ms-user-select: none;     /* IE/Edge */
      user-select: none;         /* Standard */
      /* Optional: Consider adding a cursor style if needed */
      /* cursor: crosshair !important; */
    }
  `;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    console.log("CS: Injected prevent-select style.");
}

injectPreventSelectStyle(); // Call it once when the script loads

// --- State Variables (per frame instance) ---
// ... (keep existing state variables: isSelectionAvailableGlobally, etc.) ...
let isSelectionAvailableGlobally = false;
let canThisFrameListenForMouseDown = true;
let isCurrentlySelectingInThisFrame = false;

let startX, startY; // Document coordinates relative to *this* frame
let selectionBox = null;
let isDragging = false;

const LINE_BREAK_THRESHOLD_VERTICAL = 5; // Pixels

console.log(`FF Copy CS Loaded in frame: ${window.location.href.substring(0, 100)}...`);

// --- Core Activation / Deactivation ---
// ... (keep existing functions: makeSelectionAvailable, makeSelectionUnavailable) ...
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

// --- Event Handlers ---
// ... (keep existing handleMouseDown, handleMouseMove) ...
function handleMouseDown(event) {
    if (!isSelectionAvailableGlobally || !canThisFrameListenForMouseDown || isCurrentlySelectingInThisFrame || event.button !== 0) return;
    console.log("CS: MouseDown detected, attempting to start selection...");
    chrome.runtime.sendMessage({ action: "frameStartedSelection" })
        .then(response => {
            if (response?.canProceed) {
                console.log("CS: Background confirmed, starting selection in this frame.");
                isCurrentlySelectingInThisFrame = true; isDragging = true; canThisFrameListenForMouseDown = false;

                // ***** ADD CLASS TO PREVENT HIGHLIGHTING *****
                document.body.classList.add('cs-prevent-select');
                // ********************************************

                event.preventDefault(); event.stopPropagation();
                startX = event.pageX; startY = event.pageY; // Document coords
                initSelectionBox(); // Creates box in *this* frame
                // Position box using document coords initially
                selectionBox.style.left = `${startX}px`; selectionBox.style.top = `${startY}px`;
                selectionBox.style.width = '0px'; selectionBox.style.height = '0px';
                selectionBox.style.display = 'block';
                document.addEventListener('mousemove', handleMouseMove, true);
                document.addEventListener('mouseup', handleMouseUp, true);
            } else {
                console.log("CS: Background denied selection start.");
            }
        })
        .catch(err => console.error("CS: Error communicating with background on mousedown:", err));
}

function handleMouseMove(event) {
    if (!isDragging) return;
    event.preventDefault(); event.stopPropagation();
    const currentX = event.pageX; const currentY = event.pageY; // Document coords
    const left = Math.min(startX, currentX); const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX); const height = Math.abs(currentY - startY);
    if (selectionBox) { // Position using document coords
        selectionBox.style.left = `${left}px`; selectionBox.style.top = `${top}px`;
        selectionBox.style.width = `${width}px`; selectionBox.style.height = `${height}px`;
    }
}


// --- MOUSE UP (Needs adjustment to pass Viewport Rect) ---
function handleMouseUp(event) {
    // ***** REMOVE CLASS TO RE-ENABLE HIGHLIGHTING *****
    // Do this *before* checking isDragging, to ensure it's always removed on mouseup
    document.body.classList.remove('cs-prevent-select');
    // *************************************************

    if (!isDragging) return; // Check isDragging *after* removing the class

    event.preventDefault(); event.stopPropagation();
    console.log("CS: MouseUp detected, ending selection drag.");

    isDragging = false; // Update state *after* checking if we were dragging
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);

    // ***** CHANGE: Get Viewport coordinates for text extraction *****
    const selectionViewportRect = selectionBox?.getBoundingClientRect();

    if (!selectionViewportRect || selectionViewportRect.width <= 2 || selectionViewportRect.height <= 2) {
        console.log("CS: Selection too small or box not found.");
        cancelSelectionDrag(true); // Cancel and notify background immediately
        // Note: cancelSelectionDrag will also attempt removal, which is harmless
        return;
    }

     // Convert to plain object for safety, although not strictly necessary
     const plainSelectionViewportRect = {
        top: selectionViewportRect.top, left: selectionViewportRect.left,
        bottom: selectionViewportRect.bottom, right: selectionViewportRect.right,
        width: selectionViewportRect.width, height: selectionViewportRect.height
    };

    console.log("CS: Final Selection Viewport Rect (local):", plainSelectionViewportRect);

    let textFound = false;
    selectionBox.style.borderColor = 'orange'; // Feedback during processing

    // --- Pass Viewport Rect to extraction ---
    const text = extractTextInBox(plainSelectionViewportRect);

    if (text) {
        copyToClipboard(text);
        textFound = true;
    } else {
        console.log("CS: No text found in local selection.");
        displayTemporaryMessage("No text found", 1500, true);
    }

    // --- Cleanup and Notify Background ---
    isCurrentlySelectingInThisFrame = false; // Done selecting
    if (selectionBox && !textFound) {
         selectionBox.style.borderColor = '#007bff';
    }
    if (selectionBox) selectionBox.style.display = 'none';

    // Always notify background that this frame ended
    chrome.runtime.sendMessage({ action: "frameEndedSelection" })
        .catch(err => console.error("CS: Error sending frameEndedSelection to background:", err));
    // Background handles global deactivation
}

// --- Helper: Cancel Drag (Add optional background notification) ---
function cancelSelectionDrag(notifyBackground = false) {
    console.log("CS: Cancelling active selection drag.");

    // ***** REMOVE CLASS TO RE-ENABLE HIGHLIGHTING *****
    // Add this here too, in case selection is cancelled other ways
    document.body.classList.remove('cs-prevent-select');
    // *************************************************

    const wasSelecting = isCurrentlySelectingInThisFrame || isDragging;
    isDragging = false;
    isCurrentlySelectingInThisFrame = false;
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    if (selectionBox) {
        selectionBox.style.display = 'none';
        selectionBox.style.borderColor = '#007bff';
    }
    // If we were actively selecting and need to tell background immediately
    if (wasSelecting && notifyBackground) {
         chrome.runtime.sendMessage({ action: "frameCancelledSelection" }) // Use cancel action
            .catch(err => console.error("CS: Error sending frameCancelledSelection:", err));
    }
    // Reset ability to listen only if global mode is still on (usually isn't after cancel)
    // canThisFrameListenForMouseDown = isSelectionAvailableGlobally;
}


// --- Box Initialization (Local to Frame) ---
// ... (keep existing initSelectionBox) ...
function initSelectionBox() {
  if (!selectionBox) {
    console.log("CS: Initializing selection box in this frame.");
    selectionBox = document.createElement('div');
    // Use class for styling, ensure position:absolute for document coord positioning
    selectionBox.className = 'freeform-selection-box-internal';
    selectionBox.style.position = 'absolute'; // Crucial for pageX/Y positioning
    document.body.appendChild(selectionBox);
    selectionBox.style.display = 'none';
  }
}


// --- Text Extraction (MAJOR CHANGES using caretRangeFromPoint) ---
// function rectsIntersect(r1, r2) { // Works for both viewport and document if consistent
//   return !(r2.left >= r1.right || r2.right <= r1.left || r2.top >= r1.bottom || r2.bottom <= r1.top);
// }



/**
 * Extracts *visible* text *precisely* within a given viewport rectangle.
 * Iterates through text nodes, checks visibility and intersection,
 * then uses caretPositionFromPoint on the intersection corners
 * to clip the text within each node accurately. Handles wrapped nodes
 * creating multiple fragments. Treats fragment text as single-line,
 * adding newlines based only on vertical gaps between fragments.
 * Removes resulting empty or whitespace-only lines.
 * Includes special fallback handling for visually selected text in disabled <select> elements.
 *
 * @param {DOMRect | {top: number, left: number, bottom: number, right: number}} selectionViewportRect - The selection rectangle in viewport coordinates.
 * @param {number} [lineBreakThreshold=5] - Approx vertical pixel gap to trigger a newline.
 * @returns {string} The extracted text.
 */
function extractTextInBox(selectionViewportRect, lineBreakThreshold = 5) {
    console.log("CS: Extracting text within viewport rect:", selectionViewportRect);
    const fragments = []; // Store { text: "substring", rect: nodeViewportRect }
    const uniqueFragmentKeys = new Set(); // Avoid duplicates from fallback

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

    while (node = walker.nextNode()) {
        const nodeTextPreview = node.nodeValue?.trim().substring(0, 50) + "...";
        if (!node.nodeValue || node.nodeValue.trim().length === 0) {
            continue;
        }

        // --- Visibility Check ---
        const parentElement = node.parentElement;
        if (!parentElement) continue;

        // *** Special Check for Selected Options ***
        let isSelectedOptionText = false;
        let associatedSelectElement = null;
        if (parentElement.tagName === 'OPTION') {
            associatedSelectElement = parentElement.closest('select');
            if (associatedSelectElement && parentElement.selected) {
                isSelectedOptionText = true;
            }
        }
        // ******************************************

        let elementToCheck = parentElement;
        let isVisible = true;
        let visibilityReason = "Passed"; // Track reason for logging

        try {
            while (elementToCheck && elementToCheck !== document.body) {
                const style = window.getComputedStyle(elementToCheck);
                if (!style) { isVisible = false; visibilityReason = "No Computed Style"; break; }
                if (style.display === 'none') { isVisible = false; visibilityReason = "display: none"; break; }
                // Relaxed check: Only fail on hidden/opacity if NOT selected option text
                 if (style.visibility === 'hidden' && !isSelectedOptionText) {
                     isVisible = false; visibilityReason = "visibility: hidden"; break;
                 }
                 if (parseFloat(style.opacity || '1') === 0 && !isSelectedOptionText) {
                     isVisible = false; visibilityReason = "opacity: 0"; break;
                 }
                 // Standard checks
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(elementToCheck.tagName)) {
                    isVisible = false; visibilityReason = `Tag: ${elementToCheck.tagName}`; break;
                }
                if (elementToCheck.classList.contains('sr-only') || elementToCheck.classList.contains('visually-hidden')) {
                    isVisible = false; visibilityReason = "Screen Reader Class"; break;
                }
                elementToCheck = elementToCheck.parentElement;
            }
        } catch (e) {
            console.warn("CS: Error checking visibility for node", node, e);
            isVisible = false; visibilityReason = "Error";
        }

        if (!isVisible) {
             // console.log(`CS DEBUG: Node skipped visibility (${visibilityReason}): "${nodeTextPreview}"`, parentElement);
            continue;
        }
        // --- End Visibility Check ---


        // --- Intersection and Clipping ---
        const range = document.createRange();
        range.selectNodeContents(node);
        const nodeViewportRects = range.getClientRects();
        let fragmentAddedForThisNode = false; // Track if standard method works

        for (let i = 0; i < nodeViewportRects.length; i++) {
            const nodeViewportRect = nodeViewportRects[i];

            if (nodeViewportRect.width > 0 && nodeViewportRect.height > 0 &&
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
                    const startPos = document.caretPositionFromPoint(startX, startY);
                    const endPos = document.caretPositionFromPoint(endX, endY);

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
                        if (!uniqueFragmentKeys.has(fragmentKey)) { // Basic deduplication
                             fragments.push({
                                 text: cleanedSubstring,
                                 rect: {
                                     top: nodeViewportRect.top, left: nodeViewportRect.left,
                                     bottom: nodeViewportRect.bottom, right: nodeViewportRect.right,
                                     width: nodeViewportRect.width, height: nodeViewportRect.height
                                 }
                             });
                             uniqueFragmentKeys.add(fragmentKey);
                             fragmentAddedForThisNode = true; // Mark success
                             // console.log(`CS DEBUG: ADDING fragment: "${cleanedSubstring}"`);
                        }
                    }
                }
            }
        } // End loop over nodeViewportRects
        range.detach();

        // --- Fallback for Selected Option Text ---
        if (isSelectedOptionText && !fragmentAddedForThisNode && associatedSelectElement) {
             // console.log(`CS DEBUG: Standard text extraction failed for selected option "${nodeTextPreview}", attempting fallback.`);
            try {
                const selectRect = associatedSelectElement.getBoundingClientRect();
                if (selectRect.width > 0 && selectRect.height > 0 && rectsIntersect(selectionViewportRect, selectRect)) {
                    // Get text directly from the option element
                    const optionText = parentElement.textContent; // Use textContent of the OPTION
                    const cleanedOptionText = optionText?.replace(/[\n\r\t]+/g, ' ').trim();

                    if (cleanedOptionText && cleanedOptionText.length > 0) {
                        // Use SELECT's rect for sorting, ensure uniqueness based on select rect + text
                        const fragmentKey = `${selectRect.top}-${selectRect.left}-SELECT-${cleanedOptionText}`;
                        if (!uniqueFragmentKeys.has(fragmentKey)) {
                             fragments.push({
                                 text: cleanedOptionText,
                                 rect: { // Use the SELECT element's rect
                                     top: selectRect.top, left: selectRect.left,
                                     bottom: selectRect.bottom, right: selectRect.right,
                                     width: selectRect.width, height: selectRect.height
                                 }
                             });
                             uniqueFragmentKeys.add(fragmentKey);
                             console.log(`CS DEBUG: ADDING fallback fragment for selected option: "${cleanedOptionText}"`);
                        }
                    }
                } else {
                     // console.log(`CS DEBUG: Fallback failed: Select element rect does not intersect or has no dimensions.`, {selectRect, selectionViewportRect});
                }
            } catch (fallbackError) {
                console.error("CS: Error during selected option fallback", fallbackError);
            }
        }
        // --- End Fallback ---

    } // End while loop over nodes

    // --- Sorting, Merging, Post-processing (Remains the same) ---
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

    let mergedLines = [];
    let currentLine = "";
    fragments.forEach((frag, index) => {
        if (index === 0) {
            currentLine = frag.text;
        } else {
            const lastFrag = fragments[index - 1];
            const verticalGap = frag.rect.top - lastFrag.rect.bottom;
            const horizontalGap = frag.rect.left - lastFrag.rect.right;
            const isNewLine = verticalGap > -lineBreakThreshold;
            if (isNewLine) {
                mergedLines.push(currentLine);
                currentLine = frag.text;
            } else {
                if (horizontalGap > 1) {
                    currentLine += " ";
                }
                currentLine += frag.text;
            }
        }
    });
    if (currentLine.length > 0) {
         mergedLines.push(currentLine);
    }

    const cleanedLines = mergedLines.filter(line => line.trim().length > 0);
    const finalExtractedText = cleanedLines.join('\n');

    console.log("CS Extracted (Cleaned, Single-Line Fragments):", finalExtractedText);
    return finalExtractedText;
}

// Helper function (ensure you have this)
function rectsIntersect(r1, r2) {
    return !(r2.left >= r1.right ||
             r2.right <= r1.left ||
             r2.top >= r1.bottom ||
             r2.bottom <= r1.top);
}


// --- Clipboard Function (Local to Frame, unchanged) ---
// ... (keep existing copyToClipboard) ...
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

// --- Utility: Temporary Message (Local to Frame, unchanged) ---
// ... (keep existing displayTemporaryMessage) ...
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


// --- Message Listener (from Background, unchanged) ---
// ... (keep existing listener for setSelectionAvailability, disableOtherMouseDowns) ...
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


// --- Cleanup on page unload ---
// ... (keep existing unload listener) ...
//window.addEventListener('unload', () => {
//     console.log("CS: Unloading frame, ensuring deactivated state.");
//     makeSelectionUnavailable();
//});