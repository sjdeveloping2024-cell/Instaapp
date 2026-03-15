// instapay_app/app/(tabs)/transactions.tsx
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { API } from '../../services/api';
import { COLORS } from '../../constants/config';

const TXN_ICONS: Record<string, string> = { refill: '💳', payment: '🛒', transfer: '📤', withdrawal: '💸' };

export default function TransactionsScreen() {
  const [txns, setTxns]         = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await API.get('/api/transactions');
      if (res.ok) setTxns(res.transactions);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const totalIn  = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = txns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  // Group by date
  const groups: Record<string, any[]> = {};
  txns.forEach(t => {
    const date = t.datetime.split(' ')[0];
    if (!groups[date]) groups[date] = [];
    groups[date].push(t);
  });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
    >
      <Text style={styles.pageTitle}>Transactions</Text>

      {/* Summary */}
      <View style={styles.sumRow}>
        <View style={styles.sumBox}>
          <Text style={styles.sumL}>Total In</Text>
          <Text style={[styles.sumV, { color: COLORS.green }]}>₱{totalIn.toLocaleString()}</Text>
        </View>
        <View style={styles.sumBox}>
          <Text style={styles.sumL}>Total Out</Text>
          <Text style={[styles.sumV, { color: COLORS.red }]}>₱{totalOut.toLocaleString()}</Text>
        </View>
      </View>

      {txns.length === 0
        ? <Text style={styles.empty}>No transactions yet.</Text>
        : Object.entries(groups).map(([date, items]) => (
          <View key={date}>
            <Text style={styles.grpLbl}>{date}</Text>
            {items.map((t, i) => (
              <View key={i} style={styles.txnRow}>
                <View style={styles.txnIco}><Text style={{ fontSize: 16 }}>{TXN_ICONS[t.type] ?? '💳'}</Text></View>
                <View style={styles.txnMid}>
                  <Text style={styles.txnName}>{t.desc}</Text>
                  <Text style={styles.txnDate}>{t.datetime.split(' ')[1]}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.txnAmt, t.amount > 0 ? styles.cr : styles.dr]}>
                    {t.amount > 0 ? '+' : ''}₱{Math.abs(t.amount).toLocaleString()}
                  </Text>
                  <Text style={styles.balAfter}>Bal ₱{t.balAfter.toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </View>
        ))
      }
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:     { flex: 1, backgroundColor: COLORS.bg },
  content:    { paddingBottom: 90 },
  pageTitle:  { fontSize: 20, fontWeight: '800', color: COLORS.text, textTransform: 'uppercase', letterSpacing: 1, padding: 16, paddingTop: 52 },
  sumRow:     { flexDirection: 'row', gap: 10, paddingHorizontal: 14, marginBottom: 10 },
  sumBox:     { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  sumL:       { fontSize: 11, color: COLORS.muted, marginBottom: 4 },
  sumV:       { fontSize: 16, fontWeight: '800' },
  grpLbl:     { fontSize: 11, color: COLORS.border, letterSpacing: 1.5, textTransform: 'uppercase', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  empty:      { color: COLORS.muted, fontSize: 13, textAlign: 'center', paddingVertical: 40 },
  txnRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#f3e8ff' },
  txnIco:     { width: 36, height: 36, backgroundColor: COLORS.surface, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  txnMid:     { flex: 1 },
  txnName:    { fontSize: 13, fontWeight: '600', color: COLORS.text },
  txnDate:    { fontSize: 11, color: COLORS.muted },
  txnAmt:     { fontSize: 13, fontWeight: '700' },
  balAfter:   { fontSize: 10, color: COLORS.muted, marginTop: 1 },
  cr:         { color: COLORS.green },
  dr:         { color: COLORS.red },
});
