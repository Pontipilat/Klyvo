import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { ChevronLeft } from 'lucide-react-native';
import { apiRequest } from '../src/api/client';
import {
  KlyvoEmptyState,
  KlyvoErrorState,
  KlyvoIconButton,
  KlyvoSkeleton,
  ScreenHeader,
} from '../src/components/ui';
import { useTranslation, type Translate } from '../src/i18n';
import { colors, fonts, spacing } from '../src/theme';

interface Transaction {
  id: string;
  type: 'PURCHASE' | 'CHARGE' | 'REFUND' | 'RESERVE' | 'BONUS';
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}
interface TransactionPage {
  items: Transaction[];
  nextCursor?: string;
}

function typeLabel(type: Transaction['type'], t: Translate) {
  switch (type) {
    case 'PURCHASE':
      return t('txPurchase');
    case 'CHARGE':
      return t('txCharge');
    case 'REFUND':
      return t('txRefund');
    case 'RESERVE':
      return t('txReserve');
    default:
      return t('txBonus');
  }
}

export default function TransactionsScreen() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['transactions'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<TransactionPage>(
        `/wallet/transactions?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data?.pages],
  );
  const locale = language === 'kk' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU';

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.header}>
        <KlyvoIconButton icon={ChevronLeft} label={t('back')} onPress={() => router.back()} />
        <ScreenHeader title={t('transactionsTitle')} />
      </View>
      {query.isError ? (
        <KlyvoErrorState
          title={t('offlineTitle')}
          body={t('offlineBody')}
          actionLabel={t('tryAgain')}
          onAction={() => void query.refetch()}
        />
      ) : query.isLoading ? (
        <View style={styles.loading}>
          <KlyvoSkeleton height={64} />
          <KlyvoSkeleton height={64} />
          <KlyvoSkeleton height={64} />
        </View>
      ) : !items.length ? (
        <KlyvoEmptyState title={t('transactionsEmpty')} body={t('transactionsEmptyBody')} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.text}
              onRefresh={() => {
                setRefreshing(true);
                void query.refetch().finally(() => setRefreshing(false));
              }}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{typeLabel(item.type, t)}</Text>
                <Text style={styles.rowDate}>
                  {new Date(item.createdAt).toLocaleString(locale, {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <View style={styles.rowValue}>
                <Text style={[styles.amount, item.amount >= 0 ? styles.plus : styles.minus]}>
                  {item.amount >= 0 ? '+' : ''}
                  {item.amount}
                </Text>
                <Text style={styles.rowDate}>
                  {item.balanceAfter} {t('creditsShort')}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  loading: { gap: spacing.md, padding: spacing.lg },
  list: { paddingBottom: 60, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 64,
  },
  rowCopy: { flex: 1, gap: 3 },
  rowValue: { alignItems: 'flex-end', gap: 3 },
  rowTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  rowDate: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  amount: { fontFamily: fonts.bold, fontSize: 16 },
  plus: { color: colors.text },
  minus: { color: colors.textMuted },
});
