// instapay_app/app/(tabs)/home.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Alert,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { API } from '../../services/api';
import { getSocket } from '../../services/socket';
import { COLORS } from '../../constants/config';

const TXN_ICONS: Record<string, string> = { refill: '💳', payment: '🛒', transfer: '📤', withdrawal: '💸' };

export default function HomeScreen() {
  const { user, setUser, logout } = useAuth();
  const [txns, setTxns]         = useState<any[]>([]);
  const [unread, setUnread]     = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [meRes, txRes, notifRes] = await Promise.all([
        API.get('/api/me'),
        API.get('/api/transactions'),
        API.get('/api/notifications'),
      ]);
      if (meRes.ok) setUser(meRes.user);
      if (txRes.ok) setTxns(txRes.transactions.slice(0, 6));
      if (notifRes.ok) setUnread(notifRes.notifications.filter((n: any) => !n.read).length);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Real-time balance update
  useEffect(() => {
    const socket = getSocket();
    const onBal = (data: any) => {
      if (user && data.rfid === user.rfid) {
        setUser({ ...user!, balance: data.balance });
      }
    };
    const onNotif = () => setUnread(u => u + 1);
    socket.on('balance_updated', onBal);
    socket.on('notification_push', onNotif);
    return () => { socket.off('balance_updated', onBal); socket.off('notification_push', onNotif); };
  }, [user]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  function confirmLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { logout(); router.replace('/'); } },
    ]);
  }

  const fmt = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2 });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
    >
      {/* Header */}
      <View style={styles.hdr}>
        <View>
          <Text style={styles.greetName}>Hi, {user?.name.split(' ')[0]} 👋</Text>
          <Text style={styles.greetSub}>{user?.status}</Text>
        </View>
        <View style={styles.hdrRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/(tabs)/notifications')}>
            <Text style={{ fontSize: 16 }}>🔔</Text>
            {unread > 0 && <View style={styles.badge}><Text style={styles.badgeTxt}>{unread}</Text></View>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={confirmLogout}>
            <Text style={{ fontSize: 16 }}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Balance card */}
      <LinearGradient colors={[COLORS.cardGrad1, COLORS.cardGrad2]} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.balCard}>
        <Text style={styles.balLabel}>Available Balance</Text>
        <Text style={styles.balAmount}>₱ {fmt(user?.balance ?? 0)}</Text>
        <View style={styles.balFooter}>
          <Text style={styles.balRfid}>{user?.rfid}</Text>
          <View style={styles.balStatus}><Text style={styles.balStatusTxt}>● Active</Text></View>
        </View>
      </LinearGradient>

      {/* Transfer button */}
      <TouchableOpacity style={styles.transferBtn} onPress={() => router.push('/transfer')} activeOpacity={0.85}>
        <LinearGradient colors={[COLORS.purple, COLORS.accent]} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.transferGrad}>
          <Text style={styles.transferTxt}>↗  Transfer Balance</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Recent transactions */}
      <View style={styles.sec}>
        <View style={styles.secHdr}>
          <Text style={styles.secLbl}>Recent Transactions</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/transactions')}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>
        {txns.length === 0
          ? <Text style={styles.empty}>No transactions yet.</Text>
          : txns.map((t, i) => (
            <View key={i} style={styles.txnRow}>
              <View style={styles.txnIco}><Text style={{ fontSize: 16 }}>{TXN_ICONS[t.type] ?? '💳'}</Text></View>
              <View style={styles.txnMid}>
                <Text style={styles.txnName}>{t.desc}</Text>
                <Text style={styles.txnDate}>{t.datetime}</Text>
              </View>
              <Text style={[styles.txnAmt, t.amount > 0 ? styles.cr : styles.dr]}>
                {t.amount > 0 ? '+' : ''}₱{Math.abs(t.amount).toLocaleString()}
              </Text>
            </View>
          ))
        }
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: COLORS.bg },
  content:      { paddingBottom: 90 },
  hdr:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 52 },
  greetName:    { fontSize: 16, fontWeight: '700', color: COLORS.text },
  greetSub:     { fontSize: 12, color: COLORS.muted },
  hdrRight:     { flexDirection: 'row', gap: 8 },
  iconBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  badge:        { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' },
  badgeTxt:     { color: '#fff', fontSize: 9, fontWeight: '800' },
  balCard:      { margin: 14, borderRadius: 18, padding: 18 },
  balLabel:     { color: 'rgba(255,255,255,.7)', fontSize: 11, letterSpacing: 1 },
  balAmount:    { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -1, marginTop: 4 },
  balFooter:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  balRfid:      { color: 'rgba(255,255,255,.6)', fontSize: 12, letterSpacing: 1 },
  balStatus:    { backgroundColor: 'rgba(255,255,255,.2)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,.3)' },
  balStatusTxt: { color: '#fff', fontSize: 11 },
  transferBtn:  { marginHorizontal: 14, borderRadius: 12, overflow: 'hidden', marginTop: 4 },
  transferGrad: { padding: 14, alignItems: 'center' },
  transferTxt:  { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 2 },
  sec:          { padding: 14, paddingTop: 12 },
  secHdr:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  secLbl:       { fontSize: 11, fontWeight: '800', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 2 },
  seeAll:       { color: COLORS.accent, fontSize: 12, fontWeight: '700' },
  empty:        { color: COLORS.muted, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  txnRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3e8ff' },
  txnIco:       { width: 36, height: 36, backgroundColor: COLORS.surface, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  txnMid:       { flex: 1 },
  txnName:      { fontSize: 13, fontWeight: '600', color: COLORS.text },
  txnDate:      { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  txnAmt:       { fontSize: 13, fontWeight: '700' },
  cr:           { color: COLORS.green },
  dr:           { color: COLORS.red },
});
