import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// In production: use VITE_SERVER_URL env var (e.g. https://paint-server.onrender.com)
// In dev: connect to same hostname on port 3001 (works for LAN too)
const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;

export function useSocket() {
    const socketRef = useRef(null);
    const [isConnected, setIsConnected] = useState(false);
    const [userCount, setUserCount] = useState(0);

    useEffect(() => {
        const socket = io(SERVER_URL, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 1000,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            setIsConnected(true);
            console.log('🔗 Connected to server');
        });

        socket.on('disconnect', () => {
            setIsConnected(false);
            console.log('🔌 Disconnected from server');
        });

        socket.on('users', (count) => {
            setUserCount(count);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    const emit = (event, data) => {
        if (socketRef.current) {
            socketRef.current.emit(event, data);
        }
    };

    const on = (event, callback) => {
        if (socketRef.current) {
            socketRef.current.on(event, callback);
        }
    };

    const off = (event, callback) => {
        if (socketRef.current) {
            socketRef.current.off(event, callback);
        }
    };

    return { emit, on, off, isConnected, userCount };
}
