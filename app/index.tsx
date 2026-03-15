import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../constants/config';
import { useAuth } from '../context/AuthContext';
import { API } from '../services/api';
import { connectSocket } from '../services/socket';

function formatRFID(raw: string) {
  let v = raw.replace(/\D/g, '');
  if (v.length > 2)  v = v.slice(0, 2) + '-' + v.slice(2);
  if (v.length > 7)  v = v.slice(0, 7) + '-' + v.slice(7);
  if (v.length > 14) v = v.slice(0, 14);
  return v;
}

function isValidRFID(v: string) {
  return /^\d{2}-\d{4}-\d{6}$/.test(v);
}

export default function LoginScreen() {
  const { setUser, setToken } = useAuth();
  const [rfid, setRfid]       = useState('');
  const [pw, setPw]           = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleLogin() {
    if (!rfid)              { setError('Please enter your ID number (00-0000-000000).'); return; }
    if (!isValidRFID(rfid)) { setError('ID format: 00-0000-000000.'); return; }
    if (!pw)                { setError('Please enter your password.'); return; }

    setLoading(true); setError('');
    try {
      const res = await API.post('/api/login', { rfid, password: pw });
      if (res.ok) {
        setUser(res.user);           // cookie is saved automatically in api.ts
        connectSocket(res.user.rfid);
        setPw('');
        setRfid('');
        router.replace('/(tabs)/home');
      } else {
        setError(res.error || 'Invalid credentials.');
        setPw('');
      }
    } catch {
      setError('Network error. Check your connection.');
    }
    setLoading(false);
  }

  const rfidValid   = isValidRFID(rfid);
  const rfidInvalid = rfid.length > 0 && !rfidValid;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.logoWrap}>
          <Text style={styles.logo}>INSTA<Text style={styles.logoAccent}>PAY</Text></Text>
          <Text style={styles.logoSub}>TAP. PAY. DONE.</Text>
        </View>

        <Text style={styles.title}>Sign In</Text>
        <Text style={styles.sub}>Use your ID number (00-0000-000000) to log in</Text>

        {error ? (
          <View style={styles.errBox}><Text style={styles.errText}>⚠ {error}</Text></View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>ID NUMBER</Text>
          <TextInput
            style={[styles.input, rfidValid && styles.inputValid, rfidInvalid && styles.inputInvalid]}
            value={rfid}
            onChangeText={t => setRfid(formatRFID(t))}
            placeholder="00-0000-000000"
            placeholderTextColor={COLORS.border}
            keyboardType="numeric"
            maxLength={14}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleLogin}
          />
          <Text style={styles.hint}>Format: 00-0000-000000 · e.g. 12-3456-789012</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            value={pw}
            onChangeText={setPw}
            placeholder="••••••••"
            placeholderTextColor={COLORS.border}
            secureTextEntry
            onSubmitEditing={handleLogin}
          />
        </View>

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>SIGN IN</Text>}
        </TouchableOpacity>

        <View style={styles.demoBox}>
          <Text style={styles.demoText}>
            Demo accounts:{'\n'}
            ID <Text style={styles.demoVal}>11-9220-357300</Text> · pw <Text style={styles.demoVal}>password123</Text>{'\n'}
            ID <Text style={styles.demoVal}>09-2401-082000</Text> · pw <Text style={styles.demoVal}>password123</Text>
          </Text>
        </View>

        <Text style={styles.switchText}>
          No account?{' '}
          <Text style={styles.switchLink} onPress={() => router.push('/register')}>Sign Up</Text>
        </Text>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex:         { flex: 1, backgroundColor: COLORS.bg },
  scroll:       { flexGrow: 1, padding: 22, paddingTop: 60 },
  logoWrap:     { alignItems: 'center', marginBottom: 28 },
  logo:         { fontSize: 36, fontWeight: '900', letterSpacing: 2, color: COLORS.text },
  logoAccent:   { color: COLORS.accent },
  logoSub:      { fontSize: 11, letterSpacing: 3, color: COLORS.muted, marginTop: 3 },
  title:        { fontSize: 20, fontWeight: '800', color: COLORS.text, textTransform: 'uppercase', letterSpacing: 1 },
  sub:          { fontSize: 12, color: COLORS.muted, marginBottom: 14 },
  errBox:       { backgroundColor: 'rgba(220,38,38,.08)', borderWidth: 1, borderColor: 'rgba(220,38,38,.3)', borderRadius: 7, padding: 10, marginBottom: 10 },
  errText:      { color: COLORS.red, fontSize: 12, fontFamily: 'monospace' },
  field:        { marginBottom: 11 },
  label:        { fontSize: 10, letterSpacing: 1.5, color: COLORS.muted, marginBottom: 4, fontFamily: 'monospace' },
  input:        { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 9, padding: 10, color: COLORS.text, fontSize: 13, fontFamily: 'monospace' },
  inputValid:   { borderColor: COLORS.green },
  inputInvalid: { borderColor: COLORS.red },
  hint:         { fontSize: 11, color: COLORS.muted, marginTop: 3, fontFamily: 'monospace' },
  btn:          { backgroundColor: COLORS.accent, borderRadius: 9, padding: 12, alignItems: 'center', marginTop: 6 },
  btnDisabled:  { opacity: 0.6 },
  btnText:      { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 2 },
  demoBox:      { marginTop: 10, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10 },
  demoText:     { fontSize: 11, color: COLORS.muted, lineHeight: 20, fontFamily: 'monospace' },
  demoVal:      { color: COLORS.accent },
  switchText:   { textAlign: 'center', marginTop: 12, fontSize: 12, color: COLORS.muted },
  switchLink:   { color: COLORS.accent, fontWeight: '700' },
});