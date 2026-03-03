# Piant — Real-time Collaborative Drawing Tool 🎨

A web application for real-time collaborative drawing using **React** (Frontend), **Node.js/Express** (Backend), and **Socket.io** for bidirectional communication.

## Features

- **Canvas Drawing** — Smooth brush, eraser, and shape tools (rectangle, circle, line)
- **Real-time Sync** — Draw on one screen, see it instantly on another via Socket.io
- **Throttled Emissions** — Points batched at ~16ms to minimize bandwidth
- **Normalized Coordinates** — Fixed 1920×1080 virtual canvas ensures all users see the same drawing regardless of screen size
- **Premium UI** — Dark glassmorphism toolbar with color palette, size slider, and connection status

## Tech Stack

- **Frontend:** React + Vite + Canvas API
- **Backend:** Node.js + Express + Socket.io
- **Communication:** WebSocket (Socket.io)

## Getting Started

```bash
# Install dependencies
cd server && npm install
cd ../client && npm install

# Start backend (Terminal 1)
cd server && node server.js

# Start frontend (Terminal 2)
cd client && npm run dev -- --host
```

Open `http://localhost:5173` in two browser tabs and start drawing!

## Project Structure

```
piant/
├── server/
│   └── server.js          # Socket.io relay server
└── client/src/
    ├── App.jsx             # Main layout
    ├── components/
    │   ├── Canvas.jsx      # Drawing engine + throttling + virtual coords
    │   └── Toolbar.jsx     # Color palette, tools, and controls
    └── hooks/
        └── useSocket.js    # Socket.io connection hook
```
