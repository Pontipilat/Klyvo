import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../../theme';

const MAX_SCALE = 5;

/**
 * Просмотр картинки во весь экран с масштабированием.
 *
 * Обычный `Image` показывает результат целиком и не даёт разглядеть детали —
 * а у картинки это единственный способ оценить генерацию. Щипок увеличивает,
 * перетаскивание двигает, двойное касание возвращает к исходному виду.
 */
export function KlyvoImageViewer({
  uri,
  visible,
  closeLabel,
  hintLabel,
  onClose,
}: {
  uri: string;
  visible: boolean;
  closeLabel: string;
  hintLabel?: string;
  onClose: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const reset = () => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    offsetX.value = withTiming(0);
    offsetY.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
    setZoomed(false);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(setZoomed)(scale.value > 1.01);
    });

  // Двигать имеет смысл только увеличенную картинку, иначе жест перехватывает пролистывание.
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((event) => {
      if (scale.value <= 1) return;
      offsetX.value = savedX.value + event.translationX;
      offsetY.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = offsetX.value;
      savedY.value = offsetY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(reset)();
    });

  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        reset();
        onClose();
      }}
    >
      <View style={styles.backdrop}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={styles.stage}>
            <Animated.Image source={{ uri }} resizeMode="contain" style={[styles.image, imageStyle]} />
          </Animated.View>
        </GestureDetector>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          hitSlop={12}
          onPress={() => {
            reset();
            onClose();
          }}
          style={styles.close}
        >
          <X color={colors.text} size={22} />
        </Pressable>

        {hintLabel && !zoomed ? <Text style={styles.hint}>{hintLabel}</Text> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000', flex: 1 },
  stage: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  image: { height: '100%', width: '100%' },
  close: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radii.pill,
    height: 40,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.lg,
    top: spacing.xxl,
    width: 40,
  },
  hint: {
    alignSelf: 'center',
    bottom: spacing.xxl,
    color: colors.textMuted,
    fontFamily: fonts.medium,
    fontSize: 13,
    position: 'absolute',
  },
});
