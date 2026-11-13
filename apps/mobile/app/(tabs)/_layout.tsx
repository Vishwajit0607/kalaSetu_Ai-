import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View } from 'react-native';
import { colors, touch, typography } from '@/theme/tokens';
import { speak, stopSpeaking } from '@/services/speech';
import { useLanguage } from '@/store/useArtisanStore';
import { useT, type StringKey } from '@/i18n';

/**
 * Six-tab bar.
 *
 * Icons carry the meaning and labels back them up, because a tab bar is the
 * one place where an unreadable label is survivable - but every tab also
 * speaks its own name on long-press, so the mapping is learnable by ear.
 *
 * The bar is tall (68px + safe area) and the icons are 26px: the reference
 * user taps with a thumb, outdoors, often one-handed.
 */

const TAB_SPEECH_KEYS: Record<string, StringKey> = {
  index: 'tab.speak.home',
  studio: 'tab.speak.studio',
  'catalog-voice': 'tab.speak.voice',
  'pricing-engine': 'tab.speak.price',
  inventory: 'tab.speak.stock',
  marketplaces: 'tab.speak.market',
};

export default function TabsLayout() {
  const language = useLanguage();
  const { t } = useT();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.electricLime,
        tabBarInactiveTintColor: colors.textMutedSage,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: typography.label - 3,
          letterSpacing: 0.2,
          marginBottom: Platform.OS === 'ios' ? 0 : 6,
        },
        tabBarStyle: {
          backgroundColor: colors.surfaceCharcoal,
          borderTopColor: colors.borderHairline,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : touch.minTarget + 16,
          paddingTop: 8,
        },
        tabBarItemStyle: { minHeight: touch.minTarget },
        sceneStyle: { backgroundColor: colors.canvasObsidian },
      }}
      screenListeners={{
        tabPress: () => {
          void stopSpeaking();
        },
        // `target` is "<routeName>-<nanoid>", so the route name is the prefix.
        tabLongPress: (event: { target?: string }) => {
          const name = event.target?.split('-')[0] ?? '';
          const key = TAB_SPEECH_KEYS[name];
          if (key) void speak(t(key), language);
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarAccessibilityLabel: 'Home dashboard',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="grid" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="studio"
        options={{
          title: t('tab.studio'),
          tabBarAccessibilityLabel: 'AI photo studio',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="camera" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="catalog-voice"
        options={{
          title: t('tab.voice'),
          tabBarAccessibilityLabel: 'Voice auto cataloger',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="mic" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="pricing-engine"
        options={{
          title: t('tab.price'),
          tabBarAccessibilityLabel: 'Pricing assistant',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="pricetag" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: t('tab.stock'),
          tabBarAccessibilityLabel: 'Inventory ledger',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="cube" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="marketplaces"
        options={{
          title: t('tab.market'),
          tabBarAccessibilityLabel: 'Marketplace sync hub',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="globe" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

function TabIcon({
  name,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
}) {
  return (
    <View className="items-center">
      <Ionicons name={name} size={24} color={color} />
      {/* 3px lime underline is the active marker - visible in bright sun where
          a tint change alone is not. */}
      <View
        style={{
          marginTop: 4,
          height: 3,
          width: focused ? 18 : 0,
          borderRadius: 2,
          backgroundColor: colors.electricLime,
        }}
      />
    </View>
  );
}
