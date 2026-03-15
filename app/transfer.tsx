// instapay_app/app/transfer.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { API } from '../services/api';
import { COLORS } from '../constants/config';

function formatRFID(raw: string) {
  const d = raw.replace(/\D/g, '');
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0,2)}-${d.slice(2)}`;
  return `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6,12)}`;
}

export default function TransferScreen() {
  const { user, setUser } = useAuth();
  const [recName, setRecName]   = useState('');
  const [recId, setRecId]       = useState('');
  const [amount, setAmount]     = useState('');
  const [pingDone, setPingDone] = useState(false);
  const [pingTarget, setPingTarget] = useState<{ name: string; rfid: string } | null>(null);
  const [pinging, setPinging]   = useState(false);
  const [sending, setSending]   = useState(false);
  const [successModal, setSuccessModal] = useState(false);
  const [successData, setSuccessData]   = useState<any>(null);

  const balance = user?.balance ?? 0;
  const amt     = parseFloat(amount) || 0;
  const amtOk   = amt > 0 && amt <= balance;

  async function sendPing() {
    if (!recName.trim()) { Alert.alert('Missing', 'Enter the recipient name.'); return; }
    const rfidClean = recId.replace(/\D/g, '');
    if (rfidClean.length !== 12) { Alert.alert('Invalid ID', 'Enter a valid ID number (00-0000-000000).'); return; }
    if (recId === user?.rfid)    { Alert.alert('Error', 'You cannot transfer to yourself.'); return; }

    setPinging(true);
    try {
      const res = await API.post('/api/ping-transfer', { toRfid: recId });
      if (res.ok) {
        setPingTarget({ name: res.recipientName, rfid: recId });
        setPingDone(true);
        Alert.alert('Ping Sent ✓', `Verification sent to ${res.recipientName}. Enter the amount to send.`);
      } else {
        Alert.alert('Not Found', res.error || 'Recipient not found.');
      }
    } catch {
      Alert.alert('Error', 'Network error.');
    }
    setPinging(false);
  }

  function cancelTransfer() {
    setPingDone(false);
    setPingTarget(null);
    setAmount('');
  }

  async function doTransfer() {
    if (!amtOk)         { Alert.alert('Invalid Amount', 'Check your amount.'); return; }
    if (!pingTarget)    { Alert.alert('Error', 'Verify recipient first.'); return; }

    setSending(true);
    try {
      const res = await API.post('/api/transfer', { toRfid: pingTarget.rfid, amount: amt });
      if (res.ok) {
        setUser(res.sender);
        setSuccessData({ to: pingTarget.name, amount: amt, newBal: res.sender.balance });
        setSuccessModal(true);
        setPingDone(false); setPingTarget(null);
        setRecName(''); setRecId(''); setAmount('');
      } else {
        Alert.alert('Transfer Failed', res.error || 'Something went wrong.');
      }
    } catch {
      Alert.alert('Error', 'Network error.');
    }
    setSending(false);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.hdr}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Transfer Balance</Text>
        </View>

        {/* Sender balance */}
        <View style={styles.senderCard}>
          <View>
            <Text style={styles.senderLbl}>Your Balance</Text>
            <Text style={styles.senderBal}>₱ {balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.senderName}>{user?.name}</Text>
            <Text style={styles.senderRfid}>{user?.rfid}</Text>
          </View>
        </View>

        {/* Recipient section */}
        <Text style={styles.sectionLbl}>Recipient Details</Text>

        <View style={styles.field}>
          <Text style={styles.label}>RECIPIENT NAME</Text>
          <TextInput
            style={[styles.input, pingDone && styles.inputDisabled]}
            value={recName} onChangeText={setRecName}
            placeholder="e.g. Maria Santos" placeholderTextColor={COLORS.border}
            editable={!pingDone}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>RECIPIENT ID NUMBER</Text>
          <TextInput
            style={[styles.input, pingDone && styles.inputDisabled]}
            value={recId}
            onChangeText={t => setRecId(formatRFID(t))}
            placeholder="00-0000-000000" placeholderTextColor={COLORS.border}
            keyboardType="numeric" maxLength={14}
            editable={!pingDone}
          />
          <Text style={styles.hint}>Format: 00-0000-000000</Text>
        </View>

        {/* Security verification section */}
        {!pingDone ? (
          <View style={styles.secBox}>
            <Text style={styles.secTitle}>🔐 SECURITY VERIFICATION</Text>
            <Text style={styles.secDesc}>Send a test notification to verify the recipient's account before transferring.</Text>
            <TouchableOpacity
              style={[styles.btn, pinging && styles.btnDisabled]}
              onPress={sendPing} disabled={pinging} activeOpacity={0.85}
            >
              {pinging
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>SEND VERIFICATION PING</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            {/* Ping success badge */}
            <View style={styles.pingOk}>
              <Text style={styles.pingOkTitle}>✓ Verification ping sent</Text>
              <Text style={styles.pingOkDesc}>
                Notification sent to <Text style={{ color: COLORS.text, fontWeight: '700' }}>{pingTarget?.name}</Text>.
                Enter the amount to send.
              </Text>
            </View>

            {/* Amount input */}
            <View style={styles.field}>
              <Text style={styles.label}>AMOUNT TO TRANSFER (₱)</Text>
              <TextInput
                style={[styles.input, !amtOk && amount.length > 0 && styles.inputError]}
                value={amount} onChangeText={setAmount}
                placeholder="0.00" placeholderTextColor={COLORS.border}
                keyboardType="decimal-pad"
              />
              <Text style={[styles.hint, amount.length > 0 && (amtOk ? styles.hintGreen : styles.hintRed)]}>
                {amount.length > 0
                  ? amtOk
                    ? `After transfer: ₱${(balance - amt).toLocaleString('en-PH', { minimumFractionDigits: 2 })} remaining`
                    : amt > balance ? '⚠ Insufficient balance.' : 'Enter an amount greater than ₱0.'
                  : 'Must not exceed your available balance.'}
              </Text>
            </View>

            {/* Action buttons */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={cancelTransfer} activeOpacity={0.8}>
                <Text style={styles.cancelTxt}>✕ Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendBtn, (!amtOk || sending) && styles.btnDisabled]}
                onPress={doTransfer} disabled={!amtOk || sending} activeOpacity={0.85}
              >
                {sending
                  ? <ActivityIndicator color="#fff" />
                  : <LinearGradient colors={[COLORS.purple, COLORS.accent]} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.sendGrad}>
                      <Text style={styles.sendTxt}>Send ↗</Text>
                    </LinearGradient>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Success modal */}
      <Modal visible={successModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>✅ Transfer Sent!</Text>
            <Text style={styles.modalEmoji}>✅</Text>
            <Text style={styles.modalSub}>Successfully Sent!</Text>
            <Text style={styles.modalDesc}>
              ₱{successData?.amount?.toLocaleString('en-PH', { minimumFractionDigits: 2 })} sent to {successData?.to}
            </Text>
            <View style={styles.modalTable}>
              <View style={styles.modalRow}>
                <Text style={styles.modalLbl}>Sent to</Text>
                <Text style={styles.modalVal}>{successData?.to}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={styles.modalLbl}>Amount</Text>
                <Text style={[styles.modalVal, { color: COLORS.green }]}>
                  +₱{successData?.amount?.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={styles.modalLbl}>New Balance</Text>
                <Text style={[styles.modalVal, { color: COLORS.green }]}>
                  ₱{successData?.newBal?.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.modalBtn} onPress={() => { setSuccessModal(false); router.replace('/(tabs)/home'); }}>
              <Text style={styles.modalBtnTxt}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex:         { flex: 1, backgroundColor: COLORS.bg },
  scroll:       { flexGrow: 1, padding: 16, paddingBottom: 40 },
  hdr:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 48, marginBottom: 16 },
  backBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  backIcon:     { color: COLORS.purple, fontSize: 16 },
  pageTitle:    { fontSize: 18, fontWeight: '800', color: COLORS.text, textTransform: 'uppercase', letterSpacing: 1 },
  senderCard:   { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  senderLbl:    { fontSize: 11, color: COLORS.muted, letterSpacing: 1, textTransform: 'uppercase' },
  senderBal:    { fontSize: 22, fontWeight: '900', color: COLORS.green, marginTop: 2 },
  senderName:   { fontSize: 13, fontWeight: '700', color: COLORS.purple },
  senderRfid:   { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  sectionLbl:   { fontSize: 11, fontWeight: '800', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 },
  field:        { marginBottom: 14 },
  label:        { fontSize: 10, letterSpacing: 1.5, color: COLORS.muted, marginBottom: 5 },
  input:        { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10, padding: 11, color: COLORS.text, fontSize: 13 },
  inputDisabled:{ backgroundColor: COLORS.surface, color: COLORS.muted },
  inputError:   { borderColor: COLORS.red },
  hint:         { fontSize: 11, color: COLORS.muted, marginTop: 4 },
  hintGreen:    { color: COLORS.green },
  hintRed:      { color: COLORS.red },
  secBox:       { backgroundColor: 'rgba(249,115,22,.06)', borderWidth: 1, borderColor: 'rgba(249,115,22,.2)', borderRadius: 10, padding: 14, marginBottom: 14 },
  secTitle:     { fontSize: 11, color: COLORS.accent, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  secDesc:      { fontSize: 12, color: COLORS.muted, marginBottom: 12, lineHeight: 18 },
  btn:          { backgroundColor: COLORS.accent, borderRadius: 10, padding: 12, alignItems: 'center' },
  btnDisabled:  { opacity: 0.5 },
  btnText:      { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  pingOk:       { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, marginBottom: 14 },
  pingOkTitle:  { fontSize: 12, color: COLORS.accent, fontWeight: '700', marginBottom: 3 },
  pingOkDesc:   { fontSize: 12, color: COLORS.muted, lineHeight: 17 },
  actionRow:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:    { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: 'center' },
  cancelTxt:    { color: COLORS.red, fontSize: 13, fontWeight: '700' },
  sendBtn:      { flex: 1, borderRadius: 10, overflow: 'hidden' },
  sendGrad:     { padding: 12, alignItems: 'center' },
  sendTxt:      { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(26,10,46,.6)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: '#fff', borderRadius: 20, padding: 20, margin: 0, paddingBottom: 36 },
  modalTitle:   { fontSize: 16, fontWeight: '800', color: COLORS.green, marginBottom: 12 },
  modalEmoji:   { fontSize: 40, textAlign: 'center', marginBottom: 6 },
  modalSub:     { fontSize: 18, fontWeight: '800', color: COLORS.green, textAlign: 'center', letterSpacing: 1 },
  modalDesc:    { fontSize: 12, color: COLORS.muted, textAlign: 'center', marginBottom: 14, marginTop: 4 },
  modalTable:   { backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, gap: 6 },
  modalRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#f3e8ff' },
  modalLbl:     { fontSize: 12, color: COLORS.muted },
  modalVal:     { fontSize: 12, color: COLORS.text, fontWeight: '600' },
  modalBtn:     { backgroundColor: COLORS.green, borderRadius: 10, padding: 14, alignItems: 'center' },
  modalBtnTxt:  { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
});
