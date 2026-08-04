import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Coins, RefreshCcw, Sparkles } from 'lucide-react-native';
import { apiRequest } from '../src/api/client';
import {
  ScreenHeader,
  KlyvoButton,
  KlyvoCard,
  KlyvoChip,
  KlyvoErrorState,
  KlyvoIconButton,
  KlyvoScreen,
  KlyvoSkeleton,
  useToast,
} from '../src/components/ui';
import { useTranslation } from '../src/i18n';
import { colors, fonts, radii, spacing } from '../src/theme';

interface Product {
  id: string;
  name: string;
  credits: number;
  priceAmount: number;
  currency: string;
  featured?: boolean;
}

export default function ShopScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, tError, language } = useTranslation();
  const toast = useToast();
  const [outcome, setOutcome] = useState<'SUCCESS' | 'CANCEL' | 'ERROR'>('SUCCESS');
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiRequest<{ products: Product[] }>('/products', { skipAuth: true }),
  });
  const purchase = useMutation({
    mutationFn: (productId: string) =>
      apiRequest<{ status: string }>('/purchases/mock', {
        method: 'POST',
        body: JSON.stringify({ productId, outcome, platform: 'MOCK' }),
      }),
    onSuccess: (result) => {
      toast.show(result.status === 'CANCELED' ? t('purchaseCanceled') : t('purchaseSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });
  const restore = useMutation({
    mutationFn: () => apiRequest<{ restored: number }>('/purchases/restore', { method: 'POST' }),
    onSuccess: ({ restored }) =>
      toast.show(restored ? t('restoreDone') : t('restoreNone'), restored ? 'success' : 'error'),
    onError: (error) => toast.show(tError(error), 'error'),
  });
  const formatPrice = (item: Product) =>
    new Intl.NumberFormat(language === 'kk' ? 'kk-KZ' : language === 'ru' ? 'ru-RU' : 'en-US', {
      style: 'currency',
      currency: item.currency,
    }).format(item.priceAmount / 100);

  return (
    <KlyvoScreen>
      <View style={styles.top}>
        <KlyvoIconButton icon={ChevronLeft} label={t('back')} onPress={() => router.back()} />
      </View>
      <ScreenHeader title={t('storeTitle')} subtitle={t('storeSubtitle')} />

      {/* Честное предупреждение вместо значка «MOCK SECURE», который читался как настоящая защита. */}
      <KlyvoCard style={styles.notice}>
        <Text style={styles.noticeText}>{t('storeNotice')}</Text>
      </KlyvoCard>

      {/* Переключатель тестовых сценариев виден только в дев-сборке. */}
      {__DEV__ ? (
        <View style={styles.mock}>
          <Text style={styles.mockLabel}>{t('testScenario')}</Text>
          <View style={styles.mockOptions}>
            <KlyvoChip
              label={t('testSuccess')}
              selected={outcome === 'SUCCESS'}
              onPress={() => setOutcome('SUCCESS')}
            />
            <KlyvoChip
              label={t('testCancel')}
              selected={outcome === 'CANCEL'}
              onPress={() => setOutcome('CANCEL')}
            />
            <KlyvoChip
              label={t('testError')}
              selected={outcome === 'ERROR'}
              onPress={() => setOutcome('ERROR')}
            />
          </View>
        </View>
      ) : null}

      {products.isError ? (
        <KlyvoErrorState
          title={t('offlineTitle')}
          body={t('offlineBody')}
          actionLabel={t('tryAgain')}
          onAction={() => void products.refetch()}
        />
      ) : products.isLoading ? (
        <View style={styles.products}>
          <KlyvoSkeleton height={112} />
          <KlyvoSkeleton height={112} />
          <KlyvoSkeleton height={112} />
        </View>
      ) : (
        <View style={styles.products}>
          {products.data?.products.map((item) => (
            <KlyvoCard
              key={item.id}
              accent={item.featured}
              style={[styles.product, ...(item.featured ? [styles.productFeatured] : [])]}
            >
              {item.featured ? (
                <View style={styles.popular}>
                  <Sparkles color={colors.background} size={12} />
                  <Text style={styles.popularText}>{t('popular')}</Text>
                </View>
              ) : null}
              <View style={styles.productIcon}>
                <Coins color={colors.text} size={23} />
              </View>
              <View style={styles.productCopy}>
                <Text style={styles.productName}>{item.name}</Text>
                <View style={styles.credits}>
                  <Text style={styles.creditNumber}>{item.credits}</Text>
                  <Text style={styles.creditLabel}>{t('credits')}</Text>
                </View>
              </View>
              <View style={styles.priceWrap}>
                <Text style={styles.price}>{formatPrice(item)}</Text>
                <KlyvoButton
                  label={t('buy')}
                  size="sm"
                  loading={purchase.isPending && purchase.variables === item.id}
                  onPress={() => purchase.mutate(item.id)}
                />
              </View>
            </KlyvoCard>
          ))}
        </View>
      )}
      <KlyvoButton
        fullWidth
        label={t('restore')}
        icon={RefreshCcw}
        variant="ghost"
        loading={restore.isPending}
        onPress={() => restore.mutate()}
      />
    </KlyvoScreen>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'flex-start', flexDirection: 'row' },
  notice: { backgroundColor: colors.surfaceRaised },
  noticeText: { color: colors.warning, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  mock: { gap: spacing.sm },
  mockLabel: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 12 },
  mockOptions: { flexDirection: 'row', gap: spacing.sm },
  products: { gap: spacing.md },
  product: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 112,
    overflow: 'hidden',
  },
  productFeatured: { backgroundColor: colors.surfaceRaised },
  popular: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderBottomLeftRadius: radii.sm,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  popularText: {
    color: colors.background,
    fontFamily: fonts.extraBold,
    fontSize: 9,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  productIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  productCopy: { flex: 1, gap: 3 },
  productName: { color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  credits: { alignItems: 'baseline', flexDirection: 'row', gap: 5 },
  creditNumber: { color: colors.text, fontFamily: fonts.bold, fontSize: 25 },
  creditLabel: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  priceWrap: { alignItems: 'flex-end', gap: spacing.sm },
  price: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
});
