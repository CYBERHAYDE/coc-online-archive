# COC Igbogbo app

Two parts: the website files (this folder) and the backend (`backend/Code.gs`, which runs in Google Apps Script behind your sheet).
Do the backend first, because the website cannot log anyone in until it is updated.

## 1. Update the backend

1. Open the Google Sheet, then Extensions > Apps Script. (Use the same project your app talks to now.)
2. Delete everything in the editor, paste in `backend/Code.gs`, and save.
3. If the script is not attached to the sheet, put the sheet's ID in `SHEET_ID` at the top.
4. Pick `setup` in the function list and press Run. Approve the permissions (Sheets and Drive). This creates any missing tabs and the photo folder.
5. Deploy > Manage deployments > pencil icon > Version: New version > Deploy. Keep "Execute as: Me" and "Who has access: Anyone". Editing the existing deployment keeps the same web app URL, so the website needs no change.

The old backend had no login at all, so anyone with the link could read the data. This version refuses every request that does not carry a valid login.

## 2. Make yourself the owner

1. Open the app and create your account with your name and a passcode.
2. In `Code.gs`, type that exact name into `OWNER_NAME` near the top and save.
3. Pick `makeOwner` and press Run.
4. Log out and back in. You now have an Accounts screen where you choose who is an admin.

If you forget your passcode, fill in the two values inside `emergencyResetPasscode`, run it, log in, then clear them again.

## 3. Publish the website

Replace the files in your GitHub repo with the ones in this folder (keep the `js` folder). Delete the old `index.html` and `manifest.json` first if your tool does not overwrite.
`js/core.js` holds the web app URL at the top (`API_URL`). It is the same one that was in the old page.

## What each kind of account can do

| | Member (anyone who signs up) | Admin | Owner |
|---|---|---|---|
| Home, history, bulletin, connect, nearby churches | yes | yes | yes |
| Members, attendance, visitors, prospects, reports | no | yes | yes |
| Edit history, social links, pop-ups, congregations | no | yes | yes |
| Make or remove admins, reset passcodes, turn accounts off | no | no | yes |

Member records (phone numbers, addresses, birthdays) are admin only on purpose. Since anyone can create an account, showing them to every account would defeat the point.

## Installing on a phone

Android and Chrome show the real install box when someone taps Download app. iPhones do not allow a website to install itself, so iOS people get the three step Add to Home Screen guide instead. The app name and icon are the church logo and "COC Igbogbo" on both.

## Tests

`test/` has automated checks for the backend rules and for the screens. Run `node test/backend.test.js` and `node test/e2e.test.js` (the second needs `npm install jsdom` inside `test`).
