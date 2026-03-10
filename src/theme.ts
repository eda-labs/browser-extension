import '@fontsource/roboto/latin-300.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import { createTheme, type PaletteOptions } from '@mui/material/styles';
import { DEFAULT_THEME_MODE, type ThemeMode } from './core/theme-mode';

function buildPalette(mode: ThemeMode): PaletteOptions {
  if (mode === 'light') {
    return {
      mode: 'light',
      primary: { main: '#366EDC' },
      error: { main: '#D14343' },
      warning: { main: '#B56A00' },
      success: { main: '#007A5A' },
      info: { main: '#2F72FF' },
      background: { default: '#ECF1F7', paper: '#FFFFFF' },
      text: { primary: '#172334', secondary: '#4A5D74' },
      divider: '#CBD6E4',
    };
  }

  return {
    mode: 'dark',
    primary: { main: '#6098FF' },
    error: { main: '#FF6363' },
    warning: { main: '#FFAC0A' },
    success: { main: '#00A87E' },
    info: { main: '#90B7FF' },
    background: { default: '#1A222E', paper: '#101824' },
    text: { primary: '#ffffff', secondary: '#C9CED6' },
    divider: '#4A5361B2',
  };
}

export function createAppTheme(mode: ThemeMode = DEFAULT_THEME_MODE) {
  return createTheme({
    typography: {
      fontFamily: '"Roboto", sans-serif',
    },
    components: {
      MuiButton: {
        styleOverrides: {
          contained: ({ theme: t }) => ({
            color: t.palette.mode === 'dark' ? t.palette.text.primary : t.palette.common.white,
          }),
        },
      },
    },
    palette: buildPalette(mode),
  });
}

const theme = createAppTheme(DEFAULT_THEME_MODE);

export default theme;
