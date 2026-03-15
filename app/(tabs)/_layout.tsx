// instapay_app/app/(tabs)/_layout.tsx
import { Tabs, router } from 'expo-router';
import { useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { COLORS } from '../../constants/config';

function TabIcon({ emoji, label, focused }: { emoji: string; label: string; focused: boolean }) {
  return (
    <>
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </>
  );
}

export default function TabLayout() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) router.replace('/');
  }, [user]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" label="History" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="card"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="💳" label="Card" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="🔔" label="Inbox" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 64,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.97)',
  },
  tabLabel: { fontSize: 9, color: COLORS.muted, marginTop: 2 },
  tabLabelActive: { color: COLORS.accent },
});
