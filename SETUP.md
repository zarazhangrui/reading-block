# Setting up Reading Block (one time, ~15 minutes)

This guide gets the extension running in Chrome and connected to your Google
Calendar. You only do this once. Follow it top to bottom.

There are two halves:
- **Part A** loads the extension into Chrome.
- **Part B** gives it permission to use your Google Calendar.

We do Part A first because Part B needs a code (the "Extension ID") that only
appears after Part A.

---

## Part A: Load the extension into Chrome

1. Download this project to your computer (if you cloned or unzipped it, just
   remember where the folder is).
2. Open Chrome. In the address bar type `chrome://extensions` and press Enter.
3. Top-right of that page, turn **Developer mode** ON.
4. Click **Load unpacked** (top-left).
5. In the file picker, select **this project's folder** (the one containing
   `manifest.json`), then click Select.
6. A card titled **Reading Block** appears.
7. On that card, find **ID:** followed by a long string of letters. **Copy that
   whole ID and keep it handy.** You'll need it in Part B.

> Keep the project folder where it is. Chrome ties the Extension ID to the
> folder's location, so if you move the folder later, the ID changes and you'd
> have to redo Part B.

If the icon is hidden, click the puzzle-piece icon in Chrome's toolbar and pin
"Reading Block".

---

## Part B: Give it permission to use Google Calendar

Google requires every app to register before it can touch your calendar. It's
free. You'll create a "project," switch on the Calendar feature, and generate a
login ID that you paste into the extension.

### B1. Create a Google Cloud project
1. Go to **https://console.cloud.google.com** and sign in.
2. At the top, click the project dropdown, then **New Project**. Name it
   `Reading Block` and click **Create**. Make sure it's the selected project.

### B2. Turn on the Calendar API
1. In the top search bar, type **Google Calendar API** and click it.
2. Click **Enable**.

### B3. Set up the consent screen
1. Left menu → **APIs & Services** → **OAuth consent screen** (in newer consoles
   this may appear as **Google Auth Platform** → **Audience**).
2. Choose **External**, click **Create**.
3. Fill in the required fields (app name `Reading Block`, your email for the
   support and developer contact fields). Save and continue through the next
   screens; you can skip "Scopes" and "Optional info."
4. On **Test users**, click **Add Users** and add your own Google email address,
   then Save. (While the app is in "Testing" mode, only the test users you list
   can use it. That's fine, it's just you.)

### B4. Create the login ID (the "OAuth client")
1. Left menu → **APIs & Services** → **Credentials**.
2. Click **+ Create Credentials** → **OAuth client ID**.
3. **Application type:** choose **Chrome Extension** (older consoles call this
   **Chrome App**).
4. Name it `Reading Block`.
5. In the **Item ID / Application ID** field, paste the **Extension ID** you
   copied in Part A, step 7.
6. Click **Create** and copy the **Client ID** (it ends in
   `.apps.googleusercontent.com`).

### B5. Put the Client ID into the extension
1. Open `manifest.json` in this project folder with any text editor.
2. Find `PASTE_YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com`.
3. Replace that whole placeholder (keep the quotes) with your Client ID. Save.

### B6. Reload the extension
1. Back on `chrome://extensions`, click the circular **reload** arrow on the
   Reading Block card.

---

## Part C: Test it safely (don't touch your real calendar yet)

Before letting it write to your real schedule, point it at a throwaway calendar.

1. Open **Google Calendar** (calendar.google.com).
2. Next to "Other calendars," click **+** → **Create new calendar**. Name it
   `Reading Block Test` and click **Create calendar**.
3. In that calendar's settings, scroll to **Integrate calendar** and copy the
   **Calendar ID** (a long address ending in `@group.calendar.google.com`).
4. **Right-click** the Reading Block toolbar icon → **Settings**. Paste that
   Calendar ID into the **Calendar ID** box → **Save settings**.
5. Save 5 articles: open 5 pages and **left-click the Reading Block icon once**
   on each (a small "Saved" confirmation appears each time). On the 5th, the
   first time, Google will ask you to allow calendar access. Click through (if it
   warns the app is "unverified," click **Advanced** → **Go to Reading Block
   (unsafe)** — this is normal for your own personal, unpublished app).
6. Check the `Reading Block Test` calendar: a 30-minute **Reading Block** should
   appear on a free day in your window, with the 5 links in the notes.

When you're happy, change the Calendar ID in Settings back to `primary` to use
your real calendar.

---

## If something goes wrong
- **"Access blocked ... has not completed the Google verification process"
  (Error 403: access_denied):** your Google account isn't on the tester list. Go
  to the Google Cloud Console → APIs & Services → OAuth consent screen (or Google
  Auth Platform → Audience) → Test users → Add users → add your own email → Save.
  Wait a minute and try again.
- **Consent never appears / "bad client id":** the Client ID in `manifest.json`
  doesn't match, or the Extension ID in the OAuth client is wrong. Re-check Part A
  step 7 and Part B steps 4–5, then reload.
- **"No free slot found":** your chosen window had no meeting-free block on a free
  day in the lookahead period. Widen the window or days in Settings.
- **Nothing happens on the 5th save:** open `chrome://extensions`, click "service
  worker" under the Reading Block card to see logs.
