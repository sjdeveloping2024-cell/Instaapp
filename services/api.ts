import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../constants/config';

const SESSION_KEY = 'instapay_session_cookie';

export async function saveToken(token: string) {
  await AsyncStorage.setItem(SESSION_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_KEY);
}

export async function clearToken() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

async function authHeaders(): Promise<Record<string, string>> {
  const cookie = await getToken();
  return {
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

export const API = {
  async post(path: string, body: object = {}) {
    const headers = await authHeaders();
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    // Capture session cookie from login response
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/(session=[^;]+)/);
      if (match) await AsyncStorage.setItem(SESSION_KEY, match[1]);
    }
    return res.json();
  },

  async get(path: string) {
    const headers = await authHeaders();
    const res = await fetch(`${BASE_URL}${path}`, { headers });
    return res.json();
  },

  async postBlob(path: string, body: object = {}) {
    const headers = await authHeaders();
    return fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  },
};