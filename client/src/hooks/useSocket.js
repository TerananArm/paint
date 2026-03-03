import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// Dynamically resolve server URL — uses the same hostname the page was loaded from
// so other devices on the same network can connect
const SERVER_URL = `http://${window.location.hostname}:3001`;

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
