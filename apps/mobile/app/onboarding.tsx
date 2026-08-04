import { useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Clapperboard, Languages, LibraryBig } from 'lucide-react-native';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { KlyvoButton, KlyvoScreen } from '../src/components/ui';
import { useTranslation } from '../src/i18n';
import { useAuthStore } from '../src/state/auth';
import { colors, fonts, radii, spacing } from '../src/theme';

const width = Dimensions.get('window').width;

export default function OnboardingScreen() {
  const [page, setPage] = useState(0);
  const { t } = useTranslation();
  const router = useRouter();
  const complete = useAuthStore((state) => state.completeOnboarding);
  const pages = [
    { title: t('onboarding1Title'), body: t('onboarding1Body'), icon: Clapperboard },
    { title: t('onboarding2Title'), body: t('onboarding2Body'), icon: Languages },
    { title: t('onboarding3Title'), body: t('onboarding3Body'), icon: LibraryBig },
  ];
  const finish = async () => {
    await complete();
    router.replace('/auth');
  };
  const item = pages[page] ?? pages[0]!;
  const Icon = item.icon;
  return (
    <KlyvoScreen scroll={false} contentStyle={styles.screen}>
      <View style={styles.top}>
        <Text style={styles.brand}>Klyvo</Text>
        <KlyvoButton label={t('skip')} variant="ghost" size="sm" onPress={() => void finish()} />
      </View>
      <Animated.View
        key={page}
        entering={FadeInRight.springify().damping(20)}
        exiting={FadeOutLeft}
        style={styles.hero}
      >
        <View style={styles.visual}>
          <Text style={styles.visualLabel}>Klyvo / 0{page + 1}</Text>
          <View style={styles.iconWrap}>
            <Icon size={40} color={colors.text} strokeWidth={1.5} />
          </View>
          <Text style={styles.frameCode}>0{page + 1} — 03</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.body}>{item.body}</Text>
        </View>
      </Animated.View>
      <View style={styles.footer}>
        <View style={styles.dots}>
          {pages.map((_, index) => (
            <View key={index} style={[styles.dot, index === page && styles.dotActive]} />
          ))}
        </View>
        <KlyvoButton
          fullWidth
          size="lg"
          label={page === pages.length - 1 ? t('start') : t('continue')}
          onPress={() => (page === pages.length - 1 ? void finish() : setPage(page + 1))}
        />
      </View>
    </KlyvoScreen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'space-between', paddingBottom: spacing.xl, paddingTop: spacing.md },
  top: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brand: { color: colors.text, fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.6 },
  hero: { gap: spacing.xxl },
  visual: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    height: Math.min(width - 32, 390),
    justifyContent: 'center',
    overflow: 'hidden',
    width: Math.min(width - 32, 390),
  },
  visualLabel: {
    color: colors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 11,
    left: spacing.lg,
    letterSpacing: 1,
    position: 'absolute',
    top: spacing.lg,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    height: 88,
    justifyContent: 'center',
    width: 88,
  },
  frameCode: {
    bottom: spacing.lg,
    color: colors.textMuted,
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 2,
    position: 'absolute',
    right: spacing.lg,
  },
  copy: { gap: spacing.md },
  title: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 30,
    letterSpacing: -0.9,
    lineHeight: 37,
  },
  body: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  footer: { gap: spacing.xl },
  dots: { flexDirection: 'row', gap: spacing.sm },
  dot: { backgroundColor: colors.border, borderRadius: 2, height: 4, width: 20 },
  dotActive: { backgroundColor: colors.text, width: 42 },
});
