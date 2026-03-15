// instapay_app/app/(tabs)/notifications.tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, Share,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { API } from '../../services/api';
import { getSocket } from '../../services/socket';
import { COLORS } from '../../constants/config';

const TYPE_CFG: Record<string, { icon: string; color: string; label: string }> = {
  receipt:           { icon: '📄', color: COLORS.accent,  label: 'Refill Receipt' },
  payment:           { icon: '🛒', color: COLORS.purple,  label: 'Payment' },
  transfer_received: { icon: '💸', color: COLORS.green,   label: 'Money Received!' },
  ping:              { icon: '📡', color: '#a855f7',      label: 'Transfer Verification' },
  transfer_cancel:   { icon: '✕',  color: COLORS.red,     label: 'Transfer Cancelled' },
};

export default function NotificationsScreen() {
  const { user }    = useAuth();
  const [notifs, setNotifs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await API.get('/api/notifications');
      if (res.ok) {
        setNotifs(res.notifications);
        await API.post('/api/notifications/read-all', {});
      }
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Real-time push
  React.useEffect(() => {
    const socket = getSocket();
    const onPush = (data: any) => {
      if (user && data.rfid === user.rfid) {
        setNotifs(prev => [{ ...data.notif, read: false }, ...prev]);
      }
    };
    socket.on('notification_push', onPush);
    return () => socket.off('notification_push', onPush);
  }, [user]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  function buildReceiptText(n: any) {
    return [
      'INSTAPAY OFFICIAL REFILL RECEIPT',
      '================================',
      `From: ${n.from || 'InstaPay Administration'}`,
      `Receipt No:  ${n.refId || n.id}`,
      `Date/Time:   ${n.dt}`,
      '--------------------------------',
      `Card Holder: ${n.user || user?.name}`,
      `ID Number:   ${user?.rfid}`,
      `Bal Before:  ₱${Number(n.before || 0).toFixed(2)}`,
      `Loaded:     +₱${Number(n.amount || 0).toFixed(2)}`,
      `New Balance: ₱${Number(n.newBal || n.after || 0).toFixed(2)}`,
      '================================',
      'Official receipt — InstaPay Administration.',
      'Keep this slip for your records.',
    ].join('\n');
  }

  function viewReceipt(n: any) {
    Alert.alert('Receipt Slip', buildReceiptText(n), [
      { text: 'Download', onPress: () => Share.share({ message: buildReceiptText(n), title: `Receipt-${n.id}` }) },
      { text: 'Close', style: 'cancel' },
    ]);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
    >
      <Text style={styles.pageTitle}>Inbox</Text>

      {notifs.length === 0
        ? <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTxt}>No notifications yet.{'\n'}When admin sends a receipt, it will appear here.</Text>
          </View>
        : notifs.map((n, i) => {
            const cfg = TYPE_CFG[n.type] ?? TYPE_CFG['receipt'];
            const isReceipt = !n.type || n.type === 'receipt';
            return (
              <View key={i} style={[styles.card, !n.read && styles.cardUnread]}>
                <View style={styles.cardHdr}>
                  <View style={[styles.iconBox, { borderColor: cfg.color + '44' }]}>
                    <Text style={{ fontSize: 16 }}>{cfg.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fromTxt, { color: cfg.color }]}>{n.from || 'InstaPay'}</Text>
                    <Text style={styles.titleTxt}>{cfg.label}</Text>
                    <Text style={styles.timeTxt}>{n.dt}</Text>
                  </View>
                  {!n.read && <View style={styles.dot} />}
                </View>
                <Text style={styles.bodyTxt}>{n.body}</Text>
                {isReceipt && (
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => viewReceipt(n)}>
                      <Text style={styles.actionTxtView}>👁 View Slip</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGreen]} onPress={() => Share.share({ message: buildReceiptText(n), title: `Receipt-${n.id}` })}>
                      <Text style={styles.actionTxtDl}>⬇ Download</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
      }
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: COLORS.bg },
  content:      { paddingBottom: 90 },
  pageTitle:    { fontSize: 20, fontWeight: '800', color: COLORS.text, textTransform: 'uppercase', letterSpacing: 1, padding: 16, paddingTop: 52 },
  empty:        { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon:    { fontSize: 40 },
  emptyTxt:     { color: COLORS.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  card:         { marginHorizontal: 12, marginBottom: 12, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  cardUnread:   { borderColor: COLORS.accent, backgroundColor: '#fff8f0' },
  cardHdr:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, paddingBottom: 6 },
  iconBox:      { width: 34, height: 34, backgroundColor: 'rgba(249,115,22,.08)', borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  fromTxt:      { fontSize: 11, fontWeight: '700', marginBottom: 1 },
  titleTxt:     { fontSize: 14, fontWeight: '700', color: COLORS.text },
  timeTxt:      { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  dot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent, marginTop: 4 },
  bodyTxt:      { fontSize: 12, color: COLORS.muted, paddingHorizontal: 12, paddingBottom: 10, lineHeight: 17 },
  actions:      { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  actionBtn:    { flex: 1, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(249,115,22,.3)', backgroundColor: 'rgba(249,115,22,.08)', alignItems: 'center' },
  actionBtnGreen: { borderColor: 'rgba(22,163,74,.25)', backgroundColor: 'rgba(22,163,74,.08)' },
  actionTxtView:{ color: COLORS.accent, fontSize: 12, fontWeight: '700' },
  actionTxtDl:  { color: COLORS.green, fontSize: 12, fontWeight: '700' },
});
