const mockMessages = [];
let mockStartResponder = () => Promise.resolve({ canProceed: true });
chrome.runtime = {
    sendMessage(message) {
        mockMessages.push(message);
        if (message.action === 'getSelectionAvailability') return Promise.resolve({ available: false });
        return message.action === 'frameStartedSelection' ? mockStartResponder(message) : Promise.resolve({ accepted: true });
    },
    onMessage: { addListener: fn => window.contentMessageListener = fn }
};
chrome.storage = {
    sync: { get: (defaults, cb) => cb(defaults) },
    onChanged: { addListener: () => {} }
};

function createBackground(storage = {}) {
    const handlers = {}, broadcasts = [];
    const copy = value => JSON.parse(JSON.stringify(value));
    const api = {
        storage: { session: {
            get: async key => copy({ [key]: storage[key] }),
            set: async values => Object.assign(storage, copy(values)),
            remove: async key => { delete storage[key]; }
        } },
        action: { onClicked: { addListener: fn => handlers.click = fn } },
        runtime: { onMessage: { addListener: fn => handlers.message = fn } },
        tabs: {
            sendMessage: async (tabId, message) => { broadcasts.push({ tabId, message }); },
            onRemoved: { addListener: fn => handlers.remove = fn },
            onUpdated: { addListener: fn => handlers.update = fn }
        }
    };
    new Function('chrome', sources['background.js'])(api);
    return {
        handlers, broadcasts, storage, api,
        message: (action, requestId, frameId = 0, documentId = 'doc-1') => new Promise(resolve => {
            handlers.message({ action, requestId }, { tab: { id: 1 }, frameId, documentId }, resolve);
        })
    };
}
