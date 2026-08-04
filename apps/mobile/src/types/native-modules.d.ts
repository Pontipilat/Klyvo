declare module '*.png' {
  const asset: number;
  export default asset;
}

declare module 'react-native-svg' {
  import type { ColorValue, ViewProps } from 'react-native';

  export interface SvgProps extends ViewProps {
    color?: ColorValue;
    fill?: ColorValue | string;
    stroke?: ColorValue | string;
    strokeWidth?: number | string;
    width?: number | string;
    height?: number | string;
  }
}

declare module '@shopify/flash-list' {
  import type { ReactElement } from 'react';
  import type { FlatListProps } from 'react-native';

  export function FlashList<ItemT>(props: FlatListProps<ItemT>): ReactElement;
}
