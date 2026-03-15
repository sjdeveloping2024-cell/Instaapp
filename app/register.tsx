import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../constants/config';
import { API } from '../services/api';

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

export default function RegisterScreen() {
  const [name, setName]       = useState('');
  const [rfid, setRfid]       = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus]   = useState<'Student' | 'Non-Student' | ''>('');
  const [pw, setPw]           = useState('');
  const [pw2, setPw2]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const rfidValid   = isValidRFID(rfid);
  const rfidInvalid = rfid.length > 0 && !rfidValid;

  async function handleRegister() {
    if (!name.trim())           { setError('Please fill in all required fields.'); return; }
    if (!isValidRFID(rfid))     { setError('ID format: 00-0000-000000.'); return; }
    if (!contact.startsWith('09') || contact.length !== 11) { setError('Enter valid 11-digit contact starting with 09.'); return; }
    if (!status)                { setError('Please select your status.'); return; }
    if (!pw)                    { setError('Please create a password.'); return; }
    if (pw !== pw2)             { setError('Passwords do not match.'); return; }

    setLoading(true); setError('');
    try {
      const res = await API.post('/api/register', {
        name: name.trim(), rfid, contact: contact.trim(), status, password: pw,
      });
      if (res.ok) {
        Alert.alert('Account Created!', 'You can now sign in.', [
          { text: 'Sign In', onPress: () => router.replace('/') }
        ]);
      } else {
        setError(res.error || 'Registration failed.');
      }
    } catch {
      setError('Network error. Check your connection.');
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.logoWrap}>
          <Text style={styles.logo}>INSTA<Text style={styles.logoAccent}>PAY</Text></Text>
        </View>

        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <View style={styles.backBtn}><Text style={styles.backIcon}>←</Text></View>
          <Text style={styles.backLabel}>Back to Sign In</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.sub}>All fields are required</Text>

        {error ? (
          <View style={styles.errBox}><Text style={styles.errText}>⚠ {error}</Text></View>
        ) : null}

        {/* Full Name */}
        <View style={styles.field}>
          <Text style={styles.label}>FULL NAME</Text>
          <TextInput
            style={styles.input} value={name} onChangeText={setName}
            placeholder="e.g. Maria Santos" placeholderTextColor={COLORS.border}
          />
        </View>

        {/* RFID */}
        <View style={styles.field}>
          <Text style={styles.label}>ID NUMBER (RFID CARD)</Text>
          <TextInput
            style={[styles.input, rfidValid && styles.inputValid, rfidInvalid && styles.inputInvalid]}
            value={rfid}
            onChangeText={t => setRfid(formatRFID(t))}
            placeholder="00-0000-000000"
            placeholderTextColor={COLORS.border}
            keyboardType="numeric"
            maxLength={14}
          />
          <Text style={styles.hint}>This is your RFID card number — format: 00-0000-000000</Text>
        </View>

        {/* Contact */}
        <View style={styles.field}>
          <Text style={styles.label}>CONTACT NUMBER</Text>
          <TextInput
            style={styles.input} value={contact}
            onChangeText={t => setContact(t.replace(/\D/g, ''))}
            placeholder="09XXXXXXXXX" placeholderTextColor={COLORS.border}
            keyboardType="phone-pad" maxLength={11}
          />
        </View>

        {/* Status */}
        <View style={styles.field}>
          <Text style={styles.label}>STATUS</Text>
          <View style={styles.toggleRow}>
            {(['Student', 'Non-Student'] as const).map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.toggleBtn, status === s && styles.toggleBtnActive]}
                onPress={() => setStatus(s)}
              >
                <Text style={[styles.toggleTxt, status === s && styles.toggleTxtActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Password */}
        <View style={styles.field}>
          <Text style={styles.label}>PASSWORD</Text>
          <TextInput
            style={styles.input} value={pw} onChangeText={setPw}
            placeholder="Create a password" placeholderTextColor={COLORS.border}
            secureTextEntry
          />
        </View>

        {/* Confirm Password */}
        <View style={styles.field}>
          <Text style={styles.label}>CONFIRM PASSWORD</Text>
          <TextInput
            style={styles.input} value={pw2} onChangeText={setPw2}
            placeholder="Repeat password" placeholderTextColor={COLORS.border}
            secureTextEntry
          />
        </View>

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleRegister}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>CREATE ACCOUNT</Text>}
        </TouchableOpacity>

        <Text style={styles.switchText}>
          Already have an account?{' '}
          <Text style={styles.switchLink} onPress={() => router.back()}>Sign In</Text>
        </Text>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex:            { flex: 1, backgroundColor: COLORS.bg },
  scroll:          { flexGrow: 1, padding: 22, paddingTop: 52 },
  logoWrap:        { alignItems: 'center', marginBottom: 16 },
  logo:            { fontSize: 28, fontWeight: '900', letterSpacing: 2, color: COLORS.text },
  logoAccent:      { color: COLORS.accent },
  backRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  backBtn:         { width: 26, height: 26, backgroundColor: COLORS.surface, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  backIcon:        { color: COLORS.purple, fontSize: 14 },
  backLabel:       { fontSize: 12, color: '#666' },
  title:           { fontSize: 20, fontWeight: '800', color: COLORS.text, textTransform: 'uppercase', letterSpacing: 1 },
  sub:             { fontSize: 12, color: COLORS.muted, marginBottom: 14 },
  errBox:          { backgroundColor: 'rgba(220,38,38,.08)', borderWidth: 1, borderColor: 'rgba(220,38,38,.3)', borderRadius: 7, padding: 10, marginBottom: 10 },
  errText:         { color: COLORS.red, fontSize: 12, fontFamily: 'monospace' },
  field:           { marginBottom: 11 },
  label:           { fontSize: 10, letterSpacing: 1.5, color: COLORS.muted, marginBottom: 4, fontFamily: 'monospace' },
  input:           { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 9, padding: 10, color: COLORS.text, fontSize: 13, fontFamily: 'monospace' },
  inputValid:      { borderColor: COLORS.green },
  inputInvalid:    { borderColor: COLORS.red },
  hint:            { fontSize: 11, color: COLORS.muted, marginTop: 3, fontFamily: 'monospace' },
  toggleRow:       { flexDirection: 'row', gap: 10 },
  toggleBtn:       { flex: 1, padding: 11, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', backgroundColor: COLORS.surface },
  toggleBtnActive: { borderColor: COLORS.accent, backgroundColor: 'rgba(249,115,22,.08)' },
  toggleTxt:       { color: COLORS.muted, fontSize: 13, fontWeight: '600' },
  toggleTxtActive: { color: COLORS.accent },
  btn:             { backgroundColor: COLORS.accent, borderRadius: 9, padding: 12, alignItems: 'center', marginTop: 6 },
  btnDisabled:     { opacity: 0.6 },
  btnText:         { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 2 },
  switchText:      { textAlign: 'center', marginTop: 12, fontSize: 12, color: COLORS.muted },
  switchLink:      { color: COLORS.accent, fontWeight: '700' },
});