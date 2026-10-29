# Where U Elevate Exam: Chrome extension

Lets a candidate take a proctored exam in Chrome instead of the desktop app. The extension:

- opens an exam tab (toolbar button) for sign-in, one-time code, face check, consent, the exam itself and the receipt;
- uploads a webcam frame every 20 s, autosaves answers and sends heartbeats, like the desktop app;
- reports every visited tab and tab switch to `/proctoring/browsing-logs`;
- on AI sites, records text typed into inputs and chat boxes (on Enter, form submit, or a 2.5 s pause) and shows a notice bar;
- sends `WINDOW_BLUR` when the candidate leaves the exam tab or Chrome loses focus (at most once per 10 s).

It signs in with `channel: "web"`, and sessions keep the same OTP and face requirements as the desktop app.

## Build and load

```bash
npm run build -w apps/extension                         # API at http://localhost:4000
API_URL=https://<api> npm run build -w apps/extension   # another API
```

Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick `apps/extension/dist`. Then click the extension's toolbar button.

The manifest's `key` fixes the extension ID to `fgfompcfejncbbpbipjokoniblfihbnm`, and the API accepts that origin by default. If you publish under a different ID, add it to `EXTENSION_IDS` in the API's environment (comma-separated).

## Limits

- Chrome can't lock the screen the way the desktop app's secure exam window does. The extension can only report what the candidate does.
- Typing is tracked on the AI sites listed in `manifest.json`. A site already open when the exam starts begins tracking after it reloads.
