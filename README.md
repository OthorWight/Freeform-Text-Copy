# Freeform Text Copy

A Chrome extension that copies text from a rectangular area of a webpage. Click the extension icon, draw a box, and copy the text inside it—useful for tables, columns, and layouts that are awkward to select normally.

## Features

- Select text by dragging a rectangle over the page.
- Copy the selected text directly to your clipboard.
- Optionally preserve visual spacing for columns and tables.
- Select text inside iframes, including cross-origin frames. Each selection stays within the frame where it starts.
- Cancel a selection with **Escape**.

## Installation

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/dfngjfboeobeiplbhcajljldomfpabac).

Requires Chrome 102 or later.

To install from source:

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder.

## Usage

1. Open a webpage and click **Freeform Text Copy** in the toolbar or extensions menu.
2. Click and drag a rectangle over the text you want.
3. Release the mouse button to copy it, then paste it wherever you need.

Hold **Alt** while selecting to preserve spacing temporarily. To enable this by default, open the extension's **Options** and check **Preserve page layout (columns / spacing)**. Spacing is approximated using spaces, so a monospace font works best when viewing the result.

Press **Escape** to cancel a drag. Click the extension icon again to start another selection or turn selection mode off.

The extension copies webpage text; it does not perform OCR on images. Local files require **Allow access to file URLs** in the extension's details.

## Development

The extension uses plain JavaScript, HTML, and CSS, with no build step or npm dependencies. After editing extension files, click **Reload** on its card at `chrome://extensions` and refresh the webpage.

### Local demo

With Python 3 and Chromium installed, run:

```sh
python3 try.py
```

This opens Chromium with the local extension loaded and a practice page containing columns, a table, an iframe, and a paste box. Activate the extension from the extensions menu, then drag over the sample text. Close the browser or press **Ctrl+C** to stop; the temporary browser profile is removed on exit.

To use your own browser instead:

```sh
python3 try.py --serve-only
```

Load the extension using the source installation steps above, then open the practice URL printed in the terminal.

### Tests

With Python 3 and Chromium installed, run:

```sh
python3 tests/run.py
```

The suite covers text extraction, selection state, clipboard copying, and frame messaging. No additional Python packages are needed.

## Contributing

Bug reports and pull requests are welcome. For selection issues, include steps to reproduce and a sample page or HTML snippet when possible. Run the regression suite before submitting code changes.

## License

[GNU Affero General Public License v3.0](LICENSE).
