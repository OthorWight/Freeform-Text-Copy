// Runs in the same isolated world as content.js, only in a temporary test extension.
(async () => {
    const results = [];
    const output = document.createElement('pre');
    output.id = 'integration-results';
    output.style.cssText = 'position:absolute;left:0;top:200px;';
    document.body.appendChild(output);
    const check = async (name, fn) => {
        try { await fn(); results.push({ name, passed: true }); }
        catch (error) { results.push({ name, passed: false, error: error.stack }); }
        output.textContent = JSON.stringify(results);
    };
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const waitFor = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('Timed out waiting for extension state');
    };
    const activate = async () => {
        const response = await chrome.runtime.sendMessage({ action: 'testActivate' });
        expect(response?.activated, 'Could not activate selection');
    };
    const mouse = (type, x = 30, y = 30) => new MouseEvent(type, {
        button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true
    });
    const pasteAndCheck = expected => {
        const textarea = document.createElement('textarea');
        document.documentElement.appendChild(textarea);
        try {
            textarea.focus();
            expect(document.execCommand('paste'), 'Native paste failed');
            expect(textarea.value === expected, 'Clipboard contents did not match the test text');
        } finally { textarea.remove(); }
    };

    await check('installed content script runs on an insecure HTTP origin', () => {
        expect(!isSecureContext, 'Test origin was unexpectedly secure');
        expect(navigator.clipboard === undefined, 'HTTP origin unexpectedly exposed the Clipboard API');
    });
    await check('native HTTP clipboard fallback writes exact text', async () => {
        await copyToClipboard('HTTP clipboard regression\nsecond line');
        pasteAndCheck('HTTP clipboard regression\nsecond line');
    });
    await check('HTTP drag starts, copies, and releases the actual worker lock', async () => {
        await activate();
        document.body.dispatchEvent(mouse('mousedown'));
        await waitFor(() => selectionRequest?.confirmed);
        document.body.dispatchEvent(mouse('mouseup', 230, 90));
        await waitFor(() => overlayRoot.querySelector('.message')?.textContent === 'Text Copied!');
        pasteAndCheck('Hello HTTP');
        const state = await sendSelectionMessage('getSelectionAvailability');
        expect(!state.available && !state.busy && !isDragging, 'Completion left selection active');
    });
    await check('real cancellation broadcasts availability and releases the lock', async () => {
        await activate();
        document.body.dispatchEvent(mouse('mousedown'));
        await waitFor(() => selectionRequest?.confirmed);
        document.body.dispatchEvent(mouse('mouseup'));
        const state = await sendSelectionMessage('getSelectionAvailability');
        expect(state.available && !state.busy && canThisFrameListenForMouseDown, 'Cancellation did not rearm selection');
    });
    clearTimeout(messageTimeout);
    output.dataset.complete = 'true';
})();
