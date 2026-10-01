// Serialize each tab's read/modify/write operations. State itself survives worker restarts.
const tabQueues = new Map();

function withTabState(tabId, operation) {
    const key = `selection-tab-${tabId}`;
    const task = (tabQueues.get(tabId) || Promise.resolve()).then(async () => {
        const stored = await chrome.storage.session.get(key);
        return operation(stored[key] || { enabled: false, selection: null }, key);
    });
    const settled = task.catch(error => console.error('Freeform Copy: tab state update failed', error));
    tabQueues.set(tabId, settled);
    settled.then(() => {
        if (tabQueues.get(tabId) === settled) tabQueues.delete(tabId);
    });
    return task;
}

async function broadcast(tabId, message) {
    try {
        await chrome.tabs.sendMessage(tabId, message);
        return true;
    } catch {
        // Restricted pages and unloading documents may have no content script.
        return false;
    }
}

chrome.action.onClicked.addListener(tab => {
    if (tab.id === undefined || !/^(https?|file):/.test(tab.url || '')) return;
    return withTabState(tab.id, async (state, key) => {
        const enabled = !state.enabled;
        await chrome.storage.session.set({ [key]: { enabled, selection: null } });
        const delivered = await broadcast(tab.id, { action: 'setSelectionAvailability', available: enabled });
        if (!delivered) await chrome.storage.session.remove(key);
    }).catch(() => {});
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    const actions = ['frameStartedSelection', 'frameEndedSelection', 'frameCancelledSelection', 'getSelectionAvailability'];
    if (tabId === undefined || frameId === undefined || !actions.includes(request.action)) return;

    withTabState(tabId, async (state, key) => {
        if (request.action === 'getSelectionAvailability') {
            return { available: state.enabled, busy: !!state.selection };
        }
        if (typeof request.requestId !== 'string' || !request.requestId) return { canProceed: false };
        if (request.action === 'frameStartedSelection') {
            if (!state.enabled || state.selection) return { canProceed: false };
            state.selection = { frameId, documentId: sender.documentId || null, requestId: request.requestId };
            await chrome.storage.session.set({ [key]: state });
            await broadcast(tabId, {
                action: 'disableOtherMouseDowns', selectingRequestId: request.requestId
            });
            return { canProceed: true };
        }

        const owner = state.selection;
        if (!owner || owner.frameId !== frameId || owner.requestId !== request.requestId ||
            owner.documentId !== (sender.documentId || null)) return { accepted: false };

        state.selection = null;
        if (request.action === 'frameEndedSelection') state.enabled = false;
        await chrome.storage.session.set({ [key]: state });
        await broadcast(tabId, { action: 'setSelectionAvailability', available: state.enabled });
        return { accepted: true };
    }).then(sendResponse, () => sendResponse({ canProceed: false, accepted: false }));
    return true;
});

function clearTab(tabId) {
    return withTabState(tabId, async (_state, key) => {
        await chrome.storage.session.remove(key);
    }).catch(() => {});
}

chrome.tabs.onRemoved.addListener(clearTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') clearTab(tabId);
});
