import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { colors } from '../../theme';

export interface MasonryItem {
  id: string;
  width?: number;
  height?: number;
  /** Нужен, чтобы кладка успевала предзагрузить превью до появления плитки. */
  thumbnailUrl?: string;
  /** Нужен, чтобы заранее прогреть начало ролика по ходу прокрутки. */
  videoUrl?: string;
}

/** Сколько байт ролика тянем заранее: этого хватает на мгновенный старт. */
const WARM_BYTES = 512 * 1024;

interface Placed<T> {
  item: T;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Те же ограничения пропорций, что и у плитки, иначе колонки разъезжаются. */
function safeAspect(width?: number, height?: number, fallback = 0.72) {
  if (!width || !height) return fallback;
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio <= 0) return fallback;
  return Math.min(2.4, Math.max(0.5, ratio));
}

/**
 * Двухколоночная кладка с точным знанием положения каждой плитки.
 *
 * Положение и высота считаются заранее для всего списка, поэтому компонент может
 * делать две вещи, которых не умеет обычный список:
 *  - рисовать только то, что попадает в окно вокруг экрана (остальные плитки не
 *    существуют как компоненты, память не растёт с длиной ленты);
 *  - точно понимать, какие ролики видны, и включать воспроизведение ровно у них.
 */
export function KlyvoMasonry<T extends MasonryItem>({
  data,
  gap = 6,
  columns = 2,
  // Играет всё, что попало в экран: облегчённые копии весят меньше мегабайта,
  // поэтому шесть одновременных плееров ленту уже не топят.
  maxActive = 6,
  /** Сколько роликов прогреваем впереди по ходу прокрутки (без создания плееров). */
  warmCount = 6,
  /** На сколько экранов вперёд смотрит зона прогрева. */
  warmScreens = 1.5,
  settleDelay = 200,
  /** Сколько экранов рисовать выше и ниже видимой области. */
  overscanAbove = 1,
  overscanBelow = 1.5,
  paddingTop = 0,
  paddingBottom = 0,
  refreshing,
  header,
  footer,
  onRefresh,
  onEndReached,
  onActiveChange,
  renderItem,
}: {
  data: T[];
  gap?: number;
  columns?: number;
  maxActive?: number;
  warmCount?: number;
  warmScreens?: number;
  /** Сколько плитка должна продержаться на экране, прежде чем в ней запустится видео. */
  settleDelay?: number;
  overscanAbove?: number;
  overscanBelow?: number;
  paddingTop?: number;
  paddingBottom?: number;
  refreshing?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  onRefresh?: () => void;
  onEndReached?: () => void;
  onActiveChange?: (ids: string[]) => void;
  renderItem: (item: T, active: boolean) => ReactNode;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const [viewport, setViewport] = useState({ offset: 0, height: 0 });
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const activeKey = useRef('');
  const endReachedAt = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetched = useRef(new Set<string>());
  const warmed = useRef(new Set<string>());
  const committedOffset = useRef(0);
  /** Направление прокрутки: 1 — вниз, -1 — вверх. Задаёт, куда смотреть заранее. */
  const direction = useRef(1);
  const lastOffset = useRef(0);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const columnWidth = (screenWidth - gap * (columns + 1)) / columns;

  const { placed, contentHeight } = useMemo(() => {
    const heights = new Array<number>(columns).fill(0);
    const result: Placed<T>[] = [];
    for (const item of data) {
      const height = columnWidth / safeAspect(item.width, item.height);
      let column = 0;
      for (let index = 1; index < columns; index += 1) {
        if ((heights[index] ?? 0) < (heights[column] ?? 0)) column = index;
      }
      const top = heights[column] ?? 0;
      result.push({
        item,
        left: gap + column * (columnWidth + gap),
        top,
        width: columnWidth,
        height,
      });
      heights[column] = top + height + gap;
    }
    return { placed: result, contentHeight: Math.max(...heights, 0) };
  }, [columnWidth, columns, data, gap]);

  const recomputeActive = useCallback(
    (offset: number, height: number) => {
      if (!height) return;
      /**
       * Полоса запуска несимметрична и следует за направлением прокрутки:
       * по ходу движения она шире, поэтому плитка успевает начать играть
       * ещё до того, как полностью выедет на экран. Позади полоса узкая —
       * пройденные ролики освобождают плеер сразу.
       */
      const goingDown = direction.current >= 0;
      const top = offset - height * (goingDown ? 0.1 : 0.45);
      const bottom = offset + height * (goingDown ? 1.45 : 1.1);
      const center = offset + height / 2;
      /**
       * Играют не первые попавшиеся плитки, а ближайшие к центру экрана —
       * именно на них смотрит человек. Так же ограничение в maxActive тратится
       * на самое заметное, а не на карточку, наполовину ушедшую за край.
       */
      const visibleEntries = placed.filter(
        (entry) => entry.top < bottom && entry.top + entry.height > top,
      );
      const visible = visibleEntries
        .map((entry) => ({
          id: entry.item.id,
          distance: Math.abs(entry.top + entry.height / 2 - center),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxActive)
        .map((entry) => entry.id);
      const key = visible.join('|');
      if (key === activeKey.current) return;
      activeKey.current = key;

      /**
       * Плееры создаются не сразу: при быстрой прокрутке плитки пролетают мимо,
       * и создавать для каждой плеер — значит зря дёргать сеть и тормозить список.
       * Ролик стартует, только если плитка задержалась на экране.
       */
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        setActiveIds(visible);
        onActiveChange?.(visible);
      }, settleDelay);

      /**
       * Дальше по ходу прокрутки идёт зона прогрева. Плееры там не создаются —
       * их число ограничено железом, — но картинка и начало ролика уже скачиваются,
       * поэтому долистав до плитки, вы видите её сразу, без чёрного кадра.
       */
      const warmFrom = goingDown ? bottom : top - height * warmScreens;
      const warmTo = goingDown ? bottom + height * warmScreens : top;
      const warming = placed.filter(
        (entry) => entry.top < warmTo && entry.top + entry.height > warmFrom,
      );
      for (const entry of [...visibleEntries, ...warming].slice(0, maxActive + warmCount)) {
        const thumb = entry.item.thumbnailUrl;
        if (thumb && !prefetched.current.has(thumb)) {
          prefetched.current.add(thumb);
          void Image.prefetch(thumb).catch(() => undefined);
        }
      }
      for (const entry of warming.slice(0, warmCount)) {
        const media = entry.item.videoUrl;
        if (!media || warmed.current.has(media)) continue;
        warmed.current.add(media);
        // Тянем только начало файла: moov лежит в начале, этого достаточно для старта.
        void fetch(media, { headers: { Range: `bytes=0-${WARM_BYTES - 1}` } })
          .then((response) => response.arrayBuffer())
          .catch(() => undefined);
      }
      // Наборы ссылок не должны расти бесконечно на очень длинной ленте.
      if (prefetched.current.size > 400) prefetched.current.clear();
      if (warmed.current.size > 120) warmed.current.clear();
    },
    [maxActive, onActiveChange, placed, settleDelay, warmCount, warmScreens],
  );

  /**
   * Окно рендера. Плитки за его пределами не создаются вообще, поэтому память
   * не зависит от того, пролистали вы двадцать роликов или две тысячи.
   */
  const windowed = useMemo(() => {
    if (!viewport.height) return placed.slice(0, 8);
    const scroll = viewport.offset - paddingTop;
    const from = scroll - viewport.height * overscanAbove;
    const to = scroll + viewport.height * (1 + overscanBelow);
    return placed.filter((entry) => entry.top < to && entry.top + entry.height > from);
  }, [overscanAbove, overscanBelow, paddingTop, placed, viewport.height, viewport.offset]);

  // Догруженная страница должна включиться в проигрывание без ожидания следующего скролла.
  useEffect(() => {
    recomputeActive(viewport.offset - paddingTop, viewport.height);
  }, [paddingTop, recomputeActive, viewport.height, viewport.offset]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const offset = contentOffset.y;
    const height = layoutMeasurement.height;
    const delta = offset - lastOffset.current;
    // Мелкое дрожание направление не меняет.
    if (Math.abs(delta) > 4) direction.current = delta > 0 ? 1 : -1;
    lastOffset.current = offset;
    /**
     * Перерисовываем окно не на каждый кадр прокрутки, а раз в ~48 точек.
     * Запас окна больше экрана, поэтому пустых мест не появляется,
     * зато React не пересобирает список тридцать раз в секунду.
     */
    if (Math.abs(offset - committedOffset.current) > 48 || height !== viewport.height) {
      committedOffset.current = offset;
      setViewport({ offset, height });
    }
    recomputeActive(offset - paddingTop, height);
    if (
      onEndReached &&
      contentSize.height - (offset + height) < height * 0.8 &&
      Date.now() - endReachedAt.current > 600
    ) {
      endReachedAt.current = Date.now();
      onEndReached();
    }
  };

  return (
    <ScrollView
      scrollEventThrottle={32}
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;
        setViewport((current) => ({ ...current, height }));
        recomputeActive(viewport.offset - paddingTop, height);
      }}
      contentContainerStyle={{ paddingBottom }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            progressViewOffset={paddingTop}
            refreshing={Boolean(refreshing)}
            tintColor={colors.text}
            onRefresh={onRefresh}
          />
        ) : undefined
      }
    >
      <View style={{ height: paddingTop }}>{header}</View>
      {/* Высота контейнера известна заранее, поэтому полоса прокрутки и позиция
          остаются верными, даже когда большая часть плиток не отрисована. */}
      <View style={{ height: contentHeight }}>
        {windowed.map((entry) => (
          <View
            key={entry.item.id}
            style={{
              position: 'absolute',
              left: entry.left,
              top: entry.top,
              width: entry.width,
              height: entry.height,
            }}
          >
            {renderItem(entry.item, activeIds.includes(entry.item.id))}
          </View>
        ))}
      </View>
      {footer}
    </ScrollView>
  );
}
