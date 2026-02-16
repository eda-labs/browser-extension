import '@fontsource/roboto/latin-300.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import './nokia-fonts.css';
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  typography: {
    fontFamily: '"NokiaPureText", "Roboto", sans-serif',
  },
  palette: {
    mode: 'dark',
    primary: { main: '#6098FF' },
    error: { main: '#FF6363' },
    warning: { main: '#FFAC0A' },
    success: { main: '#00A87E' },
    info: { main: '#90B7FF' },
    background: { default: '#1A222E', paper: '#101824' },
    text: { primary: '#ffffff', secondary: '#C9CED6' },
    divider: '#4A5361B2',
  },
});

export default theme;
