// instapay_app/app/(tabs)/card.tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, RefreshControl, Share,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { API } from '../../services/api';
import { COLORS, BASE_URL } from '../../constants/config';
import { getToken } from '../../services/api';

export default function CardScreen() {
  const { user, setUser } = useAuth();
  const [txns, setTxns]   = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [meRes, txRes] = await Promise.all([API.get('/api/me'), API.get('/api/transactions')]);
      if (meRes.ok) setUser(meRes.user);
      if (txRes.ok) setTxns(txRes.transactions.filter((t: any) => t.type === 'refill'));
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const totalLoaded = txns.reduce((s, t) => s + t.amount, 0);
  const lastRefill  = txns[0]?.datetime ?? '—';

  async function doWithdraw() {
    if (!user || user.balance <= 0) {
      Alert.alert('No Balance', 'Your balance is ₱0.00. Nothing to withdraw.'); return;
    }
    Alert.alert(
      '💸 Withdraw Full Balance',
      `Withdraw ₱${user.balance.toFixed(2)}?\n\nA withdrawal slip will be generated. Present it to the cashier.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw & Download',
          style: 'destructive',
          onPress: async () => {
            setWithdrawing(true);
            try {
              const token = await getToken();
              const res = await fetch(`${BASE_URL}/api/withdraw-slip`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
              });
              if (res.ok) {
                const text = await res.text();
                await Share.share({ message: text, title: 'Withdrawal Slip' });
                setUser({ ...user, balance: 0 });
              } else {
                const j = await res.json();
                Alert.alert('Error', j.error || 'Withdrawal failed.');
              }
            } catch {
              Alert.alert('Error', 'Network error.');
            }
            setWithdrawing(false);
          },
        },
      ]
    );
  }

  const fmt = (n: number) => `₱${Number(n).toFixed(2)}`;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
    >
      <Text style={styles.pageTitle}>My Card</Text>

      {/* Card visual */}
      <LinearGradient colors={['#7c3aed', '#dc2626']} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.cardLogo}>InstaPay</Text>
          <View style={styles.chip} />
        </View>
        <Text style={styles.cardRfid}>{user?.rfid}</Text>
        <View style={styles.cardBot}>
          <View>
            <Text style={styles.cardFieldLbl}>Card Holder</Text>
            <Text style={styles.cardFieldVal}>{user?.name}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.cardFieldLbl}>Balance</Text>
            <Text style={[styles.cardFieldVal, { color: '#22c55e' }]}>{fmt(user?.balance ?? 0)}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Info list */}
      <View style={styles.infoList}>
        {[
          ['ID Number',    user?.rfid ?? '—'],
          ['Card Status',  '● Active'],
          ['Account Type', user?.status ?? '—'],
          ['Contact',      user?.contact ?? '—'],
          ['Balance',      fmt(user?.balance ?? 0)],
          ['Total Loaded', fmt(totalLoaded)],
          ['Last Refill',  lastRefill],
        ].map(([lbl, val]) => (
          <View key={lbl} style={styles.infoRow}>
            <Text style={styles.infoLbl}>{lbl}</Text>
            <Text style={[styles.infoVal, lbl === 'Card Status' && { color: '#22c55e' }]}>{val}</Text>
          </View>
        ))}
      </View>

      {/* Withdraw button */}
      <TouchableOpacity
        style={styles.withdrawBtn}
        onPress={doWithdraw}
        disabled={withdrawing}
        activeOpacity={0.8}
      >
        <Text style={styles.withdrawTxt}>{withdrawing ? 'Processing…' : '💸 Withdraw All Balance (Download Slip)'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: COLORS.bg },
  content:      { paddingBottom: 90 },
  pageTitle:    { fontSize: 20, fontWeight: '800', color: COLORS.text, textTransform: 'uppercase', letterSpacing: 1, padding: 16, paddingTop: 52 },
  card:         { margin: 14, borderRadius: 16, padding: 18 },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  cardLogo:     { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  chip:         { width: 24, height: 18, backgroundColor: '#ffd700', borderRadius: 3 },
  cardRfid:     { color: 'rgba(255,255,255,.9)', fontSize: 13, letterSpacing: 2, marginBottom: 14 },
  cardBot:      { flexDirection: 'row', justifyContent: 'space-between' },
  cardFieldLbl: { color: 'rgba(255,255,255,.6)', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' },
  cardFieldVal: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 2 },
  infoList:     { paddingHorizontal: 14 },
  infoRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#f3e8ff' },
  infoLbl:      { fontSize: 13, color: COLORS.muted },
  infoVal:      { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  withdrawBtn:  { margin: 14, marginTop: 6, padding: 13, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.red, backgroundColor: COLORS.surface, alignItems: 'center' },
  withdrawTxt:  { color: COLORS.red, fontSize: 13, fontWeight: '700' },
});
