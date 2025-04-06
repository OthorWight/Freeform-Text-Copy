// Keep track of which tab has selection mode enabled globally
const activeTabs = new Set();
// Keep track of which frame is *currently* performing a selection drag
const selectingFrame = {}; // { tabId: frameId }

// --- Action Button Click ---
chrome.action.onClicked.addListener((tab) => {
    const tabId = tab.id;
    if (!tabId || !tab.url || !(tab.url.startsWith('http') || tab.url.startsWith('file'))) {
        console.log("BG: Cannot activate on this page.", tab.url);
        return;
    }

    // Toggle the global selection availability for this tab
    if (activeTabs.has(tabId)) {
        // Turn Off
        activeTabs.delete(tabId);
        delete selectingFrame[tabId]; // Clear any active selection state
        chrome.tabs.sendMessage(tabId, { action: "setSelectionAvailability", available: false })
            .catch(err => console.log("BG: Error sending setSelectionAvailability(false)", err));
        console.log(`BG: Disabled selection availability for tab ${tabId}`);
    } else {
        // Turn On
        activeTabs.add(tabId);
        chrome.tabs.sendMessage(tabId, { action: "setSelectionAvailability", available: true })
            .catch(err => console.log("BG: Error sending setSelectionAvailability(true)", err));
        console.log(`BG: Enabled selection availability for tab ${tabId}`);
    }
});

// --- Listen for Messages from Content Scripts ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;

    if (!tabId) return; // Ignore messages without tab context

    if (request.action === "frameStartedSelection") {
        // A frame has captured the mousedown and started dragging
        if (selectingFrame[tabId] === undefined) { // Check if another frame hasn't already started
            selectingFrame[tabId] = frameId;
            console.log(`BG: Frame ${frameId} in tab ${tabId} started selection.`);
            // Tell all *other* frames in this tab to temporarily ignore mousedown
            chrome.tabs.sendMessage(tabId, { action: "disableOtherMouseDowns", selectingFrameId: frameId })
                .catch(err => console.log("BG: Error sending disableOtherMouseDowns", err));
            sendResponse({ canProceed: true });
        } else {
            // Another frame is already selecting, tell this one it can't proceed
            console.log(`BG: Frame ${frameId} tried to start selection in tab ${tabId}, but frame ${selectingFrame[tabId]} is already active.`);
            sendResponse({ canProceed: false });
        }
         return true; // Indicates async response

    } else if (request.action === "frameEndedSelection") {
        // The frame that was selecting has finished (mouseup)
        console.log(`BG: Frame ${frameId} in tab ${tabId} ended selection.`);
        // Clear the active frame lock for this tab
        delete selectingFrame[tabId];
        // Make selection mode globally unavailable until icon is clicked again
        activeTabs.delete(tabId);
        chrome.tabs.sendMessage(tabId, { action: "setSelectionAvailability", available: false })
             .catch(err => console.log("BG: Error sending setSelectionAvailability(false) after end", err));
        // No response needed

    } else if (request.action === "frameCancelledSelection") {
         // The frame cancelled mid-drag or had tiny selection
         console.log(`BG: Frame ${frameId} in tab ${tabId} cancelled selection.`);
         delete selectingFrame[tabId];
         // Re-enable mousedown listeners in other frames IF global mode is still technically active
         // However, current logic turns global off on mouseup/cancel, so just ensure state is clean.
         // If we wanted immediate re-selection without icon click, we'd need different logic here.
          if (!activeTabs.has(tabId)) { // If global was already turned off (e.g., by icon click during drag)
              chrome.tabs.sendMessage(tabId, { action: "setSelectionAvailability", available: false })
                 .catch(err => console.log("BG: Error confirming setSelectionAvailability(false) after cancel", err));
          }
         // No response needed
    }
});

// --- Tab Closure Cleanup ---
chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabs.delete(tabId);
    delete selectingFrame[tabId];
     console.log(`BG: Cleaned up state for closed tab ${tabId}`);
});


console.log("Freeform Text Copy Background Script Loaded (v1.3 - Active Frame)");