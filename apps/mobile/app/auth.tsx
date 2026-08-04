import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Eye, EyeOff, Video } from 'lucide-react-native';
import {
  KlyvoButton,
  KlyvoCard,
  KlyvoIconButton,
  KlyvoInput,
  KlyvoScreen,
  KlyvoSegmentedControl,
  useToast,
} from '../src/components/ui';
import { useTranslation } from '../src/i18n';
import { useAuthStore } from '../src/state/auth';
import { colors, fonts, radii, spacing } from '../src/theme';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const { t, tError } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { login, register } = useAuthStore();

  // Сообщение под каждым полем объясняет, что именно не так, а не «проверьте поля».
  const schema = useMemo(
    () =>
      z.object({
        name:
          mode === 'register'
            ? z.string().trim().min(2, t('errNameShort'))
            : z.string().optional(),
        email: z.email(t('errEmailFormat')),
        password: z.string().min(8, t('errPasswordShort')),
      }),
    [mode, t],
  );
  type FormData = z.infer<typeof schema>;

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const submit = handleSubmit(async (values) => {
    setLoading(true);
    try {
      if (mode === 'login') await login(values.email, values.password);
      else await register(values.name?.trim() || 'Creator', values.email, values.password);
      router.replace('/(tabs)');
    } catch (error) {
      toast.show(tError(error), 'error');
    } finally {
      setLoading(false);
    }
  });

  return (
    <KlyvoScreen contentStyle={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <View style={styles.hero}>
          <View style={styles.mark}>
            <Video size={23} color={colors.text} strokeWidth={1.7} />
          </View>
          <Text style={styles.brand}>Klyvo</Text>
          <Text style={styles.tagline}>{t('tagline')}</Text>
        </View>
        <KlyvoCard style={styles.form}>
          <KlyvoSegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'login', label: t('signIn') },
              { value: 'register', label: t('signUp') },
            ]}
          />
          {mode === 'register' ? (
            <Controller
              control={control}
              name="name"
              render={({ field }) => (
                <KlyvoInput
                  label={t('name')}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  error={errors.name?.message}
                />
              )}
            />
          ) : null}
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <KlyvoInput
                label={t('email')}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                error={errors.email?.message}
              />
            )}
          />
          <View>
            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <KlyvoInput
                  label={t('password')}
                  secureTextEntry={!visible}
                  autoCapitalize="none"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  error={errors.password?.message}
                  style={styles.passwordInput}
                />
              )}
            />
            <KlyvoIconButton
              icon={visible ? EyeOff : Eye}
              label={visible ? t('hidePassword') : t('showPassword')}
              size={36}
              onPress={() => setVisible(!visible)}
              style={styles.reveal}
            />
          </View>
          <KlyvoButton
            fullWidth
            size="lg"
            icon={ArrowRight}
            loading={loading}
            label={mode === 'login' ? t('signIn') : t('signUp')}
            onPress={() => void submit()}
          />
        </KlyvoCard>
        {/* Гостевой вход убран: библиотека, кредиты и публикации требуют настоящего аккаунта. */}
        <Text style={styles.hint}>{t('accountRequired')}</Text>
      </KeyboardAvoidingView>
    </KlyvoScreen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center', paddingBottom: spacing.xl },
  keyboard: { gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  mark: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 48,
  },
  brand: { color: colors.text, fontFamily: fonts.bold, fontSize: 34, letterSpacing: -1.5 },
  tagline: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 15 },
  form: { gap: spacing.lg },
  passwordInput: { paddingRight: 52 },
  reveal: { backgroundColor: 'transparent', borderWidth: 0, position: 'absolute', right: 6, top: 26 },
  guest: { gap: spacing.md },
  hint: {
    color: colors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
