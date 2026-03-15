# Focus+

Focus+ is a local-first productivity app for structured work sessions. It combines a Pomodoro timer, recurring daily and weekly checklists, a completion calendar, configurable sounds, and optional local folder backups in a simple browser-based interface.

## App Overview

Focus+ is organized around two main views:

- Focus view: the Pomodoro timer, daily checklist, weekly checklist, and settings live here.
- Calendar view: a month grid shows daily completion status and weekly progress markers over time.

The app is designed for personal workflow tracking on a local machine, with state persisted to disk through a lightweight Python server instead of a hosted backend.

## Timer

The timer is built around a standard Pomodoro flow:

- Focus session: 25 minutes
- Short break: 5 minutes
- Long break: 15 minutes

The mode sequence is:

`Focus -> Short Break -> Focus -> Short Break -> Focus -> Short Break -> Focus -> Long Break`

Key timer behavior:

- Start, pause, reset, and skip controls are available from the main timer card.
- The session counter increases after each completed focus session.
- Auto-start can optionally begin the next session or break immediately.
- Sound alerts and browser notifications can be enabled or disabled in the timer settings.
- Individual UI sounds and per-sound volume levels can be customized in `sound-config.js`.

## Features

- Pomodoro timer with focus and break cycles
- Daily recurring checklist templates
- Weekly recurring checklist templates
- Completion calendar for daily and weekly progress
- Configurable sound effects
- Shared local state persisted to disk through a small Python server
- Optional folder-based backup export
- Offline support through a service worker

## Project Structure

```text
.
|-- app.js                    # Main frontend app logic
|-- index.html                # App shell and UI markup
|-- styles.css                # App styling
|-- sound-config.js           # Sound file and per-sound volume settings
|-- sw.js                     # Service worker and offline cache list
|-- manifest.webmanifest      # PWA manifest
|-- focusplus_server.py       # Local HTTP server and /api/state endpoint
|-- launch_workflow_focus.bat # Windows launcher
|-- focusplus_state.json      # Current persisted app state
|-- focusplus_icon.ico        # App icon
|-- click_sound/              # Bundled audio assets
|-- .gitignore
`-- README.md
```

## Run Locally

1. Make sure Python is installed.
2. Start the app with `launch_workflow_focus.bat`, or run the server manually:

```powershell
python focusplus_server.py --host localhost --port 8000
```

3. Open `http://localhost:8000/`.

## Data and Persistence

- App state is stored in `focusplus_state.json`.
- The Python server serves the frontend and handles reads and writes to `/api/state`.
- The server sends `Cache-Control: no-store`, while the service worker handles offline caching for static assets.
- Browser-based backups export app configuration and completion history into a selected folder.

## Customization

- Update `sound-config.js` to change sound files, aliases, synth fallbacks, and sound gain.
- Timer durations can be adjusted from the app settings and are persisted in app state.
- Font size, sound volume, browser notifications, and backup settings are all stored locally.

## GitHub Setup

This project is ready to be published to GitHub as a standard static frontend plus Python utility repo. If you create a new empty repository on GitHub, you can publish this local project with:

```powershell
git remote add origin <your-github-repo-url>
git add .
git commit -m "Initial commit"
git push -u origin main
```
