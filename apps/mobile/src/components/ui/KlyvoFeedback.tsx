import type { ComponentType, ReactNode } from 'react';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { AlertTriangle, CheckCircle2, Film, X } from 'lucide-react-native';
import { create } from 'zustand';
import { colors, fonts, radii, spacing } from '../../theme';
import { KlyvoButton, KlyvoIconButton } from './KlyvoPrimitives';

export function KlyvoSkeleton({
  height = 120,
  radius = radii.lg,
}: {
  height?: number;
  radius?: number;
}) {
  const opacity = useSharedValue(0.34);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.72, { duration: 800 }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.skeleton, { height, borderRadius: radius }, style]} />;
}

export function KlyvoEmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.state}>
      <View style={styles.stateIcon}>
        <Film color={colors.text} size={26} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {actionLabel && onAction ? <KlyvoButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function KlyvoErrorState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, styles.errorIcon]}>
        <AlertTriangle color={colors.error} size={26} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      <KlyvoButton label={actionLabel} variant="secondary" onPress={onAction} />
    </View>
  );
}

interface SheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}
export function KlyvoBottomSheet({ visible, title, onClose, children }: SheetProps) {
  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        style={styles.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          entering={SlideInDown.springify().damping(20)}
          exiting={SlideOutDown.duration(180)}
          style={styles.sheet}
        >
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <KlyvoIconButton icon={X} label={title} size={36} onPress={onClose} />
          </View>
          {children}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export function KlyvoModal({ visible, title, onClose, children }: SheetProps) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={[styles.overlay, styles.modalOverlay]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View entering={FadeIn.duration(180)} style={styles.modalCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <KlyvoIconButton icon={X} label={title} size={36} onPress={onClose} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Подтверждение необратимых действий: заголовок, последствия и обязательная «Отмена».
 * Раньше диалог удаления показывал только промпт и красную кнопку.
 */
export function KlyvoConfirm({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  loading,
  destructive,
  icon,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  destructive?: boolean;
  icon?: ComponentType<LucideProps>;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={[styles.overlay, styles.modalOverlay]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View entering={FadeIn.duration(160)} style={styles.modalCard}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Text style={styles.stateBodyLeft}>{body}</Text>
          <View style={styles.confirmActions}>
            <KlyvoButton
              fullWidth
              icon={icon}
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              loading={loading}
              onPress={onConfirm}
            />
            <KlyvoButton fullWidth label={cancelLabel} variant="ghost" onPress={onClose} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

interface ToastState {
  message?: string;
  kind: 'success' | 'error';
  show: (message: string, kind?: 'success' | 'error') => void;
  hide: () => void;
}
export const useToast = create<ToastState>((set) => ({
  kind: 'success',
  show: (message, kind = 'success') => set({ message, kind }),
  hide: () => set({ message: undefined }),
}));

export function KlyvoToast() {
  const { message, kind, hide } = useToast();
  useEffect(() => {
    if (!message) return;
    // Ошибку читать дольше, чем «Сохранено», и любое сообщение можно закрыть касанием.
    const timer = setTimeout(hide, kind === 'error' ? 5200 : 2600);
    return () => clearTimeout(timer);
  }, [message, kind, hide]);
  if (!message) return null;
  return (
    <Animated.View entering={SlideInDown} exiting={FadeOut} style={styles.toast}>
      <Pressable accessibilityRole="button" onPress={hide} style={styles.toastInner}>
        {kind === 'success' ? (
          <CheckCircle2 size={18} color={colors.success} />
        ) : (
          <AlertTriangle size={18} color={colors.error} />
        )}
        <Text style={styles.toastText}>{message}</Text>
        <X size={15} color={colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: colors.surfaceRaised, width: '100%' },
  state: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 300,
    paddingHorizontal: spacing.xl,
  },
  stateIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    height: 62,
    justifyContent: 'center',
    width: 62,
  },
  errorIcon: { backgroundColor: 'rgba(255,92,92,0.09)' },
  stateTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 20, textAlign: 'center' },
  stateBody: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  stateBodyLeft: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  confirmActions: { gap: spacing.sm },
  overlay: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    maxHeight: '90%',
    paddingBottom: 36,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 3,
    height: 4,
    width: 42,
  },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sheetTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 20 },
  modalOverlay: { justifyContent: 'center', padding: spacing.lg },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  toast: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    bottom: 96,
    elevation: 10,
    maxWidth: '90%',
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  toastInner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  toastText: { color: colors.text, flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14 },
});
