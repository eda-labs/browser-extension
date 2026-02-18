import {
  Box,
  TextField,
  InputAdornment,
  IconButton,
  Typography,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

interface EdaUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoLogin: boolean;
  onAutoLoginChange: (checked: boolean) => void;
}

export function EdaUrlField({ value, onChange, disabled, autoLogin, onAutoLoginChange }: EdaUrlFieldProps) {
  return (
    <Box sx={{ px: 2, pt: 1.5, display: 'grid', gap: 1.5 }}>
      <TextField
        label="EDA URL"
        placeholder="eda.example.com"
        fullWidth
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/^https?:\/\//i, ''))}
        disabled={disabled}
        size="small"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start" sx={{ mr: 0 }}>
                <Typography sx={{ color: 'text.secondary', fontSize: 'inherit', whiteSpace: 'nowrap' }}>https://&nbsp;</Typography>
              </InputAdornment>
            ),
            endAdornment: value ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  edge="end"
                  onClick={() => window.open('https://' + value, '_blank')}
                  title="Open in new tab"
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          },
        }}
      />
      <FormControlLabel
        sx={{ pl: '2px' }}
        control={
          <Checkbox
            size="small"
            checked={autoLogin}
            onChange={(e) => onAutoLoginChange(e.target.checked)}
          />
        }
        label={
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Auto-login to EDA UI (dangerous)
          </Typography>
        }
      />
    </Box>
  );
}
