const activeTabs = new Set();
const selectingFrame = {};

chrome.action.onClicked.addListener((tab) => {
    const tabId = tab.id;
    if (!tabId || !tab.url || !(tab.url.startsWith('http') || tab.url.startsWith('file'))) {
        console.log("BG: Cannot activate on this page.", tab.url);
        return;
    }

    if (activeTabs.has(tabId)) {
        activeTabs.delete(tabId);
        delete selectingFrame[tabId];
        chrome.tabs.sendMessage(tabId, { action: "setSelectionAvailability", available: false })
            .catch(err => console.log("BG: Error sending setSelectionAvailability(false)", err));
        console.log(`BG: Disabled selection availability for tab ${tabId}`);
    } else {
        activeTabs.add(tabId);
        chrome.tabs.sendMessage(tabId, { action: "setSelectionAvailability", available: true })
            .catch(err => console.log("BG: Error sending setSelectionAvailability(true)", err));
        console.log(`BG: Enabled selection availability for tab ${tabId}`);
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;

    if (!tabId) return;

    if (request.action === "frameStartedSelection") {
        if (selectingFrame[tabId] === undefined) {
            selectingFrame[tabId] = frameId;
            console.log(`BG: Frame ${frameId} in tab ${tabId} started selection.`);
            chrome.tabs.sendMessage(tabId, { action: "disableOtherMouseDowns", selectingFrameId: frameId })
                .catch(err => console.log("BG: Error sending disableOtherMouseDowns", err));
            sendResponse({ canProceed: true });
        } else {
            console.log(`BG: Frame ${frameId} tried to start selection in tab ${tabId}, but frame ${selectingFrame[tabId]} is already active.`);
            sendResponse({ canProceed: false });
        }
         return true;

    } else if (request.action === "frameEndedSelection") {
        console.log(`BG: Frame ${frameId} in tab ${tabId} ended selection.`);
        delete selectingFrame[tabId];
        activeTabs.delete(tabId);
        chrome.tabs.sendMessage(tabId, { action: "setSelectionAvailability", available: false })
             .catch(err => console.log("BG: Error sending setSelectionAvailability(false) after end", err));

    } else if (request.action === "frameCancelledSelection") {
         console.log(`BG: Frame ${frameId} in tab ${tabId} cancelled selection.`);
         delete selectingFrame[tabId];
          if (!activeTabs.has(tabId)) {
              chrome.tabs.sendMessage(tabId, { action: "setSelectionAvailability", available: false })
                 .catch(err => console.log("BG: Error confirming setSelectionAvailability(false) after cancel", err));
          }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabs.delete(tabId);
    delete selectingFrame[tabId];
     console.log(`BG: Cleaned up state for closed tab ${tabId}`);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        activeTabs.delete(tabId);
        delete selectingFrame[tabId];
    }
});


console.log("Freeform Text Copy Background Script Loaded (v1.3 - Active Frame)");