document.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.getElementById('preserveLayout');

    chrome.storage.sync.get({ preserveLayout: false }, (items) => {
        checkbox.checked = items.preserveLayout;
    });

    checkbox.addEventListener('change', () => {
        chrome.storage.sync.set({ preserveLayout: checkbox.checked });
    });
});