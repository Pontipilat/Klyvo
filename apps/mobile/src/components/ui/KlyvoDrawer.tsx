import type { ComponentType, ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInLeft,
  SlideOutLeft,
} from 'react-native-reanimated';
import type { LucideProps } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../../theme';

export interface DrawerItem {
  key: string;
  label: string;
  description?: string;
  icon: ComponentType<LucideProps>;
  disabled?: boolean;
  badge?: string;
}

/**
 * Боковое меню слева. Отсюда переключаются разделы ленты — сейчас видео,
 * дальше сюда же встанет генерация изображений со своей лентой.
 */
export function KlyvoDrawer({
  visible,
  title,
  items,
  activeKey,
  footer,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: DrawerItem[];
  activeKey: string;
  footer?: ReactNode;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(140)}
        exiting={FadeOut.duration(120)}
        style={styles.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          // Пружина проскакивала конечную точку и качалась вокруг неё — меню дёргалось.
          entering={SlideInLeft.duration(260).easing(Easing.out(Easing.cubic))}
          exiting={SlideOutLeft.duration(180).easing(Easing.in(Easing.cubic))}
          style={[styles.panel, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
        >
          <Text style={styles.brand}>{title}</Text>
          <View style={styles.items}>
            {items.map((item) => {
              const active = item.key === activeKey;
              const Icon = item.icon;
              return (
                <Pressable
                  key={item.key}
                  disabled={item.disabled}
                  onPress={() => onSelect(item.key)}
                  style={({ pressed }) => [
                    styles.item,
                    active && styles.itemActive,
                    item.disabled && styles.itemDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.itemIcon, active && styles.itemIconActive]}>
                    <Icon color={active ? colors.background : colors.textMuted} size={19} />
                  </View>
                  <View style={styles.itemCopy}>
                    <View style={styles.itemTop}>
                      <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>
                        {item.label}
                      </Text>
                      {item.badge ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{item.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    {item.description ? (
                      <Text style={styles.itemHint}>{item.description}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.footer}>{footer}</View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: colors.overlay, flex: 1, flexDirection: 'row' },
  panel: {
    backgroundColor: colors.surface,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    gap: spacing.xl,
    maxWidth: 320,
    paddingHorizontal: spacing.lg,
    width: '82%',
  },
  brand: { color: colors.text, fontFamily: fonts.extraBold, fontSize: 26, letterSpacing: -1 },
  items: { flex: 1, gap: spacing.sm },
  item: {
    alignItems: 'center',
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.md,
  },
  itemActive: { backgroundColor: colors.surfaceRaised },
  itemDisabled: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  itemIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  itemIconActive: { backgroundColor: colors.text, borderColor: colors.text },
  itemCopy: { flex: 1, gap: 2 },
  itemTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  itemLabel: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 15 },
  itemLabelActive: { color: colors.text },
  itemHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  badge: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 10 },
  footer: { gap: spacing.sm },
});
