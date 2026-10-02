# Freeform-Text-Copy

A Chrome extension allowing you to copy text from any rectangular area on a webpage by simply clicking and dragging. Useful for complex layouts, tables, or areas where standard text selection is difficult or doesn't capture the desired content accurately.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/dfngjfboeobeiplbhcajljldomfpabac)**

Click the extension icon, then drag a rectangle over the text to copy. Hold **Alt** to preserve spacing temporarily, or enable it in the extension options. Press **Escape** to cancel. Requires Chrome 102 or later.

Package the extension for the Chrome Web Store with Python 3 (no extra dependencies):

```sh
python3 package.py
```

This creates `dist/freeform-text-copy-<version>.zip`, using the version in `manifest.json`. It includes the extension files and license, with `manifest.json` at the ZIP root, and excludes tests, demos, and development files. The script works from any working directory when invoked by its path. If you add extension assets, update `PACKAGE_FILES` in `package.py`.

Upload the ZIP in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). For an update to an existing listing, increase `version` in `manifest.json` before packaging. See Chrome's [publishing instructions](https://developer.chrome.com/docs/webstore/publish) for the remaining listing and review steps.

Try the local version with Python 3 and Chromium installed:

```sh
python3 try.py
```

This opens a separate Chromium window with the extension loaded and a practice page containing columns, a table, an iframe, and a paste box. Open the puzzle-piece menu and click **Freeform Text Copy**, then drag over the sample text. Close the window or press Ctrl+C in the terminal to stop. The temporary browser profile is removed on exit.

To use your own Chrome browser, run `python3 try.py --serve-only`. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this repository folder. Then visit the practice URL printed in the terminal. After changing extension files, click **Reload** on its extension card and refresh the practice page.

Run the regression suite with Python 3 and Chromium installed:

```sh
python3 tests/run.py
```

The suite checks text extraction and selection state, then loads a temporary extension copy to verify native clipboard copying and frame messaging on an HTTP page.

Version 2.0.1 removes the unused `scripting` permission reported in the Chrome Web Store rejection and removes `activeTab` by activating selection with only the tab ID. The remaining access is used as follows:

| Access | Purpose |
| --- | --- |
| `clipboardWrite` | Copies the selected text, including the clipboard fallback on HTTP pages. |
| `storage` | Saves the layout preference in `storage.sync` and coordinates per-tab selection and frame ownership in `storage.session`. |
| Content scripts matching `<all_urls>` with `all_frames` | Supports selecting text on arbitrary webpages and in cross-origin frames. Scripts wait for toolbar activation before enabling selection. Local files require the user's **Allow access to file URLs** setting. |

For resubmission, upload `dist/freeform-text-copy-2.0.1.zip` and update the dashboard's permission justifications to match this table. No `scripting`, `activeTab`, `tabs`, or clipboard-reading permission is requested by the release. The integration suite adds `clipboardRead` only to its temporary test copy so it can verify copied text.
