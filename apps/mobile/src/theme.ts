export const colors = {
  background: '#09090B',
  surface: '#0F0F11',
  surfaceRaised: '#18181B',
  lime: '#FAFAFA',
  limeStrong: '#FFFFFF',
  text: '#FAFAFA',
  textMuted: '#A1A1AA',
  border: '#27272A',
  borderStrong: '#3F3F46',
  error: '#F87171',
  warning: '#FBBF24',
  success: '#A1A1AA',
  overlay: 'rgba(0,0,0,0.78)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 44 } as const;
export const radii = { sm: 6, md: 9, lg: 12, xl: 16, pill: 999 } as const;
export const fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',
} as const;
