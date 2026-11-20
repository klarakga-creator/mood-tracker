# Mood Tracker (web app)

A free, installable web app for iPhone and Mac. It works offline and saves entries on the device first.
Sync (Supabase), daily push reminders and the automatic monthly email (Resend) are added on top.

- `index.html`, `styles.css`, `app.js`: the app. The scale's wording is at the top of `app.js`.
- `sw.js`: offline support and push notifications. Updates show up the next time the app opens.
- `manifest.webmanifest`, `icons/`: Home Screen name and icon.
- `report-pdf.js` (with `vendor/jspdf.umd.min.js`): the monthly PDF report. The app uses it for Save as PDF, and the email server loads it from the live app when it is deployed, so redeploy the server after changing it.

## Install on iPhone
Open the app's address in Safari, tap Share, then **Add to Home Screen**.

## Install on Mac
Open it in Safari and choose **File → Add to Dock**.
