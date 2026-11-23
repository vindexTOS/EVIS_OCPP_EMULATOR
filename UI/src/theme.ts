import { createTheme, type MantineColorsTuple } from '@mantine/core';

const evis: MantineColorsTuple = [
  '#e6fbf1',
  '#c9f5df',
  '#9aebc2',
  '#66dfa2',
  '#3bd487',
  '#22c877',
  '#16ad64',
  '#108a50',
  '#0c6c3f',
  '#084e2e',
];

/** Mantine's greys for the dark scheme, tuned to the app's surfaces (tokens.css). */
const dark: MantineColorsTuple = [
  '#d7dde5',
  '#b4beca',
  '#8f9aa9',
  '#6b7686',
  '#36414d',
  '#27313c',
  '#19212b',
  '#121820',
  '#0c1117',
  '#07090d',
];

export const theme = createTheme({
  primaryColor: 'evis',
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  luminanceThreshold: 0.38,
  colors: { evis, dark },
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  headings: { fontFamily: 'var(--font-sans)', fontWeight: '650' },
  defaultRadius: 'md',
  components: {
    Modal: {
      defaultProps: {
        centered: true,
        radius: 'lg',
        overlayProps: { blur: 3, backgroundOpacity: 0.55 },
      },
    },
    Drawer: { defaultProps: { overlayProps: { blur: 2, backgroundOpacity: 0.45 } } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
    Menu: { defaultProps: { shadow: 'lg', radius: 'md', withinPortal: true } },
    Popover: { defaultProps: { shadow: 'lg', radius: 'md', withinPortal: true } },
    Switch: {
      defaultProps: { size: 'md' },
      styles: { label: { fontSize: 14, fontWeight: 500 }, description: { fontSize: 12.5 } },
    },
  },
});
