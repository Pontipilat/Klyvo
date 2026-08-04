import type { ComponentType, ReactNode } from 'react';
import { forwardRef } from 'react';
import type { PressableProps, TextInputProps, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import type { LucideProps } from 'lucide-react-native';
import { Coins } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../../theme';

type IconType = ComponentType<LucideProps>;

interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconType;
  loading?: boolean;
  fullWidth?: boolean;
}

export function KlyvoButton({
  label,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading,
  disabled,
  fullWidth,
  onPress,
  style,
  ...props
}: ButtonProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[fullWidth && styles.fullWidth, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled || loading}
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 18, stiffness: 350 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 18, stiffness: 350 });
        }}
        onPress={(event) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress?.(event);
        }}
        {...props}
        style={({ pressed }) => [
          styles.button,
          styles[`button_${variant}`],
          styles[`button_${size}`],
          fullWidth && styles.fullWidth,
          (disabled || loading) && styles.disabled,
          pressed && styles.pressed,
          typeof style === 'function' ? style({ pressed, hovered: false }) : style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={variant === 'primary' ? colors.background : colors.text} />
        ) : (
          <>
            {Icon ? (
              <Icon
                size={size === 'sm' ? 16 : 19}
                color={variant === 'primary' ? colors.background : colors.text}
              />
            ) : null}
            <Text
              style={[
                styles.buttonText,
                styles[`buttonText_${variant}`],
                size === 'sm' && styles.buttonTextSm,
              ]}
            >
              {label}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

interface IconButtonProps extends PressableProps {
  icon: IconType;
  label: string;
  active?: boolean;
  size?: number;
}
export function KlyvoIconButton({
  icon: Icon,
  label,
  active,
  size = 42,
  style,
  disabled,
  ...props
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      disabled={disabled}
      {...props}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size },
        active && styles.iconButtonActive,
        disabled && styles.disabled,
        pressed && styles.pressed,
        typeof style === 'function' ? style({ pressed, hovered: false }) : style,
      ]}
    >
      <Icon size={size * 0.46} color={active ? colors.background : colors.text} />
    </Pressable>
  );
}

/** Переключатель для настроек публикации. */
export function KlyvoToggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {description ? <Text style={styles.toggleHint}>{description}</Text> : null}
      </View>
      <View style={[styles.toggle, value && styles.toggleActive]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobActive]} />
      </View>
    </Pressable>
  );
}

interface CardProps {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  accent?: boolean;
}
export function KlyvoCard({ children, style, accent }: CardProps) {
  return <View style={[styles.card, accent && styles.cardAccent, style]}>{children}</View>;
}

interface FieldProps extends TextInputProps {
  label?: string;
  error?: string;
}
export const KlyvoInput = forwardRef<TextInput, FieldProps>(function KlyvoInput(
  { label, error, style, ...props },
  ref,
) {
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.text}
        style={[styles.input, error && styles.inputError, style]}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
});

export const KlyvoTextArea = forwardRef<TextInput, FieldProps>(function KlyvoTextArea(props, ref) {
  return (
    <KlyvoInput
      ref={ref}
      multiline
      textAlignVertical="top"
      style={[styles.textArea, props.style]}
      {...props}
    />
  );
});

interface ChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  icon?: IconType;
}
export function KlyvoChip({ label, selected, disabled, onPress, icon: Icon }: ChipProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {Icon ? <Icon size={15} color={selected ? colors.background : colors.textMuted} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

interface Segment<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}
export function KlyvoSegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Segment<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmentWrap}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            disabled={option.disabled}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              selected && styles.segmentSelected,
              option.disabled && styles.disabled,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.segmentText, selected && styles.segmentTextSelected]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function KlyvoCreditBadge({ amount, label }: { amount: number; label?: string }) {
  return (
    <View style={styles.creditBadge}>
      <Coins size={15} color={colors.textMuted} />
      <Text style={styles.creditValue}>{amount}</Text>
      {label ? <Text style={styles.creditLabel}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fullWidth: { width: '100%' },
  button: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  button_primary: { backgroundColor: colors.text },
  button_secondary: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
  },
  button_ghost: { backgroundColor: 'transparent' },
  button_danger: {
    backgroundColor: 'rgba(255,92,92,0.12)',
    borderColor: 'rgba(255,92,92,0.28)',
    borderWidth: 1,
  },
  button_sm: { minHeight: 36 },
  button_md: { minHeight: 44 },
  button_lg: { minHeight: 50 },
  buttonText: { color: colors.background, fontFamily: fonts.bold, fontSize: 15 },
  buttonText_primary: { color: colors.background },
  buttonText_secondary: { color: colors.text },
  buttonText_ghost: { color: colors.text },
  buttonText_danger: { color: colors.error },
  buttonTextSm: { fontSize: 13 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.82 },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  iconButtonActive: { backgroundColor: colors.text, borderColor: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  cardAccent: { borderColor: colors.borderStrong },
  fieldWrap: { gap: spacing.sm },
  fieldLabel: {
    color: colors.textMuted,
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputError: { borderColor: colors.error },
  errorText: { color: colors.error, fontFamily: fonts.medium, fontSize: 12 },
  textArea: { minHeight: 142, paddingTop: spacing.lg },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  chipSelected: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 13 },
  chipTextSelected: { color: colors.background },
  segmentWrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  segmentSelected: { backgroundColor: colors.surfaceRaised },
  segmentText: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 13 },
  segmentTextSelected: { color: colors.text },
  creditBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  creditValue: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  creditLabel: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  toggleRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  toggleCopy: { flex: 1, gap: 2 },
  toggleLabel: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  toggleHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  toggle: { backgroundColor: colors.surfaceRaised, borderRadius: 15, height: 28, padding: 3, width: 50 },
  toggleActive: { backgroundColor: colors.text },
  toggleKnob: { backgroundColor: colors.textMuted, borderRadius: 11, height: 22, width: 22 },
  toggleKnobActive: { backgroundColor: colors.background, transform: [{ translateX: 22 }] },
});
