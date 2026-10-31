# Publishing the browser extension

A website cannot install an extension, so candidates need a store listing. Brave uses the Chrome Web Store too. Everything the store asks for is here.

## 1. Build the upload

```bash
API_URL=https://dev102-api.onrender.com npm run package:extension
```

This writes `apps/extension/store/Where-U-Elevate-Extension-<version>.zip`, for uploading to the store only. It leaves out the manifest `key`, which the store does not accept.

## 2. Create the listing

Sign up at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time registration fee), choose **New item** and upload the zip. Use these values:

| Field | Value |
|---|---|
| Name | Where U Elevate Exam |
| Summary | Take a proctored Where U Elevate exam in your browser. |
| Category | Education |
| Language | English |
| Icon | `apps/extension/store-assets/icon-128.png` |
| Screenshot | `apps/extension/store-assets/screenshot-1280x800.png` |
| Small promo tile | `apps/extension/store-assets/promo-440x280.png` |
| Homepage | Your website's `/download` page |
| Privacy policy | Your website's `/privacy` page |

**Description**

```
Take your Where U Elevate exam in Chrome or Brave.

Your organization emails you an exam link and a password. Open the extension, enter them, and complete the email code and face check. Agree to monitoring, share your entire screen, and your exam starts on time.

During the exam your proctor sees your webcam and screen, the sites you open, your searches, and what you ask AI tools and what they answer. Monitoring runs only during your exam, and only after you agree. The extension does nothing outside an exam.

You need an invitation from your organization to use this extension.
```

## 3. Answer the privacy tab

**Single purpose:** Lets invited candidates take a proctored exam in the browser and reports their exam activity to their proctor.

| Permission | Justification |
|---|---|
| `tabs` | Detects when the candidate leaves the exam tab and which site they opened, for the proctor. |
| `storage` | Keeps the exam session, and a device ID that locks the exam link to one browser. |
| Host access (`<all_urls>`) | Takes a proof picture of the tab in front when a candidate leaves the exam, on any site, and reads AI chats on the listed AI sites. |
| Remote code | No. All code is in the package. |

Under **Data usage**, declare: personally identifiable information, website content, web history and user activity. Certify that data is not sold, is not used for unrelated purposes and is not used for creditworthiness.

The broad host access means the first review can take longer than usual. Mention in the review notes that this is a proctoring tool, used only by invited candidates after they consent on screen, and give the reviewer a test exam link and password.

## 4. Connect it to the website

When the listing is approved:

1. Copy the extension ID from the dashboard and add it to `EXTENSION_IDS` on the Render API, separated by a comma. The API refuses extensions it does not know.
2. Set `EXTENSION_CHROME_URL` on the Render API to the listing page.

Share the listing link with candidates. Installing opens the exam sign-in by itself.

For Edge, publish the same zip on [Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge) (free) and set `EXTENSION_EDGE_URL`, or Edge uses the Chrome listing.

## Updates

Bump `version` in `apps/extension/manifest.json`, run step 1 and upload the zip as a new version. The store updates installed copies by itself.
