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
    if (!isDragging) return;

    event.preventDefault(); event.stopPropagation();
    console.log("CS: MouseUp detected, ending selection drag.");

    isDragging = false;
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);

    // ***** CHANGE: Get Viewport coordinates for text extraction *****
    const selectionViewportRect = selectionBox?.getBoundingClientRect();

    if (!selectionViewportRect || selectionViewportRect.width <= 2 || selectionViewportRect.height <= 2) {
        console.log("CS: Selection too small or box not found.");
        cancelSelectionDrag(true); // Cancel and notify background immediately
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
function rectsIntersect(r1, r2) { // Works for both viewport and document if consistent
  return !(r2.left >= r1.right || r2.right <= r1.left || r2.top >= r1.bottom || r2.bottom <= r1.top);
}

// ** Takes VIEWPORT selection rectangle **
function extractTextInBox(selectionViewportRect) {
    console.log("CS: Extracting text within viewport rect:", selectionViewportRect);
    const fragments = []; // Store { text: "substring", rect: viewportRect }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;

    while (node = walker.nextNode()) {
        if (!node.nodeValue || node.nodeValue.trim() === '') continue;

        const parentElement = node.parentElement;
        if (!parentElement) continue;
        const parentStyle = window.getComputedStyle(parentElement);
        if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden' || parentStyle.opacity === '0') continue;

        const range = document.createRange();
        range.selectNodeContents(node);
        const nodeViewportRects = range.getClientRects(); // Use viewport rects

        for (let i = 0; i < nodeViewportRects.length; i++) {
            const nodeViewportRect = nodeViewportRects[i];

            // Check intersection between selection (viewport) and text node part (viewport)
            if (nodeViewportRect.width > 0 && nodeViewportRect.height > 0 &&
                rectsIntersect(selectionViewportRect, nodeViewportRect))
            {
                // Calculate the actual intersection rectangle (in viewport coordinates)
                const intersectTop = Math.max(selectionViewportRect.top, nodeViewportRect.top);
                const intersectLeft = Math.max(selectionViewportRect.left, nodeViewportRect.left);
                const intersectBottom = Math.min(selectionViewportRect.bottom, nodeViewportRect.bottom);
                const intersectRight = Math.min(selectionViewportRect.right, nodeViewportRect.right);

                // Use caretRangeFromPoint to find the precise text range
                // Add small epsilon to avoid landing exactly on boundaries sometimes
                const startX = intersectLeft + 0.1;
                const startY = intersectTop + 0.1;
                const endX = intersectRight - 0.1;
                const endY = intersectBottom - 0.1;

                let startRange, endRange;
                try {
                    // 1. Use the modern API to get CaretPosition objects, replacing caretRangeFromPoint which is deprecated
                    const startPos = document.caretPositionFromPoint(startX, startY);
                    const endPos = document.caretPositionFromPoint(endX, endY);

                    // 2. Check if the API returned valid positions (it returns null on failure)
                    if (!startPos || !endPos) {
                        // Handle the failure case - equivalent to the old catch block's purpose
                        console.warn("CS: caretPositionFromPoint returned null (possibly off-screen or non-text area)");
                        continue; // Skip this rectangle if points fail
                    }

                    // 3. Create collapsed Range objects from the CaretPosition data
                    startRange = document.createRange();
                    // Set both start and end to the same point to create a collapsed range
                    startRange.setStart(startPos.offsetNode, startPos.offset);
                    startRange.setEnd(startPos.offsetNode, startPos.offset); // or startRange.collapse(true);

                    endRange = document.createRange();
                    // Set both start and end to the same point
                    endRange.setStart(endPos.offsetNode, endPos.offset);
                    endRange.setEnd(endPos.offsetNode, endPos.offset); // or endRange.collapse(true);

                    // Now startRange and endRange are Range objects, just like before,
                    // representing the caret positions closest to the start/end coordinates.

                } catch (e) {
                    // Keep a general catch block for any unexpected errors during range creation etc.
                    console.error("CS: Error processing caret positions or creating ranges", e);
                    continue; // Skip this rectangle on other errors
                }


                if (startRange && endRange) {
                    // Create a new range covering the intersection
                    const selectedRange = document.createRange();

                    // --- Crucial Validation ---
                    // Ensure the points landed within the *current* text node or its children
                    // This check might be too restrictive if caretRange lands slightly outside,
                    // but helps prevent grabbing text from adjacent nodes accidentally.
                    // A simpler check: are containers the same text node?
                    if (startRange.startContainer === node && endRange.startContainer === node) {
                         // Common case: both points land within the same text node
                         selectedRange.setStart(node, startRange.startOffset);
                         selectedRange.setEnd(node, endRange.startOffset); // Use startOffset from endRange
                    }
                    else {
                         // More complex case: points might land in different nodes if near boundary,
                         // or if the intersection spans elements inside the main node (unlikely for pure text nodes).
                         // We'll try setting boundaries directly, but prioritize the current node.
                         // If the container isn't our node, maybe take offset 0 or node.length?

                         // Simplified: Only proceed if *both* containers seem related to our node.
                         // A truly robust solution here is very complex. Let's stick to the common case.
                         // If containers differ, we likely have an edge case or error.
                         console.warn("CS: Start/End containers differ or not the current node. Skipping fragment.", node, startRange.startContainer, endRange.startContainer);
                         continue; // Skip this fragment for now
                    }


                    // Ensure start does not come after end
                    if (!selectedRange.collapsed) { // Check if start <= end implicitly
                        const extractedSubstring = selectedRange.toString();
                        if (extractedSubstring.trim() !== '') {
                             fragments.push({
                                 text: extractedSubstring,
                                 // Store the viewport rect of the *text node part* for sorting
                                 rect: { top: nodeViewportRect.top, left: nodeViewportRect.left, bottom: nodeViewportRect.bottom, right: nodeViewportRect.right }
                             });
                        }
                    }
                     selectedRange.detach();
                }
                 // Detach temporary ranges if they exist
                 // Note: Ranges created by caretRangeFromPoint might not need explicit detach
            }
        }
        range.detach(); // Clean up main node range
    }

    if (fragments.length === 0) {
        return "";
    }

    // Sort fragments based on VIEWPORT coordinates
    fragments.sort((a, b) => {
        if (Math.abs(a.rect.top - b.rect.top) > LINE_BREAK_THRESHOLD_VERTICAL) {
            return a.rect.top - b.rect.top;
        } else {
            return a.rect.left - b.rect.left;
        }
    });

    // Merge fragments (logic remains similar, using viewport rects now)
    let extractedText = "";
    let lastFragBottom = -Infinity;

    fragments.forEach((frag, index) => {
        // Check for newline based on vertical gap
        if (index > 0) {
             const prevFrag = fragments[index - 1];
             // Use bottom of previous rect for better line grouping check
             if (frag.rect.top > (prevFrag.rect.bottom - LINE_BREAK_THRESHOLD_VERTICAL / 2) && // Vertically distinct enough
                 frag.rect.top - prevFrag.rect.bottom > LINE_BREAK_THRESHOLD_VERTICAL) // Significantly lower
             {
                 extractedText += "\n";
             }
             // Check for space based on horizontal gap on same visual line
             else if (Math.abs(frag.rect.top - prevFrag.rect.top) <= LINE_BREAK_THRESHOLD_VERTICAL) { // Same line check
                 if (frag.rect.left > prevFrag.rect.right + 1) { // Horizontal gap (tolerance 1px)
                    // Avoid double spaces if previous already ends with one
                    if (!extractedText.endsWith(' ') && !extractedText.endsWith('\n')) {
                         extractedText += " ";
                    }
                 }
             }
        }

        extractedText += frag.text; // Add the extracted substring
        lastFragBottom = Math.max(lastFragBottom, frag.rect.bottom); // Update for next iteration
    });

    console.log("CS Extracted (partial):", extractedText.substring(0,100) + "...");
    return extractedText; // No final trim needed as fragments should be precise
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