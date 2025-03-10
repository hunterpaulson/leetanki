# LeetAnki - LeetCode Spaced Repetition

A Chrome extension that implements spaced repetition learning for LeetCode problems.

## Features

- Track completed LeetCode problems
- Apply spaced repetition algorithms to recommend review problems
- Provide problem recommendations based on your learning needs
- Set reminders for reviewing problems at optimal intervals

## Installation (Development Mode)

1. Clone this repository:
   """
   git clone https://github.com/yourusername/leetanki.git
   cd leetanki
   """

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" by toggling the switch in the top right corner

4. Click "Load unpacked" and select the `leetanki` directory

5. The extension should now be installed and visible in your Chrome toolbar

## Usage

1. Log in to your LeetCode account at [leetcode.com](https://leetcode.com)
2. Click on the LeetAnki extension icon in your toolbar
3. Your completed problems will be automatically synchronized
4. Follow the recommended problems for review based on the spaced repetition algorithm

## Development

### Project Structure

"""
leetanki/
├── manifest.json         # Extension configuration
├── background.js         # Background service worker
├── popup/                # Extension popup UI
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content/              # Content scripts for LeetCode pages
│   └── content.js
└── assets/               # Images and other assets
    └── icon.png (in various sizes)
"""

### Current Status

This project is under active development. Current implemented features:

- Basic extension structure
- Authentication detection on LeetCode
- Popup UI framework

## License

This project is licensed under the MIT License - see the LICENSE file for details. 