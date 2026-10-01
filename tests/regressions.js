const results = [];
function assert(condition, message = 'Assertion failed') { if (!condition) throw new Error(message); }
function equal(actual, expected) { assert(actual === expected, `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
async function test(name, fn) {
    try {
        const detail = await fn();
        results.push({ name, passed: true, ...(detail === undefined ? {} : { detail }) });
    } catch (error) { results.push({ name, passed: false, error: error.stack }); }
}
function fixture(html = '', bodyStyle = '') {
    makeSelectionUnavailable();
    document.body.innerHTML = html;
    document.body.style.cssText = 'margin:0;font:16px/24px monospace;' + bodyStyle;
    mockMessages.length = 0;
    mockStartResponder = () => Promise.resolve({ canProceed: true });
}
function textRect(node, start = 0, end = node.length) {
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, end);
    return range.getBoundingClientRect();
}
function around(r) { return makeRect(r.left - 1, r.top - 1, r.right + 1, r.bottom + 1); }
function mouse(type, x = 40, y = 40) {
    return new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
}
async function startDrag(x = 40, y = 40) {
    makeSelectionAvailable();
    document.body.dispatchEvent(mouse('mousedown', x, y));
    await Promise.resolve();
}

async function run() {
    await test('all JavaScript parses', () => { for (const source of Object.values(sources)) new Function(source); });
    await test('plain text', () => {
        fixture('<div style="position:absolute;left:40px;top:40px">Hello world</div>');
        equal(extractTextInBox(around(textRect(document.body.firstChild.firstChild))), 'Hello world');
    });
    await test('partial text selection', () => {
        fixture('<div style="position:absolute;left:40px;top:40px">ABCDEFGHIJKLMNO</div>');
        equal(extractTextInBox(textRect(document.body.firstChild.firstChild, 3, 6)), 'DEF');
    });
    await test('spaces before inline formatting', () => {
        fixture('<div style="position:absolute;left:40px;top:40px">Hello <b>world</b></div>');
        equal(extractTextInBox(makeRect(30, 30, 240, 80)), 'Hello world');
    });
    await test('spaces after inline formatting', () => {
        fixture('<div style="position:absolute;left:40px;top:40px"><b>Hello</b> world</div>');
        equal(extractTextInBox(makeRect(30, 30, 240, 80)), 'Hello world');
    });
    await test('whitespace-only node between inline elements', () => {
        fixture('<div style="position:absolute;left:40px;top:40px"><span>Hello</span> <span>world</span></div>');
        equal(extractTextInBox(makeRect(30, 30, 240, 80)), 'Hello world');
    });
    await test('wrapped line extraction', () => {
        fixture('<div style="position:absolute;left:40px;top:40px;width:100px;word-break:break-all">ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>');
        const node = document.body.firstChild.firstChild;
        const range = document.createRange(); range.selectNodeContents(node);
        const line = range.getClientRects()[1];
        let expected = '';
        for (let index = 0; index < node.length; index++) {
            if (Math.abs(textRect(node, index, index + 1).top - line.top) < 1) expected += node.data[index];
        }
        equal(extractTextInBox(makeRect(line.left, line.top, line.right, line.bottom)), expected);
    });
    await test('partial shadow-DOM text', () => {
        fixture('<div id="host" style="position:absolute;left:40px;top:40px"></div>');
        const root = document.getElementById('host').attachShadow({ mode: 'open' });
        root.innerHTML = '<span>ABCDEFGHIJKLMNO</span>';
        equal(extractTextInBox(textRect(root.firstChild.firstChild, 3, 6)), 'DEF');
    });
    await test('nested shadow-DOM text', () => {
        fixture('<div id="host" style="position:absolute;left:40px;top:40px"></div>');
        const outer = document.getElementById('host').attachShadow({ mode: 'open' });
        const host = document.createElement('span'); outer.appendChild(host);
        const inner = host.attachShadow({ mode: 'open' }); inner.textContent = 'ABCDEFGHIJKLMNO';
        equal(extractTextInBox(textRect(inner.firstChild, 3, 6)), 'DEF');
    });
    await test('geometry fallback without caret APIs', () => {
        fixture('<div style="position:absolute;left:40px;top:40px">ABCDEFGHIJKLMNO</div>');
        const position = document.caretPositionFromPoint, caretRange = document.caretRangeFromPoint;
        const rect = textRect(document.body.firstChild.firstChild, 3, 6);
        document.caretPositionFromPoint = document.caretRangeFromPoint = undefined;
        try { equal(extractTextInBox(rect), 'DEF'); }
        finally { document.caretPositionFromPoint = position; document.caretRangeFromPoint = caretRange; }
    });
    await test('horizontal overflow clipping', () => {
        fixture('<div style="position:absolute;left:40px;top:40px;width:40px;overflow:hidden;white-space:nowrap">ABCDEFGHIJKLMNO</div>');
        equal(extractTextInBox(makeRect(90, 35, 190, 70)), '');
        equal(extractTextInBox(makeRect(30, 35, 190, 70)), 'ABCD');
    });
    await test('vertical overflow clipping', () => {
        fixture('<div style="position:absolute;left:40px;top:40px;height:24px;overflow:hidden">first<br>hidden</div>');
        equal(extractTextInBox(makeRect(30, 30, 190, 100)), 'first');
    });
    await test('visible descendants of a hidden ancestor', () => {
        fixture('<div style="position:absolute;left:40px;top:40px;visibility:hidden"><span style="visibility:visible">Visible A</span><span style="visibility:visible">Visible B</span></div>');
        equal(extractTextInBox(makeRect(30, 30, 260, 80)), 'Visible AVisible B');
    });
    await test('ancestor opacity remains hidden', () => {
        fixture('<div style="position:absolute;left:40px;top:40px;opacity:0"><span style="opacity:1">Hidden</span></div>');
        equal(extractTextInBox(makeRect(30, 30, 260, 80)), '');
        document.body.style.opacity = '0';
        equal(extractTextInBox(makeRect(30, 30, 260, 80)), '');
    });
    await test('preserve-layout indentation', () => {
        fixture('<div style="position:absolute;left:40px;top:40px">A</div><div style="position:absolute;left:140px;top:70px">B</div>');
        const lines = extractTextInBox(makeRect(30, 30, 200, 110), 5, true).split('\n');
        equal(lines.length, 2);
        assert(lines[1].indexOf('B') > lines[0].indexOf('A') + 8, JSON.stringify(lines));
    });
    await test('row grouping uses a consistent reading order', () => {
        const fragments = [
            { text: 'A', rect: makeRect(200, 0, 210, 20) },
            { text: 'B', rect: makeRect(100, 8, 110, 28) },
            { text: 'C', rect: makeRect(0, 16, 10, 36) }
        ];
        equal(mergeTextFragments(fragments, makeRect(0, 0, 300, 100), 5, false), 'B A\nC');
    });
    await test('edited form values', () => {
        fixture('<input value="Original input" style="position:absolute;left:40px;top:40px"><textarea style="position:absolute;left:40px;top:90px">Original textarea</textarea>');
        document.querySelector('input').value = 'Edited input';
        document.querySelector('textarea').value = 'Edited textarea';
        equal(extractTextInBox(makeRect(30, 30, 400, 150)), 'Edited input\nEdited textarea');
    });
    await test('partial input value', () => {
        fixture('<input value="ABCDEFGHIJK" style="position:absolute;left:40px;top:40px;width:200px;height:30px;padding:0;border:0;font:16px/24px monospace">');
        const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
        context.font = '16px monospace'; const width = context.measureText('A').width;
        equal(extractTextInBox(makeRect(40 + 3 * width, 40, 40 + 6 * width, 70)), 'DEF');
    });
    await test('textarea line breaks', () => {
        fixture('<textarea style="position:absolute;left:40px;top:40px;width:200px;height:100px">first\nsecond</textarea>');
        equal(extractTextInBox(makeRect(30, 30, 300, 150)), 'first\nsecond');
    });
    await test('password and hidden inputs excluded', () => {
        fixture('<input type="password" value="secret"><input type="hidden" value="hidden">');
        equal(extractTextInBox(makeRect(0, 0, 400, 200)), '');
    });
    await test('selected option text', () => {
        fixture('<select style="position:absolute;left:40px;top:40px"><option>Other</option><option selected>Selected</option></select>');
        equal(extractTextInBox(makeRect(30, 30, 300, 100)), 'Selected');
    });
    await test('overlay coordinates ignore body positioning and transforms', () => {
        fixture('', 'position:relative;margin:50px;transform:translate(20px,30px);');
        initSelectionBox();
        Object.assign(selectionBox.style, { display: 'block', left: '100px', top: '100px', width: '100px', height: '100px' });
        const r = selectionBox.getBoundingClientRect(); equal(r.left, 100); equal(r.top, 100);
    });
    await test('mousedown is suppressed synchronously', async () => {
        fixture(); let received = 0;
        document.body.addEventListener('mousedown', () => received++);
        makeSelectionAvailable(); const event = mouse('mousedown'); document.body.dispatchEvent(event);
        assert(event.defaultPrevented); equal(received, 0);
        await Promise.resolve(); cancelSelectionDrag(true);
    });
    await test('release before confirmation cannot start a stale drag', async () => {
        fixture(); let resolve;
        mockStartResponder = () => new Promise(r => resolve = r);
        makeSelectionAvailable(); document.body.dispatchEvent(mouse('mousedown'));
        document.body.dispatchEvent(mouse('mouseup'));
        resolve({ canProceed: true }); await Promise.resolve();
        assert(!isDragging && !isCurrentlySelectingInThisFrame && canThisFrameListenForMouseDown);
        assert(mockMessages.some(m => m.action === 'frameCancelledSelection'));
    });
    await test('disable invalidates a pending drag', async () => {
        fixture(); let resolve;
        mockStartResponder = () => new Promise(r => resolve = r);
        makeSelectionAvailable(); document.body.dispatchEvent(mouse('mousedown'));
        makeSelectionUnavailable(); resolve({ canProceed: true }); await Promise.resolve();
        assert(!isDragging && !isCurrentlySelectingInThisFrame && !isSelectionAvailableGlobally);
    });
    await test('old confirmation cannot affect a newer drag', async () => {
        fixture(); let resolveOld;
        mockStartResponder = () => new Promise(resolve => resolveOld = resolve);
        makeSelectionAvailable(); document.body.dispatchEvent(mouse('mousedown'));
        document.body.dispatchEvent(mouse('mouseup'));
        mockStartResponder = () => Promise.resolve({ canProceed: true });
        await startDrag(); const current = selectionRequest;
        resolveOld({ canProceed: false }); await Promise.resolve();
        assert(isDragging && selectionRequest === current && current.confirmed); cancelSelectionDrag(true);
    });
    await test('zero-distance click cancels and rearms', async () => {
        fixture(); await startDrag(); document.body.dispatchEvent(mouse('mouseup'));
        assert(!isDragging && canThisFrameListenForMouseDown && isSelectionAvailableGlobally);
        equal(mockMessages.at(-1).action, 'frameCancelledSelection');
        await startDrag(); assert(isDragging); cancelSelectionDrag(true);
    });
    await test('Escape cancels and rearms', async () => {
        fixture(); await startDrag();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        assert(!isDragging && canThisFrameListenForMouseDown); equal(mockMessages.at(-1).action, 'frameCancelledSelection');
    });
    await test('blur cancels and rearms', async () => {
        fixture(); await startDrag(); window.dispatchEvent(new Event('blur'));
        assert(!isDragging && canThisFrameListenForMouseDown); equal(mockMessages.at(-1).action, 'frameCancelledSelection');
    });
    await test('completion uses release coordinates even without mousemove', async () => {
        fixture('<div style="position:absolute;left:40px;top:40px">Hello world</div>');
        const original = copyToClipboard; let copied;
        copyToClipboard = async text => { copied = text; };
        try {
            await startDrag(30, 30); document.body.dispatchEvent(mouse('mouseup', 230, 90)); await Promise.resolve();
            equal(copied, 'Hello world'); assert(!isDragging && !isCurrentlySelectingInThisFrame);
            equal(mockMessages.at(-1).action, 'frameEndedSelection');
        } finally { copyToClipboard = original; }
    });
    await test('extraction exception still releases the lock', async () => {
        fixture(); const original = extractTextInBox;
        extractTextInBox = () => { throw new Error('injected failure'); };
        try {
            await startDrag(30, 30); document.body.dispatchEvent(mouse('mouseup', 230, 90));
            assert(!isCurrentlySelectingInThisFrame && !isDragging); equal(mockMessages.at(-1).action, 'frameEndedSelection');
        } finally { extractTextInBox = original; }
    });
    await test('selection click cannot activate page controls', async () => {
        fixture('<button>Page action</button>'); let clicked = 0;
        document.body.firstChild.addEventListener('click', () => clicked++);
        await startDrag(); document.body.dispatchEvent(mouse('mouseup'));
        document.body.firstChild.dispatchEvent(mouse('click'));
        equal(clicked, 0);
    });
    await test('HTTP clipboard fallback copies exact text and restores focus/selection', async () => {
        fixture('<input value="selection">'); const input = document.querySelector('input');
        input.focus(); input.setSelectionRange(1, 4);
        const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const exec = document.execCommand; let copied;
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        document.execCommand = command => { equal(command, 'copy'); copied = overlayRoot.activeElement.value; return true; };
        try {
            await copyToClipboard('exact\ntext'); equal(copied, 'exact\ntext'); equal(document.activeElement, input);
            equal(input.selectionStart, 1); equal(input.selectionEnd, 4); equal(document.querySelectorAll('textarea').length, 0);
        } finally {
            document.execCommand = exec;
            if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor); else delete navigator.clipboard;
        }
    });
    await test('clipboard fallback after rejected native write', async () => {
        fixture(); const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard'); const exec = document.execCommand;
        let copied = false;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
        document.execCommand = () => { copied = true; return true; };
        try { await copyToClipboard('text'); assert(copied); }
        finally { document.execCommand = exec; if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor); else delete navigator.clipboard; }
    });
    await test('denied frame stays disabled while another frame selects', async () => {
        fixture(); let resolve;
        mockStartResponder = () => new Promise(r => resolve = r);
        makeSelectionAvailable(); document.body.dispatchEvent(mouse('mousedown'));
        contentMessageListener({ action: 'disableOtherMouseDowns', selectingRequestId: 'another-frame' });
        resolve({ canProceed: false }); await Promise.resolve();
        assert(!isDragging && !canThisFrameListenForMouseDown);
        contentMessageListener({ action: 'setSelectionAvailability', available: true });
        assert(canThisFrameListenForMouseDown);
    });
    await test('worker restart preserves toolbar toggle state', async () => {
        const storage = {}; let bg = createBackground(storage);
        await bg.handlers.click({ id: 1, url: 'https://example.test' });
        bg = createBackground(storage); await bg.handlers.click({ id: 1, url: 'https://example.test' });
        equal(bg.broadcasts.at(-1).message.available, false);
    });
    await test('inactive tab rejects frame starts', async () => {
        const bg = createBackground(); equal((await bg.message('frameStartedSelection', 'one')).canProceed, false);
    });
    await test('cancelled frame broadcasts recovery and permits another drag', async () => {
        const bg = createBackground(); await bg.handlers.click({ id: 1, url: 'https://example.test' });
        assert((await bg.message('frameStartedSelection', 'one')).canProceed);
        await bg.message('frameCancelledSelection', 'one'); equal(bg.broadcasts.at(-1).message.available, true);
        assert((await bg.message('frameStartedSelection', 'two', 2)).canProceed);
    });
    await test('stale and foreign-frame endings cannot release another drag', async () => {
        const bg = createBackground(); await bg.handlers.click({ id: 1, url: 'https://example.test' });
        await bg.message('frameStartedSelection', 'one');
        equal((await bg.message('frameEndedSelection', 'old')).accepted, false);
        equal((await bg.message('frameEndedSelection', 'one', 2)).accepted, false);
        equal((await bg.message('frameEndedSelection', 'one', 0, 'different-document')).accepted, false);
        equal((await bg.message('frameStartedSelection', 'two', 2)).canProceed, false);
    });
    await test('simultaneous frame starts have one winner', async () => {
        const bg = createBackground(); await bg.handlers.click({ id: 1, url: 'https://example.test' });
        const replies = await Promise.all([bg.message('frameStartedSelection', 'one'), bg.message('frameStartedSelection', 'two', 2)]);
        equal(replies.filter(reply => reply.canProceed).length, 1);
    });
    await test('frame ownership works before documentId was introduced', async () => {
        const bg = createBackground(); await bg.handlers.click({ id: 1, url: 'https://example.test' });
        const message = action => new Promise(resolve => bg.handlers.message({ action, requestId: 'one' }, { tab: { id: 1 }, frameId: 0 }, resolve));
        assert((await message('frameStartedSelection')).canProceed);
        assert((await message('frameEndedSelection')).accepted);
    });
    await test('frame lock survives worker restart', async () => {
        const storage = {}; let bg = createBackground(storage);
        await bg.handlers.click({ id: 1, url: 'https://example.test' }); await bg.message('frameStartedSelection', 'one');
        bg = createBackground(storage); equal((await bg.message('frameStartedSelection', 'two', 2)).canProceed, false);
        assert((await bg.message('frameCancelledSelection', 'one')).accepted);
    });
    await test('failed activation delivery does not leave an active tab', async () => {
        const bg = createBackground(); bg.api.tabs.sendMessage = async () => { throw new Error('no receiver'); };
        await bg.handlers.click({ id: 1, url: 'https://example.test' });
        equal((await bg.message('getSelectionAvailability')).available, false);
    });
    await test('tab closure clears persisted state', async () => {
        const bg = createBackground(); await bg.handlers.click({ id: 1, url: 'https://example.test' });
        await bg.handlers.remove(1); equal((await bg.message('getSelectionAvailability')).available, false);
    });
    await test('tiny selection prunes a 50,000-node document', () => {
        fixture('<div>row content</div>'.repeat(50000)); document.body.getBoundingClientRect();
        const original = window.getComputedStyle; let styleChecks = 0;
        window.getComputedStyle = (...args) => { styleChecks++; return original(...args); };
        const start = performance.now();
        try { equal(extractTextInBox(makeRect(0, 0, 200, 24)), 'row content'); }
        finally { window.getComputedStyle = original; }
        assert(styleChecks < 20, `Performed ${styleChecks} computed-style checks`);
        return `${Math.round(performance.now() - start)} ms; ${styleChecks} computed-style checks`;
    });
    fixture(); clearTimeout(messageTimeout);
    const output = document.createElement('pre'); output.id = 'test-results';
    output.textContent = JSON.stringify(results); document.body.replaceChildren(output);
}
run().catch(error => {
    const output = document.createElement('pre'); output.id = 'test-results';
    output.textContent = JSON.stringify([{ name: 'test runner', passed: false, error: error.stack }]); document.body.replaceChildren(output);
});
