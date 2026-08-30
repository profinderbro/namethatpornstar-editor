# NTPS Community Helper
📂[Extension.zip](https://github.com/profinderbro/namethatpornstar-editor/archive/refs/heads/master.zip)

*A lightweight community extension that makes basic account actions on NameThatPornStar.com easier to access.*

---

## The Problem

If you frequently participate on NameThatPornStar.com (NTPS), you might have noticed a common usability headache: several basic account and discussion features are surprisingly tricky to find or reach.

* **Managing your own activity is harder than it should be.** When you want to clean up an older reply or remove a comment you posted, the native controls can be easy to miss, difficult to discover, or inconvenient to navigate to.
* **Reporting problematic content can feel hidden.** The website already has a built-in reporting system for threads, but the trigger is not always obvious or readily accessible when you are browsing through active discussions.
* **No easy way to manage content directly where you read it.** Discussion feeds move quickly, and having to hunt around the page to find standard moderation and management actions adds unnecessary friction.

The site's server already supports all of these actions—the interface just needed a cleaner way to bring them within easy reach.

---

## Why This Exists

This extension grew out of a simple, practical need: giving community members a smoother browsing experience on NTPS. 

Rather than waiting for native interface redesigns or building separate third-party tools, we created a lightweight client-side companion that connects you directly to the features NTPS already provides. It is an open, community-made utility built for any logged-in NTPS member who wants a faster, more intuitive way to manage their contributions and report threads.

---

## What It Does

| Feature | What it does |
| :--- | :--- |
| **Remove own comments** | Adds a clean, accessible **Remove** button exclusively to comments authored by your currently logged-in account. |
| **Report thread** | Places a convenient **Report Thread** button directly in the main thread navigation to open NTPS's native reporting dialog. |
| **Dynamic content support** | Seamlessly detects new comments and discussion items loaded into the page as you browse. |
| **Deleted-comment awareness** | Automatically skips comments that have already been removed so you never see broken or cluttering controls. |
| **Ownership awareness** | Intelligently identifies comment authors and never shows removal controls on comments written by other users. |

---

## What It Does Not Do

To keep this project safe, predictable, and respectful of the platform, the extension adheres to strict boundaries:

* **It does NOT bypass NTPS permissions.** The NTPS backend server remains the final authority on every action.
* **It CANNOT delete another user's comment.** Removal is strictly limited by the server to your own comments.
* **It does NOT invent a separate reporting system.** When you click report, it uses NTPS's official report dialog and workflow.
* **It does NOT auto-submit reports.** You always retain full control to choose the reason category and submit manually.
* **It does NOT modify or tamper with NTPS's servers or database.** It only sends standard requests identical to what the official site interface triggers.

---

## How It Works — In Simple Terms

The extension works as a quiet layer on top of your existing browser tab:

### 1. Removing Your Own Comments
When viewing discussion items, the extension checks your currently authenticated user ID against the author ID listed on the comment. If—and only if—they match, a small **Remove** button is placed neatly next to that comment's action area. 

When clicked, you are asked for confirmation. Once confirmed, the extension dispatches the exact same deletion request that NTPS uses natively, using your active browser session. Once the server confirms the deletion, the comment is visually marked as removed on your screen.

### 2. Opening the Thread Report Dialog
Instead of creating a custom modal or sending data to an external tool, the **Report Thread** button simply reveals NTPS's existing `#report` dialog on the page and applies the site's native visible state. From there, you select your reason (such as spam or copyright) and submit the report directly through NTPS.

> [!NOTE]
> Everything runs right in your browser. There is no middleman and no background server altering your data.

---

## A Small Technical Note

For those curious about the underlying mechanics, the extension relies solely on observing and utilizing the official frontend endpoints that NTPS exposes to logged-in users:

* **Comment Removal**:
  * **Endpoint**: `POST /comment--delete.php`
  * **Payload**: Form-encoded `thread=THREAD_ID&comment=COMMENT_ID`
  * **Authentication**: Standard browser session cookies (`same-origin`)
* **Thread Reporting**:
  * **Endpoint**: `POST /report--process.php`
  * **Native Form**: `#report`
  * **Fields**: `threadid`, `report__reason`, `report__comment`

No private, undocumented, or privileged APIs are used.

---

## Privacy

We believe browser extensions should be transparent and do only what they say on the box:

* **Runs exclusively on NTPS**: Restricted specifically to `namethatpornstar.com` URLs in the manifest.
* **No external accounts or logins**: Operates entirely using your existing, active NTPS session.
* **Zero telemetry & zero data collection**: No analytics, no tracking pixels, and no remote scripts.
* **No third-party servers**: Your browser only communicates directly with NameThatPornStar.com.

---

## Installation

The extension is designed for Chromium-based browsers (Google Chrome, Brave, Microsoft Edge, Arc, Opera, Vivaldi) using Manifest V3.

1. **Download or clone** this repository to a folder on your computer.
2. In your browser, navigate to your extensions manager:
   * Chrome / Brave / Arc: `chrome://extensions`
   * Edge: `edge://extensions`
3. Toggle on **Developer mode** (usually in the top right corner).
4. Click **Load unpacked** (top left).
5. Select the project folder containing `manifest.json`.
6. Visit or refresh [NameThatPornStar.com](https://namethatpornstar.com/) to start using it!

---

## Project Philosophy

> *"The goal is not to replace NTPS. It is to make functionality that already exists easier to reach."*

We believe in keeping things:
* **Minimal**: Zero build steps, zero bloated dependencies, and minimal styling that respects the original site design.
* **Transparent**: Clean, readable vanilla JavaScript that anyone in the community can inspect and trust.
* **Community-Focused**: Designed to solve genuine day-to-day usability issues for real users.

---

## Disclaimer

*This is an independent community project and is not affiliated with, maintained by, or endorsed by NameThatPornStar.com.*
