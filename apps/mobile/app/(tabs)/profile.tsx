import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  Coins,
  FileClock,
  FileText,
  History,
  Languages,
  LogOut,
  ShieldCheck,
  Trash2,
  UserRound,
  UserPlus,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { Language, WalletDto } from '@klyvo/shared';
import { apiRequest } from '../../src/api/client';
import {
  ScreenHeader,
  KlyvoBottomSheet,
  KlyvoButton,
  KlyvoCard,
  KlyvoChip,
  KlyvoConfirm,
  KlyvoCreditBadge,
  KlyvoScreen,
  useToast,
} from '../../src/components/ui';
import { useI18nStore, useTranslation } from '../../src/i18n';
import { useAuthStore } from '../../src/state/auth';
import { colors, fonts, radii, spacing } from '../../src/theme';

function SettingRow({
  icon: Icon,
  label,
  value,
  danger,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
      <View style={[styles.settingIcon, danger && styles.dangerIcon]}>
        <Icon color={danger ? colors.error : colors.textMuted} size={19} />
      </View>
      <Text style={[styles.settingLabel, danger && styles.dangerText]}>{label}</Text>
      {value ? <Text style={styles.settingValue}>{value}</Text> : null}
      <ChevronRight color={colors.textMuted} size={17} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { t, tError, language } = useTranslation();
  const setLanguage = useI18nStore((state) => state.setLanguage);
  const { user, logout, deleteAccount } = useAuthStore();
  const toast = useToast();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: () => apiRequest<WalletDto>('/wallet'),
  });
  const languageLabels: Record<Language, string> = {
    ru: t('russian'),
    kk: t('kazakh'),
    en: t('english'),
  };

  const removeAccount = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      toast.show(t('accountDeleted'));
      router.replace('/auth');
    } catch (error) {
      toast.show(tError(error), 'error');
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <KlyvoScreen>
      <ScreenHeader title={t('profile')} subtitle={t('profileSubtitle')} />

      <KlyvoCard style={styles.identity}>
        <View style={styles.avatar}>
          <UserRound color={colors.text} size={30} />
        </View>
        <View style={styles.identityCopy}>
          <Text style={styles.name}>{user?.displayName ?? '—'}</Text>
          {/* Служебный email гостя пользователю не показываем. */}
          <Text style={styles.email}>{user?.isGuest ? t('guestBadge') : (user?.email ?? '')}</Text>
        </View>
        {/* Баланс показывается только когда он реально получен с сервера. */}
        {wallet.data ? <KlyvoCreditBadge amount={wallet.data.availableBalance} /> : null}
      </KlyvoCard>

      {user?.isGuest ? (
        <KlyvoCard style={styles.guestCard} accent>
          <Text style={styles.guestTitle}>{t('guestBadge')}</Text>
          <Text style={styles.guestBody}>{t('guestUpgradeBody')}</Text>
          <KlyvoButton
            label={t('guestUpgrade')}
            icon={UserPlus}
            variant="secondary"
            onPress={() => void logout().then(() => router.replace('/auth'))}
          />
        </KlyvoCard>
      ) : null}

      <KlyvoCard style={styles.balanceCard} accent>
        <View>
          <Text style={styles.balanceLabel}>{t('balance')}</Text>
          <View style={styles.balanceValue}>
            <Text style={styles.balanceNumber}>{wallet.data?.balance ?? '—'}</Text>
            <Text style={styles.balanceUnit}>{t('credits')}</Text>
          </View>
          {wallet.data && wallet.data.reservedBalance > 0 ? (
            <Text style={styles.balanceUnit}>
              {t('reserved')}: {wallet.data.reservedBalance}
            </Text>
          ) : null}
        </View>
        <KlyvoButton label={t('topUp')} icon={Coins} onPress={() => router.push('/shop')} />
      </KlyvoCard>

      <SettingsGroup title={t('account')}>
        <SettingRow
          icon={History}
          label={t('spendingHistory')}
          onPress={() => router.push('/transactions')}
        />
        <SettingRow
          icon={Languages}
          label={t('language')}
          value={languageLabels[language]}
          onPress={() => setLanguageOpen(true)}
        />
      </SettingsGroup>

      <SettingsGroup title={t('legal')}>
        <SettingRow
          icon={ShieldCheck}
          label={t('privacy')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
        />
        <SettingRow
          icon={FileText}
          label={t('terms')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}
        />
        <SettingRow
          icon={FileClock}
          label={t('storagePolicy')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'storage' } })}
        />
        <SettingRow
          icon={ShieldCheck}
          label={t('contentRules')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'content' } })}
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow
          icon={LogOut}
          label={t('logout')}
          onPress={() => void logout().then(() => router.replace('/auth'))}
        />
        <SettingRow
          icon={Trash2}
          label={t('deleteAccount')}
          danger
          onPress={() => setDeleteOpen(true)}
        />
      </SettingsGroup>

      <KlyvoBottomSheet
        visible={languageOpen}
        title={t('language')}
        onClose={() => setLanguageOpen(false)}
      >
        <View style={styles.languageList}>
          {(['ru', 'kk', 'en'] as const).map((value) => (
            <KlyvoChip
              key={value}
              label={languageLabels[value]}
              selected={value === language}
              onPress={() => {
                void setLanguage(value);
                setLanguageOpen(false);
              }}
            />
          ))}
        </View>
      </KlyvoBottomSheet>

      <KlyvoConfirm
        visible={deleteOpen}
        destructive
        icon={Trash2}
        title={t('deleteAccountTitle')}
        body={t('deleteAccountBody')}
        confirmLabel={t('deleteAccountConfirm')}
        cancelLabel={t('cancel')}
        loading={deleting}
        onConfirm={() => void removeAccount()}
        onClose={() => setDeleteOpen(false)}
      />
    </KlyvoScreen>
  );
}

function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <KlyvoCard style={styles.groupCard}>{children}</KlyvoCard>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  identityCopy: { flex: 1, gap: 3 },
  name: { color: colors.text, fontFamily: fonts.bold, fontSize: 18 },
  email: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13 },
  guestCard: { gap: spacing.md },
  guestTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  guestBody: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  balanceCard: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  balanceLabel: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13 },
  balanceValue: { alignItems: 'baseline', flexDirection: 'row', gap: 6 },
  balanceNumber: { color: colors.text, fontFamily: fonts.extraBold, fontSize: 34 },
  balanceUnit: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  group: { gap: spacing.md },
  groupTitle: {
    color: colors.textMuted,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 1.2,
    paddingHorizontal: spacing.xs,
    textTransform: 'uppercase',
  },
  groupCard: { padding: 0 },
  setting: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 58,
    paddingHorizontal: spacing.md,
  },
  pressed: { opacity: 0.66 },
  settingIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  dangerIcon: { backgroundColor: 'rgba(255,92,92,0.08)' },
  settingLabel: { color: colors.text, flex: 1, fontFamily: fonts.semibold, fontSize: 14 },
  settingValue: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13 },
  dangerText: { color: colors.error },
  languageList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
