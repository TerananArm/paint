const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());

// Track connected users
let connectedUsers = 0;
// Track drawn events
let drawHistory = [];

io.on('connection', (socket) => {
  connectedUsers++;
  console.log(`✅ User connected: ${socket.id} (Total: ${connectedUsers})`);

  // Send history to new user
  socket.emit('init-history', drawHistory);

  // Notify all clients about updated user count
  io.emit('users', connectedUsers);

  // Relay drawing data to all other clients
  socket.on('draw', (data) => {
    drawHistory.push(data);
    socket.broadcast.emit('draw', data);
  });

  // Relay batch drawing data (throttled points)
  socket.on('draw-batch', (dataArray) => {
    drawHistory.push(...dataArray);
    socket.broadcast.emit('draw-batch', dataArray);
  });

  // Relay clear canvas event to all other clients
  socket.on('clear', () => {
    drawHistory = [];
    socket.broadcast.emit('clear');
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    connectedUsers--;
    console.log(`❌ User disconnected: ${socket.id} (Total: ${connectedUsers})`);
    io.emit('users', connectedUsers);
  });
});

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`\n🎨 Piant Server running on http://${HOST}:${PORT}`);
  console.log(`   Waiting for connections...\n`);
});
