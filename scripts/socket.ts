// instapay_app/services/socket.ts
import { io, Socket } from 'socket.io-client';
import { BASE_URL } from '../constants/config';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(BASE_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket(rfid: string) {
  const s = getSocket();
  if (!s.connected) s.connect();
  s.emit('join_user', { rfid });
}

export function disconnectSocket(rfid?: string) {
  const s = getSocket();
  if (rfid) s.emit('leave_user', { rfid });
  s.disconnect();
}
